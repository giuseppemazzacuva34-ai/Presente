// La migrazione di stato_chiavi e sera_di (issue #5, passo 5a) usa le regole di api/regole.js e resta chiusa al
// telefono. Si legge solo il testo della migrazione: nessun database. Linea «sviluppatore-c».
// Il comportamento vero è in supabase/test/prova_chiavi_sera.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { CHIAVI } from "../api/regole.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_chiavi_sera\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";

test("la migrazione di stato_chiavi e sera_di esiste", () => assert.ok(file, "manca supabase/migrations/*_chiavi_sera.sql"));

test("chiavi per stanza uguali a api/regole.js, chiuse un minuto prima", () => {
  assert.match(sql, new RegExp(`greatest\\(0, ${CHIAVI.perSettimana} - `));
  assert.match(sql, /chiude_il - interval '1 minute'/);
});

test("la sera si mostra fino a lunedì 9:00 (12 ore dopo le 21:00)", () => assert.match(sql, /chiude_il \+ interval '12 hours'/));

test("solo il server: nessun permesso al telefono", () => {
  assert.match(sql, /revoke all on function public\.stato_chiavi\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.sera_di\(uuid\) from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/);
});

test("mai le chiavi ricevute: si leggono solo quelle date (c.da = p_utente)", () => {
  assert.doesNotMatch(sql, /c\.a = p_utente/);
});

test("niente SQL distruttivo e niente diario", () => {
  assert.doesNotMatch(sql, /\b(drop|truncate|delete|alter system)\b/i);
  assert.doesNotMatch(sql, /diario/i);
});

// Passo 5c: sera_di con il nome dell'altra persona (solo il nome, solo per le porte aperte).
const fileNome = readdirSync(cartella).find((n) => /^\d{14}_sera_nome\.sql$/.test(n));
const sqlNome = fileNome ? readFileSync(new URL(fileNome, cartella), "utf8") : "";

test("sera_di con il nome: solo il nome del profilo, chiusa al telefono", () => {
  assert.ok(fileNome, "manca supabase/migrations/*_sera_nome.sql");
  assert.match(sqlNome, /'nome', pr\.nome/);
  assert.doesNotMatch(sqlNome, /pr\.(foto|cognome|data_nascita|citta|email)/);
  assert.match(sqlNome, /revoke all on function public\.sera_di\(uuid\) from public, anon, authenticated/);
  assert.doesNotMatch(sqlNome, /grant [^;]* to (anon|authenticated)/);
  assert.doesNotMatch(sqlNome, /\b(drop|truncate|delete|alter system)\b/i);
});
