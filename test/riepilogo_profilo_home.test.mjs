// Riepilogo alla cieca delle valutazioni nel proprio profilo (issue #6, spec v1 del CPO del 3/11, «Valutazione (D20)»),
// passo 3o della linea «sviluppatore-b»: il modulo riepilogo_valutazioni.js (passo 3j) entra nel riquadro del profilo
// della home. Aggiunte minime nei file condivisi (flusso.js, avvio.js, sw.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("flusso: righe del riepilogo nel profilo, lette una volta, solo con l'accesso vero", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /riepilogoMio = \(telefono && opzioni\.riepilogo\) \|\| null;/);
  assert.match(flusso, /bloccoRiepilogoMio\(\),/);
  assert.match(flusso, /function bloccoRiepilogoMio\(/);
});

test("avvio: riepilogo col proprio token", () => {
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /creaRiepilogo\(\{ token: \(\) => accesso\.token\(\)/);
  assert.match(avvio, /vostriIncontri, incontro, valutazione, riepilogo, regali \}/);
});

test("service worker: modulo nella cache, versione aumentata", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.ok(sw.includes('"/app/moduli/riepilogo_valutazioni.js"'));
  assert.ok(!sw.includes('"presente-app-42"'), "versione della cache aumentata");
});
