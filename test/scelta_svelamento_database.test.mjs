// «Come vuoi lo svelamento» (issue #65 passo 3a, linea «sviluppatore»): la funzione è chiusa al telefono e la scelta
// dell'altra persona non esce mai. Si legge solo il testo della migrazione; il comportamento vero lo prova
// supabase/test/prova_scelta_svelamento.sql su un Postgres di prova.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_scelta_svelamento\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const codice = sql.replace(/--.*$/gm, "");

test("la migrazione della scelta video/foto esiste", () => assert.ok(file));

test("funzioni solo per il server, mai per il telefono", () => {
  for (const f of ["scelta_svelamento", "svelamento_di"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`), f);
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`), f);
  }
  assert.doesNotMatch(codice, /to (anon|authenticated)/);
});

test("allo stato va solo la propria scelta: mai quella dell'altra persona, email o data di nascita", () => {
  const stato = codice.slice(codice.indexOf("create or replace function public.svelamento_di"));
  assert.match(stato, /'mia_scelta'/);
  assert.doesNotMatch(stato, /'sua_scelta'|'scelta_a'|'scelta_b'|'email'|'data_nascita'|'risposta/);
});

test("solo «video» o «foto»; nessuna penale", () => {
  assert.match(codice, /p_scelta not in \('video', 'foto'\)/);
  assert.doesNotMatch(codice, /penale|buca/i);
});
