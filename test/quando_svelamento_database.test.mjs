// «Quando» dello svelamento (issue #65 passo 5a, linea «sviluppatore»): funzioni chiuse al telefono, le fasce
// dell'altra persona non escono mai, valori uguali a api/svelamento.js. Si legge solo il testo della migrazione; il
// comportamento vero lo prova supabase/test/prova_quando_svelamento.sql su un Postgres di prova.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { SVELAMENTO } from "../api/svelamento.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_quando_svelamento\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const codice = sql.replace(/--.*$/gm, "");

test("la migrazione di «Quando» esiste", () => assert.ok(file));

test("funzioni solo per il server, mai per il telefono", () => {
  for (const f of ["porta_aperta_per", "pronto_svelamento", "fasce_svelamento", "svelamento_di"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`), f);
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`), f);
  }
  assert.doesNotMatch(codice, /to (anon|authenticated)/);
});

test("stessi valori di api/svelamento.js: 5 minuti per «pronto», 3 fasce da 30 minuti, 48 ore", () => {
  assert.equal(SVELAMENTO.attesaOraMinuti, 5);
  assert.equal(SVELAMENTO.maxFasce, 3);
  assert.equal(SVELAMENTO.fasciaMinuti, 30);
  assert.match(codice, new RegExp(`interval '${SVELAMENTO.attesaOraMinuti} minutes'`));
  assert.match(codice, new RegExp(`cardinality\\(p_fasce\\) > ${SVELAMENTO.maxFasce}`));
  assert.match(codice, new RegExp(`mod\\(extract\\(epoch from f\\), ${SVELAMENTO.fasciaMinuti * 60}\\)`));
  assert.match(codice, new RegExp(`interval '${SVELAMENTO.finestraOre} hours'`));
});

test("allo stato vanno solo le proprie fasce e la fascia fissata, mai quelle dell'altra persona", () => {
  const stato = codice.slice(codice.indexOf("create or replace function public.svelamento_di"));
  for (const campo of ["mie_fasce", "fascia_fissata", "mio_pronto", "suo_pronto", "pronto_scade_il", "mia_scelta"]) assert.match(stato, new RegExp(`'${campo}'`));
  assert.doesNotMatch(stato, /'sue_fasce'|'fasce_a'|'fasce_b'|'sua_scelta'|'email'|'data_nascita'|'risposta/);
});

test("«pronto» solo con la caparra di entrambi; nessuna penale", () => {
  const pronto = codice.slice(codice.indexOf("create function public.pronto_svelamento"), codice.indexOf("create function public.fasce_svelamento"));
  assert.match(pronto, /caparra_a_il is null or v_s\.caparra_b_il is null/);
  assert.doesNotMatch(codice, /penale|buca/i);
});
