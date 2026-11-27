// Sfondo della chiamata (issue #349, design v4 D149, schermate 25, 29, 30; linea A).
// Dietro nome, timer e onda: la sagoma di chi parla che ondeggia dietro un vetro rosso, con luci che si muovono e un
// riflesso (valori del prototipo, sezione «chiamata»: .sfondo-ch). Sagoma maschile se l'altra persona è nel gruppo
// «uomini», femminile se è in «donne», disegnata col CSS (nessuna foto) negli altri casi. Le immagini sono generate
// con AI, nessuna persona reale, volto mai a fuoco. Si usa solo il gruppo che la stanza viva ha già: nessun dato nuovo.
// L'immagine la sceglie il CSS dalla classe (la CSP vieta gli stili negli attributi).

const SAGOME = Object.freeze({ uomini: "uomo", donne: "donna" });

export const sagomaChiamata = (gruppo) =>
  (typeof gruppo === "string" && Object.hasOwn(SAGOME, gruppo) ? SAGOME[gruppo] : "neutra");

// h: la funzione di flusso.js (tag, attributi, ...figli). Solo decorazione: aria-hidden.
export function vistaSfondoChiamata(h, gruppo) {
  return h("div", { classe: "sfondo-chiamata", "aria-hidden": "true" },
    h("div", { classe: `sagoma ${sagomaChiamata(gruppo)}` }),
    h("div", { classe: "luci" }),
    h("div", { classe: "vetro" }),
    h("div", { classe: "riflesso" }));
}
