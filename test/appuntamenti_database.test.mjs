// «Fissa una chiamata» (issue #380, spec v1 del CPO del 23/11, punti 4-7), passo 2b della linea CTO: gli appuntamenti
// nel database. Controlli sul testo della migrazione; il comportamento vero (proposte, controproposte, limiti, scadenze,
// blocchi, segnalazioni, uscita, pulizia alla chiusura) è in supabase/test/prova_appuntamenti.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_appuntamenti\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";

test("la migrazione degli appuntamenti esiste", () => assert.ok(file, "manca supabase/migrations/*_appuntamenti.sql"));

test("appuntamenti: regole per riga attive, nessun permesso al telefono, messaggio al massimo 120 caratteri", () => {
  assert.match(sql, /create table public\.appuntamenti \(/);
  assert.match(sql, /alter table public\.appuntamenti enable row level security/);
  assert.match(sql, /revoke all on public\.appuntamenti from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /grant [^;]*on public\.appuntamenti to/);
  assert.match(sql, /messaggio text check \(char_length\(messaggio\) <= 120\)/);
  assert.match(sql, /controproposte smallint not null default 0 check \(controproposte between 0 and 2\)/);
  assert.match(sql, /references public\.stanze \(id\) on delete cascade/);
});

test("le funzioni sono solo per il server", () => {
  const funzioni = [...sql.matchAll(/create function public\.(\w+)\(([^)]*)\)\s*returns (?!trigger)/g)].map((m) => m[1]);
  for (const f of ["proponi_appuntamento", "rispondi_appuntamento", "annulla_appuntamento", "appuntamenti_di",
    "pulisci_appuntamenti"]) assert.ok(funzioni.includes(f), f);
  for (const f of funzioni) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated;`), f);
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role;`), f);
    assert.match(sql, new RegExp(`function public\\.${f}\\([^)]*\\)[\\s\\S]*?security definer set search_path = ''`), f);
  }
});

test("appuntamenti e messaggi non entrano negli algoritmi (stanze, suggerimenti, chiavi, lavoro del lunedì)", () => {
  const algoritmi = ["../api/stanze.js", "../api/aree.js", "../api/chiavi.js", "../api/settimana.js",
    "../scripts/lavoro_lunedi.mjs"];
  for (const percorso of algoritmi) {
    const testo = readFileSync(new URL(percorso, import.meta.url), "utf8");
    assert.doesNotMatch(testo, /appuntament/i, percorso);
  }
  const altre = readdirSync(cartella).filter((n) => n.endsWith(".sql") && n !== file);
  for (const n of altre) assert.doesNotMatch(readFileSync(new URL(n, cartella), "utf8"), /public\.appuntamenti\b/, n);
});
