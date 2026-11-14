// Chiavi e sera delle porte nella web app (issue #5, spec v1.1 del CPO, passi 4-8; D14 A, D51 A).
// Passo 5c della linea «sviluppatore-c»: testi della spec, conto alla rovescia, schermata delle 21:00 e richieste a
// /app/api/chiavi (worker/chiavi_api.js). Le regole (2 chiavi, solo a chi hai chiamato, frase senza contatti, chiuse
// dalle 20:59:00) le decide il server: qui si mostrano le sue risposte.
// Nessuno scopre un no: il server manda solo le chiavi date da te e le porte aperte, mai quelle ricevute.
// Il corpo non dice mai chi dà la chiave: lo dice solo il token. Niente salvataggi locali.
// Questo modulo non tocca la pagina: riceve fetch e token dall'esterno, così si prova con node --test.
// I testi sono gli stessi di api/chiavi.js (TESTI_CHIAVI): il test lo controlla.

const PERCORSO = "/app/api/chiavi";
const ATTESA_MS = 8000;
const FRASE_MASSIMO = 140;
const MINUTO = 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const TESTI = Object.freeze({
  chiuse: "Le chiavi sono chiuse. Tra poco le porte.",
  nessunaPorta: "Stasera nessuna porta si è aperta. Lunedì alle 9 apre una nuova stanza.",
});

const chi = (nome) => (typeof nome === "string" && nome.trim() ? nome.trim() : "");
const dateDa = (stato) => (Array.isArray(stato?.date) ? stato.date : []);

// «Le tue chiavi: N» con due icone: piene quelle ancora da dare. null senza stanza aperta.
export function contatoreChiavi(stato) {
  if (!stato || stato.stanza !== true) return null;
  const n = Math.max(0, Math.min(2, Number.isInteger(stato.restanti) ? stato.restanti : 0));
  return { testo: `Le tue chiavi: ${n}`, icone: [n >= 1, n >= 2] };
}

// Cosa mostra la scheda di una persona della stanza (spec, passi 4, 5 e 7).
export function schedaChiave(stato, persona) {
  if (!stato || stato.stanza !== true) return null;
  const data = dateDa(stato).find((k) => k && k.a === persona);
  if (stato.chiuse === true) return data ? { segno: "Hai dato una chiave", chiuse: TESTI.chiuse } : { chiuse: TESTI.chiuse };
  if (data) {
    return { segno: "Hai dato una chiave", frase: typeof data.frase === "string" ? data.frase : null,
      riprendi: "Riprendi la chiave", modifica: "Modifica la frase" };
  }
  return stato.restanti > 0 ? { dai: "Dai una chiave" } : {};
}

export function finestraDai(nome) {
  const n = chi(nome) || "questa persona";
  return {
    titolo: `Dai una chiave a ${n}?`,
    etichetta: `Una frase per ${n}`,
    nota: `La leggerà solo se anche ${n} ti dà una chiave.`,
    bottone: "Dai la chiave",
    massimo: FRASE_MASSIMO,
  };
}

export const confermaRiprendi = (nome) => `Riprendi la chiave a ${chi(nome) || "questa persona"}? Non lo saprà.`;

// Dalle 20:00 (un'ora prima della chiusura, ora di Roma decisa dal server) il conto alla rovescia, che si calcola
// sull'orologio di chi guarda; nell'ultimo minuto le chiavi sono chiuse. Prima e dopo nessun testo.
export function contoAllaRovescia(chiudeIl, adesso = new Date()) {
  const chiude = new Date(chiudeIl).getTime();
  if (!Number.isFinite(chiude)) return null;
  const manca = chiude - adesso.getTime();
  if (manca <= 0 || manca > 60 * MINUTO) return null;
  if (manca <= MINUTO) return TESTI.chiuse;
  const minuti = Math.floor(manca / MINUTO);
  return `Le porte si aprono tra ${minuti} ${minuti === 1 ? "minuto" : "minuti"}`;
}

// La schermata delle 21:00 (spec, passo 8). null = niente da mostrare (stanza aperta o sera finita).
export function schermataSera(sera) {
  if (!sera || sera.ok !== true) return null;
  if (sera.stato === "attesa") return { tipo: "attesa" };
  if (sera.stato !== "pronta") return null;
  const schede = (Array.isArray(sera.porte) ? sera.porte : [])
    .filter((p) => p && UUID.test(String(p.id || "")) && UUID.test(String(p.con || "")))
    .map((p) => {
      const nome = chi(p.nome) || "una persona della stanza";
      const frase = typeof p.frase_per_te === "string" && p.frase_per_te.trim() ? p.frase_per_te.trim() : null;
      return { porta: p.id, testo: `Una porta si è aperta: ${nome}.`, scritto: frase ? `${nome} ti ha scritto:` : null, frase,
        bottone: "Vai allo svelamento" };
    });
  // Chi non ha porte vede sempre lo stesso testo, che abbia dato chiavi o no.
  return schede.length ? { tipo: "porte", schede } : { tipo: "nessuna_porta", testo: TESTI.nessunaPorta };
}

const ERRORI = Object.freeze({
  rete: "Sei senza connessione. Riprova tra poco.",
  accesso: "Accedi di nuovo per continuare.",
  troppe: "Troppi tentativi. Aspetta un minuto.",
  dati: "Non riusciamo a collegare questa persona. Torna alla stanza e riprova.",
});
export const testoErroreChiavi = (motivo) => (Object.hasOwn(ERRORI, motivo) ? ERRORI[motivo] : "Non è andata. Riprova tra poco.");
const errore = (motivo) => ({ ok: false, motivo, testo: testoErroreChiavi(motivo) });

export function creaChiavi({ token, fetch: f = globalThis.fetch, attesa = ATTESA_MS }) {
  async function chiedi(percorso, corpo = null) {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return errore("accesso");
    const ferma = new AbortController();
    const timer = setTimeout(() => ferma.abort(), attesa);
    try {
      let r;
      try {
        const headers = { authorization: `Bearer ${t}` };
        if (corpo) headers["content-type"] = "application/json";
        r = await f(percorso, { method: corpo ? "POST" : "GET", signal: ferma.signal, headers, body: corpo ? JSON.stringify(corpo) : undefined });
      } catch {
        return errore("rete");
      }
      if (r.status === 401) return errore("accesso");
      if (r.status === 429) return errore("troppe");
      let dati;
      try { dati = await r.json(); } catch { return errore("riprova"); }
      if (!dati || typeof dati !== "object" || (r.status !== 200 && dati.ok !== false)) return errore("riprova");
      if (dati.ok === false) {
        // Il testo per l'utente lo manda il server per i rifiuti delle regole (chiuse, finite, contatti…).
        return typeof dati.testo === "string" && dati.testo ? { ok: false, motivo: String(dati.motivo || ""), testo: dati.testo }
          : errore(String(dati.motivo || "riprova"));
      }
      return { ok: true, dati };
    } finally {
      clearTimeout(timer);
    }
  }
  const azione = async (corpo) => {
    if (!UUID.test(String(corpo.a || ""))) return errore("dati");
    const r = await chiedi(PERCORSO, corpo);
    return r.ok ? { ok: true, stato: r.dati.stato ?? null } : r;
  };
  return {
    async leggi() {
      const r = await chiedi(PERCORSO);
      if (!r.ok) return r;
      const { ok, ...stato } = r.dati;
      return { ok: true, stato };
    },
    dai: (a, frase) => azione({ azione: "dai", a, frase: typeof frase === "string" ? frase : "" }),
    riprendi: (a) => azione({ azione: "riprendi", a }),
    cambiaFrase: (a, frase) => azione({ azione: "frase", a, frase: typeof frase === "string" ? frase : "" }),
    async sera() {
      const r = await chiedi(PERCORSO + "/sera");
      return r.ok ? r.dati : r;
    },
  };
}
