// Pagina Aiuto collegata all'app (issue #10, spec v1 parte A, passo 3b della linea «sviluppatore-c»):
// link «Aiuto» nella home, «Sono in difficoltà» in alto a un tocco, «Scrivici» e «I miei messaggi».
// Controlli sul testo dei file della web app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("flusso: link «Aiuto» nella home e schermata con «Sono in difficoltà» in alto", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /from "\.\/aiuto\.js"/);
  assert.match(flusso, /function schermoAiuto\(/);
  assert.match(flusso, /onclick: apriAiuto \}, TESTI_AIUTO\.titolo\)/);
  assert.match(flusso, /if \(aiuto\.aperta\) \{ radice\.replaceChildren\(schermoAiuto\(\)\); return; \}/);
  // «Sono in difficoltà» è il primo pulsante della schermata e porta alla schermata della #7.
  const corpo = flusso.slice(flusso.indexOf("function schermoAiuto("));
  assert.ok(corpo.indexOf("apriDifficoltaDaAiuto") < corpo.indexOf("TESTI_AIUTO.scrivici"));
  // Funziona solo con il telefono acceso (ACCESSO_APP = «si»), come segnala e blocca.
  assert.match(flusso, /supporto = \(telefono && opzioni\.aiuto\) \|\| null;/);
});

test("flusso: campi con etichetta visibile, contatore annunciato, email mostrata e non modificabile", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /h\("label", \{ for: "aiuto-categoria" \}/);
  assert.match(flusso, /h\("label", \{ for: "aiuto-testo" \}/);
  assert.match(flusso, /id: "aiuto-contatore", "aria-live": "polite"/);
  assert.match(flusso, /id: "aiuto-email", readonly: true/);
});

test("avvio: il modulo Aiuto usa il token di chi è entrato", () => {
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /import \{ creaAiuto \} from "\/app\/moduli\/aiuto\.js";/);
  assert.match(avvio, /const aiuto = creaAiuto\(\{ token: \(\) => accesso\.token\(\), fetch: window\.fetch\.bind\(window\) \}\);/);
  assert.match(avvio, /return \{ aiuto, accesso,/);
});

test("service worker: aiuto.js in memoria e versione nuova", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.ok(sw.includes('"/app/moduli/aiuto.js"'));
  assert.ok(!sw.includes('"presente-app-29"'));
});
