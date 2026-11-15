// Esito per chi segnala collegato all'app (issue #7, spec v1.1, passo 4: notifica in app alla chiusura; passo 10c della
// linea «sviluppatore-b»). Controlli sul testo dei file della web app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("flusso: nella home gli esiti delle proprie segnalazioni, ognuno con «Ho capito»", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /import \{ TESTI_ESITO \} from "\.\/esiti_segnalazioni\.js";/);
  assert.match(flusso, /function bloccoEsiti\(/);
  assert.match(flusso, /bloccoEsiti\(\),/);
  assert.match(flusso, /TESTI_ESITO\.ok/);
  assert.match(flusso, /esitiSegnalazioni\.letto\(/);
  // Solo con il telefono acceso (ACCESSO_APP = «si»), come segnala, blocca e storico.
  assert.match(flusso, /esitiSegnalazioni = \(telefono && opzioni\.esiti\) \|\| null;/);
});

test("avvio: gli esiti si leggono da Supabase con il token di chi è entrato", () => {
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /import \{ creaEsiti \} from "\/app\/moduli\/esiti_segnalazioni\.js";/);
  assert.match(avvio, /creaEsiti\(\{ supabaseUrl: config\.supabaseUrl, supabaseAnonKey: config\.supabaseAnonKey,/);
  assert.match(avvio, /esiti, erroreLink/);
});

test("service worker: esiti_segnalazioni.js in memoria e versione nuova", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.ok(sw.includes('"/app/moduli/esiti_segnalazioni.js"'));
  assert.ok(!sw.includes('"presente-app-27"'));
});
