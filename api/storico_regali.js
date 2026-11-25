// «I tuoi regali» (schermata 28 del design v4, issue #349; regole dei regali #331). Linea «sviluppatore-b».
// Funzioni pure, usate dal Worker (worker/storico_regali_api.js): dai numeri del database (storico_regali) ai testi
// della schermata. Nessun id di persona esce di qui; delle stanze passate solo numeri.
// Testi dal design v4; «Non hai ancora ricevuto regali.» è provvisorio (chiesto al CPO).

const TIPI = ["rosa", "spumante", "fiori"];
const NOMI = { rosa: ["rosa", "rose"], spumante: ["spumante", "spumante"], fiori: ["fiori", "fiori"] };
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const intero = (n) => Number.isInteger(n) && n >= 0;
const conteggi = (x) => !!x && typeof x === "object" && TIPI.every((t) => intero(x[t]));

export function titoloStorico(totale) {
  const n = TIPI.reduce((s, t) => s + totale[t], 0);
  if (n === 0) return "Non hai ancora ricevuto regali.";
  return n === 1 ? "Hai ricevuto 1 regalo." : `Hai ricevuto ${n} regali.`;
}

export function dettaglioRegali(c) {
  return TIPI.filter((t) => c[t] > 0).map((t) => `${c[t]} ${NOMI[t][c[t] === 1 ? 0 : 1]}`).join(" · ");
}

// Giorno di calendario a Roma come numero di giorni dal 1970 (anche nelle notti del cambio d'ora).
function giornoRoma(data) {
  const [a, m, g] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(data).split("-").map(Number);
  return Date.UTC(a, m - 1, g) / 86400000;
}

const MESI_BREVI = Object.freeze(["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"]);

export function quandoRegalo(ultimo, adesso = new Date()) {
  const d = new Date(ultimo);
  if (Number.isNaN(d.getTime())) return "";
  const diff = giornoRoma(adesso) - giornoRoma(d);
  if (diff <= 0) return "oggi";
  if (diff === 1) return "ieri";
  const giorno = new Date(giornoRoma(d) * 86400000);
  // Spec CPO del 25/11 (#349): oltre una settimana la data breve («12 nov»); dal 7° giorno il nome del giorno
  // sarebbe lo stesso di oggi e confonderebbe.
  if (diff >= 7) return `${giorno.getUTCDate()} ${MESI_BREVI[giorno.getUTCMonth()]}`;
  return GIORNI[giorno.getUTCDay()];
}

// Dati del database → schermata. Qualunque dato strano → null (il Worker risponde «riprova»).
export function vistaStorico(d, adesso = new Date()) {
  if (!d || typeof d !== "object" || Array.isArray(d) || !conteggi(d.totale)) return null;
  const p = d.passate;
  if (!conteggi(p) || !intero(p.stanze) || !intero(p.persone)) return null;
  let attuale = null;
  if (d.attuale !== null && d.attuale !== undefined) {
    const a = d.attuale;
    if (typeof a !== "object" || typeof a.citta !== "string" || !Array.isArray(a.persone)) return null;
    const persone = [];
    for (const x of a.persone) {
      if (!conteggi(x) || typeof x.nome !== "string" || !x.nome || !intero(x.eta)) return null;
      persone.push({ nome: `${x.nome}, ${x.eta}`, dettaglio: dettaglioRegali(x), quando: quandoRegalo(x.ultimo, adesso) });
    }
    attuale = { citta: a.citta, persone };
  }
  return {
    titolo: titoloStorico(d.totale),
    totale: { rosa: d.totale.rosa, spumante: d.totale.spumante, fiori: d.totale.fiori },
    attuale,
    passate: p.stanze === 0 ? null
      : { stanze: p.stanze, persone: p.persone === 1 ? "1 persona" : `${p.persone} persone`, dettaglio: dettaglioRegali(p) },
  };
}
