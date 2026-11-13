// La migrazione delle chiavi (issue #5) usa le stesse regole di api/chiavi.js e api/regole.js:
// 2 chiavi, chiamata di almeno 60 s, frase di 140 caratteri, chiavi chiuse un minuto prima, motivi uguali.
// Si legge solo il testo della migrazione: nessun database. Linea «sviluppatore-c».
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FRASE_MASSIMO } from "../api/chiavi.js";
import { CHIAVI } from "../api/regole.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_chiavi\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";

test("la migrazione delle chiavi esiste", () => assert.ok(file, "manca supabase/migrations/*_chiavi.sql"));

test("numeri uguali a api/regole.js e api/chiavi.js", () => {
  assert.match(sql, new RegExp(`>= ${CHIAVI.perSettimana} then return 'finite'`));
  assert.match(sql, new RegExp(`durata >= ${CHIAVI.secondiMinimiPerChiamataValida}`));
  assert.match(sql, new RegExp(`char_length\\(frase\\) between 1 and ${FRASE_MASSIMO}`));
  assert.match(sql, /interval '1 minute'/);
});

test("motivi uguali a quelli di api/chiavi.js", () => {
  const motivi = new Set([...sql.matchAll(/return '([a-z_]+)'/g)].map((m) => m[1]));
  const js = readFileSync(new URL("../api/chiavi.js", import.meta.url), "utf8");
  const noti = new Set([...js.matchAll(/no\("([a-z_]+)"/g)].map((m) => m[1]));
  for (const m of motivi) if (m !== "ok") assert.ok(noti.has(m), `motivo ${m} non è in api/chiavi.js`);
});

test("regole per riga attive e chiavi chiuse al telefono", () => {
  assert.match(sql, /alter table public\.chiavi enable row level security/);
  assert.match(sql, /revoke all on public\.chiavi from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/);
});

test("il diario non entra nelle chiavi", () => assert.doesNotMatch(sql, /diario/i));
