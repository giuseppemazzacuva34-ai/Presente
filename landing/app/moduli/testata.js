// Testata del design v4 (#349, base comune della linea A): pillola del saldo Coin in alto a sinistra e cerchio del
// profilo in alto a destra. Il saldo lo dà sempre il server (mai un numero inventato al telefono): se manca, la
// pillola resta nascosta. Diventa rossa sotto il costo di una stanza (api/coin.js, stanzaAlBuio = 80).
// Le altre linee chiamano aggiornaTestata(document, { saldo, nome }) quando hanno i dati; il clic sul profilo lo
// aggancia chi fa la schermata del profilo (n. 22).

export const SOGLIA_SALDO_BASSO = 80;

export function statoSaldo(n) {
  if (!Number.isInteger(n) || n < 0) return null;
  return { testo: String(n), basso: n < SOGLIA_SALDO_BASSO };
}

export function iniziale(nome) {
  if (typeof nome !== "string") return null;
  const t = nome.trim();
  return t ? [...t][0].toLocaleUpperCase("it") : null;
}

export function aggiornaTestata(doc, { saldo = null, nome = null } = {}) {
  const pillola = doc.getElementById("saldo-coin");
  if (pillola) {
    const s = statoSaldo(saldo);
    pillola.hidden = s === null;
    if (s) {
      const numero = pillola.querySelector("span");
      if (numero) numero.textContent = s.testo;
      pillola.classList.toggle("basso", s.basso);
      pillola.setAttribute("aria-label", `Saldo: ${s.testo} Coin${s.basso ? ", non bastano per la prossima stanza" : ""}`);
    }
  }
  const profilo = doc.getElementById("apri-profilo");
  if (profilo) {
    const i = iniziale(nome);
    profilo.hidden = i === null;
    if (i) profilo.textContent = i;
  }
}
