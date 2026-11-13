// La migrazione delle porte (issue #5) usa la stessa lunghezza massima della frase di api/chiavi.js
// ed è chiusa al telefono. Si legge solo il testo della migrazione: nessun database. Linea «sviluppatore-c».
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { FRASE_MASSIMO } from "../api/chiavi.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_porte\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";

test("la migrazione delle porte esiste", () => assert.ok(file, "manca supabase/migrations/*_porte.sql"));

test("frasi lunghe al massimo quanto in api/chiavi.js", () => {
  assert.match(sql, new RegExp(`char_length\\(frase_di_a\\) between 1 and ${FRASE_MASSIMO}`));
  assert.match(sql, new RegExp(`char_length\\(frase_di_b\\) between 1 and ${FRASE_MASSIMO}`));
});

test("regole per riga attive e porte chiuse al telefono", () => {
  assert.match(sql, /alter table public\.porte enable row level security/);
  assert.match(sql, /revoke all on public\.porte from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/);
});

test("il diario non entra nelle porte", () => assert.doesNotMatch(sql, /diario/i));
