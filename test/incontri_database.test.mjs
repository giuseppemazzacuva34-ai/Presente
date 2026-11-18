// La migrazione dell'incontro (issue #6 passo 2a, spec v1 del CPO del 3/11) usa gli stessi valori di api/incontro.js
// ed è chiusa al telefono. Si legge solo il testo della migrazione: nessun database. Linea «sviluppatore-b».
// Il comportamento vero (vincoli, scadenza, crediti della buca) lo prova supabase/test/prova_incontri.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { INCONTRO } from "../api/incontro.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_incontri\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";

test("la migrazione dell'incontro esiste", () => assert.ok(file, "manca supabase/migrations/*_incontri.sql"));

test("valori uguali a api/incontro.js: giorni, controproposte, ritardi, buca", () => {
  assert.match(sql, new RegExp(`interval '${INCONTRO.giorniStessaArea} days'`));
  assert.match(sql, new RegExp(`interval '${INCONTRO.giorniAreeDiverse} days'`));
  assert.match(sql, new RegExp(`controproposte between 0 and ${INCONTRO.controproposte}`));
  assert.match(sql, new RegExp(`ritardo_minuti in \\(0, ${INCONTRO.ritardi.join(", ")}\\)`));
  assert.match(sql, new RegExp(`tipo = 'buca_ricevuta' and crediti = ${INCONTRO.bucaAChiAspetta}`));
  assert.match(sql, new RegExp(`crediti_presente = ${INCONTRO.bucaAPresente}`));
});

test("regole per riga attive e incontri chiusi al telefono", () => {
  assert.match(sql, /alter table public\.incontri enable row level security/);
  assert.match(sql, /revoke all on public\.incontri from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/);
});

test("nessun SQL distruttivo sui dati", () => {
  const codice = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(codice, /\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i);
});
