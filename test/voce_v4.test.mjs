// Design v4 (D149, #349), schermate 07-08 «La tua voce» e 09 «Tre risposte a voce» come il prototipo (#n07, #n08, #n09):
// riquadro .rec con l'onda grande che si muove con la voce, «8 / 20 s» in serif grande e «Ferma» in 3D sulla stessa riga;
// dopo, «Eccola. Se non ti convince, rifalla.» con «▶ Riascolta» e «Rifai» sulla stessa riga; le domande come pillole brevi.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMANDE_VOCE, DOMANDE_VOCE_BREVI } from "../landing/app/moduli/domande.js";
import { livelloVoce, scalaOnda } from "../landing/app/moduli/registratore.js";

const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
const blocco = (da, a) => flusso.slice(flusso.indexOf(da), flusso.indexOf(a));
const registratore = blocco("function registratoreVoce", "function casellaFoto");
const voce = blocco("  voce() {", "  risposte() {");
const scelta = blocco("  risposte() {", "// Una schermata per domanda");

test("09: una pillola breve per ogni domanda, stesso ordine (gli indici salvati in domande_voce non cambiano)", () => {
  assert.equal(DOMANDE_VOCE_BREVI.length, DOMANDE_VOCE.length);
  assert.deepEqual(DOMANDE_VOCE_BREVI.slice(0, 3), ["Una cosa che ti fa ridere sempre", "Il posto dove ti senti a casa", "Un viaggio che rifaresti domani"]);
  assert.equal(DOMANDE_VOCE_BREVI[4], "La tua domenica perfetta");
  assert.equal(DOMANDE_VOCE_BREVI[6], "Una canzone che ti riporta indietro");
  for (const b of DOMANDE_VOCE_BREVI) assert.ok(b.length <= 40 && !/[.:?]$/.test(b), b);
});

test("09: pillole brevi in colonna, sottotitolo del design, niente contatore sotto", () => {
  assert.match(scelta, /"Scegli 3 domande e rispondi a voce, massimo 30 secondi\."/);
  assert.match(scelta, /DOMANDE_VOCE_BREVI\.map\(\(d, i\) => \[i, d\]\)/);
  assert.match(scelta, /pillole: true/);
  assert.doesNotMatch(scelta, /di 3 scelte/);
  assert.match(css, /\.scelte\.pillole \{[^}]*flex-direction: column;[^}]*align-items: flex-start;/);
});

test("livello della voce: silenzio 0, segnale pieno 1, valori intermedi crescenti", () => {
  assert.equal(livelloVoce(new Float32Array(64)), 0);
  assert.equal(livelloVoce(new Float32Array(64).fill(1)), 1);
  const piano = livelloVoce(new Float32Array(64).fill(0.02));
  const forte = livelloVoce(new Float32Array(64).fill(0.1));
  assert.ok(piano > 0 && piano < forte && forte <= 1, `${piano} ${forte}`);
  assert.equal(livelloVoce(null), 0);
});

test("onda che segue la voce: in silenzio bassa ma visibile, con voce piena alta 1, mai oltre", () => {
  assert.equal(scalaOnda(0), 0.15);
  assert.equal(scalaOnda(1), 1);
  assert.equal(scalaOnda(5), 1);
  assert.equal(scalaOnda(-1), 0.15);
  assert.ok(scalaOnda(0.2) > scalaOnda(0.05));
});

test("07: riquadro .rec con onda grande, «n / 20 s» in .tempo e «Ferma» sulla stessa riga", () => {
  assert.match(registratore, /classe: "registratore rec"/);
  assert.match(registratore, /ondaGrande\(/);
  assert.match(registratore, /classe: "tempo"/);
  assert.match(registratore, /`\$\{Math\.floor\(s\)\} \/ \$\{massimo\} s`/);
  assert.match(registratore, /"Ferma"/);
  assert.match(registratore, /classe: "riga-rec"/);
  assert.match(registratore, /scalaOnda\(livello\)/);
  assert.match(css, /\.app \.rec \{[^}]*border-radius: 16px;[^}]*background: #151217;/);
  assert.match(css, /\.app \.tempo \{[^}]*font-family: var\(--serif\);[^}]*font-size: 34px;/);
});

test("07: durante la registrazione il riquadro non si ricostruisce a ogni decimo (l'onda resta la stessa)", () => {
  assert.match(registratore, /function aggiornaRegistrazione\(/);
  assert.match(registratore, /registra\(massimo, aggiornaRegistrazione\)/);
});

test("08: «Eccola. Se non ti convince, rifalla.» quando la voce c'è; «▶ Riascolta» e «Rifai» in riga", () => {
  assert.match(voce, /stato\.voce \? "Eccola\. Se non ti convince, rifalla\." : "Presentati come faresti a una cena tra amici\. Hai 20 secondi\."/);
  assert.match(registratore, /h\("span", \{ "aria-hidden": "true" \}, "▶ "\)/);
  assert.match(registratore, /classe: "riga-registratore"/);
  assert.match(registratore, /"Rifai"/);
});

test("rispetto per chi chiede meno movimento: l'onda della registrazione si ferma", () => {
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.onda-grande span \{ animation: none; \}/);
  assert.match(registratore, /menoMovimento/);
});
