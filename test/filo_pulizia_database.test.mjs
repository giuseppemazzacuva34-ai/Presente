// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 11a della linea «sviluppatore-c»: i dati
// della pulizia dei vocali 7 giorni dopo la chiusura. Controlli sul testo della migrazione; il comportamento vero è in
// supabase/test/prova_filo_pulizia.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_filo_pulizia\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const senzaCommenti = (testo) => testo.replace(/--[^\n]*/g, "");

test("la migrazione della pulizia del Filo esiste", () => assert.ok(file, "manca supabase/migrations/*_filo_pulizia.sql"));

test("le funzioni della pulizia sono solo per il server", () => {
  for (const f of ["vocali_filo_scaduti", "togli_vocali_filo"]) {
    assert.match(sql, new RegExp(`create function public\\.${f}\\(`), f);
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated;`), f);
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role;`), f);
    assert.match(sql, new RegExp(`function public\\.${f}\\([^)]*\\)[\\s\\S]*?security definer set search_path = ''`), f);
  }
});

test("solo aggiunte di funzioni; le cancellazioni hanno sempre il filtro dei 7 giorni", () => {
  const corpo = senzaCommenti(sql);
  assert.doesNotMatch(corpo, /\b(drop|truncate|alter table|alter system|disable row level security)\b/i);
  const cancellazioni = corpo.match(/delete from[\s\S]*?;/gi) || [];
  assert.ok(cancellazioni.length >= 1);
  for (const c of cancellazioni) assert.match(c, /interval '7 days'/, c);
});
