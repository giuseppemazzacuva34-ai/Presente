// «Ero lì» e «Non riesco a fare il check-in» (issue #6, spec v1 «Regole» e «Casi limite», v1.4 del CPO del 27/11;
// D51 A, D156 A). Linea «sviluppatore-b». Legge GET /app/api/incontro?porta=<id>&buca=1 e manda
// POST /app/api/incontro { azione: "contesta_buca", porta, testo } (worker/incontro_api.js → contesta_buca): chi contesta
// lo dice solo il token, chi può contestare e quando lo decide il database. Arrivano solo { contestabile, stato }: mai id,
// nomi, date o saldi dell'altra persona. Nella finestra del check-in il pulsante è «Non riesco a fare il check-in», dopo
// la buca è «Ero lì» (nomi dalla spec). Le altre frasi sono provvisorie, da rivedere con «contenuti». Niente salvataggi
// locali, niente log, il testo non va da nessun'altra parte. Non tocca la pagina: si prova con node --test.

const PERCORSO = "/app/api/incontro";
const MINIMO = 10;
const MASSIMO = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATI = ["in_attesa", "accolta", "respinta"];

export const TESTI_BUCA = Object.freeze({
  // Dalla spec (v1 casi limite e regole; v1.4 punto 1).
  eroLi: "Ero lì",
  nonRiesco: "Non riesco a fare il check-in",
  altroContesta: "L'altra persona dice che non è riuscita a fare il check-in. Decidiamo entro 48 ore e ti scriviamo qui.",
  nota: "Lo legge una persona, non un algoritmo.",
  // Provvisori.
  domanda: "Cosa è successo?",
  manda: "Manda",
  annulla: "Annulla",
  inviata: "Contestazione inviata. Finché non decidiamo nessun credito si muove: ti scriviamo qui.",
  inRevisione: "In revisione",
  accolta: "Abbiamo accolto la tua contestazione: i tuoi 100 crediti tornano a te.",
  respinta: "Abbiamo letto la tua contestazione: la buca resta.",
  errori: Object.freeze({
    testo_non_valido: "Scrivi almeno 10 caratteri (al massimo 500).",
    non_contestabile: "Questo incontro non si può più contestare.",
    gia_inviata: "Hai già mandato una contestazione per questo incontro.",
    generico: "Non siamo riusciti a mandarla. Riprova tra poco.",
  }),
});

const lunghezza = (t) => (typeof t === "string" ? [...t.trim()].length : 0);
export const testoValidoBuca = (t) => typeof t === "string" && lunghezza(t) >= MINIMO && lunghezza(t) <= MASSIMO;
export const LIMITI_BUCA = Object.freeze({ minimo: MINIMO, massimo: MASSIMO });

// Quale pulsante mostrare («non_riesco», «ero_li», «in_revisione» o nessuno) e l'esito di una decisione.
// tipo è quello di schermataIncontro: «confermato» (finestra del check-in) o «concluso» (dopo la buca).
export function rigaContestaBuca(c, tipo) {
  const vuota = { bottone: null, esito: null };
  if (!c || typeof c !== "object" || typeof c.contestabile !== "boolean") return vuota;
  const stato = c.stato ?? null;
  if (stato !== null && !STATI.includes(stato)) return vuota;
  if (tipo !== "confermato" && tipo !== "concluso") return vuota;
  if (stato === "in_attesa") return { bottone: "in_revisione", esito: null };
  if (stato) return { bottone: null, esito: TESTI_BUCA[stato] };
  if (!c.contestabile) return vuota;
  return { bottone: tipo === "confermato" ? "non_riesco" : "ero_li", esito: null };
}

export function creaContestaBuca({ token, fetch: f = globalThis.fetch }) {
  const leggiToken = () => Promise.resolve().then(token).catch(() => null);
  return {
    // { ok: true, contestazione: { contestabile, stato } } oppure { ok: false, motivo: "accesso" | "rete" | "lettura" }.
    async leggi(porta) {
      if (typeof porta !== "string" || !UUID.test(porta)) return { ok: false, motivo: "lettura" };
      const t = await leggiToken();
      if (!t) return { ok: false, motivo: "accesso" };
      let r;
      try {
        r = await f(`${PERCORSO}?porta=${porta}&buca=1`, { method: "GET", headers: { authorization: `Bearer ${t}` } });
      } catch {
        return { ok: false, motivo: "rete" };
      }
      if (r.status === 401) return { ok: false, motivo: "accesso" };
      if (!r.ok) return { ok: false, motivo: "lettura" };
      let corpo;
      try { corpo = await r.json(); } catch { return { ok: false, motivo: "lettura" }; }
      const c = corpo && corpo.ok === true ? corpo.contestazione : null;
      const stato = c && typeof c === "object" ? c.stato ?? null : undefined;
      if (!c || typeof c.contestabile !== "boolean" || !(stato === null || STATI.includes(stato))) return { ok: false, motivo: "lettura" };
      return { ok: true, contestazione: { contestabile: c.contestabile, stato } };
    },
    // { ok: true } oppure { ok: false, testo } con una frase da mostrare sotto il campo.
    async manda(porta, testo) {
      if (!testoValidoBuca(testo)) return { ok: false, testo: TESTI_BUCA.errori.testo_non_valido };
      if (typeof porta !== "string" || !UUID.test(porta)) return { ok: false, testo: TESTI_BUCA.errori.generico };
      const t = await leggiToken();
      if (!t) return { ok: false, testo: TESTI_BUCA.errori.generico };
      let corpo;
      try {
        const r = await f(PERCORSO, { method: "POST",
          headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
          body: JSON.stringify({ azione: "contesta_buca", porta, testo }) });
        corpo = await r.json();
      } catch {
        return { ok: false, testo: TESTI_BUCA.errori.generico };
      }
      if (corpo && corpo.ok === true && corpo.esito === "inviata") return { ok: true };
      const m = corpo && typeof corpo.motivo === "string" ? corpo.motivo : "";
      return { ok: false, testo: m !== "generico" && Object.hasOwn(TESTI_BUCA.errori, m) ? TESTI_BUCA.errori[m] : TESTI_BUCA.errori.generico };
    },
  };
}
