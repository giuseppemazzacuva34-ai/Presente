// Richiesta del Worker GET /app/api/filo/porte (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 6b della linea
// «sviluppatore-c»: chi è nella stanza legge il numero delle porte aperte per la schermata 36, dalle 21:00 di domenica
// per un giorno. Chi è lo dice SOLO il token; se e quale numero lo decide il database (porte_stanza_membro,
// migrazione 20261123215547: niente se la stanza non ha Filo, se le porte non sono ancora aperte, a sospesi o usciti).
// Mai chi: solo stanza e numero. Spento finché ACCESSO_APP non vale «si». Supabase finto, nessuna rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filoPorteApi, PERCORSO_FILO_PORTE } from "../worker/filo_porte_api.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const STANZA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

function supabaseFinto({ utente = 200, righe = [{ stanza_id: STANZA, porte: 3 }], rpcStato = 200 } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    const corpo = typeof opzioni.body === "string" ? JSON.parse(opzioni.body) : opzioni.body;
    viste.push({ percorso: u.pathname, metodo: opzioni.method || "GET", headers: opzioni.headers || {}, corpo });
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID }) : new Response("{}", { status: utente });
    if (u.pathname === "/rest/v1/rpc/porte_stanza_membro") return rpcStato === 200 ? Response.json(righe) : new Response("{}", { status: rpcStato });
    return new Response("{}", { status: 404 });
  };
  return { f, viste, dove: (p) => viste.filter((v) => v.percorso.startsWith(p)) };
}

const richiesta = ({ metodo = "GET", token = TOKEN, query = "" } = {}) =>
  new Request(`${SITO}${PERCORSO_FILO_PORTE}${query}`, { method: metodo, headers: token ? { authorization: `Bearer ${token}` } : {} });

test("percorso: /app/api/filo/porte", () => assert.equal(PERCORSO_FILO_PORTE, "/app/api/filo/porte"));

test("spento finché ACCESSO_APP non vale «si»: 404 e nessuna chiamata a Supabase", async () => {
  for (const valore of [undefined, "", "no", "tester", "SI"]) {
    const s = supabaseFinto();
    const r = await filoPorteApi(richiesta(), { ...ENV, ACCESSO_APP: valore }, s.f);
    assert.equal(r.status, 404, String(valore));
    assert.equal(s.viste.length, 0);
  }
});

test("solo GET: 405 con allow", async () => {
  const r = await filoPorteApi(richiesta({ metodo: "POST" }), ENV, supabaseFinto().f);
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "GET");
});

test("senza token o con token rifiutato: 401, il database non si interroga", async () => {
  const s = supabaseFinto();
  assert.equal((await filoPorteApi(richiesta({ token: null }), ENV, s.f)).status, 401);
  const s2 = supabaseFinto({ utente: 401 });
  assert.equal((await filoPorteApi(richiesta(), ENV, s2.f)).status, 401);
  assert.equal(s.dove("/rest/").length + s2.dove("/rest/").length, 0);
});

test("il numero della stanza: solo stanza e numero, chi lo dice il token", async () => {
  const s = supabaseFinto();
  const r = await filoPorteApi(richiesta({ query: `?utente=99999999-2222-4333-8444-555555555555` }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, porte: { stanza: STANZA, numero: 3 } });
  const [rpc] = s.dove("/rest/v1/rpc/porte_stanza_membro");
  assert.equal(rpc.metodo, "POST");
  assert.equal(rpc.headers.apikey, "chiave-server-finta");
  assert.equal(rpc.corpo.p_utente, ID, "l'utente scritto nella richiesta non conta");
  assert.ok(!Number.isNaN(Date.parse(rpc.corpo.p_ora)));
});

test("zero porte è un numero, non «niente»", async () => {
  const r = await filoPorteApi(richiesta(), ENV, supabaseFinto({ righe: [{ stanza_id: STANZA, porte: 0 }] }).f);
  assert.deepEqual(await r.json(), { ok: true, porte: { stanza: STANZA, numero: 0 } });
});

test("niente riga (stanza senza Filo, prima delle 21, sospeso): porte null → la schermata 36 non compare", async () => {
  const r = await filoPorteApi(richiesta(), ENV, supabaseFinto({ righe: [] }).f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, porte: null });
});

test("risposta strana o database giù: 503 riprova, mai un numero inventato", async () => {
  for (const righe of [{}, [{ stanza_id: "x", porte: 3 }], [{ stanza_id: STANZA, porte: -1 }], [{ stanza_id: STANZA, porte: "3" }], [{ stanza_id: STANZA, porte: null }]]) {
    const r = await filoPorteApi(richiesta(), ENV, supabaseFinto({ righe }).f);
    assert.equal(r.status, 503, JSON.stringify(righe));
  }
  const r = await filoPorteApi(richiesta(), ENV, supabaseFinto({ rpcStato: 500 }).f);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { ok: false, motivo: "riprova" });
});

test("troppe richieste: 429", async () => {
  const env = { ...ENV, LIMITE_PROVINCIA: { limit: async () => ({ success: false }) } };
  assert.equal((await filoPorteApi(richiesta(), env, supabaseFinto().f)).status, 429);
});

test("il Worker instrada /app/api/filo/porte (spento senza ACCESSO_APP)", async () => {
  const r = await worker.fetch(richiesta(), { ASSETS: { fetch: async () => new Response("asset") } }, { waitUntil() {} });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { ok: false, motivo: "spento" });
});
