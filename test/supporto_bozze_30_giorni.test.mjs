// Bozze di «Scrivici» cancellate 30 giorni dopo la risposta (issue #10, parte B v1 del CPO, «Conservazione»; D122 B).
// Linea «sviluppatore-c». Ogni ora il Worker chiama public.pulisci_bozze_supporto() col ruolo di servizio. Rete finta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pulisciBozzeSupporto } from "../worker/bozze_supporto.js";

const env = (extra = {}) => ({ ACCESSO_APP: "si", SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "chiave-finta", ...extra });

test("spento senza ACCESSO_APP o senza Supabase: nessuna richiesta", async () => {
  let chiamate = 0;
  const f = async () => { chiamate++; return new Response("0"); };
  for (const e of [env({ ACCESSO_APP: "no" }), env({ SUPABASE_URL: "" }), env({ SUPABASE_SERVICE_ROLE_KEY: "" }), null]) {
    assert.deepEqual(await pulisciBozzeSupporto(e, f), { esito: "spento" });
  }
  assert.equal(chiamate, 0);
});

test("chiama la funzione del database col ruolo di servizio e restituisce quante bozze ha tolto", async () => {
  const viste = [];
  const f = async (url, opz) => { viste.push([url, opz]); return new Response("3", { status: 200 }); };
  assert.deepEqual(await pulisciBozzeSupporto(env(), f), { esito: "fatto", tolte: 3 });
  assert.equal(viste.length, 1);
  assert.equal(viste[0][0], "https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/pulisci_bozze_supporto");
  assert.equal(viste[0][1].method, "POST");
  assert.equal(viste[0][1].headers.authorization, "Bearer chiave-finta");
  assert.equal(viste[0][1].body, "{}");
  assert.ok(viste[0][1].signal);
});

test("risposta strana, errore o rete assente: nessuna eccezione, si riprova al giro dopo", async () => {
  assert.deepEqual(await pulisciBozzeSupporto(env(), async () => new Response("\"x\"")), { esito: "fatto", tolte: 0 });
  assert.deepEqual(await pulisciBozzeSupporto(env(), async () => new Response("no", { status: 500 })), { esito: "errore" });
  assert.deepEqual(await pulisciBozzeSupporto(env(), async () => { throw new Error("rete"); }), { esito: "errore" });
});

test("nei log solo numeri, mai testi", async () => {
  const righe = [];
  const prima = [console.log, console.error];
  console.log = (...a) => righe.push(a.join(" "));
  console.error = (...a) => righe.push(a.join(" "));
  try {
    await pulisciBozzeSupporto(env(), async () => new Response("2"));
    await pulisciBozzeSupporto(env(), async () => new Response("Ciao segreto", { status: 500 }));
  } finally {
    [console.log, console.error] = prima;
  }
  assert.ok(righe.every((r) => !/segreto|Ciao/.test(r)));
});

test("il lavoro di ogni ora pulisce anche le bozze", () => {
  const indice = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  assert.match(indice, /pulisciBozzeSupporto\(env\)/);
});
