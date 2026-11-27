// «Cambia luogo» nel database (issue #6, spec v1 del CPO del 3/11, «Casi limite»): stesso limite di api/incontro.js
// (fino a 1 ora prima), funzioni e tabella chiuse al telefono, stato senza l'id di chi ha chiesto il cambio. Si legge
// solo il testo della migrazione; il comportamento vero lo prova supabase/test/prova_cambia_luogo.sql.
// Linea «sviluppatore-b».
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { INCONTRO } from "../api/incontro.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_cambia_luogo\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const codice = sql.replace(/--.*$/gm, "");

test("la migrazione di «Cambia luogo» esiste", () => assert.ok(file, "manca supabase/migrations/*_cambia_luogo.sql"));

test("limite uguale a api/incontro.js: fino a 1 ora prima", () => {
  assert.equal(INCONTRO.cambioLuogoPrimaMinuti, 60);
  assert.match(codice, new RegExp(`v_prima_cambio constant integer := ${INCONTRO.cambioLuogoPrimaMinuti};`));
});

test("tabella con regole per riga e chiusa al telefono", () => {
  assert.match(codice, /alter table public\.cambi_luogo enable row level security/);
  assert.match(codice, /revoke all on public\.cambi_luogo from public, anon, authenticated/);
});

test("funzioni chiuse al telefono, solo il server", () => {
  for (const firma of ["cambia_luogo\\(uuid, uuid, text, text\\)", "rispondi_cambio_luogo\\(uuid, uuid, text\\)",
                       "stato_incontro\\(uuid, uuid\\)"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${firma} from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${firma} to service_role`));
  }
  assert.doesNotMatch(codice, /grant [^;]* to (anon|authenticated)/);
});

test("lo stato dice solo se la richiesta è mia, mai chi l'ha chiesta", () => {
  assert.match(codice, /'mio', /);
  assert.doesNotMatch(codice, /'proposto_da', v_c/);
});

test("lo stato tiene tutto quello che c'era (ritardo, disdetta, valutazione)", () => {
  for (const chiave of ["'ritardo_mio'", "'disdetta'", "\"valuta\"", "\"sono_qui\"", "\"disdici\"", "\"ritardo\"", "'segnale'"]) {
    assert.ok(codice.includes(chiave), `manca ${chiave}`);
  }
});

test("nessun SQL distruttivo", () => {
  assert.doesNotMatch(codice, /\bdrop\s+(table|function)\b|\btruncate\b|\bdelete\s+from\b/i);
});
