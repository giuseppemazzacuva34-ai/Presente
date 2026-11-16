// Richieste del Worker per il pannello di chi decide (issue #7, «Cosa vede chi decide»; linea «sviluppatore-b», passo 13b).
// Chi decide lo dice SOLO il token + la tabella moderatori. Spento finché ACCESSO_APP non vale «si». Supabase finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pannelloApi, PERCORSO_PANNELLO, AZIONI } from "../worker/pannello_api.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const SEG = "66666666-7777-4888-9999-000000000000";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

function supabaseFinto({ utente = 200 } = {}) {
  const viste = [];
  const f = async (url) => {
    const u = new URL(url);
    viste.push(u.pathname);
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID }) : new Response("{}", { status: utente });
    return new Response("{}", { status: 404 });
  };
  return { f, viste };
}
function finta({ moderatore = true, coda = [{ id: SEG }], scheda = { segnalazione: { id: SEG } }, decidi = { ok: true, sanzione: null } } = {}) {
  const chiamate = [];
  return {
    chiamate,
    eModeratore: async (id) => { chiamate.push(["eModeratore", id]); return moderatore; },
    coda: async (id) => { chiamate.push(["coda", id]); return coda; },
    scheda: async (q) => { chiamate.push(["scheda", q]); return scheda; },
    decidi: async (q) => { chiamate.push(["decidi", q]); return decidi; },
  };
}
function richiesta(percorso, { metodo = "POST", corpo = {}, token = TOKEN } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== null) headers["content-type"] = "application/json";
  return new Request(SITO + PERCORSO_PANNELLO + percorso, { method: metodo, headers, body: corpo === null ? undefined : JSON.stringify(corpo) });
}

test("spento finché ACCESSO_APP non vale «si»: nessuna chiamata a Supabase", async () => {
  const { f, viste } = supabaseFinto();
  const op = finta();
  const r = await pannelloApi(richiesta("/coda", { metodo: "GET", corpo: null }), { ...ENV, ACCESSO_APP: "no" }, f, op);
  assert.equal(r.status, 404);
  assert.equal(viste.length + op.chiamate.length, 0);
});

test("serve un token valido", async () => {
  assert.equal((await pannelloApi(richiesta("/coda", { metodo: "GET", corpo: null, token: null }), ENV, supabaseFinto().f, finta())).status, 401);
  assert.equal((await pannelloApi(richiesta("/coda", { metodo: "GET", corpo: null }), ENV, supabaseFinto({ utente: 401 }).f, finta())).status, 401);
});

test("chi non è moderatore riceve 403 e non legge nulla", async () => {
  const op = finta({ moderatore: false });
  const r = await pannelloApi(richiesta("/coda", { metodo: "GET", corpo: null }), ENV, supabaseFinto().f, op);
  assert.equal(r.status, 403);
  assert.deepEqual(op.chiamate.map((c) => c[0]), ["eModeratore"]);
});

test("coda: GET con l'id del token", async () => {
  const op = finta();
  const r = await pannelloApi(richiesta("/coda", { metodo: "GET", corpo: null }), ENV, supabaseFinto().f, op);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, coda: [{ id: SEG }] });
  assert.deepEqual(op.chiamate[1], ["coda", ID]);
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("scheda: POST con l'id della segnalazione; id sbagliato → 400", async () => {
  const op = finta();
  const r = await pannelloApi(richiesta("/scheda", { corpo: { id: SEG } }), ENV, supabaseFinto().f, op);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, scheda: { segnalazione: { id: SEG } } });
  assert.deepEqual(op.chiamate[1], ["scheda", { moderatore: ID, segnalazione: SEG }]);
  assert.equal((await pannelloApi(richiesta("/scheda", { corpo: { id: "x" } }), ENV, supabaseFinto().f, finta())).status, 400);
  assert.equal((await pannelloApi(richiesta("/scheda", { metodo: "GET", corpo: null }), ENV, supabaseFinto().f, finta())).status, 405);
});

test("decidi: azioni della spec, motivo obbligatorio, regola per le sanzioni", async () => {
  assert.deepEqual([...AZIONI], ["archivia", "avviso", "sospensione_7", "sospensione_30", "esclusione", "togli_cautelare"]);
  const op = finta();
  const buona = { id: SEG, azione: "sospensione_7", regola: "soldi", testo: "chiedeva regali", moderatore: SEG };
  const r = await pannelloApi(richiesta("/decidi", { corpo: buona }), ENV, supabaseFinto().f, op);
  assert.equal(r.status, 200);
  // Chi decide è sempre quello del token, mai un campo del corpo.
  assert.deepEqual(op.chiamate[1], ["decidi", { moderatore: ID, segnalazione: SEG, azione: "sospensione_7", regola: "soldi", testo: "chiedeva regali" }]);
  for (const sbagliata of [
    { ...buona, azione: "banna" },
    { ...buona, testo: "   " },
    { ...buona, testo: "a".repeat(2001) },
    { ...buona, regola: "" },
    { ...buona, regola: "r".repeat(101) },
  ]) {
    assert.equal((await pannelloApi(richiesta("/decidi", { corpo: sbagliata }), ENV, supabaseFinto().f, finta())).status, 400, JSON.stringify(sbagliata).slice(0, 60));
  }
  // Archiviare non chiede la regola.
  assert.equal((await pannelloApi(richiesta("/decidi", { corpo: { id: SEG, azione: "archivia", testo: "nessuna violazione" } }), ENV, supabaseFinto().f, finta())).status, 200);
});

test("errore del database → 503 riprova; percorso sconosciuto → 404", async () => {
  const r = await pannelloApi(richiesta("/coda", { metodo: "GET", corpo: null }), ENV, supabaseFinto().f, finta({ coda: null }));
  assert.equal(r.status, 503);
  assert.equal((await pannelloApi(richiesta("/altro", { metodo: "GET", corpo: null }), ENV, supabaseFinto().f, finta())).status, 404);
});

test("il Worker manda /app/api/pannello/* al pannello", async () => {
  const { default: worker } = await import("../worker/index.js");
  const r = await worker.fetch(new Request(SITO + PERCORSO_PANNELLO + "/coda"), { ...ENV, ACCESSO_APP: "no", ASSETS: { fetch: async () => new Response("pagina") } }, { waitUntil() {} });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { ok: false, motivo: "spento" });
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("database vero (finto): chiama solo le funzioni del pannello con la chiave del server", async () => {
  const chieste = [];
  const f = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID });
    chieste.push([u.pathname, JSON.parse(init.body || "{}"), init.headers?.authorization]);
    if (u.pathname === "/rest/v1/rpc/e_moderatore") return Response.json(true);
    if (u.pathname === "/rest/v1/rpc/coda_moderazione") return Response.json([{ id: SEG, ore: 1, sospeso: true }]);
    if (u.pathname === "/rest/v1/rpc/decidi_segnalazione") return Response.json({ message: "Segnalazione già decisa." }, { status: 400 });
    return new Response("{}", { status: 404 });
  };
  const coda = await pannelloApi(richiesta("/coda", { metodo: "GET", corpo: null }), ENV, f);
  // «sospeso» diventa «in_sospensione»: il codice del browser non contiene la parola (controllo di scripts/test_worker.mjs).
  assert.deepEqual(await coda.json(), { ok: true, coda: [{ id: SEG, ore: 1, in_sospensione: true }] });
  assert.deepEqual(chieste.slice(0, 2).map((c) => c.slice(0, 2)), [["/rest/v1/rpc/e_moderatore", { p_persona: ID }], ["/rest/v1/rpc/coda_moderazione", { p_moderatore: ID }]]);
  assert.equal(chieste[0][2], "Bearer chiave-server-finta");
  const decisa = await pannelloApi(richiesta("/decidi", { corpo: { id: SEG, azione: "archivia", testo: "niente" } }), ENV, f);
  assert.deepEqual(await decisa.json(), { ok: false, motivo: "rifiutata" });
});
