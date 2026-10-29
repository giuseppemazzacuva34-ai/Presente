// Test del questionario e dell'affinità (issue #2, specifica v1.1). Uso: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMANDE, TEMI, VERSIONE, affinita, erroreRisposta, questionarioCompleto, primaMancante, punteggioDomanda } from "../api/questionario.js";

const tutto = (v) => Object.fromEntries(Object.keys(TEMI).map((t) => [t, v]));
const A = { versione: "v1", importanza: tutto(3), risposte: { 1: [0, 1], 2: 1, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: [0, 1], 14: 0, 15: [0, 1, 2] } };
// Tutto diverso e lontano: scelte multiple senza voci in comune, scala 1 contro 5, opzioni ordinate agli estremi opposti.
const B = { versione: "v1", importanza: tutto(1), risposte: { 1: [2, 3], 2: 5, 3: 2, 4: 2, 5: 2, 6: 2, 7: 1, 8: 2, 9: 2, 10: 1, 11: 2, 12: 1, 13: [2, 3], 14: 1, 15: [3, 4, 5] } };
const copia = (p) => structuredClone(p);

test("15 domande, versione v1, testi e opzioni della specifica", () => {
  assert.equal(VERSIONE, "v1");
  assert.deepEqual(DOMANDE.map((d) => d.n), [...Array(15)].map((_, i) => i + 1));
  assert.equal(DOMANDE[0].testo, "Nella vita metti al primo posto… (scegli 2)");
  assert.deepEqual(DOMANDE[0].opzioni, ["Famiglia", "Lavoro e carriera", "Libertà e viaggi", "Amici", "Crescita personale", "Stabilità e sicurezza", "Impegno per gli altri"]);
  assert.equal(DOMANDE[8].opzioni[2], "Mi piacerebbe vivere all'estero");
  assert.deepEqual(DOMANDE[14].opzioni, ["Sport", "Cucina", "Viaggi", "Cinema, libri, mostre", "Musica e concerti", "Natura", "Serate fuori", "Giochi"]);
  const conteggio = {};
  for (const d of DOMANDE) conteggio[d.tema] = (conteggio[d.tema] || 0) + 1;
  assert.deepEqual(conteggio, { valori: 3, ritmi: 2, soldi: 2, famiglia: 3, conflitti: 3, tempo_libero: 2 });
});

test("pesi dei temi: 25, 25, 20, 15, 10, 5 (somma 100)", () => {
  assert.equal(Object.values(TEMI).reduce((s, t) => s + t.peso, 0), 100);
  assert.equal(TEMI.valori.peso, 25); assert.equal(TEMI.conflitti.peso, 25); assert.equal(TEMI.famiglia.peso, 20);
  assert.equal(TEMI.soldi.peso, 15); assert.equal(TEMI.ritmi.peso, 10); assert.equal(TEMI.tempo_libero.peso, 5);
});

test("le multiple impongono il numero di scelte (2, 2, 1–3)", () => {
  assert.equal(erroreRisposta(1, [0]), "Scegli esattamente 2 voci.");
  assert.equal(erroreRisposta(1, [0, 1, 2]), "Scegli esattamente 2 voci.");
  assert.equal(erroreRisposta(1, [0, 0]), "Ogni voce si sceglie una volta sola.");
  assert.equal(erroreRisposta(13, [0, 9]), "Scegli dall'elenco.");
  assert.equal(erroreRisposta(15, []), "Scegli da 1 a 3 voci.");
  assert.equal(erroreRisposta(15, [0, 1, 2, 3]), "Scegli da 1 a 3 voci.");
  assert.equal(erroreRisposta(15, [7]), null);
  assert.equal(erroreRisposta(2, 6), "Scegli un valore da 1 a 5.");
  assert.equal(erroreRisposta(3, 3), "Scegli una risposta.");
  assert.equal(erroreRisposta(16, 0), "Domanda inesistente.");
});

test("completo solo con 15 risposte e 6 «quanto conta»", () => {
  assert.ok(questionarioCompleto(A));
  const senzaConta = copia(A); delete senzaConta.importanza.soldi;
  assert.equal(questionarioCompleto(senzaConta), false);
  const vecchia = copia(A); vecchia.versione = "v0";
  assert.equal(questionarioCompleto(vecchia), false);
});

test("uscendo a metà si riprende dalla prima domanda mancante", () => {
  const meta = copia(A); delete meta.risposte[7]; delete meta.risposte[12];
  assert.equal(primaMancante(meta), 7);
  assert.equal(primaMancante(A), null);
  assert.equal(primaMancante({ risposte: {} }), 1);
});

test("punteggi per domanda: uguale 1, ordinata vicina 0,5, categorica diversa 0, multipla comuni/unione", () => {
  const [q1, q2, q3, , , , q7] = DOMANDE;
  assert.equal(punteggioDomanda(q3, 1, 1), 1);
  assert.equal(punteggioDomanda(q3, 0, 1), 0.5);
  assert.equal(punteggioDomanda(q3, 0, 2), 0);
  assert.equal(punteggioDomanda(q2, 2, 3), 0.5);
  assert.equal(punteggioDomanda(q2, 2, 4), 0);
  assert.equal(punteggioDomanda(q7, 0, 1), 0);
  assert.equal(punteggioDomanda(q1, [0, 1], [1, 2]), 1 / 3);
});

test("due profili identici: affinità 100 (con qualunque «quanto conta»)", () => {
  assert.equal(affinita(A, copia(A)), 100);
  const piano = copia(A); piano.importanza = tutto(1);
  assert.equal(affinita(piano, copia(piano)), 100);
});

test("risposte tutte diverse e lontane: affinità 0", () => {
  assert.equal(affinita(A, B), 0);
  assert.equal(affinita(B, A), 0);
});

test("simmetrica, tra 0 e 100, e conta di più ciò che conta di più", () => {
  const C = copia(A); C.risposte[11] = 2; C.risposte[12] = 1; C.risposte[13] = [3, 4]; // conflitti tutti diversi
  const x = affinita(A, C);
  assert.equal(x, affinita(C, A));
  assert.ok(x > 0 && x < 100);
  const pocoConflitti = copia(A); pocoConflitti.importanza.conflitti = 1;
  const C2 = copia(C); C2.importanza.conflitti = 1;
  assert.ok(affinita(pocoConflitti, C2) > x, "se i conflitti contano poco per entrambi, la differenza pesa meno");
});

test("profilo incompleto: nessuna affinità", () => {
  const meta = copia(A); delete meta.risposte[15];
  assert.equal(affinita(A, meta), null);
});
