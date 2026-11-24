// Questionario privato (richiesta di Giuseppe del 24/11, punto 3): in ogni schermata prima il TEMA in alto (etichetta
// maiuscola, es. «VALORI»), sotto la domanda, sotto le risposte. Il numero della domanda sta sulla stessa riga del tema,
// a destra: non si mette più tra la domanda e le risposte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMANDE, testoImportanza } from "../landing/app/moduli/domande.js";

const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
const q = flusso.slice(flusso.indexOf("  questionario() {"), flusso.indexOf("  foto() {"));

test("ordine: riga del tema → titolo con la domanda → corpo con le risposte", () => {
  const tema = q.indexOf('classe: "tema-domanda"');
  const titolo = q.indexOf('h("h1", {}, d.testo)');
  const corpo = q.indexOf('h("div", { classe: "corpo" }, campo');
  assert.ok(tema > 0 && titolo > tema && corpo > titolo, "tema, poi domanda, poi risposte");
});

test("la riga del tema: nome del tema a sinistra, «k di 15» a destra; niente più sottotitolo tra domanda e risposte", () => {
  assert.match(q, /h\("span", \{\}, TEMI\[d\.tema\]\.nome\)/);
  assert.match(q, /`\$\{d\.n\} di \$\{DOMANDE\.length\}`/);
  assert.doesNotMatch(q, /return schermata\(d\.testo,/);
});

test("stile: etichetta maiuscola, piccola, spaziata, come le etichette del design v4", () => {
  const r = css.match(/\n\.tema-domanda \{([^}]*)\}/);
  assert.ok(r, "manca .tema-domanda");
  for (const x of [/text-transform: uppercase/, /letter-spacing: 0\.2em/, /font-weight: 600/, /display: flex/, /justify-content: space-between/]) assert.match(r[1], x);
});

test("bug della domanda 3: il «quanto conta» del tema non ripete più «Quanto conta per te?» sotto la domanda", () => {
  const t = testoImportanza("Valori");
  assert.equal(t, "Il tema «Valori» nel suo insieme: quanto conta per te nella scelta della stanza?");
  const d3 = DOMANDE.find((d) => d.n === 3);
  assert.ok(!t.startsWith("Quanto cont"), "non deve cominciare come la domanda 3");
  assert.notEqual(t, d3.testo);
  assert.match(q, /testoImportanza\(TEMI\[d\.tema\]\.nome\)/);
  assert.doesNotMatch(q, /DOMANDA_IMPORTANZA/);
});
