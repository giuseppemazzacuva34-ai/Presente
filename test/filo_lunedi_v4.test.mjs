// Design v4 (#349, D149), schermata 18 «Il Filo apre la stanza» (linea C): occhiello piccolo maiuscolo, scheda del Filo
// con bordo rosso e cerchio «!» vuoto (titolo in sans, non serif), nomi di oggi come pillole in serif corsivo con il
// proprio PRIMO e in rosso, regole in una riga, «Entra nella stanza» in fondo. Valori dal prototipo docs/design/v4
// (#madrina-apre: .passo, .madr, .madr .av, .madr b, .nomi span, .nomi span.tu, .nota). Testi della spec #360 invariati.
// Tutto finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schermataFiloLunedi } from "../landing/app/moduli/filo_lunedi.js";

const leggi = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const BENVENUTO = { stanza: "11111111-2222-4333-8444-555555555555", filo: "Valentina", visto: false };

test("«Vi presento»: il proprio nome viene per primo (come «Giulia (tu)» nel design), poi gli altri in ordine", () => {
  const s = schermataFiloLunedi({ benvenuto: BENVENUTO, vocale: null, mioNome: "Sara",
    persone: [{ id: "m", nome: "Marco" }, { id: "a", nome: "Anna" }] });
  assert.deepEqual(s.nomi, [{ nome: "Sara", io: true }, { nome: "Anna", io: false }, { nome: "Marco", io: false }]);
});

test("stile: occhiello maiuscolo, scheda con bordo rosso, cerchio «!» vuoto, titolo sans, nomi a pillola, «tu» rosso, pulsante in fondo", () => {
  const css = leggi("../landing/app/app.css");
  assert.match(css, /\.app \.filo-lunedi \{[^}]*display: flex;[^}]*flex-direction: column;/);
  assert.match(css, /\.app \.filo-lunedi \.passo \{[^}]*font-size: 10\.5px;[^}]*text-transform: uppercase;/);
  assert.match(css, /\.app \.filo-lunedi \.filo-scheda \{[^}]*border: 1px solid #E8432B;[^}]*border-radius: 16px;/);
  assert.match(css, /\.app \.filo-lunedi \.filo-simbolo \{[^}]*background: transparent;[^}]*border: 2px solid #E8432B;/);
  assert.match(css, /\.app \.filo-lunedi \.filo-scheda h2 \{[^}]*font-family: var\(--sans\);[^}]*font-size: 14px;/);
  assert.match(css, /\.app \.filo-lunedi \.filo-nomi li \{[^}]*font-family: var\(--serif\);[^}]*font-style: italic;[^}]*border-radius: 20px;/);
  assert.match(css, /\.app \.filo-lunedi \.filo-nomi \.filo-io \{[^}]*border-color: #E8432B;/);
  assert.match(css, /\.app \.filo-lunedi \.bottone \{[^}]*margin-top: auto;/);
});

test("service worker: versione nuova perché cambia app.css", () => {
  assert.doesNotMatch(leggi("../landing/app/sw.js"), /const VERSIONE = "presente-app-83";/);
});
