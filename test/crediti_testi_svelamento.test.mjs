// Decisione di Giuseppe del 23/11 (decisioni_giuseppe_23_11_crediti): nei testi visibili dello svelamento (#65, linea A)
// «crediti», non «Coin», sia nell'app sia nelle risposte del server. Numeri invariati (caparra 100, D145 A).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TESTI } from "../landing/app/moduli/svelamento.js";
import { TESTI_SVELAMENTO, bloccaCaparra } from "../api/svelamento.js";

const FILE = ["landing/app/moduli/svelamento.js", "api/svelamento.js", "worker/svelamento_api.js"];
const senzaCommenti = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((r) => r.replace(/^\s*\/\/.*$/, "").replace(/\s\/\/\s.*$/, "")).join("\n");

for (const f of FILE) {
  test(`${f}: nessun «Coin» nei testi visibili`, () => {
    const righe = senzaCommenti(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"))
      .split("\n").filter((r) => /\bCoin\b/.test(r));
    assert.deepEqual(righe, []);
  });
}

test("app e server dicono «Blocca 100 crediti» e «In beta i crediti sono di prova»", () => {
  for (const t of [TESTI, TESTI_SVELAMENTO]) {
    assert.equal(t.blocca, "Blocca 100 crediti");
    assert.equal(t.beta, "In beta i crediti sono di prova");
  }
});

test("server: «Ti manca 1 credito» al singolare", () => {
  const porta = { a: "x", b: "y", aperta: "2026-11-22T20:00:00Z" };
  const r = bloccaCaparra({ porta, chi: "x", crediti: 99, adesso: new Date("2026-11-22T21:00:00Z") });
  assert.equal(r.testo, "Ti manca 1 credito");
});
