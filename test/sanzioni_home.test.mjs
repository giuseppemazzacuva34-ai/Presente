// Sanzione e «Contesta» collegati all'app (issue #7, spec v1.1 punti 7-8; passo 12d della linea «sviluppatore-b»).
// Controlli sul testo dei file della web app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("flusso: nella home le proprie sanzioni con «Contesta», modulo del ricorso e conferma", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /import \{ TESTI_SANZIONE \} from "\.\/sanzioni\.js";/);
  assert.match(flusso, /function bloccoSanzioni\(/);
  assert.match(flusso, /bloccoSanzioni\(\),/);
  assert.match(flusso, /sanzioniMie\.contesta\(/);
  assert.match(flusso, /TESTI_SANZIONE\.domanda/);
  assert.match(flusso, /TESTI_SANZIONE\.conferma/);
  assert.match(flusso, /maxlength: String\(TESTI_SANZIONE\.massimo\)/);
  assert.match(flusso, /sanzioniMie = \(telefono && opzioni\.sanzioni\) \|\| null;/);
});

test("avvio: le sanzioni si leggono da Supabase con il token di chi è entrato", () => {
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /import \{ creaSanzioni \} from "\/app\/moduli\/sanzioni\.js";/);
  assert.match(avvio, /creaSanzioni\(\{ supabaseUrl: config\.supabaseUrl, supabaseAnonKey: config\.supabaseAnonKey,/);
  assert.match(avvio, /sanzioni, erroreLink/);
});

test("service worker: sanzioni.js in memoria e versione nuova", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.ok(sw.includes('"/app/moduli/sanzioni.js"'));
  assert.ok(!sw.includes('"presente-app-28"'));
});
