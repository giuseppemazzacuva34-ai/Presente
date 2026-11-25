// Profilo (schermata 23 del design v4, #349): le due schermate «Notifiche» e «Privacy» (spec del CPO del 25/11).
// Linea «sviluppatore-b». Notifiche: nessun interruttore in beta (niente notifiche sul telefono, D24; nessun invio
// automatico la domenica, D136 B), solo una frase. Privacy: 4 righe nell'ordine della spec; «Elimina il mio account»
// resta solo nel profilo. Nessun download automatico dei dati in beta, nessuna regola legale nuova (testi legali = CFO
// e Giuseppe). Il modulo non chiama la rete e non salva nulla: riceve h (il costruttore di elementi del flusso).

import { REGOLE_COMMUNITY } from "./regole_community.js";

export const TESTI_NOTIFICHE = Object.freeze({
  titolo: "Notifiche",
  testo: "Per ora ti avvisiamo dentro l'app, quando la apri. Le notifiche sul telefono arriveranno presto.",
  indietro: "Indietro",
});

export const TESTI_PRIVACY = Object.freeze({
  titolo: "Privacy",
  informativa: "Informativa privacy",
  regole: "Regole della community",
  chiVedeTitolo: "Chi vede cosa",
  chiVede: "Voce e risposte: le persone della tua stanza. Foto: solo dopo il sì di entrambi. Questionario, diario e chi vuoi incontrare: nessuno.",
  copiaTitolo: "Una copia dei tuoi dati",
  copia: "Scrivici da Aiuto › Scrivici: te la mandiamo entro 30 giorni.",
  vaiAiuto: "Vai ad Aiuto",
  indietro: "Indietro",
});
const P = TESTI_PRIVACY;

const freccia = (h) => h("span", { classe: "freccia", "aria-hidden": "true" }, "›");
const piede = (h, testo, indietro) => h("div", { classe: "azioni" }, h("button", { classe: "bottone", type: "button", onclick: indietro }, testo));

export function vistaNotifiche(h, { indietro } = {}) {
  return h("section", { classe: "schermata profilo notifiche", "aria-labelledby": "notifiche-titolo" },
    h("div", { classe: "corpo" },
      h("h2", { id: "notifiche-titolo" }, TESTI_NOTIFICHE.titolo),
      h("p", { classe: "sub" }, TESTI_NOTIFICHE.testo)),
    piede(h, TESTI_NOTIFICHE.indietro, indietro));
}

// Riga che apre e chiude il suo testo sotto (pulsante con aria-expanded e aria-controls: tastiera e lettori di schermo).
function rigaApribile(h, id, titolo, ...contenuto) {
  const pannello = h("div", { classe: "spiega", id, hidden: true }, ...contenuto);
  const b = h("button", { classe: "voce-profilo", type: "button", "aria-expanded": "false", "aria-controls": id,
    onclick: () => {
      const apri = b.getAttribute("aria-expanded") !== "true";
      b.setAttribute("aria-expanded", apri ? "true" : "false");
      pannello.hidden = !apri;
    } }, titolo, freccia(h));
  return [b, pannello];
}

// aiuto: apre la pagina Aiuto (#10); se manca, il pulsante non compare (mai pulsanti morti).
export function vistaPrivacy(h, { indietro, aiuto = null } = {}) {
  return h("section", { classe: "schermata profilo privacy", "aria-labelledby": "privacy-titolo" },
    h("div", { classe: "corpo" },
      h("h2", { id: "privacy-titolo" }, P.titolo),
      h("a", { classe: "voce-profilo", href: "/privacy.html" }, P.informativa, freccia(h)),
      rigaApribile(h, "privacy-regole", P.regole, h("ol", {}, REGOLE_COMMUNITY.map(([, t]) => h("li", {}, t)))),
      rigaApribile(h, "privacy-chi-vede", P.chiVedeTitolo, h("p", { classe: "nota" }, P.chiVede)),
      rigaApribile(h, "privacy-copia", P.copiaTitolo, h("p", { classe: "nota" }, P.copia),
        typeof aiuto === "function" ? h("button", { classe: "link", type: "button", onclick: aiuto }, P.vaiAiuto) : null)),
    piede(h, P.indietro, indietro));
}
