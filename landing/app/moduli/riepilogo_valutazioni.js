// Riepilogo alla cieca delle valutazioni nel proprio profilo (issue #6, spec v1 del CPO del 3/11, «Valutazione (D20)»;
// D20 A). Passo 3j della linea «sviluppatore-b».
// Legge GET /app/api/incontro?riepilogo=1 (worker/incontro_api.js → riepilogo_valutazioni, passo 3i): chi chiede lo
// dice solo il token. Arrivano solo { valutati, bollini, no_ricevuti }: mai la singola valutazione, mai la domanda
// sulla sicurezza, mai nomi o date. Qui diventano frasi: bollini solo dal terzo incontro valutato
// («Si è presentata/o in 3 incontri su 3»), «Una persona ha risposto no a: <domanda>». Niente voti, stelle o aspetto.
// «Contesta» arriva in un passo successivo. Niente salvataggi locali, niente log. Il modulo non tocca la pagina.

const PERCORSO = "/app/api/incontro?riepilogo=1";
const BOLLINI_DOPO = 3; // come VALUTAZIONE.bolliniDopo in api/valutazione.js (il test lo controlla)

export const TESTI_RIEPILOGO = Object.freeze({
  // «Si è presentata/o in 3 incontri su 3» è l'esempio della spec; gli altri due sono provvisori, da rivedere con «contenuti».
  bollini: Object.freeze({
    presentato: "Si è presentata/o in <x> incontri su <n>",
    foto_sue: "Foto confermate in <x> incontri su <n>",
    come_in_chiamata: "Come in chiamata in <x> incontri su <n>",
  }),
  // Testo della spec; le domande sono quelle della valutazione, viste da chi le riceve.
  no: "Una persona ha risposto no a: «<domanda>»",
  domande: Object.freeze({
    presentato: "Si è presentata/o?",
    foto_sue: "Le foto erano davvero sue?",
    come_in_chiamata: "Era come in chiamata?",
  }),
});
const ORDINE = ["presentato", "foto_sue", "come_in_chiamata"];
const intero = (n) => Number.isInteger(n) && n >= 0;

// { valutati, bollini, no_ricevuti } → { bollini: [frasi], no: [frasi] }. Dati strani → nessuna riga.
export function righeRiepilogo(r) {
  const vuoto = { bollini: [], no: [] };
  if (!r || typeof r !== "object" || Array.isArray(r) || !intero(r.valutati)) return vuoto;
  const n = r.valutati;
  const b = r.bollini;
  const bollini = n >= BOLLINI_DOPO && b && typeof b === "object" && ORDINE.every((k) => intero(b[k]) && b[k] <= n)
    ? ORDINE.map((k) => TESTI_RIEPILOGO.bollini[k].replace("<x>", String(b[k])).replace("<n>", String(n)))
    : [];
  const no = Array.isArray(r.no_ricevuti)
    ? ORDINE.filter((k) => r.no_ricevuti.includes(k)).map((k) => TESTI_RIEPILOGO.no.replace("<domanda>", TESTI_RIEPILOGO.domande[k]))
    : [];
  return { bollini, no };
}

export function creaRiepilogo({ token, fetch: f = globalThis.fetch }) {
  return {
    // { ok: true, righe: { bollini, no } } oppure { ok: false, motivo: "accesso" | "rete" | "lettura" }.
    async leggi() {
      const t = await Promise.resolve().then(token).catch(() => null);
      if (!t) return { ok: false, motivo: "accesso" };
      let r;
      try {
        r = await f(PERCORSO, { method: "GET", headers: { authorization: `Bearer ${t}` } });
      } catch {
        return { ok: false, motivo: "rete" };
      }
      if (r.status === 401) return { ok: false, motivo: "accesso" };
      if (!r.ok) return { ok: false, motivo: "lettura" };
      let corpo;
      try { corpo = await r.json(); } catch { return { ok: false, motivo: "lettura" }; }
      if (!corpo || corpo.ok !== true) return { ok: false, motivo: "lettura" };
      return { ok: true, righe: righeRiepilogo(corpo.riepilogo) };
    },
  };
}
