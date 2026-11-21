// Riepilogo delle valutazioni nel database (issue #6, spec v1 del CPO del 3/11, «Valutazione (D20)», passo 3b):
// alla cieca per 7 giorni e bollini da 3 incontri, come api/valutazione.js; mai la domanda sulla sicurezza.
// Si legge solo il testo della migrazione; il comportamento lo prova supabase/test/prova_riepilogo_valutazioni.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { VALUTAZIONE } from "../api/valutazione.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_riepilogo_valutazioni\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const codice = sql.replace(/--.*$/gm, "");

test("la migrazione del riepilogo esiste", () => assert.ok(file, "manca supabase/migrations/*_riepilogo_valutazioni.sql"));

test("stessi tempi e soglie di api/valutazione.js", () => {
  assert.match(codice, new RegExp(`v_giorni constant integer := ${VALUTAZIONE.giorniAperta};`));
  assert.match(codice, new RegExp(`v_bollini_dopo constant integer := ${VALUTAZIONE.bolliniDopo};`));
});

test("la domanda sulla sicurezza non entra mai nel riepilogo", () => assert.doesNotMatch(codice, /\bsicuro\b/));

test("solo il server chiama il riepilogo", () => {
  assert.match(codice, /revoke all on function public\.riepilogo_valutazioni\(uuid\) from public, anon, authenticated/);
  assert.match(codice, /grant execute on function public\.riepilogo_valutazioni\(uuid\) to service_role/);
  assert.doesNotMatch(codice, /grant [^;]* to (anon|authenticated)/);
  assert.doesNotMatch(codice, /\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i);
});
