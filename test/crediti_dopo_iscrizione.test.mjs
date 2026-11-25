// Schermata 13 «I tuoi crediti» una volta sola dopo l'iscrizione: passo 10 di 10, dopo le foto (#349, linea
// «sviluppatore-b», passo 4; spec #331 v1.1 punto 3.1 e 3.5: «Più tardi» porta alla home). «Una volta» la dice il
// server: il passo massimo salvato; chi ha già finito l'iscrizione o modifica le foto dal profilo non la rivede.
// In beta «Paga» resta spento (D150 B). Solo lettura dei sorgenti, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const f = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");

test("salvaEVai: la prima volta che si arriva a «fatto» (passo massimo sul server ancora più basso) si apre la 13", () => {
  assert.match(f, /  const primaVoltaFatto = passoMassimo < PASSI\.length - 1 && raggiunto === PASSI\.length - 1;\n  passoMassimo = raggiunto;/);
  assert.match(f, /  vai\(passo\);\n  if \(primaVoltaFatto\) apriCreditiDopoIscrizione\(\);\n\}/);
});

test("apriCreditiDopoIscrizione: saldo dal server col proprio token; senza saldo valido non si apre (mai numeri inventati)", () => {
  assert.match(f, /async function apriCreditiDopoIscrizione\(\) \{\n  if \(!opzioniCoin\) return;/);
  assert.match(f, /try \{ c = await opzioniCoin\.saldo\(\); \} catch \{ c = null; \}/); // se la rete lancia, niente 13
  assert.match(f, /if \(!c \|\| c\.ok !== true \|\| !Number\.isInteger\(c\.saldo\) \|\| document\.querySelector\("\.tuoi-coin"\)\) return;/);
  assert.match(f, /schermataTuoiCoin\(c\.saldo, \{ primaStanzaUsata: c\.primaStanzaUsata === true \}\)/);
});

test("la 13 si apre al posto della home (#app), quindi «Più tardi» porta alla home", () => {
  const i = f.indexOf("async function apriCreditiDopoIscrizione()");
  assert.ok(i > 0);
  assert.match(f.slice(i, i + 600), /\{ principale: document\.getElementById\("app"\) \}/);
});

test("opzioniCoin viene dal lettore del saldo già passato dall'avvio (coinProfilo), niente nuova rete", () => {
  assert.match(f, /opzioniCoin = opzioni\.coinProfilo \|\| null;/);
});

test("service worker con versione nuova", () => {
  assert.ok(!readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8").includes('"presente-app-60"'));
});
