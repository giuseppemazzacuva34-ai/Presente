// «Sono in difficoltà» nel menu dell'app (issue #7, spec v1.1 punto 6: «nel menu dell'app in ogni momento»; passo 7b
// della linea «sviluppatore-b»). Invio con un segnalatore finto: nessun dato reale, nessuna rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inviaDifficolta, personeDifficolta, confermaDifficolta } from "../landing/app/moduli/difficolta.js";

const LEI = "11111111-2222-4333-8444-555555555555";

test("invio: con risposta del server torna la conferma da 1 ora con il 112", async () => {
  const mandati = [];
  const s = { invia: async (c) => { mandati.push(c); return { ok: true, ore: 1, pericolo: true }; } };
  const r = await inviaDifficolta(s, { contro: LEI });
  assert.deepEqual(r, { ok: true, conferma: confermaDifficolta() });
  assert.equal(mandati.length, 1);
  assert.equal(mandati[0].contro, LEI);
  assert.equal(mandati[0].motivo, "sono_in_difficolta");
});

test("invio: senza segnalatore (app spenta) nessuna richiesta e un errore che rimanda al 112", async () => {
  const r = await inviaDifficolta(null, {});
  assert.equal(r.ok, false);
  assert.match(r.errore, /112/);
});

test("invio: rete assente o errore del server → errore con il 112, mai un id", async () => {
  for (const s of [{ invia: async () => { throw new Error("giù"); } }, { invia: async () => ({ ok: false, motivo: "rete" }) }]) {
    const r = await inviaDifficolta(s, { contro: LEI });
    assert.equal(r.ok, false);
    assert.match(r.errore, /112/);
    assert.ok(!r.errore.includes(LEI));
  }
});

test("invio: persona non valida → nessuna richiesta", async () => {
  let chiamate = 0;
  const r = await inviaDifficolta({ invia: async () => { chiamate++; return { ok: true, ore: 1 }; } }, { contro: "boh" });
  assert.equal(r.ok, false);
  assert.equal(chiamate, 0);
});

test("persone: dalla stanza pronta del telefono, solo id e nome visibile", () => {
  const m = { stanza: { stato: "pronta", persone: [{ id: LEI, titolo: "Giulia", sottotitolo: "34 anni", chiama: true }] } };
  assert.deepEqual(personeDifficolta(m), [{ id: LEI, nome: "Giulia" }]);
  assert.deepEqual(personeDifficolta({ stanza: { stato: "vuota", persone: [] } }), []);
  assert.deepEqual(personeDifficolta(null), []);
});

test("collegamento: link «Sono in difficoltà» nella home e schermata nel flusso", () => {
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.match(flusso, /from "\.\/difficolta\.js"/);
  assert.match(flusso, /"Sono in difficoltà"/);
  assert.match(flusso, /schermataDifficolta\(/);
  assert.match(flusso, /inviaDifficolta\(/);
});

test("service worker: difficolta.js in memoria e versione nuova", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"/app/moduli/difficolta.js"'));
  assert.ok(!sw.includes('"presente-app-18"'));
});
