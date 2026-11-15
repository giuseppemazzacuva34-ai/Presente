// Pulsante «Chiama» nella scheda di «La tua stanza» (issue #4, spec v1.3 § 2, passo 3c-5b-2b-2): flusso.js mostra il
// testo che arriva da schedaCompagno() (etichetta) e la descrizione per il lettore di schermo. Nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schedaCompagno } from "../landing/app/moduli/compagni.js";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("flusso: il pulsante della scheda usa etichetta e descrizione, non più «Chiama» fisso", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  const blocco = flusso.slice(flusso.indexOf("function bloccoTuaStanza"), flusso.indexOf("function schermoChiamata"));
  assert.match(blocco, /"aria-label": p\.descrizione/);
  assert.match(blocco, /p\.etichetta \|\| "Chiama"/);
  assert.doesNotMatch(blocco, /"aria-label": `Chiama \$\{p\.titolo\}`/);
});

test("flusso: con un testo il pulsante resta raggiungibile da tastiera (aria-disabled, non disabled)", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  const blocco = flusso.slice(flusso.indexOf("function bloccoTuaStanza"), flusso.indexOf("function schermoChiamata"));
  assert.match(blocco, /"aria-disabled": conTesto \? "true" : null/);
  assert.match(blocco, /disabled: m\.attesa \|\| \(!p\.chiama && !conTesto\)/);
});

test("scheda: con un testo della spec il pulsante è spento e porta quel testo", () => {
  const p = schedaCompagno({ nome: "Sara", eta: 30, citta: "Roma" }, { testo: "È in un'altra chiamata" });
  assert.equal(p.chiama, false);
  assert.equal(p.etichetta, "È in un'altra chiamata");
  assert.equal(p.descrizione, "Sara, 30: È in un'altra chiamata");
  const libero = schedaCompagno({ nome: "Sara", eta: 30 }, {});
  assert.equal(libero.etichetta, "Chiama");
  assert.equal(libero.descrizione, "Chiama Sara, 30");
});

test("service worker: versione nuova dopo la modifica di flusso.js", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.ok(!sw.includes('"presente-app-22"'));
  assert.ok(!sw.includes('"presente-app-23"'));
});
