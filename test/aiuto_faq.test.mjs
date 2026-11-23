// #10 parte A (linea «sviluppatore-c»): le 12 domande frequenti con i testi del CPO (bozze/cpo-testi-aiuto-20261106),
// passati dal gate_v3 di brand dei «contenuti» il 17/11.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMANDE_FREQUENTI, filtraDomande } from "../landing/app/moduli/aiuto.js";

const TITOLI = [
  "Come funziona una stanza",
  "Quando si apre la mia zona",
  "Perché vedo poche persone nella stanza",
  "Le mie foto chi le vede",
  "Come funzionano le chiavi",
  "Cosa succede quando si apre la porta",
  "Cos'è la caparra",
  "Cosa succede se qualcuno dà buca",
  "Come uso i crediti",
  "Come cambio provincia o raggio",
  "Come blocco o segnalo qualcuno",
  "Come cancello l'account",
];

test("le domande frequenti sono 12, nell'ordine della spec", () => {
  assert.deepEqual(DOMANDE_FREQUENTI.map((d) => d.domanda), TITOLI);
});

test("ogni risposta ha al massimo 60 parole e non è vuota", () => {
  for (const d of DOMANDE_FREQUENTI) {
    const parole = d.risposta.trim().split(/\s+/).length;
    assert.ok(parole > 0 && parole <= 60, `${d.domanda}: ${parole} parole`);
  }
});

test("regole del brand: niente «gratis», mai «niente foto», nessuna data", () => {
  for (const d of DOMANDE_FREQUENTI) {
    const r = d.risposta.toLowerCase();
    assert.ok(!r.includes("gratis"), d.domanda);
    assert.ok(!r.includes("niente foto"), d.domanda);
    assert.ok(!/\b20\d\d\b/.test(r), d.domanda);
  }
});

test("i fatti che contano sono quelli decisi", () => {
  const per = Object.fromEntries(DOMANDE_FREQUENTI.map((d) => [d.domanda, d.risposta]));
  assert.match(per["Le mie foto chi le vede"], /restano nascoste/);
  assert.match(per["Come funzionano le chiavi"], /2 chiavi/);
  assert.match(per["Come funzionano le chiavi"], /solo se la chiave è reciproca/);
  assert.match(per["Cosa succede se qualcuno dà buca"], /100 crediti vanno così: 70 a chi ha aspettato, 30 a Presente/);
  assert.match(per["Come blocco o segnalo qualcuno"], /112/);
});

test("la lista non si può modificare e «Cerca» trova le chiavi", () => {
  assert.ok(Object.isFrozen(DOMANDE_FREQUENTI));
  assert.ok(DOMANDE_FREQUENTI.every((d) => Object.isFrozen(d)));
  assert.ok(filtraDomande(DOMANDE_FREQUENTI, "chiave").some((d) => d.domanda === "Come funzionano le chiavi"));
});
