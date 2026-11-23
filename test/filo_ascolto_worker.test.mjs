// Richiesta del Worker GET /app/api/filo/ascolta?tipo=lunedi|domenica (issue #360, spec v1 + v1.1 del CPO, D151 A),
// passo 5b della linea «sviluppatore-c»: un membro della stanza ascolta il vocale del Filo con un link firmato a
// scadenza breve. Chi è lo dice SOLO il token; quale vocale e quando lo decide il database (vocale_filo_membro).
// Spento finché ACCESSO_APP non vale «si». Supabase finto, nessuna rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filoAscoltoApi, PERCORSO_FILO_ASCOLTO, SCADENZA_LINK_S } from "../worker/filo_ascolto_api.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const STANZA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FILE = `${STANZA}/0f0f0f0f-1111-4222-8333-444444444444.webm`;
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const RIGA = { file: FILE, durata: 70, testo: "Benvenuti nella stanza.", filo_nome: "Silvia" };

function supabaseFinto({ utente = 200, righe = [RIGA], rpcStato = 200, firma = 200 } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    const corpo = typeof opzioni.body === "string" ? JSON.parse(opzioni.body) : opzioni.body;
    viste.push({ percorso: u.pathname, metodo: opzioni.method || "GET", headers: opzioni.headers || {}, corpo });
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID }) : new Response("{}", { status: utente });
    if (u.pathname === "/rest/v1/rpc/vocale_filo_membro") return rpcStato === 200 ? Response.json(righe) : new Response("{}", { status: rpcStato });
    if (u.pathname.startsWith("/storage/v1/object/sign/vocali_filo/")) {
      if (firma !== 200) return new Response("{}", { status: firma });
      return Response.json({ signedURL: `/object/sign/vocali_filo/${u.pathname.split("/vocali_filo/")[1]}?token=firmato` });
    }
    return new Response("{}", { status: 404 });
  };
  return { f, viste, dove: (p) => viste.filter((v) => v.percorso.startsWith(p)) };
}

const richiesta = ({ tipo = "lunedi", metodo = "GET", token = TOKEN } = {}) =>
  new Request(`${SITO}${PERCORSO_FILO_ASCOLTO}${tipo === null ? "" : `?tipo=${tipo}`}`, {
    method: metodo, headers: token ? { authorization: `Bearer ${token}` } : {},
  });

test("percorso: /app/api/filo/ascolta", () => assert.equal(PERCORSO_FILO_ASCOLTO, "/app/api/filo/ascolta"));

test("link a scadenza breve: tra 2 e 5 minuti (il vocale dura al massimo 90 secondi)", () => {
  assert.ok(Number.isInteger(SCADENZA_LINK_S) && SCADENZA_LINK_S >= 120 && SCADENZA_LINK_S <= 300);
});

test("spento finché ACCESSO_APP non vale «si»: 404 e nessuna chiamata a Supabase", async () => {
  const s = supabaseFinto();
  const r = await filoAscoltoApi(richiesta(), { ...ENV, ACCESSO_APP: "tester" }, s.f);
  assert.equal(r.status, 404);
  assert.equal(s.viste.length, 0);
});

test("solo GET: 405 con allow", async () => {
  const r = await filoAscoltoApi(richiesta({ metodo: "POST" }), ENV, supabaseFinto().f);
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "GET");
});

test("senza token o con token rifiutato: 401", async () => {
  assert.equal((await filoAscoltoApi(richiesta({ token: null }), ENV, supabaseFinto().f)).status, 401);
  assert.equal((await filoAscoltoApi(richiesta(), ENV, supabaseFinto({ utente: 401 }).f)).status, 401);
});

test("tipo diverso da lunedi/domenica: 400 senza chiedere al database", async () => {
  for (const tipo of [null, "martedi", "LUNEDI"]) {
    const s = supabaseFinto();
    const r = await filoAscoltoApi(richiesta({ tipo }), ENV, s.f);
    assert.equal(r.status, 400, String(tipo));
    assert.equal(s.dove("/rest/v1/rpc").length, 0);
  }
});

test("il database riceve chi lo dice il token, il tipo e l'ora del server", async () => {
  const s = supabaseFinto();
  await filoAscoltoApi(richiesta({ tipo: "domenica" }), ENV, s.f);
  const [rpc] = s.dove("/rest/v1/rpc/vocale_filo_membro");
  assert.equal(rpc.corpo.p_utente, ID);
  assert.equal(rpc.corpo.p_tipo, "domenica");
  assert.ok(Math.abs(Date.parse(rpc.corpo.p_ora) - Date.now()) < 5000);
  assert.equal(rpc.headers.authorization, "Bearer chiave-server-finta");
});

test("vocale ascoltabile: 200 con link firmato, durata, testo e nome del Filo; mai il percorso del file", async () => {
  const s = supabaseFinto();
  const r = await filoAscoltoApi(richiesta(), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const corpo = await r.json();
  assert.deepEqual(corpo, {
    ok: true,
    vocale: { url: `${BASE}/storage/v1/object/sign/vocali_filo/${FILE}?token=firmato`, durata: 70, testo: RIGA.testo, filo: "Silvia", scade_tra: SCADENZA_LINK_S },
  });
  const [firma] = s.dove("/storage/v1/object/sign/");
  assert.equal(firma.metodo, "POST");
  assert.deepEqual(firma.corpo, { expiresIn: SCADENZA_LINK_S });
  assert.equal(firma.percorso, `/storage/v1/object/sign/vocali_filo/${FILE}`);
});

test("nessun vocale ascoltabile (non ancora caricato, fuori orario, non membro): 200 con vocale null, nessun link", async () => {
  const s = supabaseFinto({ righe: [] });
  const r = await filoAscoltoApi(richiesta(), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, vocale: null });
  assert.equal(s.dove("/storage/v1/object/sign/").length, 0);
});

test("percorso del file strano dal database: nessun link, 503", async () => {
  for (const file of ["../altro/x.webm", `${STANZA}/x.exe`, "x.webm", ""]) {
    const s = supabaseFinto({ righe: [{ ...RIGA, file }] });
    const r = await filoAscoltoApi(richiesta(), ENV, s.f);
    assert.equal(r.status, 503, file);
    assert.equal(s.dove("/storage/v1/object/sign/").length, 0);
  }
});

test("database o firma che non rispondono: 503 riprova", async () => {
  assert.equal((await filoAscoltoApi(richiesta(), ENV, supabaseFinto({ rpcStato: 500 }).f)).status, 503);
  assert.equal((await filoAscoltoApi(richiesta(), ENV, supabaseFinto({ firma: 400 }).f)).status, 503);
  assert.equal((await filoAscoltoApi(richiesta(), { ...ENV, SUPABASE_URL: "https://altro.example" }, supabaseFinto().f)).status, 503);
});

test("nei log mai token, testo o percorso del file", async () => {
  const righe = [];
  const originale = console.error;
  console.error = (...a) => righe.push(a.join(" "));
  try {
    await filoAscoltoApi(richiesta(), ENV, supabaseFinto({ firma: 500 }).f);
    await filoAscoltoApi(richiesta(), ENV, supabaseFinto({ rpcStato: 500 }).f);
  } finally {
    console.error = originale;
  }
  const tutto = righe.join("\n");
  for (const segreto of [TOKEN, RIGA.testo, FILE, STANZA, "Silvia"]) assert.ok(!tutto.includes(segreto), segreto);
});

test("il Worker instrada /app/api/filo/ascolta (spento senza ACCESSO_APP)", async () => {
  const r = await worker.fetch(richiesta(), { ACCESSO_APP: "no" }, { waitUntil() {} });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).motivo, "spento");
});
