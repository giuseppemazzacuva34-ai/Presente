// Menu ⋯ nella scheda della persona (issue #7, spec v1.1 punto 1: «dalla scheda della persona: menu ⋯ → Segnala ·
// Blocca»; passo 8b della linea «sviluppatore-b»). Controlli sul collegamento: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { menuScheda } from "../landing/app/moduli/blocca.js";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("menu: etichette con il nome, mai un id", () => {
  assert.deepEqual(menuScheda("Giulia"), { apri: "Altre azioni per Giulia", segnala: "Segnala", blocca: "Blocca" });
  assert.equal(menuScheda("").apri, "Altre azioni per questa persona");
});

test("flusso: menu ⋯ nella scheda, «Segnala» con origine «scheda», «Blocca» con conferma", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /from "\.\/blocca\.js"/);
  assert.match(flusso, /menuScheda\(/);
  assert.match(flusso, /origine: "scheda"/);
  assert.match(flusso, /confermaBlocco\(/);
  assert.match(flusso, /bloccatore\.blocca\(/);
});

test("avvio: il modulo del blocco riceve token e id dell'utente", () => {
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /creaBlocca\(/);
  assert.match(avvio, /blocca,/);
});

test("service worker: blocca.js in memoria e versione nuova", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.ok(sw.includes('"/app/moduli/blocca.js"'));
  assert.ok(!sw.includes('"presente-app-19"'));
});

test("nome della scheda: dal titolo «Nome, età» resta solo il nome", async () => {
  const { nomeScheda } = await import("../landing/app/moduli/blocca.js");
  assert.equal(nomeScheda({ titolo: "Luca, 41" }), "Luca");
  assert.equal(nomeScheda({ titolo: "Anna Maria" }), "Anna Maria");
  assert.equal(nomeScheda({ nome: "Sara", titolo: "Sara, 30" }), "Sara");
  assert.equal(nomeScheda(null), "");
});
