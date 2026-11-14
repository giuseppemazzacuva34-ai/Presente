// Modulo di segnalazione nella web app (issue #7, spec v1.1 definitiva, punti 2-3; passo 5a della linea «sviluppatore-b»).
// Si apre dopo «Chiudi e segnala» e da «Segnala un problema» (telefono.modello().segnala = { contro, origine, chiamataIl }).
// Il corpo non dice mai chi segnala: lo dice solo il token (worker/segnala_api.js). Al telefono tornano solo le ore di
// revisione e se mostrare il 112: mai chi riceverà la segnalazione né cosa succederà all'altra persona.
// Niente salvataggi locali: il racconto resta nella memoria della pagina finché non si invia.
// Questo modulo non tocca la pagina: riceve fetch e token dall'esterno, così si prova con node --test.
// Le richieste rispondono solo con l'accesso acceso (ACCESSO_APP = «si»).

const PERCORSO = "/app/api/segnala";
const ATTESA_MS = 8000;
const MASSIMO = 1000;

// «Cosa è successo?»: i 9 motivi della spec, nello stesso ordine. Gli altri motivi (Sono in difficoltà, valutazione)
// hanno le loro schermate.
export const MOTIVI_MODULO = Object.freeze([
  ["contatti_prima_porta", "Ha chiesto numero, cognome o social prima della porta"],
  ["insulti", "Insulti o mancanza di rispetto"],
  ["contenuti_sessuali", "Contenuti sessuali non richiesti"],
  ["minacce_pericolo", "Minacce, o mi sono sentita/o in pericolo"],
  ["sembra_minorenne", "Sembra minorenne"],
  ["profilo_falso", "Profilo falso o foto non sue"],
  ["soldi", "Chiede soldi, regali o vende qualcosa"],
  ["diffusione_immagini", "Ha diffuso immagini dello svelamento o delle chiamate"],
  ["altro", "Altro"],
].map(Object.freeze));
const VALORI = new Set(MOTIVI_MODULO.map(([v]) => v));
const ORIGINI = new Set(["chiudi_e_segnala", "dopo_chiamata", "scheda", "storico_chiamate"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const chi = (nome) => (typeof nome === "string" && nome.trim() ? nome.trim() : "");

export function moduloSegnala(segnala, nome) {
  const n = chi(nome);
  return {
    titolo: "Cosa è successo?",
    motivi: MOTIVI_MODULO,
    etichettaTesto: "Raccontaci (facoltativo)",
    massimo: MASSIMO,
    casella: `Blocca anche ${n || "questa persona"}`,
    // Dopo «Chiudi e segnala» il blocco è automatico (spec punto 2): la casella resta spuntata e ferma.
    bloccoFisso: !!segnala && segnala.origine === "chiudi_e_segnala",
    anonimato: `${n || "Questa persona"} non saprà chi l'ha segnalato.`,
    invia: "Invia",
  };
}

// scelte = { motivo, testo, blocca } → { ok, corpo } | { ok: false, errore }
export function corpoSegnala(segnala, scelte = {}) {
  if (!segnala || !UUID.test(String(segnala.contro || "")) || !ORIGINI.has(segnala.origine)) {
    return { ok: false, errore: "Non riusciamo a collegare questa persona. Torna alla stanza e riprova." };
  }
  if (!VALORI.has(scelte.motivo)) return { ok: false, errore: "Scegli cosa è successo." };
  const testo = typeof scelte.testo === "string" ? scelte.testo.trim() : "";
  if (testo.length > MASSIMO) return { ok: false, errore: `Il racconto può avere al massimo ${MASSIMO} caratteri.` };
  const corpo = {
    contro: segnala.contro,
    motivo: scelte.motivo,
    origine: segnala.origine,
    testo,
    blocca: segnala.origine === "chiudi_e_segnala" ? true : scelte.blocca !== false,
  };
  if (typeof segnala.chiamataIl === "string" && segnala.chiamataIl) corpo.chiamataIl = segnala.chiamataIl;
  return { ok: true, corpo };
}

// Spec punto 3: «Grazie. Una persona di Presente la leggerà entro <ore>. <nome> non saprà chi l'ha segnalato.»
export function confermaSegnala({ ore, pericolo } = {}, nome) {
  const n = chi(nome);
  const entro = ore === 1 ? "1 ora" : `${ore} ore`;
  return {
    titolo: "Grazie",
    testo: `Grazie. Una persona di Presente la leggerà entro ${entro}. ${n || "Questa persona"} non saprà chi l'ha segnalato.`,
    pericolo: pericolo === true ? "Se sei in pericolo ora, chiama il 112." : null,
    telefono: pericolo === true ? "tel:112" : null,
  };
}

const ERRORI = Object.freeze({
  rete: "Sei senza connessione. Riprova tra poco.",
  accesso: "Accedi di nuovo per inviare la segnalazione.",
  troppe: "Troppi tentativi. Aspetta un minuto.",
  spento: "Le segnalazioni non sono ancora attive.",
  persona: "Non riusciamo a collegare questa persona. Torna alla stanza e riprova.",
  scaduta: "Sono passati più di 30 giorni: questa chiamata non si può più segnalare.",
  dati: "Controlla il modulo e riprova.",
});
export const testoErroreSegnala = (motivo) => (Object.hasOwn(ERRORI, motivo) ? ERRORI[motivo] : "Non è andata. Riprova tra poco.");

export function creaSegnala({ token, fetch: f = globalThis.fetch, attesa = ATTESA_MS }) {
  return {
    async invia(corpo) {
      const t = await Promise.resolve().then(token).catch(() => null);
      if (!t) return { ok: false, motivo: "accesso" };
      const ferma = new AbortController();
      const timer = setTimeout(() => ferma.abort(), attesa);
      try {
        let r;
        try {
          r = await f(PERCORSO, {
            method: "POST",
            signal: ferma.signal,
            headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
            body: JSON.stringify(corpo || {}),
          });
        } catch {
          return { ok: false, motivo: "rete" };
        }
        if (r.status === 401) return { ok: false, motivo: "accesso" };
        if (r.status === 429) return { ok: false, motivo: "troppe" };
        if (r.status === 404) return { ok: false, motivo: "spento" };
        let dati;
        try { dati = await r.json(); } catch { return { ok: false, motivo: "riprova" }; }
        if (!dati || typeof dati !== "object") return { ok: false, motivo: "riprova" };
        if (dati.ok === true) {
          return Number.isInteger(dati.ore) && dati.ore > 0
            ? { ok: true, ore: dati.ore, pericolo: dati.pericolo === true } : { ok: false, motivo: "riprova" };
        }
        return { ok: false, motivo: typeof dati.motivo === "string" && Object.hasOwn(ERRORI, dati.motivo) ? dati.motivo : "riprova" };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
