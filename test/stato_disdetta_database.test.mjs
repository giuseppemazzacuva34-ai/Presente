// Azioni «Disdici» e «Annulla l'incontro» e disdetta nello stato dell'incontro (issue #6 spec v1.1 del CPO del 20/11,
// punto 2; passo 2p, linea «sviluppatore-b»). Si legge solo il testo della migrazione; il comportamento vero lo prova
// supabase/test/prova_stato_disdetta.sql. Mai l'id dell'altra persona né una posizione verso il telefono.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { INCONTRO } from "../api/incontro.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_stato_disdetta\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const codice = sql.replace(/--.*$/gm, "");

test("la migrazione dello stato con la disdetta esiste", () => assert.ok(file, "manca supabase/migrations/*_stato_disdetta.sql"));

test("solo aggiunte: una colonna vuota per l'orario disdetto, nessun SQL distruttivo", () => {
  assert.match(codice, /alter table public\.incontri\s+add column orario_disdetto timestamptz;/);
  assert.doesNotMatch(codice, /\bdrop\s+(table|function|column)\b|\btruncate\b|\bdelete\s+from\b/i);
});

test("valori uguali a api/incontro.js", () => {
  assert.match(sql, new RegExp(`v_ore_gratis constant integer := ${INCONTRO.disdettaGratisOre};`));
  assert.match(sql, new RegExp(`v_prima constant integer := ${INCONTRO.checkinPrimaMinuti};`));
  assert.match(sql, new RegExp(`v_dopo constant integer := ${INCONTRO.checkinDopoMinuti};`));
  assert.match(sql, new RegExp(`v_controproposte constant integer := ${INCONTRO.controproposte};`));
  assert.match(sql, new RegExp(`interval '${INCONTRO.propostaOre} hours'`));
});

test("nuove azioni e campo «disdetta» per il telefono", () => {
  assert.match(codice, /"disdici"/);
  assert.match(codice, /"annulla_incontro"/);
  assert.match(codice, /'disdetta',/);
  for (const campo of ["mia", "il", "orario"]) assert.match(codice, new RegExp(`'${campo}',`));
});

test("funzioni chiuse al telefono, mai id né posizioni", () => {
  for (const f of ["stato_incontro", "disdici_incontro"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\(uuid, uuid\\) from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\(uuid, uuid\\) to service_role`));
  }
  assert.doesNotMatch(codice, /grant [^;]* to (anon|authenticated)/);
  assert.doesNotMatch(codice, /'(a|b|proposto_da|ritardo_di|disdetto_da|persona|posizione|gps)',/);
});
