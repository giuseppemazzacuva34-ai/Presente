// «Le tue chiamate» collegato all'app (issue #7, spec v1.1, caso limite «Persona già bloccata»: «Le tue chiamate» →
// ⋯ → Segnala per 30 giorni; passo 9c della linea «sviluppatore-b»). Controlli sul testo dei file della web app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("flusso: link «Le tue chiamate» nella home, elenco con ⋯ → Segnala e il modulo di segnalazione", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /from "\.\/storico_chiamate\.js"/);
  assert.match(flusso, /TESTI_STORICO\.titolo/);
  assert.match(flusso, /segnalaDaStorico\(/);
  // La segnalazione dallo storico usa lo stesso modulo (schermoSegnala) con origine «storico_chiamate».
  assert.match(flusso, /function schermoStorico\(/);
  assert.match(flusso, /schermoSegnala\(\{ segnala: \{ contro: [^}]*origine: "storico_chiamate"/);
  // Funziona solo con il telefono acceso (ACCESSO_APP = «si»), come segnala e blocca.
  assert.match(flusso, /storicoChiamate = \(telefono && opzioni\.storico\) \|\| null;/);
});

test("avvio: lo storico legge Supabase con il token di chi è entrato", () => {
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /import \{ creaStorico \} from "\/app\/moduli\/storico_chiamate\.js";/);
  assert.match(avvio, /creaStorico\(\{ supabaseUrl: config\.supabaseUrl, supabaseAnonKey: config\.supabaseAnonKey,/);
  assert.match(avvio, /storico[,\s}]/);
});

test("service worker: storico_chiamate.js in memoria e versione nuova", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.ok(sw.includes('"/app/moduli/storico_chiamate.js"'));
  assert.ok(!sw.includes('"presente-app-24"'));
});
