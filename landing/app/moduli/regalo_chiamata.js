// Tasto «Regalo» durante la chiamata (issue #349, design v4 schermata 27, linea «sviluppatore-b»).
// Apre lo stesso foglio della scheda (regali_stanza.js → regali.js) con inChiamata: true, che aggiunge
// «<nome> lo vede subito, durante la chiamata.». Chi può ricevere, saldo e limiti li ricontrolla il server.
// Niente salvataggi locali, niente log.
export const ID_REGALO_CHIAMATA = "regalo-chiamata";

export function vistaRegaloChiamata(h, rs, { a, nome } = {}) {
  if (!rs || typeof a !== "string" || !a) return null;
  const n = typeof nome === "string" && nome.trim() ? nome.trim() : "questa persona";
  return h("button", { classe: "bottone-secondario", type: "button", id: ID_REGALO_CHIAMATA,
    "aria-label": `Manda un regalo a ${n}`, "aria-haspopup": "dialog",
    onclick: () => rs.apriFoglio(a, n, { inChiamata: true, ritorno: ID_REGALO_CHIAMATA }) }, "Regalo");
}
