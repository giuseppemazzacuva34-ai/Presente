// Decisione di Giuseppe del 23/11 (decisioni_giuseppe_23_11_crediti): nei testi visibili «crediti», non «Coin».
// Linea C: schermata dei crediti (coin.js), foglio dei regali (regali.js), testi del server (api/coin.js),
// richieste dei regali (worker/regali_api.js). I nomi interni del codice (coin, creaCoin, COIN) restano:
// qui si guarda solo il testo, commenti esclusi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schermataCoin, TESTI_SCHERMATA_COIN } from "../landing/app/moduli/coin.js";
import { statoFoglio } from "../landing/app/moduli/regali.js";
import { foglioRegali, tiMancano, conferma, coin } from "../api/coin.js";
import { CATEGORIE } from "../api/supporto.js";
import { CATEGORIE_SCRIVICI } from "../landing/app/moduli/aiuto.js";

const FILE = [
  "landing/app/moduli/coin.js",
  "landing/app/moduli/regali.js",
  "api/coin.js",
  "worker/regali_api.js",
  "landing/app/moduli/prova.js",
  "api/supporto.js",
];

const senzaCommenti = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((r) => r.replace(/^\s*\/\/.*$/, "").replace(/\s\/\/\s.*$/, "")).join("\n");

for (const f of FILE) {
  test(`${f}: nessun «Coin» nei testi visibili`, () => {
    const righe = senzaCommenti(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"))
      .split("\n").filter((r) => /\bCoin\b/.test(r));
    assert.deepEqual(righe, []);
  });
}

test("schermata: «I tuoi crediti», saldo e offerte in crediti", () => {
  assert.equal(TESTI_SCHERMATA_COIN.titolo, "I tuoi crediti");
  const s = schermataCoin(200);
  assert.equal(s.saldo, "200 crediti");
  assert.equal(s.offerte[0].testo, "200 crediti · 20 €");
  assert.equal(s.offerte[1].etichetta, "50 crediti in più");
  assert.equal(s.riga, "1 € = 10 crediti. La stanza Al buio costa 80 crediti, la prima è in regalo.");
  assert.equal(s.notaBeta, "Nella beta i crediti sono di prova: li trovi già nel tuo saldo. Non paghi niente.");
  assert.equal(schermataCoin(1).saldo, "1 credito");
});

test("foglio dei regali nell'app: saldo e «ti mancano» in crediti, singolare con 1", () => {
  assert.equal(statoFoglio({ nome: "Anna", saldo: 1 }).saldo, "Hai 1 credito");
  assert.equal(statoFoglio({ nome: "Anna", saldo: 0 }).saldo, "Hai 0 crediti");
  assert.match(statoFoglio({ nome: "Anna", saldo: 0 }).primario.testo, /^Ti mancano \d+ crediti$/);
});

test("server: stessi testi in crediti", () => {
  assert.equal(coin(80), "80 crediti");
  assert.equal(coin(1), "1 credito");
  assert.equal(tiMancano(1), "Ti manca 1 credito");
  assert.equal(tiMancano(5), "Ti mancano 5 crediti");
  assert.equal(foglioRegali(0).saldo, "Hai 0 crediti");
  assert.match(conferma("rosa", "Anna"), /Costa \d+ crediti\.$/);
});

test("Scrivici: la categoria dei crediti si chiama «Crediti» sul server come nella pagina Aiuto", () => {
  assert.equal(CATEGORIE.crediti, "Crediti");
  assert.deepEqual(Object.entries(CATEGORIE), CATEGORIE_SCRIVICI.map(([k, v]) => [k, v]));
});
