// Design v4 (issue #349, schermata 19 «La stanza», prototipo #n14; D149 A; linea A del CTO): la testata della stanza.
// «LA TUA STANZA · MILANO» a sinistra e «GIORNO 2 DI 7» a destra; «2 CHIAVI» sulla riga del primo gruppo.
// Tipo, città e apertura arrivano dalla tabella stanze (compagni.stanza(), regola per riga: solo le tue stanze).
// Senza quei dati resta «La tua stanza», senza giorno: mai un luogo o un giorno inventato.

const ROMA = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });

// Giorno di calendario di Roma, come numero di giorni dal 1970 (per contare i giorni senza problemi di ora legale).
function giornoRoma(d) {
  const [a, m, g] = ROMA.format(d).split("-").map(Number);
  return Date.UTC(a, m - 1, g) / 86400000;
}

export function testataStanza(info, adesso = new Date()) {
  const vuota = { luogo: "La tua stanza", giorno: null };
  if (!info || typeof info !== "object") return vuota;
  const citta = typeof info.citta === "string" ? info.citta.trim().slice(0, 60) : "";
  const posto = info.tipo === "italia" ? "Italia" : info.tipo === "citta" && citta ? citta : "";
  const apre = new Date(info.apreIl);
  let giorno = null;
  if (!Number.isNaN(apre.getTime()) && adesso >= apre) {
    const n = giornoRoma(adesso) - giornoRoma(apre) + 1;
    if (n >= 1 && n <= 7) giorno = `Giorno ${n} di 7`;
  }
  return { luogo: posto ? `La tua stanza · ${posto}` : "La tua stanza", giorno };
}

// «N chiavi» da dare, dal contatore di chiavi.js ({ icone: [piena, piena] }).
export function testoChiaviGruppo(contatore) {
  if (!contatore || !Array.isArray(contatore.icone)) return null;
  const n = contatore.icone.filter(Boolean).length;
  return n === 1 ? "1 chiave" : `${n} chiavi`;
}

export function vistaTestataStanza(h, t, { chiusa = false } = {}) {
  return h("div", { classe: "testata-stanza" },
    h("h2", { id: "tua-stanza-titolo" }, t.luogo, chiusa ? h("span", { classe: "etichetta-chiusa" }, " · Chiusa") : null),
    !chiusa && t.giorno ? h("p", { classe: "giorno-stanza" }, t.giorno) : null);
}

export function vistaTitoloGruppo(h, titolo, chiavi) {
  return h("h3", { classe: "gruppo-stanza" }, h("span", {}, titolo),
    chiavi ? [h("span", { classe: "solo-lettore" }, " · "), h("span", { classe: "chiavi-gruppo" }, chiavi)] : null);
}
