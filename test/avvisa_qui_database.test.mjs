// «Avvisa <nome> che sei qui» nel database (issue #6, spec v1 del CPO del 3/11, punto 6): stessi valori di
// api/incontro.js (15 minuti, finestra fino a 30 minuti dopo l'ora), funzione chiusa al telefono, stato senza id.
// Si legge solo il testo della migrazione; il comportamento vero lo prova supabase/test/prova_avvisa_qui.sql.
// Linea «sviluppatore-b».
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { INCONTRO } from "../api/incontro.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_avvisa_qui\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const codice = sql.replace(/--.*$/gm, "");

test("la migrazione di «Avvisa che sei qui» esiste", () => assert.ok(file, "manca supabase/migrations/*_avvisa_qui.sql"));

test("minuti uguali a api/incontro.js", () => {
  assert.equal(INCONTRO.avvisoQuiMinuti, 15);
  assert.match(codice, new RegExp(`v_attesa constant integer := ${INCONTRO.avvisoQuiMinuti};`));
  assert.match(codice, new RegExp(`v_dopo constant integer := ${INCONTRO.checkinDopoMinuti};`));
});

test("funzione chiusa al telefono, solo il server", () => {
  assert.match(sql, /revoke all on function public\.avvisa_sono_qui\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.avvisa_sono_qui\(uuid, uuid\) to service_role/);
  assert.doesNotMatch(codice, /grant [^;]* to (anon|authenticated)/);
});

test("lo stato dice solo vero o falso, mai chi ha avvisato", () => {
  assert.match(codice, /'avvisato_mio', /);
  assert.match(codice, /'avvisato_altro', /);
  assert.doesNotMatch(codice, /'avviso_qui_[ab]_il'/);
});

test("aggiunge colonne senza SQL distruttivo", () => {
  assert.match(codice, /add column avviso_qui_a_il timestamptz/);
  assert.doesNotMatch(codice, /\bdrop\s+(table|function|column)\b|\btruncate\b|\bdelete\s+from\b/i);
});
