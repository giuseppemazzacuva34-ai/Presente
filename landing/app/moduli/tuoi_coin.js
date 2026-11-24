// Schermata 13 «I tuoi crediti» del design v4 (issue #349; spec #331 v1.1, punti 2 e 4; prototipo #coin-negozio),
// linea «sviluppatore-b». Vista nel flusso della pagina, sotto la testata (logo e saldo restano visibili come nel
// disegno): prende il posto di <main id="app"> (principale), che si nasconde finché la vista è aperta e poi torna com'era.
// dati = schermataTuoiCoin(saldo) di saldo_coin.js: testi e numeri vengono solo da lì (saldo del server, mai inventato).
// In beta «Paga» resta SEMPRE spento con la frase dei crediti di prova: nessuna richiesta a Gomry o ad altri servizi
// di pagamento (D150 B: si accende solo con una decisione di Giuseppe). Niente salvataggi locali, niente log.

import { TESTI_SALDO } from "./saldo_coin.js";

function el(doc, tag, classe, testo) {
  const e = doc.createElement(tag);
  if (classe) e.className = classe;
  if (testo != null) e.textContent = testo;
  return e;
}

const prezzoPaga = (dati, id) => {
  const p = dati.pacchetti.find((x) => x.id === id);
  return p ? dati.paga.testo.replace(/\d+ €$/, p.euro) : dati.paga.testo;
};

export function apriTuoiCoin(contenitore, dati, { alChiudi, principale = null } = {}) {
  if (!contenitore || !dati || !Array.isArray(dati.pacchetti)) return null;
  const doc = contenitore.ownerDocument;
  const vista = el(doc, "section", "tuoi-coin");
  vista.setAttribute("aria-labelledby", "tuoi-coin-titolo");
  const eraNascosto = principale ? principale.hidden === true : true;
  if (principale) principale.hidden = true;
  let aperto = true;
  const chiudi = () => {
    if (!aperto) return;
    aperto = false;
    vista.remove();
    if (principale) principale.hidden = eraNascosto;
    if (typeof alChiudi === "function") alChiudi();
  };

  const titolo = el(doc, "h2", null, dati.titolo[0]);
  titolo.setAttribute("id", "tuoi-coin-titolo");
  titolo.append(el(doc, "br"), el(doc, "em", null, dati.titolo[1]));

  const paga = el(doc, "button", "bottone", prezzoPaga(dati, dati.scelto));
  paga.setAttribute("type", "button");
  paga.disabled = dati.paga.attivo !== true;

  const pacchi = el(doc, "div", "pacchi");
  const bottoni = [];
  const scegli = (id) => {
    for (const { id: i, b } of bottoni) {
      const on = i === id;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.className = on ? "pacco on" : "pacco";
    }
    paga.textContent = prezzoPaga(dati, id);
  };
  for (const p of dati.pacchetti) {
    const b = el(doc, "button");
    b.setAttribute("type", "button");
    const q = el(doc, "span", "q", String(p.coin));
    q.append(el(doc, "small", null, p.sotto));
    const mezzo = p.piuScelto ? el(doc, "span", "scelto", TESTI_SALDO.piuScelto) : el(doc, "span", "d", p.descrizione || "");
    b.append(q, mezzo, el(doc, "span", "e", p.euro));
    b.addEventListener("click", () => scegli(p.id));
    bottoni.push({ id: p.id, b });
    pacchi.append(b);
  }
  scegli(dati.scelto);

  const costi = el(doc, "dl", "costi");
  for (const c of dati.costi) {
    const riga = el(doc, "div");
    riga.append(el(doc, "dt", null, c.voce), el(doc, "dd", null, c.costo));
    costi.append(riga);
  }

  const tardi = el(doc, "button", "bottone-secondario", dati.piuTardi);
  tardi.setAttribute("type", "button");
  tardi.addEventListener("click", chiudi);
  const azioni = el(doc, "div", "azioni");
  azioni.append(tardi, paga);

  vista.append(el(doc, "p", "passo", dati.passo), titolo, el(doc, "p", "sub", dati.saldo), pacchi, costi,
    el(doc, "p", "nota", dati.gomry), el(doc, "p", "nota", dati.notaBeta), azioni);
  vista.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); chiudi(); } });
  contenitore.append(vista);
  tardi.focus();
  return { chiudi };
}
