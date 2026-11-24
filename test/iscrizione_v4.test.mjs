// Iscrizione come il design v4 «Dentro Presente», schermate 02-12 (richiesta di Giuseppe del 24/11, punto 1).
// Valori dal prototipo: titolo serif 31px, riga sotto in grigio 15px, «Passo n di 10» 10,5px maiuscolo con barra di 3px,
// campi su #1A171D con raggio 12px, quattro regole compatte (tutte visibili senza scorrere), «Accetto le regole» in un
// riquadro come le scelte del design, foto sfocate come le vedono gli altri prima della porta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
const regola = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = [...css.matchAll(new RegExp(`(^|\\n)${esc} \\{([^}]*)\\}`, "g"))];
  assert.ok(m.length, `manca ${sel}`);
  return m.map((x) => x[2]).join(";");
};

test("titolo 31px e riga sotto grigia 15px (non più il sottotitolo grande della landing)", () => {
  assert.match(regola(".app .schermata h1"), /font-size: 31px/);
  const s = regola(".app .sottotitolo");
  assert.match(s, /font-size: 15px/);
  assert.match(s, /color: #A8A29A/);
  assert.match(regola(".app .benvenuto-v4 h1"), /font-size: 36px/, "il benvenuto resta più grande");
});

test("«Passo n di 10»: 10,5px, maiuscolo, 0,2em, 600; barra di 3px", () => {
  const t = regola(".app .avanzamento-testo");
  for (const r of [/font-size: 10\.5px/, /letter-spacing: 0\.2em/, /font-weight: 600/]) assert.match(t, r);
  assert.match(regola(".app .avanzamento-barra"), /height: 3px/);
});

test("campi: fondo #1A171D, bordo crema al 30%, raggio 12px", () => {
  const c = regola('.app .corpo input:not([type="checkbox"]), .app .corpo select');
  for (const r of [/background-color: #1A171D/, /border: 1px solid rgba\(242, 237, 228, 0\.3\)/, /border-radius: 12px/]) assert.match(c, r);
});

test("regole compatte: titolo serif 18px, testo 12,5px grigio, numero rosso 11px", () => {
  assert.match(regola(".app .regole strong"), /font-size: 18px/);
  assert.match(regola(".app .regole li"), /font-size: 12\.5px/);
  assert.match(regola(".app .regole li::before"), /font-size: 11px/);
});

test("«Accetto le regole» e i consensi in un riquadro con bordo, come le scelte del design", () => {
  const c = regola(".app .casella");
  assert.match(c, /border: 1px solid rgba\(242, 237, 228, 0\.2\)/);
  assert.match(c, /border-radius: 12px/);
  assert.match(regola(".app .casella:has(input:checked)"), /border-color: #F2EDE4/);
});

test("foto: anteprima sfocata come la vedranno gli altri, con la frase che lo dice", () => {
  assert.match(regola(".app .casella-foto img"), /filter: blur\(6px\)/);
  assert.match(flusso, /Così le vedono gli altri, fino alla porta/);
});

test("foto: «Cambia» / «Foto n» piccoli dentro la casella (non il pulsante 3D da 52px)", () => {
  const b = regola(".app .casella-foto .bottone-secondario");
  assert.match(b, /min-height: 34px/);
  assert.match(b, /font-size: 12px/);
});
