// Lavoro programmato che chiude gli incontri finiti (issue #6, buca e «nessun check-in»; D12 A) · «sviluppatore-b», passo 2k.
// Ogni ora il Worker chiama public.chiudi_incontri_finiti() (migrazione *_buca_incontro.sql) col ruolo di servizio.
// Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chiudiIncontriFiniti } from "../worker/incontri_finiti.js";

const env = (extra = {}) => ({ ACCESSO_APP: "si", SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "chiave-finta", ...extra });

test("spento senza ACCESSO_APP o senza Supabase: nessuna richiesta", async () => {
  let chiamate = 0;
  const f = async () => { chiamate++; return new Response("0"); };
  for (const e of [env({ ACCESSO_APP: "no" }), env({ SUPABASE_URL: "" }), env({ SUPABASE_SERVICE_ROLE_KEY: "" }), null]) {
    assert.deepEqual(await chiudiIncontriFiniti(e, f), { esito: "spento" });
  }
  assert.equal(chiamate, 0);
});

test("chiama la funzione del database col ruolo di servizio e restituisce quanti ne ha chiusi", async () => {
  const viste = [];
  const f = async (url, opz) => { viste.push([url, opz]); return new Response("2", { status: 200 }); };
  assert.deepEqual(await chiudiIncontriFiniti(env(), f), { esito: "fatto", chiusi: 2 });
  assert.equal(viste.length, 1);
  assert.equal(viste[0][0], "https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/chiudi_incontri_finiti");
  assert.equal(viste[0][1].method, "POST");
  assert.equal(viste[0][1].headers.authorization, "Bearer chiave-finta");
  assert.equal(viste[0][1].body, "{}");
  assert.ok(viste[0][1].signal);
});

test("risposta strana, errore o rete assente: nessuna eccezione, si riprova al giro dopo", async () => {
  assert.deepEqual(await chiudiIncontriFiniti(env(), async () => new Response("\"x\"")), { esito: "fatto", chiusi: 0 });
  assert.deepEqual(await chiudiIncontriFiniti(env(), async () => new Response("no", { status: 500 })), { esito: "errore" });
  assert.deepEqual(await chiudiIncontriFiniti(env(), async () => { throw new Error("rete"); }), { esito: "errore" });
});

test("il lavoro di ogni ora chiude anche gli incontri finiti", () => {
  const indice = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  assert.match(indice, /chiudiIncontriFiniti\(env\)/);
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /"23 \* \* \* \*"/);
});
