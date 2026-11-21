// Valutazione dopo l'incontro nel database (issue #6, spec v1 del CPO del 3/11, «Valutazione (D20)», passo 3a):
// risposte e tempi uguali a api/valutazione.js, tabella chiusa al telefono. Si legge solo il testo della migrazione;
// il comportamento vero lo prova supabase/test/prova_valutazioni.sql. Linea «sviluppatore-b».
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { VALUTAZIONE } from "../api/valutazione.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_valutazioni\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const codice = sql.replace(/--.*$/gm, "");

test("la migrazione della valutazione esiste", () => assert.ok(file, "manca supabase/migrations/*_valutazioni.sql"));

test("tre domande sui fatti con le stesse risposte di api/valutazione.js", () => {
  for (const d of VALUTAZIONE.domande) {
    const lista = d.risposte.map((r) => `'${r}'`).join(", ");
    assert.match(codice, new RegExp(`${d.id} text not null check \\(${d.id} in \\(${lista}\\)\\)`), d.id);
  }
});

test("la domanda privata sulla sicurezza è obbligatoria", () => assert.match(codice, /sicuro boolean not null/));

test("aperta 7 giorni come in api/valutazione.js", () => {
  assert.equal(VALUTAZIONE.giorniAperta, 7);
  assert.match(codice, new RegExp(`v_giorni constant integer := ${VALUTAZIONE.giorniAperta};`));
});

test("si cancella con l'account (D20)", () => {
  assert.match(codice, /persona uuid not null references auth\.users \(id\) on delete cascade/);
  assert.match(codice, /valutato uuid not null references auth\.users \(id\) on delete cascade/);
});

test("tabella e funzione chiuse al telefono, solo il server", () => {
  assert.match(codice, /alter table public\.valutazioni enable row level security/);
  assert.match(codice, /revoke all on public\.valutazioni from public, anon, authenticated/);
  assert.match(codice, /revoke all on function public\.valuta_incontro\([^)]*\) from public, anon, authenticated/);
  assert.match(codice, /grant execute on function public\.valuta_incontro\([^)]*\) to service_role/);
  assert.doesNotMatch(codice, /grant [^;]* to (anon|authenticated)/);
});

test("niente voti, stelle o aspetto; nessun SQL distruttivo", () => {
  assert.doesNotMatch(codice, /\b(voto|stelle|stella|aspetto|bello|bella)\b/i);
  assert.doesNotMatch(codice, /\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i);
});

// supabase-postgres-best-practices › schema-foreign-key-indexes: ogni chiave esterna ha il suo indice
// (la cancellazione dell'account cerca per «persona» e per «valutato»).
test("indici sulle chiavi esterne di chi risponde e di chi è valutato", () => {
  const tutte = readdirSync(cartella).filter((n) => n.endsWith(".sql")).map((n) => readFileSync(new URL(n, cartella), "utf8")).join("\n");
  assert.match(tutte, /create index \w+ on public\.valutazioni \(valutato\)/);
  assert.match(tutte, /create index \w+ on public\.valutazioni \(persona\)/);
});
