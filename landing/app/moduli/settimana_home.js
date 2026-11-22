// La home che cambia con la settimana (design v4, issue #349: schermate 16 «La home» e 35 «Domenica sera»; LEGGIMI
// punto 8). Linea del CTO.
// - Prima della stanza: «Ciao <nome>. La tua stanza apre lunedì.», conto alla rovescia al lunedì alle 9 (ora di Roma).
// - In stanza, da lunedì a sabato: la barra dei 7 giorni segna i giorni passati e oggi (rosso).
// - In stanza, domenica: conto alla rovescia alle 21; dopo le 21 «Le porte sono aperte.».
// Mai «Il tuo profilo è pronto» nella home. Solo calcoli e testi: l'orologio arriva da fuori (test con node --test).

export const TESTI_SETTIMANA = Object.freeze({
  etichetta: "La tua settimana",
  apre: "La tua stanza apre lunedì.",
  notaApre: "Lunedì alle 9 entri con 11 persone vicine a te.",
  aperta: "La tua stanza è aperta.",
  notaAperta: "Le porte si aprono domenica alle 21.",
  domenica: "Le porte si aprono alle 21.",
  porteAperte: "Le porte sono aperte.",
  manca: "Mancano",
});

const FUSO = "Europe/Rome";
const ORA_APERTURA = 9;
const ORA_PORTE = 21;
const GIORNI = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formato = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

// Giorno della settimana (1 = lunedì … 7 = domenica), data e ora a Roma.
function aRoma(istante) {
  const p = Object.fromEntries(formato.formatToParts(istante).map((x) => [x.type, x.value]));
  return { giorno: GIORNI[p.weekday], a: Number(p.year), m: Number(p.month), g: Number(p.day), ora: Number(p.hour), min: Number(p.minute), s: Number(p.second) };
}

// L'istante in cui a Roma è «g giorni dopo la data di r, alle ore:00» (ora legale compresa).
function istanteRoma(r, giorniDopo, ore) {
  const voluto = Date.UTC(r.a, r.m - 1, r.g + giorniDopo, ore);
  let t = voluto;
  for (let i = 0; i < 2; i++) {
    const x = aRoma(new Date(t));
    t += voluto - Date.UTC(x.a, x.m - 1, x.g, x.ora, x.min, x.s);
  }
  return new Date(t);
}

const due = (n) => String(n).padStart(2, "0");

// «1 g 18 h» sopra le 24 ore, «00:42» (ore:minuti, per difetto come «tra N minuti» delle chiavi) sotto; mai negativo.
export function contoAllaRovescia(adesso, verso) {
  const ms = Math.max(0, verso.getTime() - adesso.getTime());
  const minuti = Math.floor(ms / 60000);
  if (minuti >= 24 * 60) {
    const ore = Math.floor(ms / 3600000);
    return `${Math.floor(ore / 24)} g ${ore % 24} h`;
  }
  return `${due(Math.floor(minuti / 60))}:${due(minuti % 60)}`;
}

function prossimaApertura(adesso) {
  const r = aRoma(adesso);
  const oggiAlle9 = istanteRoma(r, 0, ORA_APERTURA);
  if (r.giorno === 1 && adesso < oggiAlle9) return oggiAlle9;
  return istanteRoma(r, 8 - r.giorno, ORA_APERTURA);
}

export function settimanaHome(adesso, { nome = "", inStanza = false } = {}) {
  const n = typeof nome === "string" ? nome.trim() : "";
  const titolo = n ? `Ciao ${n}.` : "Ciao.";
  const r = aRoma(adesso);
  if (!inStanza) {
    return { titolo, evidenza: TESTI_SETTIMANA.apre, conto: contoAllaRovescia(adesso, prossimaApertura(adesso)),
      nota: TESTI_SETTIMANA.notaApre, segmenti: Array(7).fill("") };
  }
  const segmenti = Array.from({ length: 7 }, (_, i) => (i + 1 < r.giorno ? "on" : i + 1 === r.giorno ? "oggi" : ""));
  if (r.giorno === 7) {
    const porte = istanteRoma(r, 0, ORA_PORTE);
    return adesso < porte
      ? { titolo, evidenza: TESTI_SETTIMANA.domenica, conto: contoAllaRovescia(adesso, porte), nota: null, segmenti }
      : { titolo, evidenza: TESTI_SETTIMANA.porteAperte, conto: null, nota: null, segmenti };
  }
  return { titolo, evidenza: TESTI_SETTIMANA.aperta, conto: null, nota: TESTI_SETTIMANA.notaAperta, segmenti };
}

// La parte alta della home (h = costruttore di nodi della web app: i testi entrano sempre come testo, mai come HTML).
export function vistaSettimanaHome(h, m) {
  return h("div", { classe: "home-settimana" },
    h("p", { classe: "passo" }, TESTI_SETTIMANA.etichetta),
    h("div", { classe: "settimana", "aria-hidden": "true" }, m.segmenti.map((s) => h("i", s ? { classe: s } : {}))),
    h("h1", {}, m.titolo, h("br"), h("em", {}, m.evidenza)),
    m.conto ? h("p", { classe: "conto-settimana", id: "conto-settimana", "aria-label": `${TESTI_SETTIMANA.manca} ${m.conto}` }, m.conto) : null,
    m.nota ? h("p", { classe: "sottotitolo nota-settimana" }, m.nota) : null);
}
