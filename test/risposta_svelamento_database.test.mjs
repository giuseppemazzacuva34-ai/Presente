// Passo 8b-1 dello svelamento (issue #65, regola dell'esito del CPO del 21/11; linea «sviluppatore»): sì/no segreto
// nel database. Il comportamento vero lo prova supabase/test/prova_risposta_svelamento.sql; qui solo che la migrazione
// usi gli stessi valori del codice, resti solo per il server e non faccia mai uscire le risposte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { SVELAMENTO } from "../api/svelamento.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_risposta_svelamento\.sql$/.test(n));
const codice = file ? readFileSync(new URL(file, cartella), "utf8").replace(/--.*$/gm, "") : "";

test("la migrazione esiste", () => assert.ok(file));

test("funzioni solo per il server, mai per il telefono", () => {
  for (const f of ["chiudi_porta_svelamento", "porta_da_chiudere", "rispondi_svelamento", "svelamento_di"]) {
    assert.match(codice, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`), f);
    assert.match(codice, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`), f);
  }
  assert.match(codice, /revoke all on function public\.svelamenti_risposta_ferma\(\) from public, anon, authenticated/);
  assert.doesNotMatch(codice, /to (anon|authenticated)/);
});

test("48 ore del sì/no come nel codice", () => {
  const ore = codice.match(/finito_il \+ interval '(\d+) hours'/g) ?? [];
  assert.ok(ore.length >= 4);
  for (const o of ore) assert.match(o, new RegExp(`'${SVELAMENTO.rispostaOre} hours'`));
});

test("«svelate» ed «esiti» non contengono mai le risposte né il motivo della chiusura", () => {
  const vista = codice.slice(codice.indexOf("'svelate'"));
  assert.doesNotMatch(vista, /risposta_[ab]\b(?!_il)/);
  const esiti = vista.slice(vista.indexOf("'esiti'"));
  assert.match(esiti, /case when s\.esito = 'doppio_si' then 'doppio_si' else 'chiusa' end/);
});
