// Tre risposte a voce (richiesta di Giuseppe del 24/11, punti 4 e 5): dopo aver scelto le 3 domande NON si scende per
// registrarle tutte insieme. Una schermata per domanda: «Domanda 1 di 3», il testo (UNA volta sola), Registra /
// Riascolta / Rifai, poi Avanti alla successiva. Bug del punto 5: il testo della domanda compariva due volte (nella
// pillola scelta e sopra il registratore). Prova nel browser: scratchpad/pw/giro2.py (anteprima, microfono finto).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
const blocco = (inizio, fine) => flusso.slice(flusso.indexOf(inizio), flusso.indexOf(fine, flusso.indexOf(inizio)));
const risposte = blocco("  risposte() {", "  questionario() {");
const registratore = blocco("function registratoreVoce", "function casellaFoto");

test("stato: la domanda a voce in corso (null = si stanno scegliendo le 3)", () => {
  assert.match(flusso, /rispostaInCorso: null,/);
});

test("scelta: il pulsante dice «Registra le risposte» e si accende con 3 scelte; niente registratori sotto le pillole", () => {
  const scelta = risposte.slice(0, risposte.indexOf("// Una schermata per domanda"));
  assert.match(scelta, /avanti\("Registra le risposte", scelte3\.length === 3,/);
  assert.doesNotMatch(scelta, /registratoreVoce\(/);
  assert.doesNotMatch(scelta, /DOMANDE_VOCE\[i\]\)/, "il testo della domanda non va ripetuto sotto le pillole");
});

test("una schermata per domanda: «Domanda k di 3», il testo come titolo una sola volta, poi il registratore", () => {
  const una = risposte.slice(risposte.indexOf("// Una schermata per domanda"));
  assert.match(una, /`Domanda \$\{k \+ 1\} di 3`/);
  assert.equal((una.match(/DOMANDE_VOCE\[i\]/g) || []).length, 1, "il testo della domanda compare una volta sola");
  assert.match(una, /registratoreVoce\(stato\.risposteVoce\[i\], 30,/);
});

test("Avanti alla successiva; all'ultima «Continua» salva le 3 risposte e va al questionario", () => {
  const una = risposte.slice(risposte.indexOf("// Una schermata per domanda"));
  assert.match(una, /k < 2 \? "Avanti" : "Continua"/);
  assert.match(una, /stato\.rispostaInCorso = k \+ 1/);
  assert.match(una, /salvaEVai\(8,/);
  assert.match(una, /fileRisposta\(n\)/);
});

test("Indietro: dalla domanda 1 si torna alla scelta, dalle altre alla domanda prima", () => {
  const una = risposte.slice(risposte.indexOf("// Una schermata per domanda"));
  assert.match(una, /stato\.rispostaInCorso = k === 0 \? null : k - 1/);
});

test("registratore: Riascolta e Rifai sulla stessa riga, l'audio senza comandi del browser", () => {
  assert.match(registratore, /"Riascolta"/);
  assert.match(registratore, /"Rifai"/);
  assert.match(registratore, /classe: "riga-registratore"/);
  assert.doesNotMatch(registratore, /controls: true/);
});

test("lasciando la schermata o cambiando domanda il «Riascolta» si ferma (vai() ferma la registrazione)", () => {
  assert.match(flusso, /function vai\(passo\) \{\n  if \(registrazioneInCorso\)/);
});

test("la domanda con indice 0 («Una cosa che ti fa ridere sempre») apre la sua schermata (bug trovato nella prova)", () => {
  assert.match(risposte, /scelte3\[stato\.rispostaInCorso\] === undefined/);
  assert.doesNotMatch(risposte, /!scelte3\[stato\.rispostaInCorso\]/);
});

test("piede: i pulsanti non ereditano il margin-top della landing (stessa riga, stessa altezza)", () => {
  const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
  assert.match(css, /#app \.azioni > \.bottone, #app \.azioni > \.bottone-secondario \{ margin: 0;/);
});
