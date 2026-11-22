// «I vostri incontri» nella home (issue #6, spec v1 del CPO del 3/11, punto 1 «Vi incontrate»). Passo 3m della linea
// «sviluppatore-b».
// Legge GET /app/api/incontro?elenco=1 (worker/incontro_api.js → miei_incontri, passi 3k-3l): chi chiede lo dice solo
// il token. Arrivano solo { porta, nome, stato, scadenza, orario, esito }: qui diventano righe brevi con il pulsante che
// apre «Il vostro incontro» (incontro.js). Mai luoghi, email o numeri. Niente salvataggi locali, niente log.
// Il modulo non tocca la pagina: la home lo disegna con vistaVostriIncontri.

const PERCORSO = "/app/api/incontro?elenco=1";
const IN_CORSO = ["confermato", "proposto", "da_fissare"]; // ordine nella home: prima quello già fissato

export const TESTI_VOSTRI_INCONTRI = Object.freeze({
  // Provvisori, da rivedere con «contenuti».
  titolo: "I vostri incontri",
  con: "Con <nome>",
  altraPersona: "l'altra persona",
  daFissare: "Da fissare entro <giorno>",
  daFissareSenzaData: "Da fissare",
  proposto: "C'è una proposta in corso",
  confermato: "Ci vediamo <giorno> alle <ora>",
  confermatoSenzaOra: "Incontro confermato",
  avvenuto: "Vi siete visti: com'è andata?",
  apri: "Apri",
});
const T = TESTI_VOSTRI_INCONTRI;

const GIORNO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long" });
const ORARIO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const data = (x) => { if (typeof x !== "string") return null; const d = new Date(x); return Number.isFinite(d.getTime()) ? d : null; };

function testo(x) {
  if (x.stato === "confermato") {
    const o = data(x.orario);
    return o ? T.confermato.replace("<giorno>", GIORNO.format(o)).replace("<ora>", ORARIO.format(o)) : T.confermatoSenzaOra;
  }
  if (x.stato === "proposto") return T.proposto;
  if (x.stato === "da_fissare") {
    const s = data(x.scadenza);
    return s ? T.daFissare.replace("<giorno>", GIORNO.format(s)) : T.daFissareSenzaData;
  }
  return T.avvenuto; // solo concluso con esito «avvenuto» arriva qui
}

// Elenco dal Worker → righe per la home. In corso per primi (confermato, proposto, da fissare), poi gli avvenuti
// (da lì si apre la valutazione); scaduti e annullati non compaiono. Dati strani → nessuna riga.
export function righeVostriIncontri(incontri) {
  if (!Array.isArray(incontri)) return [];
  const buoni = incontri.filter((x) => x && typeof x === "object" && UUID.test(String(x.porta))
    && (IN_CORSO.includes(x.stato) || (x.stato === "concluso" && x.esito === "avvenuto")));
  const posto = (x) => (IN_CORSO.includes(x.stato) ? IN_CORSO.indexOf(x.stato) : IN_CORSO.length);
  return buoni
    .map((x, i) => ({ x, i }))
    .sort((a, b) => posto(a.x) - posto(b.x) || a.i - b.i)
    .map(({ x }) => {
      const nome = typeof x.nome === "string" && x.nome.trim() ? x.nome.trim() : null;
      return { porta: x.porta, nome, titolo: T.con.replace("<nome>", nome || T.altraPersona), testo: testo(x), apri: T.apri };
    });
}

export function creaVostriIncontri({ token, fetch: f = globalThis.fetch }) {
  return {
    // { ok: true, righe } oppure { ok: false, motivo: "accesso" | "rete" | "lettura" }.
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
      return { ok: true, righe: righeVostriIncontri(corpo.incontri) };
    },
  };
}

// Il riquadro della home; h è la funzione della pagina che crea gli elementi. Nessuna riga → niente riquadro.
export function vistaVostriIncontri(h, righe, { apri }) {
  if (!Array.isArray(righe) || !righe.length) return null;
  return h("div", { classe: "riepilogo", role: "region", "aria-label": T.titolo },
    h("h2", {}, T.titolo),
    h("ul", { classe: "compagni" }, righe.map((r) => h("li", {},
      h("strong", {}, r.titolo),
      h("p", { classe: "nota" }, r.testo),
      h("button", { classe: "bottone-secondario", type: "button", "aria-label": `${r.apri}: ${r.titolo}`,
        onclick: () => apri(r.porta, { nome: r.nome }) }, r.apri)))));
}
