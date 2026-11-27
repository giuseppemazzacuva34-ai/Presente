// Design v4 (D149, #349), schermata 12 «Le tue foto» (prototipo #n12): testi del disegno.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
const foto = flusso.slice(flusso.indexOf("  foto() {"), flusso.indexOf("  fatto() {"));

test("12: sottotitolo e nota come il design v4", () => {
  assert.match(foto, /"Nessuno le vede fino a quando aprite la porta in due\. Servono 3 foto, con il volto in almeno una\."/);
  assert.match(foto, /"Il telefono toglie dalle foto i dati nascosti: posizione, modello, data\."/);
  assert.doesNotMatch(foto, /entrambi aprite|Prima di tutto il telefono/);
});

test("12: le foto restano obbligatorie (3) e mai «niente foto»", () => {
  assert.match(foto, /avanti\("Continua", pronte === 3,/);
  assert.doesNotMatch(flusso, /niente foto/i);
});
