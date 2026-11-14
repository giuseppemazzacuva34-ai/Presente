// Richiesta del Worker /app/api/chiavi (issue #5, passo 5b, linea «sviluppatore-c»).
// Chi dà o riprende la chiave lo dice SOLO il token. Spento finché ACCESSO_APP non vale «si». Supabase finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chiaviApi, PERCORSO_CHIAVI } from "../worker/chiavi_api.js";
import { TESTI_CHIAVI } from "../api/chiavi.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const LEI = "66666666-7777-4888-9999-000000000000";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const STATO = { stanza: true, chiude_il: "2026-11-15T20:00:00+00:00", chiuse: false, restanti: 1, date: [{ a: LEI, frase: null }] };

// Supabase finto: risponde all'utente del token e alle funzioni rpc/<nome> con le risposte date.
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
function richiesta({ metodo = "GET", corpo = null, token = TOKEN, percorso = PERCORSO_CHIAVI } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== null) headers["content-type"] = "application/json";
  return new Request(SITO + percorso, { method: metodo, headers, body: corpo === null ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
}

test("spento finché ACCESSO_APP non vale «si»: nessuna chiamata a Supabase", async () => {
  const s = supabaseFinto({ rpc: { stato_chiavi: STATO } });
  const r = await chiaviApi(richiesta(), { ...ENV, ACCESSO_APP: "no" }, s.f);
  assert.equal(r.status, 404);
  assert.equal(s.viste.length, 0);
});

test("senza token valido niente: 401", async () => {
  assert.equal((await chiaviApi(richiesta({ token: null }), ENV, supabaseFinto().f)).status, 401);
  assert.equal((await chiaviApi(richiesta(), ENV, supabaseFinto({ utente: 401 }).f)).status, 401);
});

test("GET: le mie chiavi, chieste a stato_chiavi per la persona del token", async () => {
  const s = supabaseFinto({ rpc: { stato_chiavi: STATO } });
  const r = await chiaviApi(richiesta(), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, ...STATO });
  assert.deepEqual(s.rpc("stato_chiavi")[0].corpo, { p_utente: ID });
});

test("POST dai: chi dà la chiave è quello del token, anche se il corpo dice altro; poi lo stato aggiornato", async () => {
  const s = supabaseFinto({ rpc: { dai_chiave: "ok", stato_chiavi: STATO } });
  const r = await chiaviApi(richiesta({ metodo: "POST", corpo: { azione: "dai", a: LEI, frase: "Il treno!", da: LEI } }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, stato: STATO });
  assert.deepEqual(s.rpc("dai_chiave")[0].corpo, { p_da: ID, p_a: LEI, p_frase: "Il treno!" });
});

test("POST riprendi e frase usano le funzioni del server giuste", async () => {
  const s = supabaseFinto({ rpc: { riprendi_chiave: "ok", cambia_frase: "ok", stato_chiavi: STATO } });
  await chiaviApi(richiesta({ metodo: "POST", corpo: { azione: "riprendi", a: LEI } }), ENV, s.f);
  await chiaviApi(richiesta({ metodo: "POST", corpo: { azione: "frase", a: LEI, frase: "" } }), ENV, s.f);
  assert.deepEqual(s.rpc("riprendi_chiave")[0].corpo, { p_da: ID, p_a: LEI });
  assert.deepEqual(s.rpc("cambia_frase")[0].corpo, { p_da: ID, p_a: LEI, p_frase: "" });
});

test("un rifiuto del server torna con il motivo e il testo per l'utente", async () => {
  for (const [motivo, testo] of [["chiuse", TESTI_CHIAVI.chiuse], ["contatti", TESTI_CHIAVI.contatti],
    ["finite", TESTI_CHIAVI.finite], ["non_chiamato", TESTI_CHIAVI.nonChiamato], ["non_nella_stanza", TESTI_CHIAVI.nonNellaStanza]]) {
    const s = supabaseFinto({ rpc: { dai_chiave: motivo } });
    const r = await chiaviApi(richiesta({ metodo: "POST", corpo: { azione: "dai", a: LEI } }), ENV, s.f);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: false, motivo, testo });
  }
  assert.equal(TESTI_CHIAVI.nonNellaStanza, "Non è più nella stanza.");
});

test("dati sbagliati 400 senza chiamare il database: azione sconosciuta, persona non valida, frase non testo", async () => {
  for (const corpo of ["non json", { azione: "regala", a: LEI }, { azione: "dai", a: "lei" }, { azione: "dai", a: LEI, frase: 3 }]) {
    const s = supabaseFinto({ rpc: { dai_chiave: "ok" } });
    const r = await chiaviApi(richiesta({ metodo: "POST", corpo }), ENV, s.f);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.equal(s.rpc("dai_chiave").length, 0);
  }
});

test("corpo troppo grande: 413", async () => {
  const r = await chiaviApi(richiesta({ metodo: "POST", corpo: { azione: "dai", a: LEI, frase: "x".repeat(5000) } }), ENV, supabaseFinto().f);
  assert.equal(r.status, 413);
});

test("database giù: 503 «riprova»", async () => {
  const s = supabaseFinto({ rpc: { stato_chiavi: new Response("{}", { status: 500 }) } });
  const r = await chiaviApi(richiesta(), ENV, s.f);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { ok: false, motivo: "riprova" });
});

test("GET /sera: le porte con la frase dell'altra persona", async () => {
  const sera = { stato: "pronta", porte: [{ id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", con: LEI, frase_per_te: "Ciao" }] };
  const s = supabaseFinto({ rpc: { sera_di: sera } });
  const r = await chiaviApi(richiesta({ percorso: PERCORSO_CHIAVI + "/sera" }), ENV, s.f);
  assert.deepEqual(await r.json(), { ok: true, ...sera });
  assert.deepEqual(s.rpc("sera_di")[0].corpo, { p_utente: ID });
});

test("GET /sera senza porte: lo stesso testo per tutti", async () => {
  const s = supabaseFinto({ rpc: { sera_di: { stato: "pronta", porte: [] } } });
  const r = await chiaviApi(richiesta({ percorso: PERCORSO_CHIAVI + "/sera" }), ENV, s.f);
  assert.deepEqual(await r.json(), { ok: true, stato: "pronta", porte: [], testo: TESTI_CHIAVI.nessunaPorta });
});

test("metodi e percorsi: POST su /sera 405, percorso sconosciuto 404", async () => {
  assert.equal((await chiaviApi(richiesta({ metodo: "POST", corpo: {}, percorso: PERCORSO_CHIAVI + "/sera" }), ENV, supabaseFinto().f)).status, 405);
  assert.equal((await chiaviApi(richiesta({ metodo: "DELETE" }), ENV, supabaseFinto().f)).status, 405);
  assert.equal((await chiaviApi(richiesta({ percorso: PERCORSO_CHIAVI + "/altro" }), ENV, supabaseFinto().f)).status, 404);
});

test("il Worker instrada /app/api/chiavi e /app/api/chiavi/sera (spenti senza ACCESSO_APP)", async () => {
  for (const percorso of [PERCORSO_CHIAVI, PERCORSO_CHIAVI + "/sera"]) {
    const r = await worker.fetch(richiesta({ percorso }), { ...ENV, ACCESSO_APP: "no" }, {});
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { ok: false, motivo: "spento" });
  }
});
