// Coin e saldo del design v4 (issue #349, schermate 13 «I tuoi Coin» e 21 «Coin quasi finiti»; decisione di Giuseppe
// del 22/11 sul design v4). Passo 1 della linea «sviluppatore-b»: logica e testi, gli stili arrivano dopo la base
// grafica del CTO.
// In beta i Coin sono un CONTATORE INTERNO: «Paga» e «Ricarica» restano sempre spenti e nessuna richiesta va a Gomry
// (pagamenti veri solo con l'ok di Giuseppe). Il saldo lo dà sempre il server (coin.js → GET /app/api/regali): qui non
// si calcola né si inventa nessun numero. Niente salvataggi locali, niente log.
// I numeri restano uguali a api/coin.js, api/svelamento.js e moduli/coin.js: lo controlla test/saldo_coin_app.test.mjs.

import { OFFERTE } from "./coin.js";

const STANZA = 80; // COIN.stanzaAlBuio
const CAPARRA = 100; // SVELAMENTO.caparra
const REGALI_COIN = [5, 10, 20]; // REGALI di api/coin.js
const SCELTO = "coin500"; // «Il più scelto»

export const TESTI_SALDO = Object.freeze({
  // Schermata 13 (testi del design v4).
  passo: "Passo 10 di 10 · I tuoi Coin",
  titolo: Object.freeze(["I tuoi Coin", "per la stanza e i regali."]),
  hai: "Hai <n> Coin. La tua prima stanza è in regalo.",
  primaStanza: "La tua prima stanza è in regalo.",
  descrizione200: "2 stanze, o 1 stanza e regali",
  inRegalo: "+<n> in regalo",
  piuScelto: "Il più scelto",
  stanza: "Una stanza al buio, 7 giorni",
  caparra: "Caparra dello svelamento",
  regali: "Regali in chiamata",
  gomry: "Paghi con Gomry: carta, Apple Pay, Google Pay.",
  piuTardi: "Più tardi",
  paga: "Paga <euro>",
  // Come moduli/coin.js (spec #331 B.3): in beta i Coin sono di prova.
  notaBeta: "Nella beta i Coin sono di prova: li trovi già nel tuo saldo. Non paghi niente.",
  // Schermata 21. La frase con 15 Coin è del design; le altre due sono provvisorie, da rivedere con «contenuti».
  etichetta: "I tuoi Coin",
  restano: "Ti restano",
  resta: "Ti resta",
  finiti: Object.freeze(["Hai finito", "i Coin."]),
  bastanoCaparra: "Bastano per una caparra o qualche regalo, non per la prossima stanza (<stanza> Coin).",
  bastanoRegali: "Bastano per qualche regalo, non per la prossima stanza (<stanza> Coin).",
  nonBastano: "Non bastano per la prossima stanza (<stanza> Coin) né per un regalo.",
  dopo: "Dopo",
  ricarica: "Ricarica",
});
const T = TESTI_SALDO;

const valido = (n) => Number.isInteger(n) && n >= 0;
const euro = (n) => `${n} €`;
function pacchetto(o) {
  return { id: o.id, coin: o.coin, euro: euro(o.euro), sotto: o.inPiu > 0 ? T.inRegalo.replace("<n>", String(o.inPiu)) : "Coin" };
}

// Schermata 13. saldo: il numero del server; se manca, nessun numero. scelto: il pacchetto toccato (di base il 500).
export function schermataTuoiCoin(saldo, { scelto = SCELTO } = {}) {
  const id = OFFERTE.some((o) => o.id === scelto) ? scelto : SCELTO;
  const prezzo = OFFERTE.find((o) => o.id === id).euro;
  return {
    passo: T.passo,
    titolo: [...T.titolo],
    saldo: valido(saldo) ? T.hai.replace("<n>", String(saldo)) : T.primaStanza,
    pacchetti: OFFERTE.map((o) => ({ ...pacchetto(o), descrizione: o.inPiu > 0 ? null : T.descrizione200, piuScelto: o.id === SCELTO })),
    scelto: id,
    costi: [
      { voce: T.stanza, costo: `${STANZA} Coin` },
      { voce: T.caparra, costo: `${CAPARRA} Coin` },
      { voce: T.regali, costo: REGALI_COIN.join(" · ") },
    ],
    gomry: T.gomry,
    notaBeta: T.notaBeta,
    piuTardi: T.piuTardi,
    paga: { testo: T.paga.replace("<euro>", euro(prezzo)), attivo: false }, // in beta sempre spento
  };
}

// Schermata 21: solo quando il saldo non basta per la prossima stanza. Dice cosa si può ancora fare.
export function quasiFiniti(saldo) {
  if (!valido(saldo) || saldo >= STANZA) return null;
  const testo = saldo >= CAPARRA ? T.bastanoCaparra : saldo >= Math.min(...REGALI_COIN) ? T.bastanoRegali : T.nonBastano;
  const titolo = saldo === 0 ? [...T.finiti] : [saldo === 1 ? T.resta : T.restano, `${saldo} Coin.`];
  return {
    etichetta: T.etichetta,
    titolo,
    testo: testo.replace("<stanza>", String(STANZA)),
    pacchetto: pacchetto(OFFERTE.find((o) => o.id === SCELTO)),
    dopo: T.dopo,
    ricarica: T.ricarica,
    attivo: false, // «Ricarica» in beta sempre spento
  };
}

// Saldo nella testata: coin = creaCoin() di moduli/coin.js; testata(dati) = aggiornaTestata(document, dati).
export function creaSaldo({ coin, testata }) {
  return {
    async aggiorna() {
      let r;
      try { r = await coin.saldo(); } catch { return { ok: false, motivo: "rete" }; }
      if (!r || r.ok !== true || !valido(r.saldo)) return { ok: false, motivo: (r && r.motivo) || "riprova" };
      try { testata({ saldo: r.saldo }); } catch { /* la testata non deve fermare la lettura */ }
      return { ok: true, saldo: r.saldo, quasiFiniti: r.saldo < STANZA };
    },
  };
}
