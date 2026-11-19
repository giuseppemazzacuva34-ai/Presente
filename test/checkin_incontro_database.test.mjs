// Check-in «Sono qui» e segnale nel database (issue #6, spec v1 del CPO del 3/11, punto 6): stessi valori di
// api/incontro.js, lista di 200 parole neutre, funzione chiusa al telefono. Si legge solo il testo della migrazione.
// Il comportamento vero lo prova supabase/test/prova_checkin_incontro.sql. Linea «sviluppatore-b».
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { INCONTRO } from "../api/incontro.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_checkin_incontro\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const codice = sql.replace(/--.*$/gm, "");
const parole = [...(codice.match(/insert into public\.parole_segnale[^;]*;/s)?.[0] ?? "").matchAll(/\('([^']+)'\)/g)].map((m) => m[1]);

test("la migrazione del check-in esiste", () => assert.ok(file, "manca supabase/migrations/*_checkin_incontro.sql"));

test("finestra uguale a api/incontro.js: 30 minuti prima, 30 dopo più il ritardo", () => {
  assert.match(sql, new RegExp(`v_prima constant integer := ${INCONTRO.checkinPrimaMinuti};`));
  assert.match(sql, new RegExp(`v_dopo constant integer := ${INCONTRO.checkinDopoMinuti};`));
});

test("200 parole neutre, tutte diverse, una parola sola di lettere", () => {
  assert.equal(parole.length, 200);
  assert.equal(new Set(parole.map((p) => p.toLowerCase())).size, 200);
  for (const p of parole) assert.match(p, /^[A-ZÀ-Ü][a-zà-ü]{1,19}$/, p);
});

test("lista e funzione chiuse al telefono, solo il server", () => {
  assert.match(sql, /alter table public\.parole_segnale enable row level security/);
  assert.match(sql, /revoke all on public\.parole_segnale from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.checkin_incontro\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.checkin_incontro\(uuid, uuid\) to service_role/);
  assert.doesNotMatch(codice, /grant [^;]* to (anon|authenticated)/);
});

test("nessuna posizione e nessun SQL distruttivo", () => {
  assert.doesNotMatch(codice, /\b(lat|lon|lng|gps|posizione|coordinate)\b/i);
  assert.doesNotMatch(codice, /\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i);
});
