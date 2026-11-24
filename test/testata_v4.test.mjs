// Design v4 (#349), base comune della linea A (CTO): testata con logo centrato e onda della voce, pillola del saldo
// Coin a sinistra, cerchio del profilo a destra, pulsanti 3D e piede «1fr 1.7fr». Valori presi dal prototipo
// (docs/design/v4/prototipo, sezione «il telefono: nuovo design») sul ramo design/app-v4.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { statoSaldo, iniziale, aggiornaTestata, SOGLIA_SALDO_BASSO } from "../landing/app/moduli/testata.js";
import { COIN } from "../api/coin.js";

const leggi = (p) => readFileSync(new URL(`../landing/app/${p}`, import.meta.url), "utf8");
const css = leggi("app.css");
const testata = (html) => html.slice(html.indexOf("<header"), html.indexOf("</header>"));

for (const pagina of ["index.html", "prova.html"]) {
  test(`${pagina}: testata v4 con logo centrato, onda di 21 barre, saldo e profilo nascosti all'inizio`, () => {
    const t = testata(leggi(pagina));
    assert.match(t, /<header class="testata testa">/);
    assert.match(t, /class="logo marchio"[^>]*>presente<b>!<\/b><\/a>/);
    const onda = t.match(/<div class="onda" aria-hidden="true">([\s\S]*?)<\/div>/);
    assert.ok(onda, "manca l'onda");
    assert.equal((onda[1].match(/<span><\/span>/g) || []).length, 21);
    assert.match(t, /<p class="saldo-coin" id="saldo-coin" role="img" aria-label="Saldo crediti" hidden>/);
    assert.match(t, /<button class="icona-profilo" id="apri-profilo" type="button" aria-label="Il tuo profilo" hidden>/);
  });
  test(`${pagina}: nessun attributo style (CSP style-src 'self')`, () => {
    assert.doesNotMatch(leggi(pagina), /\sstyle="/);
  });
}

const regole = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(^|\\n)${esc} \\{([^}]*)\\}`, "g"))].map((m) => m[2]).join(";");
};

test("pulsanti 3D: primario in sfumatura rossa con bordo pieno, Instrument Sans 600 maiuscolo (token «pulsante»), 52px, raggio 16px", () => {
  const p = regole(".app .bottone");
  assert.match(p, /linear-gradient\(180deg, #F46A53 0%, #E8432B 55%, #D63A22 100%\)/);
  assert.match(p, /0 6px 0 #8F2414/);
  assert.match(p, /color: var\(--nero\)/);
  const b = regole(".app .bottone, .app .bottone-secondario") + regole(".app .bottone, .app .bottone-secondario, .app .bottone-pericolo");
  for (const r of [/min-height: 52px/, /border-radius: 16px/, /font-family: var\(--sans\)/, /font-weight: 600/, /text-transform: uppercase/, /font-size: 17\.6px/, /letter-spacing: 0\.06em/]) assert.match(b, r);
  const s = regole(".app .bottone-secondario");
  assert.match(s, /linear-gradient\(180deg, #2C282F 0%, #1C191F 100%\)/);
  assert.match(s, /0 6px 0 #050406/);
  assert.match(regole(".app .bottone:active:not(:disabled), .app .bottone-secondario:active:not(:disabled)"), /translateY\(4px\)/);
});

test("piede: secondario a sinistra e primario a destra, alti uguali (griglia 1fr 1.7fr), uno solo a tutta larghezza", () => {
  const a = regole("#app .azioni");
  assert.match(a, /display: grid/);
  assert.match(a, /grid-template-columns: 1fr 1\.7fr/);
  assert.match(regole("#app .azioni > :only-child"), /grid-column: 1 \/ -1/);
  assert.match(regole("#app .azioni > .bottone-secondario"), /order: -1/);
});

test("onda: 21 barre con altezza e colore propri, respira in 3,2 s e si ferma con «riduci movimento»", () => {
  for (let k = 1; k <= 21; k++) assert.match(css, new RegExp(`\\.onda span:nth-child\\(${k}\\) \\{ height: \\d+px; background: #[0-9A-F]{6};`));
  assert.match(regole(".app .onda span"), /respiro 3\.2s/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.app \.onda span \{ animation: none; \} \}/);
});

test("contrasto: testo scuro sul centro del pulsante rosso e crema sul secondario almeno 4,5:1", () => {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const c = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const fondo of ["#F46A53", "#E8432B"]) assert.ok(c("#0E0D10", fondo) >= 4.5, fondo); // il testo sta tra 0% e 55%
  for (const fondo of ["#2C282F", "#1C191F"]) assert.ok(c("#F2EDE4", fondo) >= 4.5, fondo);
  assert.ok(c("#F05A43", "#1A171D") >= 4.5, "saldo basso");
});

test("saldo: rosso sotto il costo di una stanza, nascosto se il server non lo dà", () => {
  assert.equal(SOGLIA_SALDO_BASSO, COIN.stanzaAlBuio);
  assert.deepEqual(statoSaldo(145), { testo: "145", basso: false });
  assert.deepEqual(statoSaldo(80), { testo: "80", basso: false });
  assert.deepEqual(statoSaldo(79), { testo: "79", basso: true });
  assert.deepEqual(statoSaldo(0), { testo: "0", basso: true });
  for (const x of [null, undefined, -1, 1.5, "12", NaN]) assert.equal(statoSaldo(x), null);
});

test("profilo: iniziale del nome in maiuscolo, niente cerchio senza nome", () => {
  assert.equal(iniziale("giulia"), "G");
  assert.equal(iniziale("  Élodie "), "É");
  for (const x of ["", "   ", null, undefined, 3]) assert.equal(iniziale(x), null);
});

function finto() {
  const el = () => ({ hidden: true, textContent: "", classi: new Set(), attr: {},
    classList: { toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); } },
    setAttribute(k, v) { this.attr[k] = v; } });
  const saldo = el(); saldo.classList._s = saldo.classi;
  const numero = el(); const profilo = el(); profilo.classList._s = profilo.classi;
  saldo.querySelector = () => numero;
  return { saldo, numero, profilo, doc: { getElementById: (id) => ({ "saldo-coin": saldo, "apri-profilo": profilo })[id] || null } };
}

test("aggiornaTestata mostra saldo e profilo solo con dati validi", () => {
  const f = finto();
  aggiornaTestata(f.doc, { saldo: 45, nome: "marco" });
  assert.equal(f.saldo.hidden, false);
  assert.equal(f.numero.textContent, "45");
  assert.ok(f.saldo.classi.has("basso"));
  assert.equal(f.saldo.attr["aria-label"], "Saldo: 45 crediti, non bastano per la prossima stanza");
  assert.equal(f.profilo.hidden, false);
  assert.equal(f.profilo.textContent, "M");
  aggiornaTestata(f.doc, { saldo: null, nome: "" });
  assert.equal(f.saldo.hidden, true);
  assert.equal(f.profilo.hidden, true);
  assert.doesNotThrow(() => aggiornaTestata({ getElementById: () => null }, { saldo: 3 }));
});
