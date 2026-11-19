// Stato dell'incontro con check-in e segnale nel database (issue #6 passo 2h, spec v1 del CPO del 3/11, punto 6):
// stessa finestra di api/incontro.js, funzione chiusa al telefono, mai id né posizioni. Si legge solo il testo della
// migrazione; il comportamento vero lo prova supabase/test/prova_stato_checkin.sql. Linea «sviluppatore-b».
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { INCONTRO } from "../api/incontro.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_stato_checkin\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const codice = sql.replace(/--.*$/gm, "");

test("la migrazione dello stato con il check-in esiste", () => assert.ok(file, "manca supabase/migrations/*_stato_checkin.sql"));

test("valori uguali a api/incontro.js: finestra 30 + 30, 3 controproposte, 48 ore", () => {
  assert.match(sql, new RegExp(`v_prima constant integer := ${INCONTRO.checkinPrimaMinuti};`));
  assert.match(sql, new RegExp(`v_dopo constant integer := ${INCONTRO.checkinDopoMinuti};`));
  assert.match(sql, new RegExp(`v_controproposte constant integer := ${INCONTRO.controproposte};`));
  assert.match(sql, new RegExp(`interval '${INCONTRO.propostaOre} hours'`));
});

test("nuovi campi per il telefono: check-in mio e dell'altro, finestra, segnale", () => {
  for (const campo of ["checkin_mio", "checkin_altro", "checkin_da", "checkin_fino", "segnale"]) assert.match(codice, new RegExp(`'${campo}',`));
});

test("funzione chiusa al telefono, mai id né posizioni, nessun SQL distruttivo", () => {
  assert.match(sql, /revoke all on function public\.stato_incontro\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.stato_incontro\(uuid, uuid\) to service_role/);
  assert.doesNotMatch(codice, /grant [^;]* to (anon|authenticated)/);
  assert.doesNotMatch(codice, /'(a|b|proposto_da|ritardo_di|persona|posizione|gps)',/);
  assert.doesNotMatch(codice, /\bdrop\s+(table|function)\b|\btruncate\b|\bdelete\s+from\b/i);
});
