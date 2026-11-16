// Dopo un blocco la stanza si rilegge dal database (#7 spec v1.1 punto «Blocco»: chiavi annullate, persona sparita;
// passo 11 della linea «sviluppatore-b»). Usa telefono.ricaricaPersone() della linea «sviluppatore-c» (#5 passo 9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");

function corpo(nome) {
  const i = flusso.indexOf(`function ${nome}(`);
  assert.ok(i >= 0, `manca ${nome}`);
  const j = flusso.indexOf("\nfunction ", i + 10);
  return flusso.slice(i, j < 0 ? undefined : j);
}

test("blocco dal menu ⋯: se riesce, la stanza si rilegge", () => {
  const c = corpo("menuDellaScheda");
  assert.match(c, /if \(r\.ok\) \{.*ricaricaStanzaDopoBlocco\(\); \}/);
});

test("segnalazione con «Blocca anche»: la stanza si rilegge", () => {
  const c = corpo("schermoSegnalaScheda");
  assert.match(c, /segnalazione\.blocca\) \{[^}]*ricaricaStanzaDopoBlocco\(\)/);
});

test("la rilettura usa telefono.ricaricaPersone e non rompe senza telefono", () => {
  const c = corpo("ricaricaStanzaDopoBlocco");
  assert.match(c, /telefono\.ricaricaPersone\(\)/);
  assert.match(c, /if \(!telefono/);
  assert.match(c, /\.catch\(/);
});
