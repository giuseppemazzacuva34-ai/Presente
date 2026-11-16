// Chi risponde a «Scrivici» (issue #10, parte A, passo 4b della linea «sviluppatore-c»).
//   GET  /app/api/supporto/coda                    → coda dei messaggi (solo ruolo «supporto»)
//   POST /app/api/supporto/risposta { id, risposta } → salva la risposta (solo ruolo «supporto»)
// Chi chiama lo dice SOLO il token; il ruolo lo decide il database (operatori_supporto). Supabase finto, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { supportoOperatoreApi, PERCORSO_CODA, PERCORSO_RISPOSTA } from "../worker/supporto_operatore_api.js";
import { codaOperatore, rispondiOperatore, codaDb, rispondiDb, MAX_RISPOSTA } from "../api/supporto_operatore.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const MSG = "66666666-7777-4888-9999-000000000000";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const RIGA = { id: MSG, email: "chi@example.invalid", categoria: "crediti", testo: "Testo di prova", creato_il: "2026-11-16T10:00:00Z", stato: "inviato", sicurezza: true };

function supabaseFinto({ utente = 200, rpc = {} } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.origin !== BASE) throw new Error("rete assente");
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID, email: "op@example.invalid" }) : new Response("{}", { status: utente });
    const nome = u.pathname.replace("/rest/v1/rpc/", "");
    if (nome in rpc) {
      const v = rpc[nome];
      if (v && v.stato) return Response.json(v.corpo, { status: v.stato });
      return Response.json(v);
    }
    return new Response("{}", { status: 404 });
  };
  return { f, viste };
}
const NON_OPERATORE = { stato: 403, corpo: { code: "42501", message: "non_operatore" } };
function richiesta({ metodo = "GET", percorso = PERCORSO_CODA, corpo = null, token = TOKEN } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== null) headers["content-type"] = "application/json";
  return new Request(SITO + percorso, { method: metodo, headers, body: corpo === null ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
}

// ---- Regole (api/supporto_operatore.js) -------------------------------------------------------------------

test("coda: solo i campi della spec, con nomi per lo schermo", async () => {
  const r = await codaOperatore({ operatore: ID }, { coda: async () => [{ ...RIGA, diario: "x" }] });
  assert.deepEqual(r, { ok: true, messaggi: [{ id: MSG, email: "chi@example.invalid", categoria: "crediti", testo: "Testo di prova", creatoIl: "2026-11-16T10:00:00Z", stato: "inviato", sicurezza: true }] });
});

test("coda: chi non ha il ruolo «supporto» riceve «non_autorizzato»", async () => {
  assert.deepEqual(await codaOperatore({ operatore: ID }, { coda: async () => "non_operatore" }), { ok: false, motivo: "non_autorizzato" });
  assert.deepEqual(await codaOperatore({ operatore: ID }, { coda: async () => null }), { ok: false, motivo: "riprova" });
  assert.deepEqual(await codaOperatore({ operatore: "x" }, { coda: async () => [] }), { ok: false, motivo: "dati" });
});

test("risposta: id valido e testo da 1 a 4.000 caratteri, mai vuoto", async () => {
  const salvate = [];
  const d = { rispondi: async (q) => { salvate.push(q); return true; } };
  assert.equal(MAX_RISPOSTA, 4000);
  assert.deepEqual(await rispondiOperatore({ operatore: ID, corpo: { id: "nope", risposta: "ok" } }, d), { ok: false, motivo: "dati" });
  assert.deepEqual(await rispondiOperatore({ operatore: ID, corpo: { id: MSG, risposta: "  " } }, d), { ok: false, motivo: "vuoto" });
  assert.deepEqual(await rispondiOperatore({ operatore: ID, corpo: { id: MSG, risposta: "a".repeat(4001) } }, d), { ok: false, motivo: "dati" });
  assert.equal(salvate.length, 0);
  assert.deepEqual(await rispondiOperatore({ operatore: ID, corpo: { id: MSG, risposta: "Ciao, ti abbiamo scritto." } }, d), { ok: true });
  assert.deepEqual(salvate, [{ operatore: ID, id: MSG, risposta: "Ciao, ti abbiamo scritto." }]);
});

test("risposta: già data → «gia_risposto»; senza ruolo → «non_autorizzato»", async () => {
  const corpo = { id: MSG, risposta: "Ok" };
  assert.deepEqual(await rispondiOperatore({ operatore: ID, corpo }, { rispondi: async () => false }), { ok: false, motivo: "gia_risposto" });
  assert.deepEqual(await rispondiOperatore({ operatore: ID, corpo }, { rispondi: async () => "non_operatore" }), { ok: false, motivo: "non_autorizzato" });
  assert.deepEqual(await rispondiOperatore({ operatore: ID, corpo }, { rispondi: async () => null }), { ok: false, motivo: "riprova" });
});

test("database: chiama coda_supporto_operatore e rispondi_supporto_operatore con l'utente del token", async () => {
  const { f, viste } = supabaseFinto({ rpc: { coda_supporto_operatore: [RIGA], rispondi_supporto_operatore: true } });
  assert.deepEqual(await codaDb(ENV, { operatore: ID }, f), [RIGA]);
  assert.equal(await rispondiDb(ENV, { operatore: ID, id: MSG, risposta: "Ok" }, f), true);
  assert.deepEqual(viste.map((v) => [v.percorso, v.corpo]), [
    ["/rest/v1/rpc/coda_supporto_operatore", { p_operatore: ID }],
    ["/rest/v1/rpc/rispondi_supporto_operatore", { p_operatore: ID, p_id: MSG, p_risposta: "Ok" }],
  ]);
});

test("database: l'errore «non_operatore» diventa «non_operatore», gli altri errori null", async () => {
  const { f } = supabaseFinto({ rpc: { coda_supporto_operatore: NON_OPERATORE, rispondi_supporto_operatore: { stato: 500, corpo: { message: "boom" } } } });
  assert.equal(await codaDb(ENV, { operatore: ID }, f), "non_operatore");
  assert.equal(await rispondiDb(ENV, { operatore: ID, id: MSG, risposta: "Ok" }, f), null);
});

// ---- Richieste del Worker -----------------------------------------------------------------------------------

test("spento finché ACCESSO_APP non vale «si»: nessuna chiamata a Supabase", async () => {
  const { f, viste } = supabaseFinto();
  const r = await supportoOperatoreApi(richiesta(), { ...ENV, ACCESSO_APP: "no" }, f);
  assert.equal(r.status, 404);
  assert.equal(viste.length, 0);
});

test("coda: GET con token del ruolo «supporto» → 200 con i messaggi", async () => {
  const { f } = supabaseFinto({ rpc: { coda_supporto_operatore: [RIGA] } });
  const r = await supportoOperatoreApi(richiesta(), ENV, f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.messaggi[0].id, MSG);
});

test("coda: senza token 401, senza ruolo 403, metodo sbagliato 405", async () => {
  const { f } = supabaseFinto({ rpc: { coda_supporto_operatore: NON_OPERATORE } });
  assert.equal((await supportoOperatoreApi(richiesta({ token: null }), ENV, f)).status, 401);
  const r = await supportoOperatoreApi(richiesta(), ENV, f);
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { ok: false, motivo: "non_autorizzato" });
  assert.equal((await supportoOperatoreApi(richiesta({ metodo: "POST", corpo: {} }), ENV, f)).status, 405);
  assert.equal((await supportoOperatoreApi(richiesta({ percorso: PERCORSO_RISPOSTA }), ENV, f)).status, 405);
});

test("risposta: POST salva; l'operatore è quello del token anche se il corpo dice altro", async () => {
  const { f, viste } = supabaseFinto({ rpc: { rispondi_supporto_operatore: true } });
  const r = await supportoOperatoreApi(richiesta({ metodo: "POST", percorso: PERCORSO_RISPOSTA, corpo: { id: MSG, risposta: "Ok", operatore: MSG } }), ENV, f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.deepEqual(viste.at(-1).corpo, { p_operatore: ID, p_id: MSG, p_risposta: "Ok" });
});

test("risposta: codici (JSON rotto 400, vuoto e già risposto 200 col motivo, senza ruolo 403, database giù 503)", async () => {
  const post = (corpo) => richiesta({ metodo: "POST", percorso: PERCORSO_RISPOSTA, corpo });
  let s = supabaseFinto({ rpc: { rispondi_supporto_operatore: false } });
  assert.equal((await supportoOperatoreApi(post("{rotto"), ENV, s.f)).status, 400);
  const vuoto = await supportoOperatoreApi(post({ id: MSG, risposta: " " }), ENV, s.f);
  assert.equal(vuoto.status, 200);
  assert.deepEqual(await vuoto.json(), { ok: false, motivo: "vuoto" });
  assert.deepEqual(await (await supportoOperatoreApi(post({ id: MSG, risposta: "Ok" }), ENV, s.f)).json(), { ok: false, motivo: "gia_risposto" });
  s = supabaseFinto({ rpc: { rispondi_supporto_operatore: NON_OPERATORE } });
  assert.equal((await supportoOperatoreApi(post({ id: MSG, risposta: "Ok" }), ENV, s.f)).status, 403);
  s = supabaseFinto({ rpc: { rispondi_supporto_operatore: { stato: 500, corpo: {} } } });
  assert.equal((await supportoOperatoreApi(post({ id: MSG, risposta: "Ok" }), ENV, s.f)).status, 503);
});

test("nessun testo di messaggi, risposte o email nei log", async () => {
  const scritti = [];
  const prima = [console.error, console.log, console.warn];
  console.error = console.log = console.warn = (...a) => scritti.push(a.map(String).join(" "));
  try {
    const s = supabaseFinto({ rpc: { coda_supporto_operatore: { stato: 500, corpo: { message: "Testo di prova" } }, rispondi_supporto_operatore: { stato: 500, corpo: {} } } });
    await supportoOperatoreApi(richiesta(), ENV, s.f);
    await supportoOperatoreApi(richiesta({ metodo: "POST", percorso: PERCORSO_RISPOSTA, corpo: { id: MSG, risposta: "Risposta segreta" } }), ENV, s.f);
  } finally {
    [console.error, console.log, console.warn] = prima;
  }
  const tutto = scritti.join("\n");
  assert.doesNotMatch(tutto, /Testo di prova|Risposta segreta|example\.invalid/);
});

test("il Worker instrada /app/api/supporto/coda e /risposta (spenti senza ACCESSO_APP)", async () => {
  for (const percorso of [PERCORSO_CODA, PERCORSO_RISPOSTA]) {
    const r = await worker.fetch(richiesta({ percorso }), { ...ENV, ACCESSO_APP: "no" }, {});
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { ok: false, motivo: "spento" });
  }
});
