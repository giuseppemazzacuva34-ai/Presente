// Pagina di chi risponde a «Scrivici» (issue #10, parte A; passo 5b della linea «sviluppatore-c»): controlli sul file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../landing/app/supporto.html", import.meta.url), "utf8");
const avvio = readFileSync(new URL("../landing/app/supporto_avvio.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");

test("pagina: italiano, non indicizzata, solo lo script del modulo, niente script in linea", () => {
  assert.match(html, /<html lang="it">/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  const script = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(script, ['<script type="module" src="/app/supporto_avvio.js">']);
  assert.doesNotMatch(html, /<script[^>]*>[^<]+<\/script>/);
  assert.match(html, /<main id="supporto" class="schermata">/);
  assert.match(html, /role="status" aria-live="polite"/);
});

test("avvio: usa il modulo, testi solo con textContent, niente salvataggi né log", () => {
  assert.match(avvio, /from "\/app\/moduli\/supporto_operatore\.js"/);
  assert.doesNotMatch(avvio, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(avvio, /console\./);
  assert.doesNotMatch(avvio, /sessionStorage|indexedDB/);
  assert.match(avvio, /role: "alert"/, "errori annunciati ai lettori di schermo");
  assert.match(avvio, /h\("label", \{ for:/, "campo della risposta con etichetta visibile");
});

test("stile: campo della risposta leggibile e in fondo al file", () => {
  assert.match(css, /#supporto textarea \{[^}]*color: var\(--avorio\)/);
});

test("D140 A: dopo il salvataggio, indirizzo ben visibile e pulsanti «Copia risposta» e «Copia indirizzo»", () => {
  assert.match(avvio, /copiaTesto/);
  assert.match(avvio, /testo: "Copia risposta"/);
  assert.match(avvio, /testo: "Copia indirizzo"/);
  assert.match(avvio, /class: "email-risposta"/);
});
