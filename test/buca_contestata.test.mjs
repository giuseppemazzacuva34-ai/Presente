// Spec #6 v1.4 punto 1 (CPO, 27/11; D51 A): «Non riesco a fare il check-in» mandato nella finestra sospende la buca.
// Specchio JS di public.incontro_aggiornato. Linea «sviluppatore-b». Solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { esitoIncontro } from "../api/incontro.js";

const ORA = new Date("2026-12-05T19:00:00Z");
const alle = (minuti) => new Date(ORA.getTime() + minuti * 60_000);

test("«Non riesco» di chi manca, mandato nella finestra: a fine finestra esito contestato, nessun 70 né 30", () => {
  const r = esitoIncontro({ orario: ORA, checkin: { a: alle(0), b: null }, nonRiesco: { b: true }, adesso: alle(30), a: "a", b: "b" });
  assert.equal(r.esito, "contestato");
  assert.deepEqual(r.movimenti, []);
  assert.equal(r.presente, 0);
  assert.equal(r.valutazione, false);
});

test("«Non riesco» di chi ha fatto «Sono qui» non conta: buca normale dell'altro", () => {
  const r = esitoIncontro({ orario: ORA, checkin: { a: alle(0), b: null }, nonRiesco: { a: true }, adesso: alle(30), a: "a", b: "b" });
  assert.equal(r.esito, "buca_b");
  assert.equal(r.presente, 30);
});

test("«Non riesco» non chiude prima della fine della finestra", () => {
  const r = esitoIncontro({ orario: ORA, checkin: { a: null, b: alle(0) }, nonRiesco: { a: true }, adesso: alle(29), a: "a", b: "b" });
  assert.equal(r.esito, "in_corso");
});
