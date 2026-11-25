// Decisione di Giuseppe del 23/11 (decisioni_giuseppe_23_11_crediti) e spec #331 v1.2: nei testi visibili
// «crediti», non «Coin». Linea B: «Lascia la stanza» (#381), crediti e saldo (13, 21), profilo (23), regali ricevuti (28).
// I nomi interni del codice (coin, creaCoin, saldo_coin) restano: qui si guarda solo il testo, commenti esclusi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TESTI_USCITA } from "../api/lascia_stanza.js";

const FILE = [
  "api/lascia_stanza.js",
  "landing/app/moduli/lascia_stanza.js",
  "landing/app/moduli/saldo_coin.js",
  "landing/app/moduli/tuoi_coin.js",
  "landing/app/moduli/profilo.js",
  "landing/app/moduli/preferenze_profilo.js",
  "api/storico_regali.js",
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

test("Lascia la stanza: la frase sui crediti dice «crediti»", () => {
  assert.equal(TESTI_USCITA.coin, "I crediti della stanza non tornano indietro. Le chiavi che hai dato e ricevuto si annullano.");
});
