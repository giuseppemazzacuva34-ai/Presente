// «Contesta» un «No» nel riquadro «Dopo i tuoi incontri» (issue #6, spec v1.3 punto 2), passo 3 della linea
// «sviluppatore-b»: il modulo contesta_no.js entra accanto alle righe «Una persona ha risposto no a: …».
// Aggiunte minime nei file condivisi (flusso.js, avvio.js, sw.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("flusso: «Contesta» accanto ai «no», campo con etichetta visibile, Manda e Annulla", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /contestaNo = \(telefono && opzioni\.riepilogo && opzioni\.riepilogo\.contesta\) \|\| null;/);
  assert.match(flusso, /rigaContesta\(/);
  assert.match(flusso, /h\("label", \{ for: `contesta-\$\{k\}` \}, TESTI_CONTESTA\.domanda\)/);
  assert.match(flusso, /TESTI_CONTESTA\.manda/);
  assert.match(flusso, /TESTI_CONTESTA\.annulla/);
  assert.match(flusso, /TESTI_CONTESTA\.inviata/);
});

test("avvio: contestazioni col proprio token", () => {
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /riepilogo\.contesta = creaContesta\(\{ token: \(\) => accesso\.token\(\)/);
});

test("service worker: modulo nella cache, versione aumentata", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.ok(sw.includes('"/app/moduli/contesta_no.js"'));
  assert.ok(!sw.includes('"presente-app-65"'), "versione della cache aumentata");
});
