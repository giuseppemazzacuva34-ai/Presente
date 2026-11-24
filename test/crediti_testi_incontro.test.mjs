// Decisione di Giuseppe del 23/11 (decisioni_giuseppe_23_11_crediti): «crediti» al posto di «Coin» in tutti i testi
// visibili. Qui i testi dell'incontro dopo il doppio sì (#6, linea «sviluppatore-b»). Nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_INCONTRO } from "../landing/app/moduli/incontro.js";

test("nessun testo dell'incontro dice «Coin»", () => {
  assert.doesNotMatch(JSON.stringify(TESTI_INCONTRO), /Coin/);
});

test("caparra, scadenza, annullo e disdetta parlano di crediti", () => {
  assert.equal(TESTI_INCONTRO.caparra, "Se uno dei due non si presenta, i suoi 100 crediti vanno: 70 a chi ha aspettato, 30 a Presente.");
  assert.equal(TESTI_INCONTRO.scaduto, "Non siete riusciti a fissare l'incontro. I tuoi 100 crediti sono di nuovo disponibili.");
  assert.equal(TESTI_INCONTRO.annullato, "L'incontro è annullato. I crediti tornano a entrambi.");
  assert.equal(TESTI_INCONTRO.confermaAnnulla, "Annulli l'incontro? Non potrete più fissarlo. I crediti tornano a entrambi.");
  assert.equal(TESTI_INCONTRO.creditiLiberi, "I tuoi 100 crediti sono di nuovo disponibili.");
  assert.equal(TESTI_INCONTRO.confermaDisdici, "Disdici questo appuntamento? Potete fissarne un altro entro il <data>. Se non lo fissate, i crediti tornano a entrambi.");
  assert.equal(TESTI_INCONTRO.confermaDisdiciTardi, "Mancano meno di 6 ore: se disdici ora è come non presentarsi, e i tuoi 100 crediti vanno: 70 all'altra persona, 30 a Presente. Disdici lo stesso?");
});
