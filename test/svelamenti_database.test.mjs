// La migrazione dello svelamento (issue #65, spec v1 del CPO; D48 A) usa gli stessi limiti di api/svelamento.js
// ed è chiusa al telefono. Si legge solo il testo della migrazione: nessun database. Linea «sviluppatore».
// Il comportamento vero (vincoli, trigger, regole per riga) lo prova supabase/test/prova_svelamenti.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { SVELAMENTO } from "../api/svelamento.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_svelamenti\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";

test("la migrazione dello svelamento esiste", () => assert.ok(file, "manca supabase/migrations/*_svelamenti.sql"));

test("limiti uguali a api/svelamento.js: fasce, durata, tentativi", () => {
  assert.match(sql, new RegExp(`cardinality\\(fasce_a\\) <= ${SVELAMENTO.maxFasce}`));
  assert.match(sql, new RegExp(`cardinality\\(fasce_b\\) <= ${SVELAMENTO.maxFasce}`));
  assert.match(sql, new RegExp(`durata_secondi between 0 and ${SVELAMENTO.durata}`));
  assert.match(sql, new RegExp(`tentativi between 0 and ${SVELAMENTO.tentativi}`));
});

test("regole per riga attive e svelamenti chiusi al telefono", () => {
  assert.match(sql, /alter table public\.svelamenti enable row level security/);
  assert.match(sql, /revoke all on public\.svelamenti from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/);
});

test("nessuna immagine, audio o video nel database (spec: «Nessuna registrazione»)", () => {
  const codice = sql.replace(/--.*$/gm, ""); // solo lo schema, non i commenti che spiegano cosa NON c'è
  assert.doesNotMatch(codice, /\bbytea\b|immagin|foto_url|audio|video_url|registrazion/i);
  assert.doesNotMatch(codice, /diario/i);
});

test("dopo l'esito le singole risposte sì/no non possono restare (vincolo nello schema)", () => {
  assert.match(sql, /esito is null or \(risposta_a is null and risposta_b is null\)/);
});
