// Richiesta del Worker /app/api/filo (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 3b della linea «sviluppatore-c»:
// il pannello del Filo. Chi è il Filo lo dice SOLO il token; le stanze e i nomi li decide il database.
// Spento finché ACCESSO_APP non vale «si». Supabase finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filoApi, PERCORSO_FILO } from "../worker/filo_api.js";
import { REGOLE_FILO } from "../api/filo.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const ALTRO = "66666666-7777-4888-9999-000000000000";
const STANZA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const RIGA = { id: STANZA, nome: "Stanza 1", apre_il: "2026-11-30T08:00:00+00:00", chiude_il: "2026-12-07T08:00:00+00:00" };

function supabaseFinto({ utente = 200, rpc = {} } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID }) : new Response("{}", { status: utente });
    const nome = u.pathname.replace("/rest/v1/rpc/", "");
    if (nome in rpc) return rpc[nome] instanceof Response ? rpc[nome] : Response.json(rpc[nome]);
    return new Response("{}", { status: 404 });
  };
  return { f, viste, rpc: (nome) => viste.filter((v) => v.percorso === `/rest/v1/rpc/${nome}`) };
}
function richiesta({ metodo = "GET", token = TOKEN, percorso = PERCORSO_FILO, query = "" } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(SITO + percorso + query, { method: metodo, headers });
}

test("percorso: /app/api/filo", () => {
  assert.equal(PERCORSO_FILO, "/app/api/filo");
});

test("spento finché ACCESSO_APP non vale «si»: 404 e nessuna chiamata a Supabase", async () => {
  const s = supabaseFinto();
  const r = await filoApi(richiesta(), { ...ENV, ACCESSO_APP: "no" }, s.f);
  assert.equal(r.status, 404);
  assert.equal(s.viste.length, 0);
});

test("senza token valido niente: 401", async () => {
  assert.equal((await filoApi(richiesta({ token: null }), ENV, supabaseFinto().f)).status, 401);
  assert.equal((await filoApi(richiesta(), ENV, supabaseFinto({ utente: 401 }).f)).status, 401);
});

test("metodi diversi da GET: 405 con allow", async () => {
  const r = await filoApi(richiesta({ metodo: "DELETE" }), ENV, supabaseFinto().f);
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "GET");
});

test("GET: pannello con le stanze del Filo e i soli nomi di battesimo; il Filo è quello del token", async () => {
  const s = supabaseFinto({ rpc: { stanze_del_filo: [RIGA], nomi_stanza_filo: [{ nome: "Anna" }, { nome: "Luca" }], porte_stanza_filo: 2 } });
  const r = await filoApi(richiesta({ query: `?filo=${ALTRO}` }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), {
    ok: true, regole: REGOLE_FILO,
    stanze: [{ id: STANZA, nome: "Stanza 1", apreIl: RIGA.apre_il, chiudeIl: RIGA.chiude_il, nomi: ["Anna", "Luca"], porte: 2 }],
  });
  assert.deepEqual({ ...s.rpc("porte_stanza_filo")[0].corpo, p_ora: "x" }, { p_filo: ID, p_stanza: STANZA, p_ora: "x" });
  const [chiamata] = s.rpc("stanze_del_filo");
  assert.equal(chiamata.corpo.p_filo, ID, "un «filo» scritto nella richiesta non conta");
  assert.ok(!Number.isNaN(Date.parse(chiamata.corpo.p_ora)));
  assert.deepEqual({ ...s.rpc("nomi_stanza_filo")[0].corpo, p_ora: "x" }, { p_filo: ID, p_stanza: STANZA, p_ora: "x" });
});

test("chi non è Filo vede un pannello vuoto (nessuna stanza), mai dati di altri", async () => {
  const s = supabaseFinto({ rpc: { stanze_del_filo: [] } });
  const r = await filoApi(richiesta(), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, regole: REGOLE_FILO, stanze: [] });
  assert.equal(s.rpc("nomi_stanza_filo").length, 0);
});

test("database che non risponde: 503 «riprova», mai un pannello inventato", async () => {
  const s = supabaseFinto({ rpc: { stanze_del_filo: new Response("{}", { status: 500 }) } });
  const r = await filoApi(richiesta(), ENV, s.f);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { ok: false, motivo: "riprova" });
});

test("il Worker instrada /app/api/filo (spento senza ACCESSO_APP)", async () => {
  const r = await worker.fetch(new Request(SITO + PERCORSO_FILO), { ACCESSO_APP: "no", ASSETS: { fetch: () => new Response("pagina") } }, { waitUntil() {} });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { ok: false, motivo: "spento" });
});
