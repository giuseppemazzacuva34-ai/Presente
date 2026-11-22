// «I vostri incontri» collegati alla home (issue #6, spec v1 del CPO del 3/11, punto 1), passo 3n della linea
// «sviluppatore-b»: il riquadro nella home apre «Il vostro incontro» (incontro.js) e da lì la valutazione
// (valutazione.js). Aggiunte minime nei file condivisi (flusso.js, avvio.js, sw.js), senza riordinare nulla.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("flusso: riquadro nella home, schermata dell'incontro e della valutazione", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /from "\.\/vostri_incontri\.js"/);
  assert.match(flusso, /import \{ vistaIncontro \} from "\.\/incontro\.js"/);
  assert.match(flusso, /import \{ vistaValutazione \} from "\.\/valutazione\.js"/);
  assert.match(flusso, /bloccoVostriIncontri\(\),/);
  assert.match(flusso, /export function incontroCambiato\(/);
  // Solo con l'accesso vero, come gli altri riquadri della home.
  assert.match(flusso, /vostriIncontri = \(telefono && opzioni\.vostriIncontri\) \|\| null;/);
  assert.match(flusso, /incontroVostro = \(telefono && opzioni\.incontro\) \|\| null;/);
  assert.match(flusso, /valutazioneVostra = \(telefono && opzioni\.valutazione\) \|\| null;/);
  assert.match(flusso, /schermoValutazioneVostra\(\)/);
  assert.match(flusso, /schermoIncontroVostro\(\)/);
  // Dall'incontro si torna alla home e l'elenco si rilegge.
  assert.match(flusso, /Torna alla home/);
});

test("avvio: incontro, valutazione ed elenco col proprio token", () => {
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /creaVostriIncontri\(\{ token: \(\) => accesso\.token\(\)/);
  assert.match(avvio, /creaIncontro\(\{ token: \(\) => accesso\.token\(\)/);
  assert.match(avvio, /creaValutazione\(\{ token: \(\) => accesso\.token\(\)/);
  assert.match(avvio, /incontroCambiato\(\)/);
  assert.match(avvio, /vostriIncontri, incontro, valutazione/);
});

test("service worker: i tre moduli nella cache, versione aumentata", () => {
  const sw = leggi("../landing/app/sw.js");
  for (const f of ["vostri_incontri", "incontro", "valutazione"]) assert.ok(sw.includes(`"/app/moduli/${f}.js"`), f);
  assert.ok(!sw.includes('"presente-app-39"'), "versione della cache aumentata");
});

test("sicurezza: il modulo dell'elenco non salva in locale e non scrive log", () => {
  const src = leggi("../landing/app/moduli/vostri_incontri.js");
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|console\./);
});
