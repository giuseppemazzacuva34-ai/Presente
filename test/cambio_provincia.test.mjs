// Cambio della provincia da «Il mio profilo» (#2, spec v1.3 del CPO): vale dalla stanza del lunedì dopo.
// Nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lunediCambio, testoCambio } from "../landing/app/moduli/province.js";

test("un cambio fatto mercoledì vale dal lunedì dopo (ora di Roma)", () => {
  // mercoledì 11/11/2026 15:00 a Roma (14:00 UTC)
  assert.equal(lunediCambio(new Date("2026-11-11T14:00:00Z")), "16/11");
});

test("domenica sera vale dal giorno dopo; lunedì prima delle 9 vale dallo stesso lunedì", () => {
  assert.equal(lunediCambio(new Date("2026-11-15T21:30:00Z")), "16/11"); // domenica 22:30 Roma
  assert.equal(lunediCambio(new Date("2026-11-16T07:59:00Z")), "16/11"); // lunedì 8:59 Roma
});

test("lunedì dalle 9 in poi la stanza è già aperta: vale dal lunedì successivo", () => {
  assert.equal(lunediCambio(new Date("2026-11-16T08:00:00Z")), "23/11"); // lunedì 9:00 Roma
});

test("il calcolo segue il fuso di Roma anche a cavallo della mezzanotte e del cambio d'ora", () => {
  // domenica 23:30 UTC = lunedì 00:30 a Roma (inverno): stanza non ancora aperta → stesso lunedì
  assert.equal(lunediCambio(new Date("2026-11-15T23:30:00Z")), "16/11");
  // estate: lunedì 6/7/2026 8:30 Roma = 6:30 UTC → stesso lunedì; 7:00 UTC = 9:00 Roma → lunedì dopo
  assert.equal(lunediCambio(new Date("2026-07-06T06:30:00Z")), "06/07");
  assert.equal(lunediCambio(new Date("2026-07-06T07:00:00Z")), "13/07");
});

test("il testo spiega quando vale e che la stanza in corso non cambia", () => {
  assert.equal(testoCambio(new Date("2026-11-11T14:00:00Z")),
    "Il cambio vale dalla stanza di lunedì 16/11: quella in corso non cambia. Poi potrai cambiarla di nuovo dopo 7 giorni.");
});
