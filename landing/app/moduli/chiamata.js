// Schermate della chiamata solo voce (issue #4, spec v1, v1.1 e v1.2 del CPO; passo 3c-1).
// Due parti, tutte e due senza pagina e senza audio, così si provano con node --test:
//   1. creaChiamata: parla con /app/api/chiamata (stesso sito, token di Supabase). Il corpo non dice mai chi chiama:
//      lo dice solo il token. Al telefono tornano solo ok/motivo, la descrizione SDP e la «vista».
//   2. schermata: dalla vista del server decide cosa mostrare (squillo, timer, banner, Carte, ultimo minuto).
// Tempi e regole li decide il server; qui solo testi. Niente registrazioni, niente video, niente salvataggi locali.
// Le richieste rispondono solo con l'accesso acceso (ACCESSO_APP = «si»).

const PERCORSO = "/app/api/chiamata";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ATTESA_MS = 8000;
export const BANNER = "Niente numeri, cognomi o social prima della porta";
const SECONDI_BANNER = 10;

// Testi per ogni «no». Quelli della specifica sono identici a api/chiamate.js.
const TESTI = Object.freeze({
  occupato: "È in un'altra chiamata",
  tre_con_lei: "Avete già parlato 3 volte. Ora tocca alle chiavi",
  cinque_oggi: "Per oggi hai fatto 5 chiamate. A domani",
  cinque_oggi_lei: "Oggi non può ricevere altre chiamate. Riprova domani",
  fuori_fascia: "Ora non è disponibile. Riprova più tardi",
  serve_permesso: "Chiedi di parlare",
  non_in_stanza: "Potete chiamarvi solo dentro la stessa stanza",
  stanza_chiusa: "La stanza è chiusa",
  stanza_chiude: "La stanza sta per chiudere: niente nuove chiamate",
  bloccati: "Non potete chiamarvi",
  gia_in_chiamata: "Sei già in un'altra chiamata",
  troppo_presto: "Aspetta qualche secondo per la prossima carta",
  fuori_tempo: "Le carte ora non ci sono",
  nessuna_carta: "Le carte ora non ci sono",
  nessuna: "La chiamata è già finita",
  non_tocca_a_te: "La chiamata è già finita",
  accesso: "Accedi di nuovo per chiamare",
  troppe: "Troppi tentativi. Aspetta un minuto",
  spento: "Le chiamate non sono ancora attive",
  microfono: "Per chiamare serve il microfono. Consentilo nelle impostazioni del telefono e riprova",
  rete: "Sei senza connessione. Riprova tra poco",
});
const GENERICO = "Non è andata. Riprova tra poco";
const MOTIVI = new Set([...Object.keys(TESTI), "riprova", "dati", "solo_voce"]);

const RISPOSTE_DOPO = new Set(["si", "no", "salta"]);

export const testoMotivo = (motivo) => (Object.hasOwn(TESTI, motivo) ? TESTI[motivo] : GENERICO);

// «15:00», «14:05», «0:59».
export function testoTimer(restanti) {
  const s = Number.isFinite(restanti) ? Math.max(0, Math.floor(restanti)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function creaChiamata({ token, fetch: f = globalThis.fetch, attesa = ATTESA_MS }) {
  async function richiesta(passo, corpo) {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return { ok: false, motivo: "accesso" };
    const ferma = new AbortController();
    const timer = setTimeout(() => ferma.abort(), attesa);
    let r;
    try {
      r = await f(passo ? `${PERCORSO}/${passo}` : PERCORSO, {
        method: passo ? "POST" : "GET",
        signal: ferma.signal,
        headers: { authorization: `Bearer ${t}`, ...(passo ? { "content-type": "application/json" } : {}) },
        ...(passo ? { body: JSON.stringify(corpo || {}) } : {}),
      });
    } catch {
      clearTimeout(timer);
      return { ok: false, motivo: "rete" };
    }
    try {
      if (r.status === 401) return { ok: false, motivo: "accesso" };
      if (r.status === 429) return { ok: false, motivo: "troppe" };
      if (r.status === 404) return { ok: false, motivo: "spento" };
      const dati = await r.json();
      if (!dati || typeof dati !== "object") return { ok: false, motivo: "riprova" };
      if (dati.ok !== true) return { ok: false, motivo: MOTIVI.has(dati.motivo) ? dati.motivo : "riprova" };
      if (!r.ok) return { ok: false, motivo: "riprova" };
      const fine = { ok: true };
      if (typeof dati.descrizione === "string") fine.descrizione = dati.descrizione;
      fine.vista = dati.vista && typeof dati.vista === "object" ? dati.vista : null;
      if (dati.segnala === true) fine.segnala = true;
      if (passo === "dopo") return { ok: true, dopo: dati.dopo && typeof dati.dopo === "object" ? dati.dopo : null };
      if (passo === "richiameresti") return { ok: true, salvata: dati.salvata === true };
      return fine;
    } catch {
      return { ok: false, motivo: "riprova" };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    stato: () => richiesta(null),
    async apri(verso, offerta) {
      if (!UUID.test(verso || "")) return { ok: false, motivo: "dati" };
      return richiesta("apri", { verso, offerta });
    },
    rispondi: (offerta) => richiesta("rispondi", { offerta }),
    rifiuta: () => richiesta("rifiuta", {}),
    chiudi: (segnala = false) => richiesta("chiudi", { segnala: segnala === true }),
    ascolta: () => richiesta("ascolta", {}),
    conferma: (risposta) => richiesta("conferma", { risposta }),
    caduta: () => richiesta("caduta", {}),
    rientro: (offerta) => richiesta("rientro", { offerta }),
    carta: () => richiesta("carta", {}),
    // Dopo la chiamata (3c-4b-2): il server dice cosa mostrare; «appena» = la chiamata è appena finita su questo telefono.
    dopo: (appena = false) => richiesta("dopo", { appena: appena === true }),
    async richiameresti(chiamata, risposta) {
      const c = chiamata && typeof chiamata === "object" ? chiamata : null;
      if (!c || !UUID.test(c.chi || "") || typeof c.inizio !== "string" || !RISPOSTE_DOPO.has(risposta)) return { ok: false, motivo: "dati" };
      return richiesta("richiameresti", { chi: c.chi, inizio: c.inizio, risposta });
    },
  };
}

// Cosa mostrare. vista: quella del server (o null). nomeAltra: il nome mostrato nella stanza. secondiVisti: da quanti
// secondi questo telefono vede la chiamata in corso (per il banner dei primi 10 secondi; se manca il banner resta).
export function schermata(vista, { nomeAltra = "", secondiVisti } = {}) {
  if (!vista || typeof vista !== "object") return { tipo: "nessuna" };
  const nome = typeof nomeAltra === "string" ? nomeAltra.trim() : "";

  if (vista.fase === "squilla") {
    if (vista.io === "riceve") {
      return { tipo: "squillo_in_arrivo", titolo: nome ? `${nome} ti sta chiamando` : "Ti stanno chiamando", testo: "Solo voce · 15 minuti", pulsanti: ["rispondi", "rifiuta"] };
    }
    return { tipo: "squillo_in_uscita", titolo: nome ? `Stai chiamando ${nome}` : "Stai chiamando", testo: `Squilla… ${Math.max(0, Math.ceil(Number(vista.squillo) || 0))} s`, pulsanti: ["chiudi"] };
  }

  if (vista.fase === "finita") return { tipo: "finita", titolo: "Chiamata finita", pulsanti: ["segnala_problema"] };

  if (vista.fase !== "in_corso") return { tipo: "nessuna" };

  const c = vista.carte && vista.carte.visibile === true ? vista.carte : null;
  const attesa = c && Number.isFinite(c.attesa) && c.attesa > 0 ? Math.ceil(c.attesa) : 0;
  const carta = vista.carta && typeof vista.carta.testo === "string" && vista.carta.testo
    ? { testo: vista.carta.testo, da: vista.carta.daMe === true ? "Pescata da te" : nome ? `Pescata da ${nome}` : "Pescata dall'altra persona" }
    : null;
  return {
    tipo: "in_corso",
    timer: testoTimer(vista.restanti),
    banner: Number.isFinite(secondiVisti) && secondiVisti >= SECONDI_BANNER ? null : BANNER,
    pulsanti: c ? ["microfono", "carte", "chiudi", "chiudi_e_segnala"] : ["microfono", "chiudi", "chiudi_e_segnala"],
    carte: c ? { etichetta: attesa ? `Carte · ${attesa} s` : "Carte", attiva: attesa === 0 } : null,
    suggerimento: vista.suggerimento === true ? "Serve un'idea? Pesca una carta" : null,
    avviso: vista.ultimoMinuto === true ? "Ancora un minuto" : null,
    carta,
    riconnessione: vista.altraPersona === "riconnessione"
      ? `${nome || "L'altra persona"} ha perso la connessione: ha 30 secondi per rientrare`
      : null,
    ascolta: vista.ascolto === "da_fare",
  };
}

// Dopo la chiamata (spec v1.3 § 3, passo 3c-4b-2). dopo: la risposta del server (/app/api/chiamata/dopo).
// «La richiameresti?» finché non si risponde; poi (o subito, sotto i 60 s e per la caduta lunga) la fine con
// «Segnala un problema» e «Torna alla stanza». Il diario (#5 passo 2) si aggiungerà tra domanda e fine.
export const TESTI_DOPO = Object.freeze({
  domanda: "La richiameresti?",
  finita: "Chiamata finita",
  segnala: "Segnala un problema",
  torna: "Torna alla stanza",
});
export const notaSegreta = (nome) =>
  `Resta tra te e Presente. ${String(nome || "").trim() || "L'altra persona"} non lo saprà mai.`;

export function schermataDopo(dopo, { nomeAltra = "", risposto = false } = {}) {
  if (!dopo || typeof dopo !== "object") return { tipo: "nessuna" };
  if (dopo.tipo === "richiameresti" && !risposto && dopo.chiamata) {
    return {
      tipo: "richiameresti",
      titolo: TESTI_DOPO.domanda,
      nota: notaSegreta(nomeAltra),
      risposte: [["si", "Sì"], ["no", "No"], ["salta", "Salta"]],
      pulsanti: ["segnala_problema"],
    };
  }
  return {
    tipo: "dopo_fine",
    titolo: TESTI_DOPO.finita,
    testo: typeof dopo.testo === "string" && dopo.testo ? dopo.testo : null,
    pulsanti: ["segnala_problema", "torna"],
  };
}
