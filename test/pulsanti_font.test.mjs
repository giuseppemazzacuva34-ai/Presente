// Font dei pulsanti (richiesta di Giuseppe del 24/11, punto 2): tutti i pulsanti dell'app in Instrument Sans 600,
// maiuscolo con spaziatura 0,06em (token «pulsante» del sistema del marchio, 17,6px), e il carattere caricato davvero:
// le pagine dell'app lo chiedono subito (preload) e il CSS non usa più il serif nei pulsanti.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leggi = (p) => readFileSync(new URL(`../landing/${p}`, import.meta.url), "utf8");
const css = leggi("app/app.css");
const regole = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(^|\\n)${esc} \\{([^}]*)\\}`, "g"))].map((m) => m[2]).join(";");
};

test("pulsanti 3D: Instrument Sans 600, maiuscolo, 0,06em, 17,6px; mai il serif", () => {
  const b = regole(".app .bottone, .app .bottone-secondario, .app .bottone-pericolo");
  for (const r of [/font-family: var\(--sans\)/, /font-weight: 600/, /text-transform: uppercase/, /letter-spacing: 0\.06em/, /font-size: 17\.6px/]) assert.match(b, r);
  assert.doesNotMatch(b, /var\(--serif\)/);
});

test("«Entra» grande: stesso carattere dei pulsanti, solo più grande", () => {
  const g = regole(".app .bottone.grande");
  assert.match(g, /font-family: var\(--sans\)/);
  assert.match(g, /letter-spacing: 0\.06em/);
  assert.doesNotMatch(g, /var\(--serif\)/);
});

for (const pagina of ["app/index.html", "app/prova.html", "app/pannello.html", "app/supporto.html"]) {
  test(`${pagina}: Instrument Sans caricato subito (preload woff2, stesso sito)`, () => {
    assert.match(leggi(pagina), /<link rel="preload" href="\/fonts\/InstrumentSans\.woff2" as="font" type="font\/woff2" crossorigin>/);
  });
}

test("il file del carattere esiste ed è variabile 400–700 (il 600 è vero, non simulato)", () => {
  assert.match(leggi("stile.css"), /font-family: "Instrument Sans"; src: url\("\/fonts\/InstrumentSans\.woff2"\)[^}]*font-weight: 400 700/);
});
