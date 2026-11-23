// Stanza viva (issue #380, spec v1 del CPO del 23/11, punto 1), passo 2 della linea CTO: lo stato attuale nel database.
// Controlli sul testo della migrazione; il comportamento vero (chi vede chi, blocchi, sospesi, pausa, pulizia alla
// chiusura) è in supabase/test/prova_presenze.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_presenze_stanza\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const senzaCommenti = (testo) => testo.replace(/--[^\n]*/g, "");

test("la migrazione della stanza viva esiste", () => assert.ok(file, "manca supabase/migrations/*_presenze_stanza.sql"));

test("presenze_stanza: una riga per persona e stanza, regole per riga attive, nessun permesso al telefono", () => {
  assert.match(sql, /create table public\.presenze_stanza \(/);
  assert.match(sql, /primary key \(stanza_id, utente_id\)/);
  assert.match(sql, /references public\.membri_stanza \(stanza_id, utente_id\) on delete cascade/);
  assert.match(sql, /alter table public\.presenze_stanza enable row level security/);
  assert.match(sql, /revoke all on public\.presenze_stanza from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /grant [^;]*on public\.presenze_stanza to/);
});

test("niente storico: nessun insert senza «on conflict», nessuna tabella di accessi", () => {
  const corpo = senzaCommenti(sql);
  for (const ins of corpo.match(/insert into public\.presenze_stanza[\s\S]*?;/g) || []) {
    assert.match(ins, /on conflict \(stanza_id, utente_id\) do update/, ins);
  }
  assert.equal((corpo.match(/create table/g) || []).length, 1);
});

test("le funzioni sono solo per il server", () => {
  const funzioni = [...sql.matchAll(/create function public\.(\w+)\([^)]*\)\s*returns (?!trigger)/g)].map((m) => m[1]);
  for (const f of ["segnala_presenza", "segna_in_chiamata", "stati_stanza", "pulisci_presenze"]) assert.ok(funzioni.includes(f), f);
  for (const f of funzioni) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated;`), f);
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role;`), f);
    assert.match(sql, new RegExp(`function public\\.${f}\\([^)]*\\)[\\s\\S]*?security definer set search_path = ''`), f);
  }
});

test("la pausa non si scopre e lo stato non legge dati personali", () => {
  for (const corpo of senzaCommenti(sql).match(/\$\$[\s\S]*?\$\$/g) || []) {
    assert.doesNotMatch(corpo, /\b(pausa\w*|fascia\w*|email|telefono|foto\w*|voci?|questionario|diario|chiavi|coin\w*|crediti)\b/i, corpo);
  }
});
