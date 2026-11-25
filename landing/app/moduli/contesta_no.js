// «Contesta» un «No» ricevuto, nel profilo (issue #6, spec v1.3 del CPO del 22/11, punto 2; D20 A, D51 A).
// Passo 3 della linea «sviluppatore-b». Legge GET /app/api/incontro?contestazioni=1 e manda
// POST /app/api/incontro { azione: "contesta", domanda, testo } (worker/incontro_api.js → contesta_no): chi contesta lo
// dice solo il token. Arrivano solo { contestabile, stato } per domanda: mai id, nomi o date di chi ha risposto.
// Testi della spec; i tre messaggi d'errore sono provvisori. Niente salvataggi locali, niente log. Non tocca la pagina.

const PERCORSO = "/app/api/incontro";
const MINIMO = 10;
const MASSIMO = 500;

export const TESTI_CONTESTA = Object.freeze({
  bottone: "Contesta",
  inRevisione: "In revisione",
  domanda: "Cosa non torna?",
  nota: "Lo legge una persona, non un algoritmo.",
  manda: "Manda",
  annulla: "Annulla",
  inviata: "Contestazione inviata. Ti scriviamo qui quando è decisa.",
  accolta: "Abbiamo accolto la tua contestazione: quel no non conta più.",
  respinta: "Abbiamo letto la tua contestazione: il no resta.",
  errori: Object.freeze({
    testo_non_valido: "Scrivi almeno 10 caratteri (al massimo 500).",
    nessun_no: "Questo no non si può più contestare.",
    generico: "Non siamo riusciti a mandarla. Riprova tra poco.",
  }),
});

export const lunghezza = (t) => (typeof t === "string" ? [...t.trim()].length : 0);
export const testoValido = (t) => typeof t === "string" && lunghezza(t) >= MINIMO && lunghezza(t) <= MASSIMO;
export const LIMITI_CONTESTA = Object.freeze({ minimo: MINIMO, massimo: MASSIMO });

// Per una domanda: quale pulsante mostrare («contesta», «in_revisione» o nessuno) e l'esito di una decisione.
const STATI = ["in_attesa", "accolta", "respinta"];
export function rigaContesta(contestazioni, domanda) {
  const x = contestazioni && typeof contestazioni === "object" ? contestazioni[domanda] : null;
  if (!x || typeof x !== "object" || typeof x.contestabile !== "boolean") return { bottone: null, esito: null };
  const stato = STATI.includes(x.stato) ? x.stato : null;
  if (stato === "in_attesa") return { bottone: "in_revisione", esito: null };
  return { bottone: x.contestabile ? "contesta" : null, esito: stato ? TESTI_CONTESTA[stato] : null };
}

export function creaContesta({ token, fetch: f = globalThis.fetch }) {
  const leggiToken = () => Promise.resolve().then(token).catch(() => null);
  return {
    // { ok: true, contestazioni } oppure { ok: false, motivo: "accesso" | "rete" | "lettura" }.
    async leggi() {
      const t = await leggiToken();
      if (!t) return { ok: false, motivo: "accesso" };
      let r;
      try {
        r = await f(`${PERCORSO}?contestazioni=1`, { method: "GET", headers: { authorization: `Bearer ${t}` } });
      } catch {
        return { ok: false, motivo: "rete" };
      }
      if (r.status === 401) return { ok: false, motivo: "accesso" };
      if (!r.ok) return { ok: false, motivo: "lettura" };
      let corpo;
      try { corpo = await r.json(); } catch { return { ok: false, motivo: "lettura" }; }
      if (!corpo || corpo.ok !== true || !corpo.contestazioni || typeof corpo.contestazioni !== "object") {
        return { ok: false, motivo: "lettura" };
      }
      return { ok: true, contestazioni: corpo.contestazioni };
    },
    // { ok: true } oppure { ok: false, testo } con una frase da mostrare sotto il campo.
    async manda(domanda, testo) {
      if (!testoValido(testo)) return { ok: false, testo: TESTI_CONTESTA.errori.testo_non_valido };
      const t = await leggiToken();
      if (!t) return { ok: false, testo: TESTI_CONTESTA.errori.generico };
      let corpo;
      try {
        const r = await f(PERCORSO, { method: "POST",
          headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
          body: JSON.stringify({ azione: "contesta", domanda, testo }) });
        corpo = await r.json();
      } catch {
        return { ok: false, testo: TESTI_CONTESTA.errori.generico };
      }
      if (corpo && corpo.ok === true && corpo.esito === "inviata") return { ok: true };
      const errore = corpo && TESTI_CONTESTA.errori[corpo.motivo];
      return { ok: false, testo: corpo && corpo.motivo !== "generico" && errore ? errore : TESTI_CONTESTA.errori.generico };
    },
  };
}
