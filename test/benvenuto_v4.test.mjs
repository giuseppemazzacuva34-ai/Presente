// Benvenuto (design v4 «Dentro Presente», schermata 01, richiesta di Giuseppe del 24/11 punto 1): onda grande al centro,
// «Prima la voce. Poi il resto.» centrato con la seconda frase in corsivo rosso, tre righe brevi, «ENTRA» grande.
// Regole del brand: mai «niente foto» (le foto ci sono, si vedono dopo il sì), mai «gratis», mai date.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
const b = flusso.slice(flusso.indexOf("  benvenuto() {"), flusso.indexOf("  email() {"));

test("titolo: «Prima la voce.» e «Poi il resto.» in corsivo rosso, in un h1", () => {
  assert.match(b, /h\("h1", \{\}, "Prima la voce\.", h\("br"\), h\("em", \{\}, "Poi il resto\."\)\)/);
});

test("tre righe brevi del design, senza frasi vietate", () => {
  for (const r of ["Una stanza di 12 persone vicine a te.", "Chiamate solo voce da 15 minuti.", "Le foto, solo dopo il sì di entrambi."]) assert.ok(b.includes(r), r);
  assert.doesNotMatch(b, /niente foto|gratis/i);
});

test("onda grande di 27 barre, decorativa, e «Entra» grande come unico pulsante", () => {
  assert.match(b, /ondaGrande\(\)/);
  assert.match(flusso, /function ondaGrande\(\) \{[\s\S]*?length: 27[\s\S]*?"aria-hidden": "true"/);
  assert.match(b, /conClasse\(avanti\("Entra", true, \(\) => vai\(1\)\), "bottone grande"\)/);
  assert.equal((b.match(/avanti\(|bottone\(/g) || []).length, 1);
});

test("stile: schermata centrata, onda che si ferma con «riduci movimento», nessuno style inline vietato dalla CSP", () => {
  assert.match(css, /\n\.benvenuto-v4 \{[^}]*text-align: center/);
  assert.match(css, /\.onda-grande span \{[^}]*animation: attesa/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.onda-grande span \{ animation: none; \} \}/);
});
