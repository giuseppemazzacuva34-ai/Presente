// Testi di «Lascia la stanza» cancellati 30 giorni dopo la chiusura della stanza (issue #381, spec v1 del CPO, «Dati»).
// Linea «sviluppatore-b», passo 5. Ogni ora il Worker chiama public.pulisci_testi_uscita() col ruolo di servizio.
// Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pulisciTestiUscita } from "../worker/uscite_pulizia.js";

const env = (extra = {}) => ({ ACCESSO_APP: "si", SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "chiave-finta", ...extra });

test("pulizia uscite: spenta senza ACCESSO_APP o senza Supabase, nessuna richiesta", async () => {
  let chiamate = 0;
  const f = async () => { chiamate++; return new Response("0"); };
  for (const e of [env({ ACCESSO_APP: "no" }), env({ SUPABASE_URL: "" }), env({ SUPABASE_SERVICE_ROLE_KEY: "" }), null]) {
    assert.deepEqual(await pulisciTestiUscita(e, f), { esito: "spento" });
  }
  assert.equal(chiamate, 0);
});

test("pulizia uscite: chiama la funzione del database col ruolo di servizio e dice quanti testi ha tolto", async () => {
  const viste = [];
  const f = async (url, opz) => { viste.push([url, opz]); return new Response("2", { status: 200 }); };
  assert.deepEqual(await pulisciTestiUscita(env(), f), { esito: "fatto", tolti: 2 });
  assert.equal(viste.length, 1);
  assert.equal(viste[0][0], "https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/pulisci_testi_uscita");
  assert.equal(viste[0][1].method, "POST");
  assert.equal(viste[0][1].headers.authorization, "Bearer chiave-finta");
  assert.equal(viste[0][1].body, "{}");
  assert.ok(viste[0][1].signal);
});

test("pulizia uscite: risposta strana, errore o rete assente → nessuna eccezione, si riprova al giro dopo", async () => {
  assert.deepEqual(await pulisciTestiUscita(env(), async () => new Response("\"x\"")), { esito: "fatto", tolti: 0 });
  assert.deepEqual(await pulisciTestiUscita(env(), async () => new Response("no", { status: 500 })), { esito: "errore" });
  assert.deepEqual(await pulisciTestiUscita(env(), async () => { throw new Error("rete"); }), { esito: "errore" });
});

test("pulizia uscite: nei log solo numeri, mai testi", async () => {
  const righe = [];
  const prima = [console.log, console.error];
  console.log = (...a) => righe.push(a.join(" "));
  console.error = (...a) => righe.push(a.join(" "));
  try {
    await pulisciTestiUscita(env(), async () => new Response("3"));
    await pulisciTestiUscita(env(), async () => { throw new Error("Testo segreto"); });
  } finally {
    [console.log, console.error] = prima;
  }
  assert.ok(righe.length > 0);
  assert.ok(righe.every((r) => !/segreto/i.test(r)));
});

test("pulizia uscite: il Worker la lancia ogni ora insieme agli altri lavori (aggiunta minima in index.js)", () => {
  const index = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  assert.match(index, /import \{ pulisciTestiUscita \} from "\.\/uscite_pulizia\.js";/);
  assert.match(index, /pulisciBozzeSupporto\(env\), pulisciTestiUscita\(env\)\]\)/);
});
