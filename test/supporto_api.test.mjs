// «Scrivici» della pagina Aiuto (issue #10, parte A, passo 2 della linea «sviluppatore-c»).
//   POST /app/api/supporto { categoria, testo } → invia un messaggio
//   GET  /app/api/supporto                      → «I miei messaggi»
// Chi scrive lo dice SOLO il token. Spento finché ACCESSO_APP non vale «si». Supabase finto, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { supportoApi, PERCORSO_SUPPORTO } from "../worker/supporto_api.js";
import { inviaSupporto, mieiMessaggi, CATEGORIE, MAX_CARATTERI, inviaDb, mieiDb } from "../api/supporto.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const ALTRO = "66666666-7777-4888-9999-000000000000";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

function supabaseFinto({ utente = 200, rpc = {} } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null, headers: opzioni.headers || {} });
    if (u.origin !== BASE) throw new Error("rete assente");
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID, email: "prova@example.invalid" }) : new Response("{}", { status: utente });
    const nome = u.pathname.replace("/rest/v1/rpc/", "");
    if (nome in rpc) return typeof rpc[nome] === "number" ? new Response("{}", { status: rpc[nome] }) : Response.json(rpc[nome]);
    return new Response("{}", { status: 404 });
  };
  return { f, viste };
}
// Database finto: risponde come le funzioni invia_supporto e miei_messaggi_supporto.
function finta({ invia = { esito: "inviato", id: ALTRO, sicurezza: false }, miei = [] } = {}) {
  const ricevute = [];
  return {
    ricevute,
    invia: async (q) => { ricevute.push(["invia", q]); return invia; },
    miei: async (q) => { ricevute.push(["miei", q]); return miei; },
  };
}
function richiesta({ metodo = "POST", corpo = { categoria: "account", testo: "Non riesco a entrare" }, token = TOKEN, percorso = PERCORSO_SUPPORTO } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== null) headers["content-type"] = "application/json";
  return new Request(SITO + percorso, { method: metodo, headers, body: corpo === null ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
}

// ---- Regole (api/supporto.js) ------------------------------------------------------------------------------

test("le 7 categorie della spec, con i codici del database", () => {
  assert.deepEqual(Object.keys(CATEGORIE), ["account", "stanza_chiamate", "chiavi_porte", "crediti", "incontro", "test", "altro"]);
  assert.equal(CATEGORIE.account, "Account e accesso");
  assert.equal(MAX_CARATTERI, 1000);
});

test("testo vuoto o solo spazi: «vuoto», senza toccare il database", async () => {
  const salvati = [];
  const d = { invia: async (q) => { salvati.push(q); return { esito: "inviato" }; } };
  assert.deepEqual(await inviaSupporto({ utente: ID, corpo: { categoria: "altro", testo: "   \n " } }, d), { ok: false, motivo: "vuoto" });
  assert.equal(salvati.length, 0);
});

test("categoria fuori elenco, testo non stringa o oltre 1.000 caratteri: «dati»", async () => {
  const d = { invia: async () => ({ esito: "inviato", id: ALTRO, sicurezza: false }) };
  assert.deepEqual(await inviaSupporto({ utente: ID, corpo: { categoria: "rimborso", testo: "ciao" } }, d), { ok: false, motivo: "dati" });
  assert.deepEqual(await inviaSupporto({ utente: ID, corpo: { categoria: "altro", testo: 42 } }, d), { ok: false, motivo: "dati" });
  assert.deepEqual(await inviaSupporto({ utente: ID, corpo: { categoria: "altro", testo: "a".repeat(1001) } }, d), { ok: false, motivo: "dati" });
  assert.deepEqual(await inviaSupporto({ utente: "non-uuid", corpo: { categoria: "altro", testo: "ciao" } }, d), { ok: false, motivo: "dati" });
});

test("1.000 caratteri contati come lettere vere (emoji = 1), come nel database", async () => {
  const d = { invia: async () => ({ esito: "inviato", id: ALTRO, sicurezza: false }) };
  const r = await inviaSupporto({ utente: ID, corpo: { categoria: "altro", testo: "😀".repeat(1000) } }, d);
  assert.equal(r.ok, true);
});

test("inviato: torna id e bandiera «sicurezza»; il 6° del giorno: «troppi»", async () => {
  const ok = await inviaSupporto({ utente: ID, corpo: { categoria: "incontro", testo: "mi segue" } }, { invia: async () => ({ esito: "inviato", id: ALTRO, sicurezza: true }) });
  assert.deepEqual(ok, { ok: true, id: ALTRO, sicurezza: true });
  const troppi = await inviaSupporto({ utente: ID, corpo: { categoria: "altro", testo: "ciao" } }, { invia: async () => ({ esito: "troppi" }) });
  assert.deepEqual(troppi, { ok: false, motivo: "troppi" });
  const giu = await inviaSupporto({ utente: ID, corpo: { categoria: "altro", testo: "ciao" } }, { invia: async () => null });
  assert.deepEqual(giu, { ok: false, motivo: "riprova" });
});

test("database: invia_supporto riceve l'utente del server, la categoria e il testo", async () => {
  const { f, viste } = supabaseFinto({ rpc: { invia_supporto: { esito: "inviato", id: ALTRO, sicurezza: false } } });
  const r = await inviaDb(ENV, { utente: ID, categoria: "crediti", testo: "domanda" }, f);
  assert.deepEqual(r, { esito: "inviato", id: ALTRO, sicurezza: false });
  assert.equal(viste[0].percorso, "/rest/v1/rpc/invia_supporto");
  assert.deepEqual(viste[0].corpo, { p_utente: ID, p_categoria: "crediti", p_testo: "domanda" });
  assert.equal(await inviaDb(ENV, { utente: ID, categoria: "crediti", testo: "x" }, supabaseFinto({ rpc: { invia_supporto: 500 } }).f), null);
  assert.equal(await inviaDb({}, { utente: ID, categoria: "crediti", testo: "x" }, f), null);
});

test("«I miei messaggi»: solo i campi per il telefono, stato Inviato/Risposto", async () => {
  const righe = [
    { id: ALTRO, categoria: "altro", testo: "ciao", creato_il: "2026-11-16T10:00:00Z", stato: "risposto", risposta: "Eccoci", risposto_il: "2026-11-16T12:00:00Z", extra: "no" },
  ];
  const { f, viste } = supabaseFinto({ rpc: { miei_messaggi_supporto: righe } });
  const r = await mieiMessaggi({ utente: ID }, { miei: (q) => mieiDb(ENV, q, f) });
  assert.deepEqual(r, { ok: true, messaggi: [{ id: ALTRO, categoria: "altro", testo: "ciao", creatoIl: "2026-11-16T10:00:00Z", stato: "risposto", risposta: "Eccoci", rispostoIl: "2026-11-16T12:00:00Z" }] });
  assert.deepEqual(viste[0].corpo, { p_utente: ID });
  const giu = await mieiMessaggi({ utente: ID }, { miei: (q) => mieiDb(ENV, q, supabaseFinto({ rpc: { miei_messaggi_supporto: 503 } }).f) });
  assert.deepEqual(giu, { ok: false, motivo: "riprova" });
});

// ---- Richiesta del Worker (worker/supporto_api.js) ----------------------------------------------------------

test("spento finché ACCESSO_APP non vale «si»: nessuna chiamata a Supabase", async () => {
  const { f, viste } = supabaseFinto();
  const op = finta();
  const r = await supportoApi(richiesta(), { ...ENV, ACCESSO_APP: "no" }, f, op);
  assert.equal(r.status, 404);
  assert.equal(viste.length, 0);
  assert.equal(op.ricevute.length, 0);
});

test("solo GET e POST, solo con un token valido", async () => {
  assert.equal((await supportoApi(richiesta({ metodo: "DELETE", corpo: null }), ENV, supabaseFinto().f, finta())).status, 405);
  assert.equal((await supportoApi(richiesta({ token: null }), ENV, supabaseFinto().f, finta())).status, 401);
  assert.equal((await supportoApi(richiesta(), ENV, supabaseFinto({ utente: 401 }).f, finta())).status, 401);
});

test("chi scrive è quello del token, anche se il corpo dice altro", async () => {
  const op = finta();
  const r = await supportoApi(richiesta({ corpo: { categoria: "account", testo: "aiuto", utente: ALTRO } }), ENV, supabaseFinto().f, op);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, id: ALTRO, sicurezza: false });
  assert.equal(op.ricevute[0][1].utente, ID);
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("GET: i messaggi sono sempre quelli dell'utente del token", async () => {
  const op = finta({ miei: [{ id: ALTRO, categoria: "altro", testo: "ciao", creato_il: "2026-11-16T10:00:00Z", stato: "inviato", risposta: null, risposto_il: null }] });
  const r = await supportoApi(richiesta({ metodo: "GET", corpo: null, percorso: PERCORSO_SUPPORTO + "?utente=" + ALTRO }), ENV, supabaseFinto().f, op);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, email: "prova@example.invalid", messaggi: [{ id: ALTRO, categoria: "altro", testo: "ciao", creatoIl: "2026-11-16T10:00:00Z", stato: "inviato", risposta: null, rispostoIl: null }] });
  assert.deepEqual(op.ricevute[0], ["miei", { utente: ID }]);
});

test("codici: JSON rotto 400, corpo enorme 413, «vuoto» e «troppi» 200 col motivo, database giù 503", async () => {
  assert.equal((await supportoApi(richiesta({ corpo: "non json" }), ENV, supabaseFinto().f, finta())).status, 400);
  assert.equal((await supportoApi(richiesta({ corpo: { categoria: "altro", testo: "x".repeat(20000) } }), ENV, supabaseFinto().f, finta())).status, 413);
  assert.equal((await supportoApi(richiesta({ corpo: { categoria: "rimborso", testo: "x" } }), ENV, supabaseFinto().f, finta())).status, 400);
  for (const motivo of ["vuoto", "troppi"]) {
    const r = await supportoApi(richiesta(), ENV, supabaseFinto().f, finta({ invia: { esito: motivo } }));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: false, motivo });
  }
  assert.equal((await supportoApi(richiesta(), ENV, supabaseFinto().f, finta({ invia: null }))).status, 503);
});

test("nessun testo del messaggio nei log, nemmeno quando il database è giù", async () => {
  const scritti = [];
  const prima = console.error;
  console.error = (...a) => scritti.push(a.join(" "));
  try {
    const { f } = supabaseFinto({ rpc: { invia_supporto: 500 } });
    const r = await supportoApi(richiesta({ corpo: { categoria: "altro", testo: "SEGRETO-DI-PROVA" } }), ENV, f);
    assert.equal(r.status, 503);
  } finally {
    console.error = prima;
  }
  assert.ok(!scritti.some((s) => s.includes("SEGRETO-DI-PROVA")));
});

test("il Worker instrada /app/api/supporto (spento senza ACCESSO_APP)", async () => {
  const r = await worker.fetch(richiesta(), { ...ENV, ACCESSO_APP: "no" }, {});
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { ok: false, motivo: "spento" });
});

test("GET: torna anche l'email dell'account (quella della risposta, solo da mostrare)", async () => {
  const r = await supportoApi(richiesta({ metodo: "GET", corpo: null }), ENV, supabaseFinto().f, finta());
  const dati = await r.json();
  assert.equal(dati.email, "prova@example.invalid");
  const conPost = await supportoApi(richiesta(), ENV, supabaseFinto().f, finta());
  assert.equal("email" in (await conPost.json()), false);
});
