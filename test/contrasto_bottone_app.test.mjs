// Pulsante rosso principale della web app (/app/, pannello, supporto, prova): testo bianco su #E8432B dava 3,99:1,
// sotto il 4,5:1 di WCAG 2.2 AA (criterio della spec #10 parti A e B). Stessa regola già usata dal sito il 3/11
// (test/correzioni.test.mjs): testo scuro --nero su rosso = 4,88:1. Nessun testo cambia.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
const regola = (sel) => (css.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`)) || [])[2] || "";

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrasto = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("app: .bottone rosso con testo scuro, mai bianco", () => {
  assert.match(regola(".bottone"), /background: var\(--rosso\)/);
  assert.match(regola(".bottone"), /color: var\(--nero\)/);
  assert.doesNotMatch(regola(".bottone"), /#fff/);
});

test("i colori del brand danno almeno 4,5:1 (scuro su rosso) e il bianco no", () => {
  assert.ok(contrasto("#0E0D10", "#E8432B") >= 4.5);
  assert.ok(contrasto("#FFFFFF", "#E8432B") < 4.5);
});
