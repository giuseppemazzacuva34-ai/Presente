// Passo 8a dello svelamento (issue #65, linea «sviluppatore»): fine del video nel database, ritorno al passo 4,
// svelamenti fermi, porte svelate in svelamento_di. Il comportamento vero lo prova supabase/test/prova_fine_svelamento.sql;
// qui solo che la migrazione usi gli stessi valori del codice e resti solo per il server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { SVELAMENTO } from "../api/svelamento.js";
import { SCADENZA_MS } from "../api/svelamento_do.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_fine_svelamento\.sql$/.test(n));
const codice = file ? readFileSync(new URL(file, cartella), "utf8").replace(/--.*$/gm, "") : "";

test("la migrazione esiste", () => assert.ok(file));

test("funzioni solo per il server, mai per il telefono", () => {
  for (const f of ["svelamento_fermo", "rimetti_a_quando", "svelamento_in_corso", "fine_svelamento", "torna_a_quando", "entra_svelamento", "svelamento_di"]) {
    assert.match(codice, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`), f);
    assert.match(codice, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`), f);
  }
  assert.doesNotMatch(codice, /to (anon|authenticated)/);
});

test("stessi valori del codice: svelamento fermo dopo SCADENZA_MS, 10 secondi, 48 ore per il sì/no", () => {
  const fermo = codice.slice(codice.indexOf("create function public.svelamento_fermo"), codice.indexOf("create function public.rimetti_a_quando"));
  assert.match(fermo, new RegExp(`interval '${SCADENZA_MS / 60000} minutes'`));
  const fine = codice.slice(codice.indexOf("create function public.fine_svelamento"), codice.indexOf("create function public.torna_a_quando"));
  assert.match(fine, new RegExp(`interval '${SVELAMENTO.durata} seconds'`));
  assert.match(fine, new RegExp(`then ${SVELAMENTO.durata} else 0`));
  assert.match(codice, new RegExp(`'risposta_scade_il', s\\.finito_il \\+ interval '${SVELAMENTO.rispostaOre} hours'`));
});

test("«svelate» non contiene mai le risposte sì/no, solo se ho risposto", () => {
  const svelate = codice.slice(codice.indexOf("'svelate'"));
  assert.match(svelate, /'ho_risposto', \(case when p\.a = p_utente then s\.risposta_a else s\.risposta_b end\) is not null/);
  assert.doesNotMatch(svelate.replace(/'ho_risposto'[^\n]*/, ""), /risposta_[ab]\b/);
});
