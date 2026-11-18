// La proposta d'incontro nel database (issue #6 passo 2b, spec v1 del CPO del 3/11) usa gli stessi valori di
// api/incontro.js ed è chiusa al telefono. Si legge solo il testo della migrazione: nessun database. Linea «sviluppatore-b».
// Il comportamento vero (orari, controproposte, 48 ore, conferma, annulla, scadenza) lo prova
// supabase/test/prova_proposta_incontro.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { INCONTRO } from "../api/incontro.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_proposta_incontro\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";

test("la migrazione della proposta d'incontro esiste", () => assert.ok(file, "manca supabase/migrations/*_proposta_incontro.sql"));

test("valori uguali a api/incontro.js: 10:00–23:00, ogni 30 minuti, 3 controproposte, 48 ore", () => {
  assert.match(sql, new RegExp(`v_prima_ora constant integer := ${INCONTRO.primaOra};`));
  assert.match(sql, new RegExp(`v_ultima_ora constant integer := ${INCONTRO.ultimaOra};`));
  assert.match(sql, new RegExp(`v_passo constant integer := ${INCONTRO.passoMinuti};`));
  assert.match(sql, new RegExp(`v_controproposte constant integer := ${INCONTRO.controproposte};`));
  assert.match(sql, new RegExp(`interval '${INCONTRO.propostaOre} hours'`));
});

test("funzioni chiuse al telefono, solo il server le chiama", () => {
  for (const f of ["proponi_incontro", "rispondi_incontro"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`));
  }
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/);
});

test("nessun SQL distruttivo sui dati", () => {
  const codice = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(codice, /\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i);
});
