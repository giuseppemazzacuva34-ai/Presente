// Test dei valori di D51 = A (issue #5 e #7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHIAVI, DIARIO, SEGNALAZIONI, MOTIVI_SOSPENSIONE_IMMEDIATA, chiavePermessa, sospensioneCautelare, revisioneEntro } from "../api/regole.js";

test("chiave solo a chi hai chiamato almeno una volta, 2 a settimana", () => {
  assert.equal(CHIAVI.perSettimana, 2);
  assert.equal(chiavePermessa(0), false);
  assert.equal(chiavePermessa(1), true);
  assert.equal(chiavePermessa(3), true);
  assert.equal(chiavePermessa(undefined), false);
});

test("diario: tenuto finché l'utente non lo cancella, mai negli algoritmi", () => {
  assert.equal(DIARIO.conservazioneGiorni, null);
  assert.equal(DIARIO.cancellabileDallUtente, true);
  assert.equal(DIARIO.usatoDagliAlgoritmi, false);
});

test("sospensione cautelare con 1 segnalazione solo per minacce, minori, immagini diffuse; revisione in 48 ore", () => {
  assert.deepEqual([...MOTIVI_SOSPENSIONE_IMMEDIATA], ["minacce", "minori", "immagini_diffuse"]);
  for (const m of MOTIVI_SOSPENSIONE_IMMEDIATA) assert.equal(sospensioneCautelare(m), true);
  assert.equal(sospensioneCautelare("maleducazione"), false);
  assert.equal(revisioneEntro("2026-12-06T21:00:00Z").toISOString(), "2026-12-08T21:00:00.000Z");
  assert.equal(SEGNALAZIONI.ricorsiDecideInBeta, "giuseppe");
});

test("valori non modificabili per sbaglio", () => {
  assert.throws(() => { "use strict"; CHIAVI.perSettimana = 3; });
  assert.ok(Object.isFrozen(MOTIVI_SOSPENSIONE_IMMEDIATA));
});
