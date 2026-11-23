// Decisione di Giuseppe del 23/11 (decisioni_giuseppe_23_11_crediti): nei testi visibili «crediti», non «Coin».
// Linea A: testata (pillola del saldo), home e pagina «Incontri al buio» (flusso.js), Aiuto (aiuto.js).
// I nomi interni del codice (saldo-coin, creaCoin, coin.js) restano: qui si guarda solo il testo, commenti esclusi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aggiornaTestata } from "../landing/app/moduli/testata.js";
import { DOMANDE_FREQUENTI as FAQ, CATEGORIE_SCRIVICI } from "../landing/app/moduli/aiuto.js";

const FILE = [
  "landing/app/index.html",
  "landing/app/prova.html",
  "landing/app/moduli/testata.js",
  "landing/app/moduli/flusso.js",
  "landing/app/moduli/aiuto.js",
];

const senzaCommenti = (s) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((r) => r.replace(/^\s*\/\/.*$/, "").replace(/\s\/\/\s.*$/, "")).join("\n");

for (const f of FILE) {
  test(`${f}: nessun «Coin» nei testi visibili`, () => {
    const righe = senzaCommenti(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"))
      .split("\n").filter((r) => /\bCoin\b/.test(r));
    assert.deepEqual(righe, []);
  });
}

function finto() {
  const attr = {}, classi = new Set(), numero = { textContent: "" };
  const saldo = { hidden: true, attr, setAttribute: (k, v) => { attr[k] = v; }, querySelector: () => numero,
    classList: { toggle: (c, on) => (on ? classi.add(c) : classi.delete(c)) } };
  return { saldo, doc: { getElementById: (id) => (id === "saldo-coin" ? saldo : null) } };
}

test("testata: la pillola si legge «Saldo: N crediti», al singolare con 1", () => {
  const f = finto();
  aggiornaTestata(f.doc, { saldo: 120 });
  assert.equal(f.saldo.attr["aria-label"], "Saldo: 120 crediti");
  aggiornaTestata(f.doc, { saldo: 1 });
  assert.equal(f.saldo.attr["aria-label"], "Saldo: 1 credito, non bastano per la prossima stanza");
});

test("Aiuto: la domanda e la categoria parlano di crediti", () => {
  assert.ok(FAQ.some((x) => x.domanda === "Come uso i crediti"));
  assert.ok(CATEGORIE_SCRIVICI.some(([v, t]) => v === "crediti" && t === "Crediti"));
});
