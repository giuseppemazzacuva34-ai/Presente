// Precompilazione della provincia dalla lista d'attesa (#2 v1.3). D1 e Supabase sono finti: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { provinciaLista, siglaDallaLista, PERCORSO_PROVINCIA_LISTA } from "../worker/provincia_lista.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const URL_API = "https://presenteincontri.app" + PERCORSO_PROVINCIA_LISTA;

// Lista d'attesa finta: righe per email, con o senza la colonna provincia.
function dbFinto(righe, { senzaColonna = false, lento = 0, rotto = false } = {}) {
  const domande = [];
  return {
    domande,
    prepare(sql) {
      return {
        bind(...valori) {
          return {
            async first() {
              domande.push({ sql, valori });
              if (lento) await new Promise((r) => setTimeout(r, lento));
              if (rotto) throw new Error("D1 non risponde");
              if (senzaColonna && /provincia/.test(sql)) throw new Error("no such column: provincia");
              const r = righe[valori[0]];
              return r ? { ...r } : null;
            },
          };
        },
      };
    },
  };
}

function supabaseFinto({ email = "anna@example.com", confermata = true, utente = 200, rpc = true } = {}) {
  const chiamate = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    chiamate.push({ percorso: u.pathname, metodo: opzioni.method || "GET", corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.origin !== BASE) throw new Error("rete assente");
    if (u.pathname === "/auth/v1/user") {
      if (utente !== 200) return new Response("{}", { status: utente });
      return Response.json({ id: ID, email, email_confirmed_at: confermata ? "2026-11-06T10:00:00Z" : null });
    }
    if (u.pathname === "/rest/v1/rpc/conferma_provincia_lista") return Response.json(rpc);
    return new Response("{}", { status: 404 });
  };
  return { f, chiamate };
}

function env(db, extra = {}) {
  return { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-servizio-finta", DB: db, ...extra };
}

function richiesta({ metodo = "GET", token = TOKEN, corpo, origine = "https://presenteincontri.app" } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (origine) headers.origin = origine;
  if (corpo) headers["content-type"] = "application/json";
  return new Request(URL_API, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
}

const LISTA = {
  "anna@example.com": { provincia: "RM", zona: "roma", citta: null },
  "bea@example.com": { provincia: null, zona: "venezia-padova", citta: null },
  "carla@example.com": { provincia: null, zona: "milano", citta: null },
  "dora@example.com": { provincia: "XX", zona: "altra-citta-italia", citta: "boh" },
  "elena@example.com": { provincia: null, zona: "non-indicata", citta: null },
};

test("email in lista con provincia RM → risponde solo con la sigla", async () => {
  const s = supabaseFinto();
  const r = await provinciaLista(richiesta(), env(dbFinto(LISTA)), s.f);
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.deepEqual(corpo, { sigla: "RM" });
  assert.deepEqual(Object.keys(corpo), ["sigla"], "nessun altro campo della lista arriva al telefono");
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("zona «venezia-padova» (due province) → nessuna sigla", async () => {
  const r = await provinciaLista(richiesta(), env(dbFinto(LISTA)), supabaseFinto({ email: "bea@example.com" }).f);
  assert.deepEqual(await r.json(), { sigla: null });
});

test("lista vecchia con sola città sicura (milano) → MI", async () => {
  const r = await provinciaLista(richiesta(), env(dbFinto(LISTA)), supabaseFinto({ email: "carla@example.com" }).f);
  assert.deepEqual(await r.json(), { sigla: "MI" });
});

test("database senza la colonna provincia → si usa la zona", async () => {
  const r = await provinciaLista(richiesta(), env(dbFinto(LISTA, { senzaColonna: true })), supabaseFinto({ email: "carla@example.com" }).f);
  assert.deepEqual(await r.json(), { sigla: "MI" });
});

test("email non in lista, o zona non indicata → nessuna sigla", async () => {
  for (const email of ["zoe@example.com", "elena@example.com"]) {
    const r = await provinciaLista(richiesta(), env(dbFinto(LISTA)), supabaseFinto({ email }).f);
    assert.deepEqual(await r.json(), { sigla: null }, email);
  }
});

test("sigla in lista non più valida → nessuna sigla e log senza email", async () => {
  const log = [];
  const prima = console.error;
  console.error = (...a) => log.push(a.join(" "));
  try {
    const r = await provinciaLista(richiesta(), env(dbFinto(LISTA)), supabaseFinto({ email: "dora@example.com" }).f);
    assert.deepEqual(await r.json(), { sigla: null });
  } finally {
    console.error = prima;
  }
  assert.equal(log.length, 1);
  assert.ok(!log[0].includes("dora") && !log[0].includes("@"), "nel log nessuna email");
});

test("email non confermata → nessuna precompilazione (e niente lettura della lista)", async () => {
  const db = dbFinto(LISTA);
  const r = await provinciaLista(richiesta(), env(db), supabaseFinto({ confermata: false }).f);
  assert.deepEqual(await r.json(), { sigla: null });
  assert.equal(db.domande.length, 0);
});

test("la lista si cerca con l'email del login in minuscolo", async () => {
  const db = dbFinto(LISTA);
  await provinciaLista(richiesta(), env(db), supabaseFinto({ email: "Anna@Example.com" }).f);
  assert.equal(db.domande[0].valori[0], "anna@example.com");
});

test("lista lenta o rotta → risposta vuota entro i tempi, mai un errore", async () => {
  const inizio = Date.now();
  const r = await provinciaLista(richiesta(), env(dbFinto(LISTA, { lento: 5000 })), supabaseFinto().f);
  assert.deepEqual(await r.json(), { sigla: null });
  assert.ok(Date.now() - inizio < 2000, "risponde prima dei 2 secondi");
  const r2 = await provinciaLista(richiesta(), env(dbFinto(LISTA, { rotto: true })), supabaseFinto().f);
  assert.deepEqual(await r2.json(), { sigla: null });
});

test("senza token o con token rifiutato → 401; spento → 404", async () => {
  assert.equal((await provinciaLista(richiesta({ token: null }), env(dbFinto(LISTA)), supabaseFinto().f)).status, 401);
  assert.equal((await provinciaLista(richiesta(), env(dbFinto(LISTA)), supabaseFinto({ utente: 401 }).f)).status, 401);
  assert.equal((await provinciaLista(richiesta(), env(dbFinto(LISTA), { ACCESSO_APP: "no" }), supabaseFinto().f)).status, 404);
});

test("conferma: stessa sigla della lista → il server la salva con origine «lista»", async () => {
  const s = supabaseFinto();
  const r = await provinciaLista(richiesta({ metodo: "POST", corpo: { sigla: "RM" } }), env(dbFinto(LISTA)), s.f);
  assert.deepEqual(await r.json(), { lista: true });
  const rpc = s.chiamate.find((c) => c.percorso === "/rest/v1/rpc/conferma_provincia_lista");
  assert.deepEqual(rpc.corpo, { utente: ID, sigla: "RM" }, "id da Supabase, mai dal telefono");
});

test("conferma: sigla diversa dalla lista → niente «lista», nessuna scrittura", async () => {
  const s = supabaseFinto();
  const r = await provinciaLista(richiesta({ metodo: "POST", corpo: { sigla: "MI" } }), env(dbFinto(LISTA)), s.f);
  assert.deepEqual(await r.json(), { lista: false });
  assert.ok(!s.chiamate.some((c) => c.percorso.startsWith("/rest/")));
});

test("conferma: da un altro sito → 403", async () => {
  const r = await provinciaLista(richiesta({ metodo: "POST", corpo: { sigla: "RM" }, origine: "https://altro.example" }), env(dbFinto(LISTA)), supabaseFinto().f);
  assert.equal(r.status, 403);
});

test("siglaDallaLista: senza DB → null", async () => {
  assert.equal(await siglaDallaLista({}, "anna@example.com"), null);
});

test("il Worker instrada la rotta con le intestazioni dell'app", async () => {
  const r = await worker.fetch(richiesta(), env(dbFinto(LISTA), { ACCESSO_APP: "no" }), {});
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(r.headers.get("content-security-policy") || "", /default-src 'self'/);
});
