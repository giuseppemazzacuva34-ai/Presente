// Richiesta del Worker POST /app/api/filo/vocale (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 4b della linea
// «sviluppatore-c»: il Filo carica il vocale del lunedì o della domenica. Modulo multipart: stanza, tipo, durata, testo,
// audio. Chi è il Filo lo dice SOLO il token. Spento finché ACCESSO_APP non vale «si». Supabase finto, nessuna rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filoVocaleApi, PERCORSO_FILO_VOCALE } from "../worker/filo_vocale_api.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const ALTRO = "66666666-7777-4888-9999-000000000000";
const STANZA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const RIGA = { id: STANZA, nome: "Stanza 1", apre_il: "2026-11-30T08:00:00+00:00", chiude_il: "2026-12-07T08:00:00+00:00" };

function supabaseFinto({ utente = 200, stanze = [RIGA], salva = null, salvaStato = 200, carica = 200 } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    const corpo = typeof opzioni.body === "string" ? JSON.parse(opzioni.body) : opzioni.body;
    viste.push({ percorso: u.pathname, metodo: opzioni.method || "GET", headers: opzioni.headers || {}, corpo });
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID }) : new Response("{}", { status: utente });
    if (u.pathname === "/rest/v1/rpc/stanze_del_filo") return Response.json(stanze);
    if (u.pathname === "/rest/v1/rpc/salva_vocale_filo") {
      return salvaStato === 200 ? Response.json(salva) : Response.json({ message: salva }, { status: salvaStato });
    }
    if (u.pathname.startsWith("/storage/v1/object/vocali_filo")) return new Response("{}", { status: opzioni.method === "DELETE" ? 200 : carica });
    return new Response("{}", { status: 404 });
  };
  return { f, viste, dove: (p) => viste.filter((v) => v.percorso.startsWith(p)) };
}

function modulo({ stanza = STANZA, tipo = "lunedi", durata = "45", testo = "Ciao, sono il Filo.", audio = new Blob([new Uint8Array(3000)], { type: "audio/webm;codecs=opus" }), filo } = {}) {
  const m = new FormData();
  if (stanza !== null) m.set("stanza", stanza);
  if (tipo !== null) m.set("tipo", tipo);
  if (durata !== null) m.set("durata", durata);
  if (testo !== null) m.set("testo", testo);
  if (filo) m.set("filo", filo);
  if (audio) m.set("audio", audio, "vocale.webm");
  return m;
}
// Come un browser: il modulo arriva con content-type e content-length dichiarati.
async function richiesta({ metodo = "POST", token = TOKEN, corpo = modulo(), headers = {} } = {}) {
  const h = {};
  if (token) h.authorization = `Bearer ${token}`;
  let body;
  if (metodo === "POST") {
    const r = new Response(corpo);
    body = new Uint8Array(await r.arrayBuffer());
    h["content-type"] = r.headers.get("content-type");
    h["content-length"] = String(body.byteLength);
  }
  return new Request(SITO + PERCORSO_FILO_VOCALE, { method: metodo, headers: { ...h, ...headers }, body });
}

test("percorso: /app/api/filo/vocale", () => assert.equal(PERCORSO_FILO_VOCALE, "/app/api/filo/vocale"));

test("spento finché ACCESSO_APP non vale «si»: 404 e nessuna chiamata a Supabase", async () => {
  const s = supabaseFinto();
  const r = await filoVocaleApi(await richiesta(), { ...ENV, ACCESSO_APP: "tester" }, s.f);
  assert.equal(r.status, 404);
  assert.equal(s.viste.length, 0);
});

test("solo POST: 405 con allow", async () => {
  const r = await filoVocaleApi(await richiesta({ metodo: "GET" }), ENV, supabaseFinto().f);
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "POST");
});

test("senza token valido niente: 401 e nessun file", async () => {
  let s = supabaseFinto();
  assert.equal((await filoVocaleApi(await richiesta({ token: null }), ENV, s.f)).status, 401);
  s = supabaseFinto({ utente: 401 });
  assert.equal((await filoVocaleApi(await richiesta(), ENV, s.f)).status, 401);
  assert.equal(s.dove("/storage").length, 0);
});

test("corpo troppo grande (dichiarato): 413 prima di leggere il token", async () => {
  const s = supabaseFinto();
  const r = await filoVocaleApi(await richiesta({ headers: { "content-length": String(3 * 1024 * 1024) } }), ENV, s.f);
  assert.equal(r.status, 413);
  assert.equal(s.viste.length, 0);
});

test("tutto giusto: 200, file nel contenitore privato, salva_vocale_filo con il Filo del token", async () => {
  const s = supabaseFinto({ salva: null });
  const r = await filoVocaleApi(await richiesta({ corpo: modulo({ filo: ALTRO }) }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, tipo: "lunedi", durata: 45 });
  const [file] = s.dove("/storage/v1/object/vocali_filo/");
  assert.match(file.percorso, new RegExp(`^/storage/v1/object/vocali_filo/${STANZA}/[0-9a-f-]{36}\\.webm$`));
  assert.equal(file.headers["content-type"], "audio/webm");
  assert.equal(file.headers["x-upsert"], "false");
  const [salvato] = s.dove("/rest/v1/rpc/salva_vocale_filo");
  assert.equal(salvato.corpo.p_filo, ID, "un «filo» scritto nel modulo non conta");
  assert.equal(salvato.corpo.p_file, file.percorso.split("/").pop());
  assert.equal(salvato.corpo.p_durata, 45);
  assert.equal(salvato.corpo.p_testo, "Ciao, sono il Filo.");
});

test("fuori orario: 409 con il motivo e il file nuovo cancellato", async () => {
  const s = supabaseFinto({ salva: "fuori_orario", salvaStato: 400 });
  const r = await filoVocaleApi(await richiesta(), ENV, s.f);
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { ok: false, motivo: "fuori_orario" });
  const via = s.viste.find((v) => v.metodo === "DELETE");
  assert.equal(via.percorso, "/storage/v1/object/vocali_filo");
  assert.match(via.corpo.prefixes[0], new RegExp(`^${STANZA}/`));
});

test("stanza non sua: 403, nessun file", async () => {
  const s = supabaseFinto({ stanze: [] });
  const r = await filoVocaleApi(await richiesta(), ENV, s.f);
  assert.equal(r.status, 403);
  assert.equal(s.dove("/storage").length, 0);
});

test("modulo sbagliato: 400 «dati» (manca l'audio, durata non numero, formato non audio, non multipart)", async () => {
  for (const corpo of [modulo({ audio: null }), modulo({ durata: "tanta" }), modulo({ audio: new Blob(["x"], { type: "text/plain" }) }), "ciao"]) {
    const s = supabaseFinto();
    const r = await filoVocaleApi(await richiesta({ corpo }), ENV, s.f);
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { ok: false, motivo: "dati" });
    assert.equal(s.dove("/storage").length, 0);
  }
});

test("Supabase giù: 503 «riprova»", async () => {
  const s = supabaseFinto({ carica: 500 });
  const r = await filoVocaleApi(await richiesta(), ENV, s.f);
  assert.equal(r.status, 503);
  assert.equal(s.dove("/rest/v1/rpc/salva_vocale_filo").length, 0);
});

test("il Worker instrada /app/api/filo/vocale (spento: 404 JSON)", async () => {
  const r = await worker.fetch(await richiesta(), { ...ENV, ACCESSO_APP: "no", ASSETS: { fetch: async () => new Response("x") } }, { waitUntil() {} });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { ok: false, motivo: "spento" });
});

test("senza lunghezza dichiarata (corpo a pezzi): 411, mai un modulo senza limite in memoria", async () => {
  const s = supabaseFinto();
  const pezzi = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10)); c.close(); } });
  const r = await filoVocaleApi(new Request(SITO + PERCORSO_FILO_VOCALE, {
    method: "POST", body: pezzi, duplex: "half", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "multipart/form-data; boundary=x" },
  }), ENV, s.f);
  assert.equal(r.status, 411);
  assert.equal(s.viste.length, 0);
});
