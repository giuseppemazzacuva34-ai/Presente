// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 1 della linea «sviluppatore-c»:
// il ruolo «filo» nel database. Controlli sul testo della migrazione; il comportamento vero (Filo, membri,
// sospesi, stanze di altri, telefono rifiutato) è in supabase/test/prova_filo.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_filo_ruolo\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const senzaCommenti = (testo) => testo.replace(/--[^\n]*/g, "");

test("la migrazione del ruolo «filo» esiste", () => assert.ok(file, "manca supabase/migrations/*_filo_ruolo.sql"));

test("fili_stanza: regole per riga attive, nessun permesso al telefono, al massimo un Filo per stanza", () => {
  assert.match(sql, /create table public\.fili_stanza \(\s*stanza_id uuid primary key references public\.stanze/);
  assert.match(sql, /alter table public\.fili_stanza enable row level security/);
  assert.match(sql, /revoke all on public\.fili_stanza from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /grant [^;]*on public\.fili_stanza to [^;]*(anon|authenticated)/);
});

test("le funzioni del Filo sono solo per il server", () => {
  // Le funzioni dei trigger non si chiamano da fuori: per loro basta il revoke.
  const funzioni = [...sql.matchAll(/create function public\.(\w+)\([^)]*\)\s*returns (?!trigger)/g)].map((m) => m[1]);
  assert.match(sql, /revoke all on function public\.controlla_filo_stanza\(\) from public, anon, authenticated;/);
  assert.ok(funzioni.includes("stanze_del_filo") && funzioni.includes("nomi_stanza_filo"), funzioni.join(","));
  for (const f of funzioni) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated;`), f);
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role;`), f);
    assert.match(sql, new RegExp(`function public\\.${f}\\([^)]*\\)[\\s\\S]*?security definer set search_path = ''`), f);
  }
});

test("il Filo non legge mai email, telefono, provincia, età, foto, voce, questionario, diario, chiavi, segnalazioni, Coin", () => {
  for (const corpo of senzaCommenti(sql).match(/\$\$[\s\S]*?\$\$/g) || []) {
    assert.doesNotMatch(corpo, /\b(email|telefono|citta|data_nascita|foto\w*|voci?|vocale_profilo|questionario|diario|chiavi|segnalazioni|coin\w*|crediti|porte)\b/i, corpo);
  }
});
