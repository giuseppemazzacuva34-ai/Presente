// Sfondo della chiamata (issue #349, design v4 D149, schermate 25, 29, 30; linea A).
// Durante la chiamata dietro nome e timer c'è la sagoma di chi parla dietro un vetro rosso: maschile se l'altra
// persona è un uomo, femminile se è una donna, una sagoma disegnata (nessuna foto) negli altri casi. Mai un volto,
// mai un dato in più: si usa solo il gruppo «uomini»/«donne» che la stanza viva ha già.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { sagomaChiamata, vistaSfondoChiamata } from "../landing/app/moduli/sfondo_chiamata.js";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// h minimo come quello di flusso.js: { tag, attributi, figli }.
const h = (tag, attr = {}, ...figli) => ({ tag, attr, figli: figli.flat().filter(Boolean) });

test("la sagoma è quella dell'altra persona: uomo, donna, altrimenti neutra", () => {
  assert.equal(sagomaChiamata("uomini"), "uomo");
  assert.equal(sagomaChiamata("donne"), "donna");
  for (const x of [undefined, null, "", "altre", "uomo", "__proto__", 3, {}]) assert.equal(sagomaChiamata(x), "neutra");
});

test("lo sfondo ha sagoma, luci, vetro e riflesso, nascosto ai lettori di schermo", () => {
  const v = vistaSfondoChiamata(h, "donne");
  assert.equal(v.attr.classe, "sfondo-chiamata");
  assert.equal(v.attr["aria-hidden"], "true");
  assert.deepEqual(v.figli.map((f) => f.attr.classe), ["sagoma donna", "luci", "vetro", "riflesso"]);
  assert.equal(vistaSfondoChiamata(h, null).figli[0].attr.classe, "sagoma neutra");
  // Nessuno stile in linea (la CSP vieta style negli attributi): l'immagine la sceglie il CSS dalla classe.
  assert.ok(!JSON.stringify(v).includes("style"));
});

test("CSS: immagini del design per uomo e donna, sagoma disegnata per neutra, movimento ridotto rispettato", () => {
  const css = leggi("../landing/app/app.css");
  assert.match(css, /\.sfondo-chiamata \.sagoma\.uomo \{[^}]*url\("?img\/chiamata-uomo\.jpg"?\)/);
  assert.match(css, /\.sfondo-chiamata \.sagoma\.donna \{[^}]*url\("?img\/chiamata-donna\.jpg"?\)/);
  assert.match(css, /\.sfondo-chiamata \.sagoma\.neutra \{[^}]*radial-gradient/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{[^}]*\.sfondo-chiamata/);
  for (const f of ["chiamata-uomo.jpg", "chiamata-donna.jpg"]) {
    const kb = statSync(new URL(`../landing/app/img/${f}`, import.meta.url)).size / 1024;
    assert.ok(kb > 10 && kb < 150, `${f}: ${kb} KB`);
  }
});

test("flusso.js usa lo sfondo nella chiamata in corso con il gruppo della stanza viva", () => {
  const f = leggi("../landing/app/moduli/flusso.js");
  assert.match(f, /import \{ vistaSfondoChiamata \} from "\.\/sfondo_chiamata\.js"/);
  assert.match(f, /vistaSfondoChiamata\(h, \(viva\.stati\.get\(m\.inCorsoCon\) \|\| \{\}\)\.gruppo\)/);
});

test("il service worker tiene il modulo nuovo (le immagini, come quelle della porta, arrivano dalla rete)", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.ok(sw.includes('"/app/moduli/sfondo_chiamata.js"'));
  assert.ok(Number((sw.match(/const VERSIONE = "presente-app-(\d+)"/) || [])[1]) >= 73, "cache almeno alla 73");
});
