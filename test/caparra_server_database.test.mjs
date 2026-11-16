// Caparra dal server (issue #65 passo 4a, linea «sviluppatore»): le funzioni sono chiuse al telefono e restituiscono
// i crediti senza penali. Si legge solo il testo della migrazione; il comportamento vero lo prova
// supabase/test/prova_caparra_server.sql su un Postgres di prova.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { SVELAMENTO } from "../api/svelamento.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_caparra_server\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const codice = sql.replace(/--.*$/gm, "");

test("la migrazione della caparra dal server esiste", () => assert.ok(file));

test("funzioni solo per il server, mai per il telefono", () => {
  for (const f of ["chiudi_porta_svelamento", "porta_da_chiudere", "caparra_svelamento", "svelamento_di"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`), f);
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`), f);
  }
  assert.doesNotMatch(codice, /to (anon|authenticated)/);
});

test("scadenza uguale a api/svelamento.js (48 ore dall'apertura)", () => {
  assert.equal(SVELAMENTO.finestraOre, 48);
  assert.match(codice, new RegExp(`interval '${SVELAMENTO.finestraOre} hours'`));
});

test("allo stato vanno solo nome ed età: mai email, data di nascita, frasi o risposte", () => {
  const stato = codice.slice(codice.indexOf("create function public.svelamento_di"));
  assert.doesNotMatch(stato, /'email'|'data_nascita'|frase_di|'risposta/);
});

test("nessuna penale: le chiusure restituiscono soltanto", () => {
  assert.doesNotMatch(codice, /penale|buca/i);
  assert.match(codice, /perform public\.restituisci_caparre\(p_porta\)/);
});
