// «Arrivo in ritardo» nel database (issue #6, spec v1 del CPO del 3/11, «Casi limite»): stessi valori di
// api/incontro.js (15 o 30 minuti, fino a 30 minuti dopo l'ora), funzione chiusa al telefono, stato senza l'id di chi
// l'ha dichiarato. Si legge solo il testo della migrazione; il comportamento vero lo prova
// supabase/test/prova_ritardo_incontro.sql. Linea «sviluppatore-b».
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { INCONTRO } from "../api/incontro.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_ritardo_incontro\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const codice = sql.replace(/--.*$/gm, "");

test("la migrazione di «Arrivo in ritardo» esiste", () => assert.ok(file, "manca supabase/migrations/*_ritardo_incontro.sql"));

test("minuti e finestra uguali a api/incontro.js", () => {
  assert.deepEqual(INCONTRO.ritardi, [15, 30]);
  assert.match(codice, new RegExp(`p_minuti not in \\(${INCONTRO.ritardi.join(", ")}\\)`));
  assert.match(codice, new RegExp(`v_dopo constant integer := ${INCONTRO.checkinDopoMinuti};`));
});

test("funzione chiusa al telefono, solo il server", () => {
  assert.match(sql, /revoke all on function public\.ritardo_incontro\(uuid, uuid, integer\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.ritardo_incontro\(uuid, uuid, integer\) to service_role/);
  assert.doesNotMatch(codice, /grant [^;]* to (anon|authenticated)/);
});

test("lo stato dice solo se il ritardo è mio, mai chi l'ha dichiarato", () => {
  assert.match(codice, /'ritardo_mio', /);
  assert.doesNotMatch(codice, /'ritardo_di'/);
});

test("nessun SQL distruttivo", () => {
  assert.doesNotMatch(codice, /\bdrop\s+(table|function)\b|\btruncate\b|\bdelete\s+from\b/i);
});
