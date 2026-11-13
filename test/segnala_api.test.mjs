// Richiesta del Worker POST /app/api/segnala (issue #7, passo 3, linea «sviluppatore-b»).
// Chi segnala lo dice SOLO il token. Spento finché ACCESSO_APP non vale «si». Supabase finto, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { segnalaApi, PERCORSO_SEGNALA } from "../worker/segnala_api.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const LEI = "66666666-7777-4888-9999-000000000000";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

function supabaseFinto({ utente = 200 } = {}) {
  const viste = [];
  const f = async (url) => {
    const u = new URL(url);
    viste.push(u.pathname);
    if (u.origin !== BASE) throw new Error("rete assente");
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID }) : new Response("{}", { status: utente });
    return new Response("{}", { status: 404 });
  };
  return { f, viste };
}
const finta = (esito = { ok: true, ore: 1, pericolo: true }) => {
  const ricevute = [];
  return { ricevute, segnala: async (q) => { ricevute.push(q); return esito; } };
};
function richiesta({ metodo = "POST", corpo = { contro: LEI, motivo: "insulti", origine: "scheda" }, token = TOKEN, percorso = PERCORSO_SEGNALA } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== null) headers["content-type"] = "application/json";
  return new Request(SITO + percorso, { method: metodo, headers, body: corpo === null ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
}

test("spento finché ACCESSO_APP non vale «si»: nessuna chiamata a Supabase", async () => {
  const { f, viste } = supabaseFinto();
  const op = finta();
  const r = await segnalaApi(richiesta(), { ...ENV, ACCESSO_APP: "no" }, f, op);
  assert.equal(r.status, 404);
  assert.equal(viste.length, 0);
  assert.equal(op.ricevute.length, 0);
});

test("solo POST, solo con un token valido", async () => {
  assert.equal((await segnalaApi(richiesta({ metodo: "GET", corpo: null }), ENV, supabaseFinto().f, finta())).status, 405);
  assert.equal((await segnalaApi(richiesta({ token: null }), ENV, supabaseFinto().f, finta())).status, 401);
  assert.equal((await segnalaApi(richiesta(), ENV, supabaseFinto({ utente: 401 }).f, finta())).status, 401);
});

test("chi segnala è quello del token, anche se il corpo dice altro", async () => {
  const op = finta();
  const r = await segnalaApi(richiesta({ corpo: { contro: LEI, motivo: "insulti", origine: "scheda", da: LEI } }), ENV, supabaseFinto().f, op);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, ore: 1, pericolo: true });
  assert.equal(op.ricevute[0].da, ID);
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("codici: dati sbagliati 400, database giù 503, persona sconosciuta 200 con il motivo", async () => {
  assert.equal((await segnalaApi(richiesta({ corpo: "non json" }), ENV, supabaseFinto().f, finta())).status, 400);
  assert.equal((await segnalaApi(richiesta(), ENV, supabaseFinto().f, finta({ ok: false, motivo: "dati" }))).status, 400);
  assert.equal((await segnalaApi(richiesta(), ENV, supabaseFinto().f, finta({ ok: false, motivo: "riprova" }))).status, 503);
  const r = await segnalaApi(richiesta(), ENV, supabaseFinto().f, finta({ ok: false, motivo: "persona" }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: false, motivo: "persona" });
});

test("il Worker instrada /app/api/segnala (spento senza ACCESSO_APP)", async () => {
  const r = await worker.fetch(richiesta(), { ...ENV, ACCESSO_APP: "no" }, {});
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { ok: false, motivo: "spento" });
});
