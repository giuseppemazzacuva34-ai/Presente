// Pannello dell'amministratore per il Filo della stanza (issue #360), passo 12d della linea «sviluppatore-c»:
// controlli sul file della pagina /app/filo-amministratore.html e sul suo avvio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../landing/app/filo-amministratore.html", import.meta.url), "utf8");
const avvio = readFileSync(new URL("../landing/app/filo_amministratore_avvio.js", import.meta.url), "utf8");

test("pagina: italiano, non indicizzata, solo lo script del modulo, niente script in linea", () => {
  assert.match(html, /<html lang="it">/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  const script = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(script, ['<script type="module" src="/app/filo_amministratore_avvio.js">']);
  assert.doesNotMatch(html, /<script[^>]*>[^<]+<\/script>/);
  assert.match(html, /<main id="filo-amministratore" class="schermata">/);
  assert.match(html, /role="status" aria-live="polite"/);
});

test("avvio: usa il modulo, testi solo con textContent, niente salvataggi né log", () => {
  assert.match(avvio, /from "\/app\/moduli\/filo_amministratore\.js"/);
  assert.doesNotMatch(avvio, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(avvio, /console\./);
  assert.doesNotMatch(avvio, /sessionStorage|indexedDB|localStorage\.setItem/);
  assert.match(avvio, /role: "alert"/, "errori annunciati ai lettori di schermo");
  assert.match(avvio, /h\("label", \{ for:/, "campo email con etichetta visibile");
  assert.match(avvio, /type: "email"/);
});

test("avvio: tutte le azioni del pannello, con conferma prima di togliere", () => {
  for (const azione of ["stanze", "assegna", "togliFilo", "ascolta", "togliVocale"]) assert.match(avvio, new RegExp(`\\.${azione}\\(`));
  assert.equal((avvio.match(/window\.confirm\(/g) || []).length, 2, "conferma per togliere il Filo e per togliere il vocale");
  assert.match(avvio, /preload: "none"/, "il vocale non si scarica né parte da solo");
  assert.doesNotMatch(avvio, /autoplay/);
  assert.match(avvio, /testo: "Aggiorna"/);
});
