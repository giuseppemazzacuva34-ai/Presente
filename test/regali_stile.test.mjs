// Stile del foglio dei regali e dell'avviso del regalo ricevuto (issue #331, spec v1 parte C; design v4, schermate 26
// e 27, valori del prototipo docs/design/v4/prototipo sul ramo design/app-v4). Passo 8a della linea «sviluppatore-c».
// Le icone sono i tre disegni del prototipo in file propri (CSP: img-src 'self'), mai solo icona: il nome resta scritto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const leggi = (p) => readFileSync(new URL(`../landing/app/${p}`, import.meta.url), "utf8");
const css = leggi("app.css");
const regole = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(^|\\n)${esc} \\{([^}]*)\\}`, "g"))].map((m) => m[2]).join(";");
};

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrasto = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const colore = (dich, prop) => (dich.match(new RegExp(`(?:^|;)\\s*${prop}: (#[0-9A-Fa-f]{6})`)) || [])[1];

for (const id of ["rosa", "spumante", "fiori"]) {
  test(`icona ${id}: file SVG proprio, senza script né risorse esterne, usata dal foglio`, () => {
    const p = `icone/regalo-${id}.svg`;
    assert.ok(existsSync(new URL(`../landing/app/${p}`, import.meta.url)), `manca ${p}`);
    const svg = leggi(p);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64"/);
    assert.doesNotMatch(svg, /<script|href=|url\(|on[a-z]+=/i);
    assert.match(regole(`.regalo-icona.regalo-${id}`), new RegExp(`background-image: url\\(icone/regalo-${id}\\.svg\\)`));
  });
}

test("foglio: sale dal basso sopra la schermata, fondo #18151B, angoli 26px, velo scuro dietro", () => {
  const f = regole("#app .foglio-regali");
  for (const r of [/position: fixed/, /bottom: 0/, /left: 0/, /right: 0/, /background: #18151B/, /border-radius: 26px 26px 0 0/, /z-index: \d+/]) assert.match(f, r);
  assert.match(f, /box-shadow: 0 0 0 100vmax rgba\(5, 4, 6, 0\.72\)/);
});

test("tre regali in griglia, il scelto con bordo rosso, nome e prezzo sempre scritti", () => {
  assert.match(regole("#app .foglio-regali-scelte"), /grid-template-columns: repeat\(3, 1fr\)/);
  const r = regole("#app .regalo-scelta");
  for (const x of [/border-radius: 16px/, /background: #151217/, /min-height: 44px/, /flex-direction: column/]) assert.match(r, x);
  assert.match(regole('#app .regalo-scelta[aria-pressed="true"]'), /border-color: #E8432B/);
  assert.match(regole("#app .regalo-icona"), /width: 56px/);
  assert.match(regole("#app .regalo-scelta:focus-visible"), /outline: 2px solid var\(--avorio\)/);
});

test("contrasto AA: prezzo, nome, saldo e nota leggibili sul fondo del foglio (≥ 4,5:1)", () => {
  const prezzo = colore(regole("#app .regalo-prezzo"), "color");
  assert.ok(prezzo, "manca il colore del prezzo");
  assert.ok(contrasto(prezzo, "#151217") >= 4.5, `prezzo ${prezzo}`);
  for (const sel of ["#app .regalo-nome", "#app .foglio-regali-saldo", "#app .foglio-regali-nota", "#app .foglio-regali-messaggio"]) {
    const c = colore(regole(sel), "color");
    assert.ok(c, `manca il colore di ${sel}`);
    assert.ok(contrasto(c, "#18151B") >= 4.5, `${sel} ${c}`);
  }
});

test("avviso del regalo ricevuto: piccolo, in alto al centro, compare piano e si ferma con «riduci movimento»", () => {
  const a = regole("#app .avviso-regalo");
  for (const x of [/position: fixed/, /left: 50%/, /transform: translateX\(-50%\)/, /animation: regalo-arriva/]) assert.match(a, x);
  assert.ok(contrasto(colore(a, "color"), colore(a, "background")) >= 4.5);
  assert.match(css, /@keyframes regalo-arriva \{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ #app \.avviso-regalo \{ animation: none; \} \}/);
});
