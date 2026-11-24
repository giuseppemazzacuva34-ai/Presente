// Richieste del Worker per il pannello dell'amministratore del Filo (issue #360, spec v1 + v1.1 del CPO, D151 A),
// passo 12b della linea «sviluppatore-c»:
//   GET  /app/api/filo-amministratore/stanze                         → elenco con avvisi del lunedì
//   POST /app/api/filo-amministratore/assegna    { stanza, email }   → assegna il Filo
//   POST /app/api/filo-amministratore/togli-filo { stanza }          → toglie il Filo
//   GET  /app/api/filo-amministratore/ascolta?stanza=&tipo=          → link firmato breve, durata, testo, file
//   POST /app/api/filo-amministratore/togli-vocale { stanza, tipo, file } → prima il file, poi la riga
// Chi è lo dice SOLO il token; se è amministratore lo decide il database. Spento finché ACCESSO_APP ≠ «si».
// Supabase finto, nessuna rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filoAmministratoreApi, PERCORSO_FILO_AMMINISTRATORE } from "../worker/filo_amministratore_api.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const STANZA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FILE = `${STANZA}/0f0f0f0f-1111-4222-8333-444444444444.webm`;
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const EMAIL = "filo.prova@example.com";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const STANZE = [{
  stanza: STANZA, nome: null, citta: "Milano", apre_il: "2026-03-30T07:00:00+00:00", chiude_il: "2026-04-05T19:00:00+00:00",
  filo_nome: "Silvia", membri: 12, vocale_lunedi: false, vocale_domenica: false, avviso: "manca_lunedi",
}];
const VOCALE = { file: FILE, durata: 70, testo: "Benvenuti nella stanza." };

// rpc: { nome: stato | { stato, corpo } }
function supabaseFinto({ utente = 200, rpc = {}, firma = 200, cancella = 200 } = {}) {
  const viste = [];
  const predefiniti = {
    stanze_filo_amministratore: { stato: 200, corpo: STANZE },
    assegna_filo_stanza: { stato: 204, corpo: null },
    togli_filo_stanza: { stato: 200, corpo: true },
    vocale_filo_amministratore: { stato: 200, corpo: [VOCALE] },
    togli_vocale_filo_amministratore: { stato: 200, corpo: true },
  };
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    const corpo = typeof opzioni.body === "string" ? JSON.parse(opzioni.body) : opzioni.body;
    viste.push({ percorso: u.pathname, metodo: opzioni.method || "GET", headers: opzioni.headers || {}, corpo });
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID }) : new Response("{}", { status: utente });
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const nome = u.pathname.slice("/rest/v1/rpc/".length);
      const r = { ...predefiniti[nome], ...(typeof rpc[nome] === "number" ? { stato: rpc[nome], corpo: {} } : rpc[nome] || {}) };
      if (r.stato === 204) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(r.corpo), { status: r.stato, headers: { "content-type": "application/json" } });
    }
    if (u.pathname.startsWith("/storage/v1/object/sign/vocali_filo/")) {
      if (firma !== 200) return new Response("{}", { status: firma });
      return Response.json({ signedURL: `/object/sign/vocali_filo/${u.pathname.split("/vocali_filo/")[1]}?token=firmato` });
    }
    if (u.pathname === "/storage/v1/object/vocali_filo") return cancella === 200 ? Response.json([{ name: FILE }]) : new Response("{}", { status: cancella });
    return new Response("{}", { status: 404 });
  };
  return { f, viste, dove: (p) => viste.filter((v) => v.percorso.startsWith(p)) };
}

const richiesta = (passo, { metodo = "GET", corpo, query = "", token = TOKEN } = {}) =>
  new Request(`${SITO}${PERCORSO_FILO_AMMINISTRATORE}${passo}${query}`, {
    method: metodo,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(corpo ? { "content-type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

test("percorso: /app/api/filo-amministratore", () => assert.equal(PERCORSO_FILO_AMMINISTRATORE, "/app/api/filo-amministratore"));

test("spento finché ACCESSO_APP non vale «si»: 404 e nessuna chiamata a Supabase", async () => {
  const s = supabaseFinto();
  const r = await filoAmministratoreApi(richiesta("/stanze"), { ...ENV, ACCESSO_APP: "tester" }, s.f);
  assert.equal(r.status, 404);
  assert.equal(s.viste.length, 0);
});

test("passo sconosciuto 404; metodo sbagliato 405 con allow", async () => {
  assert.equal((await filoAmministratoreApi(richiesta("/altro"), ENV, supabaseFinto().f)).status, 404);
  const r = await filoAmministratoreApi(richiesta("/stanze", { metodo: "POST", corpo: {} }), ENV, supabaseFinto().f);
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "GET");
  const r2 = await filoAmministratoreApi(richiesta("/assegna"), ENV, supabaseFinto().f);
  assert.equal(r2.status, 405);
  assert.equal(r2.headers.get("allow"), "POST");
});

test("senza token o con token rifiutato: 401", async () => {
  assert.equal((await filoAmministratoreApi(richiesta("/stanze", { token: null }), ENV, supabaseFinto().f)).status, 401);
  assert.equal((await filoAmministratoreApi(richiesta("/stanze"), ENV, supabaseFinto({ utente: 401 }).f)).status, 401);
});

test("chi non è amministratore: 403 (lo decide il database)", async () => {
  const s = supabaseFinto({ rpc: { stanze_filo_amministratore: { stato: 403, corpo: { message: "non_amministratore" } } } });
  const r = await filoAmministratoreApi(richiesta("/stanze"), ENV, s.f);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).motivo, "non_amministratore");
});

test("elenco: il database riceve chi lo dice il token e l'ora del server; 200 con le stanze", async () => {
  const s = supabaseFinto();
  const r = await filoAmministratoreApi(richiesta("/stanze"), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, stanze: STANZE });
  const [rpc] = s.dove("/rest/v1/rpc/stanze_filo_amministratore");
  assert.equal(rpc.corpo.p_amministratore, ID);
  assert.ok(Math.abs(Date.parse(rpc.corpo.p_ora) - Date.now()) < 5000);
  assert.equal(rpc.headers.authorization, "Bearer chiave-server-finta");
});

test("assegna: dati controllati prima del database; email ripulita", async () => {
  for (const corpo of [{}, { stanza: "x", email: EMAIL }, { stanza: STANZA, email: "" }, { stanza: STANZA, email: "senza-chiocciola" },
    { stanza: STANZA, email: "a".repeat(250) + "@example.com" }, { stanza: STANZA, email: 5 }]) {
    const s = supabaseFinto();
    const r = await filoAmministratoreApi(richiesta("/assegna", { metodo: "POST", corpo }), ENV, s.f);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.equal(s.dove("/rest/v1/rpc").length, 0);
  }
  const s = supabaseFinto();
  const r = await filoAmministratoreApi(richiesta("/assegna", { metodo: "POST", corpo: { stanza: STANZA, email: `  ${EMAIL} ` } }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const [rpc] = s.dove("/rest/v1/rpc/assegna_filo_stanza");
  assert.deepEqual({ ...rpc.corpo, p_ora: "x" }, { p_amministratore: ID, p_stanza: STANZA, p_email: EMAIL, p_ora: "x" });
});

test("assegna rifiutata dal database: motivo spiegabile (persona, stanza, filo_membro)", async () => {
  for (const motivo of ["persona", "stanza", "filo_membro"]) {
    const s = supabaseFinto({ rpc: { assegna_filo_stanza: { stato: 400, corpo: { message: motivo } } } });
    const r = await filoAmministratoreApi(richiesta("/assegna", { metodo: "POST", corpo: { stanza: STANZA, email: EMAIL } }), ENV, s.f);
    assert.equal(r.status, 200, motivo);
    assert.deepEqual(await r.json(), { ok: false, motivo });
  }
});

test("togli-filo: 200 con tolto vero/falso", async () => {
  const s = supabaseFinto({ rpc: { togli_filo_stanza: { stato: 200, corpo: false } } });
  const r = await filoAmministratoreApi(richiesta("/togli-filo", { metodo: "POST", corpo: { stanza: STANZA } }), ENV, s.f);
  assert.deepEqual(await r.json(), { ok: true, tolto: false });
  assert.equal(s.dove("/rest/v1/rpc/togli_filo_stanza")[0].corpo.p_stanza, STANZA);
  assert.equal((await filoAmministratoreApi(richiesta("/togli-filo", { metodo: "POST", corpo: { stanza: "x" } }), ENV, supabaseFinto().f)).status, 400);
});

test("ascolta: link firmato breve con durata, testo e file (per togliere proprio quello)", async () => {
  const s = supabaseFinto();
  const r = await filoAmministratoreApi(richiesta("/ascolta", { query: `?stanza=${STANZA}&tipo=lunedi` }), ENV, s.f);
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.deepEqual(corpo, { ok: true, vocale: { url: `${BASE}/storage/v1/object/sign/vocali_filo/${FILE}?token=firmato`, durata: 70, testo: VOCALE.testo, file: FILE } });
  assert.ok(s.dove("/storage/v1/object/sign/")[0].corpo.expiresIn <= 300);
});

test("ascolta: nessun vocale → vocale null; dati sbagliati 400; file strano 503", async () => {
  const vuoto = supabaseFinto({ rpc: { vocale_filo_amministratore: { stato: 200, corpo: [] } } });
  assert.deepEqual(await (await filoAmministratoreApi(richiesta("/ascolta", { query: `?stanza=${STANZA}&tipo=domenica` }), ENV, vuoto.f)).json(), { ok: true, vocale: null });
  assert.equal((await filoAmministratoreApi(richiesta("/ascolta", { query: `?stanza=${STANZA}&tipo=martedi` }), ENV, supabaseFinto().f)).status, 400);
  assert.equal((await filoAmministratoreApi(richiesta("/ascolta", { query: "?stanza=x&tipo=lunedi" }), ENV, supabaseFinto().f)).status, 400);
  const strano = supabaseFinto({ rpc: { vocale_filo_amministratore: { stato: 200, corpo: [{ ...VOCALE, file: "../x.webm" }] } } });
  assert.equal((await filoAmministratoreApi(richiesta("/ascolta", { query: `?stanza=${STANZA}&tipo=lunedi` }), ENV, strano.f)).status, 503);
  assert.equal(strano.dove("/storage/").length, 0);
});

test("togli-vocale: prima cancella il file dal contenitore, poi la riga", async () => {
  const s = supabaseFinto();
  const r = await filoAmministratoreApi(richiesta("/togli-vocale", { metodo: "POST", corpo: { stanza: STANZA, tipo: "lunedi", file: FILE } }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, tolto: true });
  const ordine = s.viste.map((v) => v.percorso).filter((p) => p !== "/auth/v1/user");
  assert.deepEqual(ordine, ["/rest/v1/rpc/vocale_filo_amministratore", "/storage/v1/object/vocali_filo", "/rest/v1/rpc/togli_vocale_filo_amministratore"]);
  assert.deepEqual(s.dove("/storage/v1/object/vocali_filo")[0].corpo, { prefixes: [FILE] });
  assert.equal(s.dove("/storage/v1/object/vocali_filo")[0].metodo, "DELETE");
  const [rpc] = s.dove("/rest/v1/rpc/togli_vocale_filo_amministratore");
  assert.equal(rpc.corpo.p_file, FILE);
  assert.equal(rpc.corpo.p_tipo, "lunedi");
});

test("togli-vocale: se il vocale è cambiato nel frattempo non cancella nulla (tolto falso)", async () => {
  const altro = `${STANZA}/99999999-1111-4222-8333-444444444444.webm`;
  const s = supabaseFinto();
  const r = await filoAmministratoreApi(richiesta("/togli-vocale", { metodo: "POST", corpo: { stanza: STANZA, tipo: "lunedi", file: altro } }), ENV, s.f);
  assert.deepEqual(await r.json(), { ok: true, tolto: false });
  assert.equal(s.dove("/storage/").length, 0);
  assert.equal(s.dove("/rest/v1/rpc/togli_vocale_filo_amministratore").length, 0);
});

test("togli-vocale: se il file non si cancella la riga resta (503, si riprova)", async () => {
  const s = supabaseFinto({ cancella: 500 });
  const r = await filoAmministratoreApi(richiesta("/togli-vocale", { metodo: "POST", corpo: { stanza: STANZA, tipo: "lunedi", file: FILE } }), ENV, s.f);
  assert.equal(r.status, 503);
  assert.equal(s.dove("/rest/v1/rpc/togli_vocale_filo_amministratore").length, 0);
});

test("togli-vocale: dati sbagliati 400 senza chiedere al database", async () => {
  for (const corpo of [{ stanza: STANZA, tipo: "lunedi", file: "../x.webm" }, { stanza: STANZA, tipo: "x", file: FILE }, { stanza: "x", tipo: "lunedi", file: FILE }]) {
    const s = supabaseFinto();
    assert.equal((await filoAmministratoreApi(richiesta("/togli-vocale", { metodo: "POST", corpo }), ENV, s.f)).status, 400);
    assert.equal(s.dove("/rest/v1/rpc").length + s.dove("/storage/").length, 0);
  }
});

test("database che non risponde: 503 riprova", async () => {
  assert.equal((await filoAmministratoreApi(richiesta("/stanze"), ENV, supabaseFinto({ rpc: { stanze_filo_amministratore: 500 } }).f)).status, 503);
  assert.equal((await filoAmministratoreApi(richiesta("/stanze"), { ...ENV, SUPABASE_URL: "https://altro.example" }, supabaseFinto().f)).status, 503);
});

test("nei log mai token, email, testo, nomi o percorsi", async () => {
  const righe = [];
  const originale = console.error;
  console.error = (...a) => righe.push(a.join(" "));
  try {
    await filoAmministratoreApi(richiesta("/assegna", { metodo: "POST", corpo: { stanza: STANZA, email: EMAIL } }), ENV, supabaseFinto({ rpc: { assegna_filo_stanza: 500 } }).f);
    await filoAmministratoreApi(richiesta("/ascolta", { query: `?stanza=${STANZA}&tipo=lunedi` }), ENV, supabaseFinto({ firma: 500 }).f);
    await filoAmministratoreApi(richiesta("/togli-vocale", { metodo: "POST", corpo: { stanza: STANZA, tipo: "lunedi", file: FILE } }), ENV, supabaseFinto({ cancella: 500 }).f);
  } finally {
    console.error = originale;
  }
  const tutto = righe.join("\n");
  for (const segreto of [TOKEN, EMAIL, VOCALE.testo, FILE, STANZA, "Silvia"]) assert.ok(!tutto.includes(segreto), segreto);
});

test("il Worker instrada /app/api/filo-amministratore/* (spento senza ACCESSO_APP)", async () => {
  const r = await worker.fetch(richiesta("/stanze"), { ACCESSO_APP: "no" }, { waitUntil() {} });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).motivo, "spento");
});
