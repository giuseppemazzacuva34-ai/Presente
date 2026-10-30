// Test dei valori di D51 = A (issue #5 e #7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHIAVI, DIARIO, SEGNALAZIONI, MOTIVI_SOSPENSIONE_IMMEDIATA, chiavePermessa, sospensioneCautelare, revisioneEntro, prossimoAvviso } from "../api/regole.js";

test("chiave solo a chi hai chiamato almeno una volta per almeno 60 s, 2 a settimana", () => {
  assert.equal(CHIAVI.perSettimana, 2);
  assert.equal(chiavePermessa([]), false);
  assert.equal(chiavePermessa([59]), false);
  assert.equal(chiavePermessa([10, 60]), true);
  assert.equal(chiavePermessa([900, 900, 900]), true);
  assert.equal(chiavePermessa(undefined), false);
});

test("diario: tenuto finché l'utente non lo cancella, mai negli algoritmi", () => {
  assert.equal(DIARIO.conservazioneGiorni, null);
  assert.equal(DIARIO.cancellabileDallUtente, true);
  assert.equal(DIARIO.usatoDagliAlgoritmi, false);
});

test("sospensione cautelare con 1 segnalazione solo per minacce, minori, immagini diffuse; revisione in 48 ore", () => {
  assert.deepEqual([...MOTIVI_SOSPENSIONE_IMMEDIATA], ["minacce_pericolo", "sembra_minorenne", "diffusione_immagini"]);
  for (const m of MOTIVI_SOSPENSIONE_IMMEDIATA) assert.equal(sospensioneCautelare(m), true);
  assert.equal(sospensioneCautelare("maleducazione"), false);
  assert.equal(revisioneEntro("2026-12-06T21:00:00Z").toISOString(), "2026-12-08T21:00:00.000Z");
  assert.equal(SEGNALAZIONI.ricorsiDecideInBeta, "giuseppe");
});

test("sospensione non rivista dopo 48 ore: nuovo avviso ogni 12 ore (orologio simulato)", () => {
  const sospeso = "2026-12-06T21:00:00Z";
  assert.equal(prossimoAvviso(sospeso, "2026-12-08T20:59:00Z"), null);
  assert.equal(prossimoAvviso(sospeso, "2026-12-08T21:00:00Z").toISOString(), "2026-12-09T09:00:00.000Z");
  assert.equal(prossimoAvviso(sospeso, "2026-12-09T10:00:00Z").toISOString(), "2026-12-09T21:00:00.000Z");
});

test("valori non modificabili per sbaglio", () => {
  assert.throws(() => { "use strict"; CHIAVI.perSettimana = 3; });
  assert.ok(Object.isFrozen(MOTIVI_SOSPENSIONE_IMMEDIATA));
});
