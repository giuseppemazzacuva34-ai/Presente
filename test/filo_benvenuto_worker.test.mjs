// Richieste del Worker per la schermata 18 «Il Filo apre la stanza» (issue #360, spec v1 + v1.1 del CPO, D151 A),
// passo 8b della linea «sviluppatore-c».
//   GET  /app/api/filo/benvenuto → { ok, benvenuto: { stanza, filo, visto } | null }
//   POST /app/api/filo/benvenuto { stanza } → { ok, segnato } (la schermata 18 si vede una volta a settimana)
// Chi è lo dice SOLO il token; cosa c'è lo decide il database (filo_stanza_membro, segna_benvenuto_filo, migrazione
// 20261124100411). Spento finché ACCESSO_APP non vale «si». Supabase finto, nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filoBenvenutoApi, PERCORSO_FILO_BENVENUTO } from "../worker/filo_benvenuto_api.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const STANZA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

function supabaseFinto({ utente = 200, righe = [{ stanza_id: STANZA, filo_nome: "Valentina", visto: false }], segna = true, rpcStato = 200 } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    const corpo = typeof opzioni.body === "string" ? JSON.parse(opzioni.body) : opzioni.body;
    viste.push({ percorso: u.pathname, metodo: opzioni.method || "GET", headers: opzioni.headers || {}, corpo });
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID }) : new Response("{}", { status: utente });
    if (rpcStato !== 200) return new Response("{}", { status: rpcStato });
    if (u.pathname === "/rest/v1/rpc/filo_stanza_membro") return Response.json(righe);
    if (u.pathname === "/rest/v1/rpc/segna_benvenuto_filo") return Response.json(segna);
    return new Response("{}", { status: 404 });
  };
  return { f, viste, dove: (p) => viste.filter((v) => v.percorso.startsWith(p)) };
}

const richiesta = ({ metodo = "GET", token = TOKEN, corpo } = {}) =>
  new Request(`${SITO}${PERCORSO_FILO_BENVENUTO}`, { method: metodo,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(corpo !== undefined ? { "content-type": "application/json" } : {}) },
    body: corpo === undefined ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo) });

test("percorso: /app/api/filo/benvenuto", () => assert.equal(PERCORSO_FILO_BENVENUTO, "/app/api/filo/benvenuto"));

test("spento finché ACCESSO_APP non vale «si»: 404 e nessuna chiamata a Supabase", async () => {
  for (const valore of [undefined, "", "no", "tester", "SI"]) {
    const s = supabaseFinto();
    const r = await filoBenvenutoApi(richiesta(), { ...ENV, ACCESSO_APP: valore }, s.f);
    assert.equal(r.status, 404, String(valore));
    assert.equal(s.viste.length, 0);
  }
});

test("solo GET e POST: 405 con allow", async () => {
  const r = await filoBenvenutoApi(richiesta({ metodo: "PUT", corpo: {} }), ENV, supabaseFinto().f);
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "GET, POST");
});

test("senza token o con token rifiutato: 401, il database non si interroga", async () => {
  const s = supabaseFinto();
  assert.equal((await filoBenvenutoApi(richiesta({ token: null }), ENV, s.f)).status, 401);
  const s2 = supabaseFinto({ utente: 401 });
  assert.equal((await filoBenvenutoApi(richiesta(), ENV, s2.f)).status, 401);
  assert.equal(s.dove("/rest/").length + s2.dove("/rest/").length, 0);
});

test("GET: stanza, nome del Filo e «già vista», per la persona del token", async () => {
  const s = supabaseFinto();
  const r = await filoBenvenutoApi(richiesta(), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, benvenuto: { stanza: STANZA, filo: "Valentina", visto: false } });
  const [rpc] = s.dove("/rest/v1/rpc/filo_stanza_membro");
  assert.equal(rpc.metodo, "POST");
  assert.equal(rpc.corpo.p_utente, ID);
  assert.ok(!Number.isNaN(Date.parse(rpc.corpo.p_ora)));
});

test("GET senza riga (stanza senza Filo, sospeso, uscito, fuori orario): benvenuto null", async () => {
  const r = await filoBenvenutoApi(richiesta(), ENV, supabaseFinto({ righe: [] }).f);
  assert.deepEqual(await r.json(), { ok: true, benvenuto: null });
});

test("GET con risposta strana o database giù: 503 riprova", async () => {
  for (const righe of [{}, [{ stanza_id: "x", filo_nome: "A", visto: false }], [{ stanza_id: STANZA, filo_nome: "", visto: false }],
    [{ stanza_id: STANZA, filo_nome: "A", visto: "no" }]]) {
    assert.equal((await filoBenvenutoApi(richiesta(), ENV, supabaseFinto({ righe }).f)).status, 503, JSON.stringify(righe));
  }
  assert.equal((await filoBenvenutoApi(richiesta(), ENV, supabaseFinto({ rpcStato: 500 }).f)).status, 503);
});

test("POST: segna la schermata come vista per la persona del token e quella stanza", async () => {
  const s = supabaseFinto();
  const r = await filoBenvenutoApi(richiesta({ metodo: "POST", corpo: { stanza: STANZA, utente: "99999999-2222-4333-8444-555555555555" } }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, segnato: true });
  const [rpc] = s.dove("/rest/v1/rpc/segna_benvenuto_filo");
  assert.equal(rpc.corpo.p_utente, ID, "l'utente scritto nella richiesta non conta");
  assert.equal(rpc.corpo.p_stanza, STANZA);
  const no = await filoBenvenutoApi(richiesta({ metodo: "POST", corpo: { stanza: STANZA } }), ENV, supabaseFinto({ segna: false }).f);
  assert.deepEqual(await no.json(), { ok: true, segnato: false });
});

test("POST con dati sbagliati: 400, il database non si interroga", async () => {
  for (const corpo of ["non json", { stanza: "x" }, {}, []]) {
    const s = supabaseFinto();
    const r = await filoBenvenutoApi(richiesta({ metodo: "POST", corpo }), ENV, s.f);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.equal(s.dove("/rest/").length, 0);
  }
});

test("POST con database giù o risposta strana: 503", async () => {
  assert.equal((await filoBenvenutoApi(richiesta({ metodo: "POST", corpo: { stanza: STANZA } }), ENV, supabaseFinto({ rpcStato: 500 }).f)).status, 503);
  assert.equal((await filoBenvenutoApi(richiesta({ metodo: "POST", corpo: { stanza: STANZA } }), ENV, supabaseFinto({ segna: "si" }).f)).status, 503);
});

test("troppe richieste: 429", async () => {
  const env = { ...ENV, LIMITE_PROVINCIA: { limit: async () => ({ success: false }) } };
  assert.equal((await filoBenvenutoApi(richiesta(), env, supabaseFinto().f)).status, 429);
});

test("il Worker instrada /app/api/filo/benvenuto (spento senza ACCESSO_APP)", async () => {
  const r = await worker.fetch(richiesta(), { ASSETS: { fetch: async () => new Response("asset") } }, { waitUntil() {} });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { ok: false, motivo: "spento" });
});
