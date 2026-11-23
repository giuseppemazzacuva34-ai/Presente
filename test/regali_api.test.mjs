// Richiesta del Worker /app/api/regali (issue #331, parte C, passo 5, linea «sviluppatore-c»).
// Chi manda e chi riceve lo dice SOLO il token. Spento finché ACCESSO_APP non vale «si». Supabase finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { regaliApi, PERCORSO_REGALI } from "../worker/regali_api.js";
import { TESTI_COIN, ricevutiTesto, testoLimite } from "../api/coin.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const LEI = "66666666-7777-4888-9999-000000000000";
const CHIAVE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const REGALO_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

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
function richiesta({ metodo = "GET", corpo = null, token = TOKEN, percorso = PERCORSO_REGALI } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== null) headers["content-type"] = "application/json";
  return new Request(SITO + percorso, { method: metodo, headers, body: corpo === null ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
}
const manda = (extra = {}) => richiesta({ metodo: "POST", corpo: { azione: "manda", a: LEI, regalo: "rosa", chiave: CHIAVE, ...extra } });

test("spento finché ACCESSO_APP non vale «si»: nessuna chiamata a Supabase", async () => {
  const s = supabaseFinto();
  const r = await regaliApi(richiesta(), { ...ENV, ACCESSO_APP: "no" }, s.f);
  assert.equal(r.status, 404);
  assert.equal(s.viste.length, 0);
});

test("senza token valido niente: 401", async () => {
  assert.equal((await regaliApi(richiesta({ token: null }), ENV, supabaseFinto().f)).status, 401);
  assert.equal((await regaliApi(richiesta(), ENV, supabaseFinto({ utente: 401 }).f)).status, 401);
});

test("GET: saldo e avvisi non ancora visti, con il testo della spec", async () => {
  const s = supabaseFinto({ rpc: { saldo_crediti: 200, regali_da_vedere: [{ id: REGALO_ID, da: LEI, nome: "Marta", regalo: "rosa", mandato_il: "2026-11-22T10:00:00+00:00" }] } });
  const r = await regaliApi(richiesta(), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, saldo: 200, avvisi: [{ id: REGALO_ID, da: LEI, regalo: "rosa", testo: "Marta ti ha mandato una rosa." }] });
  assert.deepEqual(s.rpc("saldo_crediti")[0].corpo, { p_persona: ID });
  assert.deepEqual(s.rpc("regali_da_vedere")[0].corpo, { p_persona: ID });
});

test("GET ?da=: cosa mi ha mandato quella persona (solo chi riceve)", async () => {
  const s = supabaseFinto({ rpc: { regali_ricevuti_da: [{ regalo: "rosa", quanti: 1 }, { regalo: "spumante", quanti: 1 }] } });
  const r = await regaliApi(richiesta({ percorso: `${PERCORSO_REGALI}?da=${LEI}` }), ENV, s.f);
  assert.deepEqual(await r.json(), { ok: true, ricevuti: [{ regalo: "rosa", quanti: 1 }, { regalo: "spumante", quanti: 1 }], testo: "Ti ha mandato: 1 rosa, 1 bicchiere di spumante" });
  assert.deepEqual(s.rpc("regali_ricevuti_da")[0].corpo, { p_persona: ID, p_da: LEI });
});

test("testo della scheda: plurali, ordine del catalogo, niente se vuoto", () => {
  assert.equal(ricevutiTesto([{ regalo: "fiori", quanti: 2 }, { regalo: "rosa", quanti: 3 }]), "Ti ha mandato: 3 rose, 2 mazzi di fiori");
  assert.equal(ricevutiTesto([{ regalo: "spumante", quanti: 2 }]), "Ti ha mandato: 2 bicchieri di spumante");
  assert.equal(ricevutiTesto([]), null);
  assert.equal(ricevutiTesto([{ regalo: "auto", quanti: 1 }]), null);
});

test("POST manda: chi manda è quello del token, anche se il corpo dice altro; poi il saldo nuovo", async () => {
  const s = supabaseFinto({ rpc: { manda_regalo: "ok", saldo_crediti: 195 } });
  const r = await regaliApi(manda({ da: LEI }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, saldo: 195 });
  assert.deepEqual(s.rpc("manda_regalo")[0].corpo, { p_da: ID, p_a: LEI, p_regalo: "rosa", p_chiave: CHIAVE });
});

test("blocco, segnalazione, sospensione, persona fuori stanza o non compatibile: stesso motivo e stesso testo", async () => {
  for (const motivo of ["blocco", "segnalazione", "sospensione", "non_nella_stanza", "non_compatibile"]) {
    const s = supabaseFinto({ rpc: { manda_regalo: motivo } });
    const r = await regaliApi(manda(), ENV, s.f);
    assert.deepEqual(await r.json(), { ok: false, motivo: "non_puoi", testo: TESTI_COIN.nonPuoi }, motivo);
  }
});

test("stanza chiusa, limiti e saldo insufficiente", async () => {
  let s = supabaseFinto({ rpc: { manda_regalo: "stanza_chiusa" } });
  assert.deepEqual(await (await regaliApi(manda(), ENV, s.f)).json(), { ok: false, motivo: "stanza_chiusa", testo: "La stanza è chiusa." });
  for (const motivo of ["limite_persona", "limite_giorno"]) {
    s = supabaseFinto({ rpc: { manda_regalo: motivo } });
    assert.deepEqual(await (await regaliApi(manda(), ENV, s.f)).json(), { ok: false, motivo, testo: testoLimite(motivo) });
  }
  s = supabaseFinto({ rpc: { manda_regalo: "saldo", saldo_crediti: 3 } });
  assert.deepEqual(await (await regaliApi(manda({ regalo: "spumante" }), ENV, s.f)).json(), { ok: false, motivo: "saldo", testo: "Ti mancano 7 crediti" });
});

test("POST visti: segna solo i regali ricevuti da chi chiede", async () => {
  const s = supabaseFinto({ rpc: { segna_regali_visti: 1 } });
  const r = await regaliApi(richiesta({ metodo: "POST", corpo: { azione: "visti", ids: [REGALO_ID] } }), ENV, s.f);
  assert.deepEqual(await r.json(), { ok: true });
  assert.deepEqual(s.rpc("segna_regali_visti")[0].corpo, { p_persona: ID, p_ids: [REGALO_ID] });
});

test("dati sbagliati 400 senza chiamare il database", async () => {
  const corpi = ["non json", { azione: "regala", a: LEI }, { azione: "manda", a: "lei", regalo: "rosa", chiave: CHIAVE },
    { azione: "manda", a: LEI, regalo: "auto", chiave: CHIAVE }, { azione: "manda", a: LEI, regalo: "rosa" },
    { azione: "manda", a: ID, regalo: "rosa", chiave: CHIAVE }, { azione: "visti", ids: "x" },
    { azione: "visti", ids: Array.from({ length: 51 }, () => REGALO_ID) }, { azione: "visti", ids: ["x"] }];
  for (const corpo of corpi) {
    const s = supabaseFinto({ rpc: { manda_regalo: "ok", segna_regali_visti: 0 } });
    const r = await regaliApi(richiesta({ metodo: "POST", corpo }), ENV, s.f);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.equal(s.rpc("manda_regalo").length + s.rpc("segna_regali_visti").length, 0);
  }
  const s = supabaseFinto();
  assert.equal((await regaliApi(richiesta({ percorso: `${PERCORSO_REGALI}?da=lei` }), ENV, s.f)).status, 400);
});

test("corpo troppo grande: 413", async () => {
  const r = await regaliApi(richiesta({ metodo: "POST", corpo: { azione: "visti", ids: ["x".repeat(5000)] } }), ENV, supabaseFinto().f);
  assert.equal(r.status, 413);
});

test("database giù: 503 «riprova»", async () => {
  const s = supabaseFinto({ rpc: { saldo_crediti: new Response("{}", { status: 500 }) } });
  const r = await regaliApi(richiesta(), ENV, s.f);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { ok: false, motivo: "riprova" });
  const t = supabaseFinto({ rpc: { manda_regalo: new Response("{}", { status: 500 }) } });
  assert.equal((await regaliApi(manda(), ENV, t.f)).status, 503);
});

test("metodi e percorsi: DELETE 405, percorso sconosciuto 404", async () => {
  assert.equal((await regaliApi(richiesta({ metodo: "DELETE" }), ENV, supabaseFinto().f)).status, 405);
  assert.equal((await regaliApi(richiesta({ percorso: PERCORSO_REGALI + "/altro" }), ENV, supabaseFinto().f)).status, 404);
});

test("il Worker instrada /app/api/regali (spento senza ACCESSO_APP)", async () => {
  const r = await worker.fetch(richiesta(), { ...ENV, ACCESSO_APP: "no" }, {});
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { ok: false, motivo: "spento" });
});

// Passo 6c (spec B.5): la schermata «I tuoi crediti» si mostra da sola solo la prima volta; lo ricorda il server.
test("schermata Coin: GET ?schermata=coin dà saldo e «già vista» di chi guarda (dal token)", async () => {
  const s = supabaseFinto({ rpc: { saldo_crediti: 200, coin_schermata_vista: false } });
  const r = await regaliApi(richiesta({ percorso: `${PERCORSO_REGALI}?schermata=coin` }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, saldo: 200, vista: false });
  assert.deepEqual(s.rpc("coin_schermata_vista").map((v) => v.corpo), [{ p_persona: ID }]);
  assert.equal(s.rpc("regali_da_vedere").length, 0);
});

test("schermata Coin: risposta strana del database → 503, mai «vista» inventata", async () => {
  const s = supabaseFinto({ rpc: { saldo_crediti: 200, coin_schermata_vista: "si" } });
  assert.equal((await regaliApi(richiesta({ percorso: `${PERCORSO_REGALI}?schermata=coin` }), ENV, s.f)).status, 503);
  const t = supabaseFinto({ rpc: { saldo_crediti: 200 } });
  assert.equal((await regaliApi(richiesta({ percorso: `${PERCORSO_REGALI}?schermata=altro` }), ENV, t.f)).status, 400);
});

test("schermata Coin: POST «coin_vista» la segna per chi guarda, un «persona» nel corpo non conta", async () => {
  const s = supabaseFinto({ rpc: { segna_coin_schermata_vista: new Response(null, { status: 204 }) } }); // funzione «void»: PostgREST risponde senza corpo
  const r = await regaliApi(richiesta({ metodo: "POST", corpo: { azione: "coin_vista", persona: LEI } }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.deepEqual(s.rpc("segna_coin_schermata_vista").map((v) => v.corpo), [{ p_persona: ID }]);
});

test("schermata Coin: se il database non risponde, POST «coin_vista» → 503", async () => {
  const s = supabaseFinto({ rpc: { segna_coin_schermata_vista: new Response("{}", { status: 500 }) } });
  assert.equal((await regaliApi(richiesta({ metodo: "POST", corpo: { azione: "coin_vista" } }), ENV, s.f)).status, 503);
});
