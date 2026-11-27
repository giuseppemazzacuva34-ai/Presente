// Stile della schermata 21 «crediti quasi finiti» (D149, parità grafica col design v4, linea «sviluppatore-b»):
// sotto il numero del pacchetto «+50 IN REGALO» è nel carattere senza grazie, come nel design (non nel serif del numero).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
const regole = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(^|\\n)${esc} \\{([^}]*)\\}`, "g"))].map((m) => m[2]).join(";");
};

test("21: «+N in regalo» sotto il numero è senza grazie, maiuscolo e spaziato", () => {
  const r = regole(".app .foglio-coin .pacco .q small");
  assert.match(r, /font-family: var\(--sans\)/);
  assert.match(r, /text-transform: uppercase/);
  assert.match(r, /letter-spacing: 0\.1em/);
});

test("21: «Dopo» e «Ricarica» alti uguali, sulla stessa riga (nessun margine sopra «Ricarica»)", () => {
  assert.match(regole(".app .foglio-coin .azioni > .bottone"), /margin-top: 0/);
});
