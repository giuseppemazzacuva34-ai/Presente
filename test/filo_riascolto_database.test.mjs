// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 10a della linea «sviluppatore-c»: i dati
// della voce «Il vocale del Filo» nella stanza (riascolto tutta la settimana, pallino fino al primo ascolto).
// Controlli sul testo della migrazione; il comportamento vero è in supabase/test/prova_filo_riascolto.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_filo_riascolto\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const senzaCommenti = (testo) => testo.replace(/--[^\n]*/g, "");

test("la migrazione del riascolto del Filo esiste", () => assert.ok(file, "manca supabase/migrations/*_filo_riascolto.sql"));

test("filo_vocali_ascoltati: regole per riga attive, nessun permesso al telefono, solo persona, stanza e ora", () => {
  assert.match(sql, /create table public\.filo_vocali_ascoltati \(/);
  assert.match(sql, /alter table public\.filo_vocali_ascoltati enable row level security/);
  assert.match(sql, /revoke all on public\.filo_vocali_ascoltati from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /grant [^;]*on public\.filo_vocali_ascoltati to [^;]*(anon|authenticated)/);
  const tabella = sql.match(/create table public\.filo_vocali_ascoltati \(([\s\S]*?)\n\);/);
  assert.ok(tabella);
  const colonne = tabella[1].split("\n").map((r) => r.trim().split(" ")[0]).filter((c) => c && c !== "primary");
  assert.deepEqual(colonne, ["utente_id", "stanza_id", "ascoltato_il"]);
});

test("le funzioni del riascolto sono solo per il server", () => {
  for (const f of ["vocale_filo_stato", "segna_ascolto_filo"]) {
    assert.match(sql, new RegExp(`create function public\\.${f}\\(`), f);
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated;`), f);
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role;`), f);
    assert.match(sql, new RegExp(`function public\\.${f}\\([^)]*\\)[\\s\\S]*?security definer set search_path = ''`), f);
  }
});

test("solo aggiunte: niente di distruttivo", () => {
  assert.doesNotMatch(senzaCommenti(sql), /\b(drop|truncate|delete from|alter system|disable row level security)\b/i);
});
