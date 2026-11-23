// Decisione di Giuseppe del 23/11 (decisioni_giuseppe_23_11_crediti): i «Coin» tornano a chiamarsi «crediti» in tutti
// i testi visibili. Qui i testi della linea «sviluppatore-b» (schermate 13 e 21, saldo_coin.js). I nomi interni del
// codice (creaCoin, coin200, …) possono restare. Nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_SALDO, schermataTuoiCoin, quasiFiniti } from "../landing/app/moduli/saldo_coin.js";

const visibile = (x) => JSON.stringify(x, (k, v) => (k === "id" || k === "scelto" ? undefined : v));

test("nessun testo visibile dice «Coin»", () => {
  assert.doesNotMatch(visibile(TESTI_SALDO), /Coin/);
  for (const n of [0, 1, 4, 15, 79, 80, 500, null]) {
    assert.doesNotMatch(visibile(schermataTuoiCoin(n)), /Coin/, `schermata 13 con ${n}`);
    assert.doesNotMatch(visibile(quasiFiniti(n)), /Coin/, `schermata 21 con ${n}`);
  }
});

test("schermata 13 parla di crediti", () => {
  const s = schermataTuoiCoin(120);
  assert.equal(s.passo, "Passo 10 di 10 · I tuoi crediti");
  assert.deepEqual(s.titolo, ["I tuoi crediti", "per la stanza e i regali."]);
  assert.equal(s.saldo, "Hai 120 crediti. La tua prima stanza è in regalo.");
  assert.equal(s.pacchetti[0].sotto, "crediti");
  assert.equal(s.costi[0].costo, "80 crediti");
  assert.equal(s.notaBeta, "Nella beta i crediti sono di prova: li trovi già nel tuo saldo. Non paghi niente.");
});

test("schermata 21 parla di crediti, al singolare con 1", () => {
  assert.equal(quasiFiniti(15).etichetta, "I tuoi crediti");
  assert.deepEqual(quasiFiniti(15).titolo, ["Ti restano", "15 crediti."]);
  assert.deepEqual(quasiFiniti(1).titolo, ["Ti resta", "1 credito."]);
  assert.deepEqual(quasiFiniti(0).titolo, ["Hai finito", "i crediti."]);
  assert.equal(quasiFiniti(15).testo, "Bastano per qualche regalo, non per la prossima stanza (80 crediti).");
  assert.equal(quasiFiniti(4).testo, "Non bastano per la prossima stanza (80 crediti) né per un regalo.");
});
