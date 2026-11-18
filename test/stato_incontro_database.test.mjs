// Lo stato dell'incontro nel database (issue #6 passo 2d, spec v1 del CPO del 3/11) usa gli stessi valori di
// api/incontro.js ed è chiuso al telefono. Si legge solo il testo della migrazione: nessun database. Linea «sviluppatore-b».
// Il comportamento vero lo prova supabase/test/prova_stato_incontro.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { INCONTRO } from "../api/incontro.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_stato_incontro\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";

test("la migrazione dello stato dell'incontro esiste", () => assert.ok(file, "manca supabase/migrations/*_stato_incontro.sql"));

test("valori uguali a api/incontro.js: 3 controproposte, 48 ore", () => {
  assert.match(sql, new RegExp(`v_controproposte constant integer := ${INCONTRO.controproposte};`));
  assert.match(sql, new RegExp(`interval '${INCONTRO.propostaOre} hours'`));
});

test("funzione chiusa al telefono, solo il server la chiama", () => {
  assert.match(sql, /revoke all on function public\.stato_incontro\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.stato_incontro\(uuid, uuid\) to service_role/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/);
});

test("non restituisce mai gli id delle persone né una posizione", () => {
  const codice = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(codice, /'(a|b|proposto_da|ritardo_di|persona|posizione|gps)',/);
});

test("nessun SQL distruttivo sui dati", () => {
  const codice = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(codice, /\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i);
});
