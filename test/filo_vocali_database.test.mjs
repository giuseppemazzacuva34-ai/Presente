// I vocali del Filo (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 2 della linea «sviluppatore-c».
// Controlli sul testo della migrazione; il comportamento vero (orari con orologio finto, durate, testo, telefono
// rifiutato) è in supabase/test/prova_filo_vocali.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_filo_vocali\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";

test("la migrazione dei vocali del Filo esiste", () => assert.ok(file, "manca supabase/migrations/*_filo_vocali.sql"));

test("vocali_filo: regole per riga attive, il telefono non legge né scrive", () => {
  assert.match(sql, /alter table public\.vocali_filo enable row level security/);
  assert.match(sql, /revoke all on public\.vocali_filo from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /grant [^;]*on public\.vocali_filo to [^;]*(anon|authenticated)/);
  assert.doesNotMatch(sql, /create policy/);
});

test("contenitore privato, solo audio, niente voci generate", () => {
  assert.match(sql, /insert into storage\.buckets[^;]*'vocali_filo', 'vocali_filo', false/);
  assert.match(sql, /array\['audio\/webm', 'audio\/ogg', 'audio\/mp4', 'audio\/mpeg', 'audio\/aac'\]/);
});

test("orari in ora di Roma (cambio d'ora), mai intervalli fissi dall'apertura", () => {
  assert.match(sql, /'Europe\/Rome'/);
  assert.match(sql, /'08:45'/);
  assert.match(sql, /'13:00'/);
  assert.match(sql, /'09:00'/);
  assert.match(sql, /'20:00'/);
});

test("salva_vocale_filo solo per il server", () => {
  assert.match(sql, /revoke all on function public\.salva_vocale_filo\([^)]*\)\s+from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.salva_vocale_filo\([^)]*\) to service_role;/);
});
