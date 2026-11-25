// Design v4 (#349, approvato da Giuseppe il 22/11), schermata 39 «Lo svelamento» (#n27 nel prototipo).
// Linea «sviluppatore-c» (le schermate 39-40 sono della linea C, plancia del CTO 22/11). Solo vista, prima della
// propria caparra: occhiello «Svelamento · <nome>, <età>», «Hai 48 ore / per lo svelamento.», timer grande «hh:mm»,
// la caparra in tre righe (testo del server) e il piede «Più tardi» / «Blocca 100 crediti».
// Le regole restano in svelamento.js e sul server (ps.blocca, ps.mostraRicarica): qui non cambia niente di quelle.
// Il prototipo scrive «10 crediti»: vale la caparra decisa (100 crediti, decisioni_giuseppe_23_11_crediti), cioè il
// testo che arriva dal server in s.caparra.

export const TESTI_CAPARRA = Object.freeze({
  occhiello: "Svelamento",
  titolo: "Hai 48 ore",
  titoloEvidenza: "per lo svelamento.",
  piuTardi: "Più tardi",
  attimo: "Un attimo…",
});

const MINUTO = 60 * 1000;
const due = (n) => String(n).padStart(2, "0");

// «47:59» (ore:minuti che mancano, per difetto); null a tempo finito o con una data illeggibile.
export function oreMinuti(scadeIl, adesso = new Date()) {
  const manca = new Date(scadeIl).getTime() - adesso.getTime();
  if (!Number.isFinite(manca) || manca <= 0) return null;
  const minuti = Math.floor(manca / MINUTO);
  return `${due(Math.floor(minuti / 60))}:${due(minuti % 60)}`;
}

// null se non è il momento della 39 (nessuna porta, porta chiusa o scaduta, propria caparra già bloccata).
export function vistaCaparra(h, ps, m, s, { torna, scadeIl, adesso = new Date() } = {}) {
  if (!s || s.tipo !== "porta" || !s.caparra) return null;
  const c = s.caparra;
  if (c.tipo !== "blocca" && c.tipo !== "ricarica") return null;
  const breve = scadeIl ? oreMinuti(scadeIl, adesso) : null;
  const corpo = [
    h("p", { classe: "passo" }, `${TESTI_CAPARRA.occhiello} · ${s.chi}`),
    h("h1", { id: "porta-titolo" }, TESTI_CAPARRA.titolo, h("br", {}), h("em", {}, TESTI_CAPARRA.titoloEvidenza)),
    h("p", { classe: "timer", role: "timer", "aria-label": s.conto }, breve || s.conto),
    h("p", { classe: "sub", id: "caparra-spiegazione" }, c.spiegazione),
  ];
  if (c.tipo === "ricarica") corpo.push(h("p", { classe: "errore", role: "status" }, c.testo));
  corpo.push(h("p", { classe: "nota" }, s.saldo));
  if (c.tipo === "ricarica" && m.ricarica) corpo.push(h("p", { classe: "nota", id: "ricarica-beta", role: "status" }, c.beta));
  const primario = c.tipo === "blocca"
    ? h("button", { classe: "bottone", type: "button", "aria-describedby": "caparra-spiegazione", disabled: m.inCorso,
      onclick: () => ps.blocca() }, m.inCorso ? TESTI_CAPARRA.attimo : c.bottone)
    : h("button", { classe: "bottone", type: "button", "aria-expanded": m.ricarica ? "true" : "false",
      "aria-controls": "ricarica-beta", onclick: () => ps.mostraRicarica() }, c.bottone);
  return h("section", { classe: "schermata porta-svelamento svelamento-v4", "aria-labelledby": "porta-titolo" },
    corpo,
    h("div", { classe: "azioni" },
      h("button", { classe: "bottone-secondario", type: "button", onclick: () => torna() }, TESTI_CAPARRA.piuTardi),
      primario));
}
