// Bozze nel pannello di chi risponde a «Scrivici» (issue #10, parte B v1 del CPO; D122 B; passo 6 linea «sviluppatore-c»).
//   GET  /app/api/supporto/bozze         → bozze dei messaggi senza risposta (solo ruolo «supporto»)
//   POST /app/api/supporto/scarta { id } → «Scarta e scrivo io» (solo ruolo «supporto»)
// «Invia così» e «Modifica e invia» usano /app/api/supporto/risposta (già esistente). Supabase finto, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { supportoOperatoreApi, PERCORSO_BOZZE, PERCORSO_SCARTA } from "../worker/supporto_operatore_api.js";
import { bozzeOperatore, scartaOperatore } from "../api/supporto_operatore.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const MSG = "66666666-7777-4888-9999-000000000000";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const BOZZA = { messaggio_id: MSG, testo: "Bozza di prova", fonte: "FAQ n. 5", con_istruzioni: true, creato_il: "2026-11-20T10:00:00Z" };

function supabaseFinto({ rpc = {} } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.origin !== BASE) throw new Error("rete assente");
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID, email: "op@example.invalid" });
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
function richiesta({ metodo = "GET", percorso = PERCORSO_BOZZE, corpo = null, token = TOKEN } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== null) headers["content-type"] = "application/json";
  return new Request(SITO + percorso, { method: metodo, headers, body: corpo === null ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
}

test("bozze: solo i campi della spec, con nomi per lo schermo", async () => {
  const r = await bozzeOperatore({ operatore: ID }, { bozze: async () => [{ ...BOZZA, email: "x@example.invalid" }] });
  assert.deepEqual(r, { ok: true, bozze: [{ id: MSG, testo: "Bozza di prova", fonte: "FAQ n. 5", conIstruzioni: true, creataIl: "2026-11-20T10:00:00Z" }] });
});

test("bozze: senza ruolo «non_autorizzato», database giù «riprova», operatore non valido «dati»", async () => {
  assert.deepEqual(await bozzeOperatore({ operatore: ID }, { bozze: async () => "non_operatore" }), { ok: false, motivo: "non_autorizzato" });
  assert.deepEqual(await bozzeOperatore({ operatore: ID }, { bozze: async () => null }), { ok: false, motivo: "riprova" });
  assert.deepEqual(await bozzeOperatore({ operatore: "x" }, { bozze: async () => [] }), { ok: false, motivo: "dati" });
});

test("scarta: id valido; già tolta → «gia_tolta»; senza ruolo → «non_autorizzato»", async () => {
  assert.deepEqual(await scartaOperatore({ operatore: ID, corpo: { id: MSG } }, { scarta: async () => true }), { ok: true });
  assert.deepEqual(await scartaOperatore({ operatore: ID, corpo: { id: MSG } }, { scarta: async () => false }), { ok: false, motivo: "gia_tolta" });
  assert.deepEqual(await scartaOperatore({ operatore: ID, corpo: { id: MSG } }, { scarta: async () => "non_operatore" }), { ok: false, motivo: "non_autorizzato" });
  assert.deepEqual(await scartaOperatore({ operatore: ID, corpo: { id: "x" } }, { scarta: async () => true }), { ok: false, motivo: "dati" });
});

test("Worker: GET bozze chiama bozze_supporto_operatore con l'utente del token", async () => {
  const s = supabaseFinto({ rpc: { bozze_supporto_operatore: [BOZZA] } });
  const r = await supportoOperatoreApi(richiesta(), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).bozze[0].fonte, "FAQ n. 5");
  assert.deepEqual(s.viste.find((v) => v.percorso.endsWith("bozze_supporto_operatore")).corpo, { p_operatore: ID });
});

test("Worker: POST scarta usa l'operatore del token anche se il corpo dice altro", async () => {
  const s = supabaseFinto({ rpc: { scarta_bozza_operatore: true } });
  const r = await supportoOperatoreApi(richiesta({ metodo: "POST", percorso: PERCORSO_SCARTA, corpo: { id: MSG, operatore: MSG } }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(s.viste.find((v) => v.percorso.endsWith("scarta_bozza_operatore")).corpo, { p_operatore: ID, p_id: MSG });
});

test("Worker: codici (senza ruolo 403, metodo sbagliato 405, già tolta 200 col motivo, database giù 503)", async () => {
  let s = supabaseFinto({ rpc: { bozze_supporto_operatore: NON_OPERATORE } });
  assert.equal((await supportoOperatoreApi(richiesta(), ENV, s.f)).status, 403);
  assert.equal((await supportoOperatoreApi(richiesta({ metodo: "POST" , corpo: {} }), ENV, s.f)).status, 405);
  s = supabaseFinto({ rpc: { scarta_bozza_operatore: false } });
  const r = await supportoOperatoreApi(richiesta({ metodo: "POST", percorso: PERCORSO_SCARTA, corpo: { id: MSG } }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: false, motivo: "gia_tolta" });
  s = supabaseFinto({ rpc: { bozze_supporto_operatore: { stato: 500, corpo: {} } } });
  assert.equal((await supportoOperatoreApi(richiesta(), ENV, s.f)).status, 503);
});

test("nessun testo di bozze nei log", async () => {
  const scritti = [];
  const prima = [console.error, console.log, console.warn];
  console.error = console.log = console.warn = (...a) => scritti.push(a.map(String).join(" "));
  try {
    const s = supabaseFinto({ rpc: { bozze_supporto_operatore: { stato: 500, corpo: { message: "Bozza di prova" } } } });
    await supportoOperatoreApi(richiesta(), ENV, s.f);
  } finally {
    [console.error, console.log, console.warn] = prima;
  }
  assert.doesNotMatch(scritti.join("\n"), /Bozza di prova|example\.invalid/);
});

test("il Worker instrada /bozze e /scarta (spenti senza ACCESSO_APP)", async () => {
  for (const percorso of [PERCORSO_BOZZE, PERCORSO_SCARTA]) {
    const r = await worker.fetch(richiesta({ percorso }), { ...ENV, ACCESSO_APP: "no" }, {});
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { ok: false, motivo: "spento" });
  }
});
