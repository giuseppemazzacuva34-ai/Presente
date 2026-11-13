// La migrazione della sera delle porte (issue #5) apre le porte solo alla chiusura della stanza, solo dal server,
// e lascia per i report soltanto numeri. Si legge solo il testo della migrazione: nessun database. Linea «sviluppatore-c».
// Il comportamento vero (12 profili, chiavi incrociate, cambio d'ora) è in supabase/test/prova_sera_porte.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_sera_porte\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";

test("la migrazione della sera delle porte esiste", () => assert.ok(file, "manca supabase/migrations/*_sera_porte.sql"));

test("le porte si aprono solo per le stanze già chiuse, all'ora della chiusura", () => {
  assert.match(sql, /chiude_il <= now\(\)/);
  assert.match(sql, /aperta_il[^;]*s\.chiude_il|s\.chiude_il[^;]*aperta_il/s);
});

test("regole per riga attive, conteggi e apertura chiusi al telefono", () => {
  assert.match(sql, /alter table public\.serate_porte enable row level security/);
  assert.match(sql, /revoke all on public\.serate_porte from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.apri_porte\(\) from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/);
});

test("niente SQL distruttivo sullo schema", () => assert.doesNotMatch(sql, /\b(drop|truncate|alter system)\b/i));

test("il diario non entra nella sera delle porte", () => assert.doesNotMatch(sql, /diario/i));
