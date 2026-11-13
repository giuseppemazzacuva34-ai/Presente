// La sera delle porte nel Worker (issue #5, spec v1.1 del CPO): alle 21:00 di Roma della domenica il lavoro
// programmato chiede al database di aprire le porte (public.apri_porte, solo ruolo di servizio). Linea «sviluppatore-c».
// Spento finché ACCESSO_APP non vale «si». Nei log solo numeri. Nessun dato reale: fetch finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apriPorteDellaSera } from "../worker/sera_porte.js";

const env = (accesso = "si") => ({ ACCESSO_APP: accesso, SUPABASE_URL: "https://prova.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "chiave-finta" });

test("spento finché ACCESSO_APP non vale «si»: nessuna richiesta", async () => {
  let chiamate = 0;
  const esito = await apriPorteDellaSera(env("no"), async () => { chiamate++; return new Response("{}"); });
  assert.deepEqual(esito, { esito: "spento" });
  assert.equal(chiamate, 0);
});

test("senza Supabase configurato non fa nulla", async () => {
  const esito = await apriPorteDellaSera({ ACCESSO_APP: "si" }, async () => { throw new Error("non doveva partire"); });
  assert.deepEqual(esito, { esito: "spento" });
});

test("acceso: chiama apri_porte con la chiave del server e restituisce solo numeri", async () => {
  let vista;
  const f = async (url, opzioni) => {
    vista = { url, opzioni };
    return new Response(JSON.stringify({ stanze: 2, chiavi_date: 14, porte_aperte: 4 }), { status: 200 });
  };
  const esito = await apriPorteDellaSera(env(), f);
  assert.equal(vista.url, "https://prova.supabase.co/rest/v1/rpc/apri_porte");
  assert.equal(vista.opzioni.method, "POST");
  assert.equal(vista.opzioni.headers.apikey, "chiave-finta");
  assert.equal(vista.opzioni.headers.authorization, "Bearer chiave-finta");
  assert.deepEqual(esito, { esito: "fatto", stanze: 2, chiavi_date: 14, porte_aperte: 4 });
});

test("risposta strana: tiene solo i tre numeri", async () => {
  const f = async () => new Response(JSON.stringify({ stanze: "1", porte_aperte: 1, chi: "qualcuno" }), { status: 200 });
  assert.deepEqual(await apriPorteDellaSera(env(), f), { esito: "fatto", stanze: 1, chiavi_date: 0, porte_aperte: 1 });
});

test("database che risponde male o non risponde: nessuna eccezione, si riprova al giro dopo", async () => {
  assert.deepEqual(await apriPorteDellaSera(env(), async () => new Response("no", { status: 500 })), { esito: "errore" });
  assert.deepEqual(await apriPorteDellaSera(env(), async () => { throw new Error("rete"); }), { esito: "errore" });
});

test("il lavoro programmato apre le porte, anche alle 21:00 di Roma della domenica (estate e inverno)", () => {
  const indice = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  assert.match(indice, /apriPorteDellaSera\(env\)/);
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /"0 19,20 \* \* SUN"/);
  assert.match(config, /"23 \* \* \* \*"/);
});
