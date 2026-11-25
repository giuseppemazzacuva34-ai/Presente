// Pannello del Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 13b della linea «sviluppatore-c»:
// controlli sul file della pagina /app/filo.html e sul suo avvio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../landing/app/filo.html", import.meta.url), "utf8");
const avvio = readFileSync(new URL("../landing/app/filo_avvio.js", import.meta.url), "utf8");

test("pagina: italiano, non indicizzata, solo lo script del modulo, niente script in linea", () => {
  assert.match(html, /<html lang="it">/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  const script = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(script, ['<script type="module" src="/app/filo_avvio.js">']);
  assert.doesNotMatch(html, /<script[^>]*>[^<]+<\/script>/);
  assert.match(html, /<main id="filo" class="schermata">/);
  assert.match(html, /role="status" aria-live="polite"/);
});

test("avvio: usa il modulo e il registratore, testi solo con textContent, niente salvataggi né log", () => {
  assert.match(avvio, /from "\/app\/moduli\/filo_pannello\.js"/);
  assert.match(avvio, /from "\/app\/moduli\/registratore\.js"/);
  assert.doesNotMatch(avvio, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(avvio, /console\./);
  assert.doesNotMatch(avvio, /sessionStorage|indexedDB|localStorage\.setItem/);
  assert.match(avvio, /role: "alert"/, "errori annunciati ai lettori di schermo");
});

test("avvio: Registra, Riascolta (lettore che non parte da solo), Rifai, Carica, testo obbligatorio con etichetta", () => {
  for (const t of ['"Registra"', '"Ferma"', '"Rifai"', '"Carica"', '"Testo del vocale"', '"Vi presento"']) assert.ok(avvio.includes(t), t);
  assert.match(avvio, /preload: "none"/);
  assert.doesNotMatch(avvio, /autoplay|\.play\(/);
  assert.match(avvio, /h\("label", \{ for:/, "testo del vocale con etichetta visibile");
  assert.match(avvio, /maxlength: "900"/);
  assert.match(avvio, /\.carica\(/);
  assert.match(avvio, /\.stanze\(/);
  assert.match(avvio, /URL\.revokeObjectURL/, "l'audio registrato non resta in memoria dopo Rifai o Carica");
  assert.match(avvio, /testo: "Aggiorna"/);
});
