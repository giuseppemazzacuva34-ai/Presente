// Azione «valuta» nello stato dell'incontro (issue #6, spec v1 del CPO del 3/11, «Valutazione (D20)»; passo 3e, linea
// «sviluppatore-b»). Dopo l'incontro avvenuto il telefono deve sapere se mostrare le 4 domande: «valuta» c'è finché la
// persona non ha risposto e la valutazione è aperta (7 giorni, «Non ora» non la chiude). Si legge solo il testo della
// migrazione; il comportamento vero lo prova supabase/test/prova_stato_valutazione.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { INCONTRO } from "../api/incontro.js";
import { VALUTAZIONE } from "../api/valutazione.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_stato_valutazione\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const codice = sql.replace(/--.*$/gm, "");

test("la migrazione dello stato con la valutazione esiste", () => assert.ok(file, "manca supabase/migrations/*_stato_valutazione.sql"));

test("solo la funzione dello stato sostituita, nessun SQL distruttivo", () => {
  assert.match(codice, /create or replace function public\.stato_incontro\(p_porta uuid, p_persona uuid\) returns jsonb/);
  assert.doesNotMatch(codice, /\bdrop\s+(table|function|column)\b|\btruncate\b|\bdelete\s+from\b|\balter table\b/i);
});

test("valori uguali a api/incontro.js e api/valutazione.js", () => {
  assert.match(sql, new RegExp(`v_giorni constant integer := ${VALUTAZIONE.giorniAperta};`));
  assert.match(sql, new RegExp(`v_prima constant integer := ${INCONTRO.checkinPrimaMinuti};`));
  assert.match(sql, new RegExp(`v_dopo constant integer := ${INCONTRO.checkinDopoMinuti};`));
  assert.match(sql, new RegExp(`v_controproposte constant integer := ${INCONTRO.controproposte};`));
  assert.match(sql, new RegExp(`interval '${INCONTRO.propostaOre} hours'`));
});

test("azione «valuta» solo a incontro avvenuto e senza la propria risposta", () => {
  assert.match(codice, /"valuta"/);
  assert.match(codice, /esito = 'avvenuto'/);
  assert.match(codice, /from public\.valutazioni where porta_id = p_porta and persona = p_persona/);
  // Restano tutte le azioni di prima.
  for (const a of ["proponi", "annulla_incontro", "accetto", "altra_data", "annulla", "sono_qui", "disdici"]) {
    assert.match(codice, new RegExp(`"${a}"`));
  }
});

test("funzione chiusa al telefono, mai le risposte né id verso il telefono", () => {
  assert.match(sql, /revoke all on function public\.stato_incontro\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.stato_incontro\(uuid, uuid\) to service_role/);
  assert.doesNotMatch(codice, /grant [^;]* to (anon|authenticated)/);
  assert.doesNotMatch(codice, /'(a|b|proposto_da|ritardo_di|disdetto_da|persona|valutato|presentato|foto_sue|come_in_chiamata|sicuro)',/);
});
