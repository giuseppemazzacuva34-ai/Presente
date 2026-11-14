// Il diario privato (issue #5, spec v1.1, D51 A): lo legge solo chi lo scrive, mai il server né gli algoritmi.
// Controlli sul testo: migrazione, altre migrazioni e codice del Worker e dell'API. Linea «sviluppatore-c».
// Il comportamento vero (due account, ruolo di servizio, eliminazione) è in supabase/test/prova_diario.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_diario\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const senzaCommenti = (testo) => testo.replace(/--[^\n]*/g, "").replace(/\/\/[^\n]*/g, "");

test("la migrazione del diario esiste", () => assert.ok(file, "manca supabase/migrations/*_diario.sql"));

test("regole per riga attive; niente permessi al server né a chi non ha fatto l'accesso", () => {
  assert.match(sql, /alter table public\.diario enable row level security/);
  assert.match(sql, /revoke all on public\.diario from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /grant [^;]*on public\.diario to [^;]*(service_role|anon)/);
  // Le funzioni della migrazione (security definer) non leggono il diario: nei loro corpi la parola non c'è.
  for (const corpo of senzaCommenti(sql).match(/\$\$[\s\S]*?\$\$/g) || []) assert.doesNotMatch(corpo, /diario/i);
});

test("ogni regola guarda solo il proprietario", () => {
  const regole = [...sql.matchAll(/create policy [^;]+;/g)].map((m) => m[0]);
  assert.equal(regole.length, 4);
  for (const r of regole) assert.match(r, /utente_id = \(select auth\.uid\(\)\)/);
});

test("1000 caratteri, solo dopo una chiamata di almeno 60 secondi, nessuna cancellazione automatica", () => {
  assert.match(sql, /char_length\(testo\) between 1 and 1000/);
  assert.match(sql, /durata between 60 and 900/);
  assert.doesNotMatch(senzaCommenti(sql), /\b(delete from|cron|interval)\b/i);
});

test("nessun'altra migrazione e nessun codice del server legge il diario", () => {
  for (const n of readdirSync(cartella)) {
    if (n === file) continue;
    assert.doesNotMatch(senzaCommenti(readFileSync(new URL(n, cartella), "utf8")), /\bdiario\b/i, n);
  }
  for (const dir of ["../worker/", "../api/"]) {
    const c = new URL(dir, import.meta.url);
    for (const n of readdirSync(c).filter((x) => x.endsWith(".js"))) {
      // Nessuna lettura della tabella dal server: niente /rest/v1/diario né public.diario.
      assert.doesNotMatch(readFileSync(new URL(n, c), "utf8"), /rest\/v1\/(rpc\/)?\w*diario|public\.diario/i, dir + n);
    }
  }
});
