// Richiesta del Worker /app/api/coin (issue #349 / spec #331 v1.1, passo 5b, linea «sviluppatore-b»): saldo, prima
// stanza usata (per il foglio «Coin quasi finiti») e stato dell'interruttore PAGAMENTI_GOMRY, spento di base.
// Chi chiede lo dice SOLO il token. Spento finché ACCESSO_APP non vale «si». Supabase finto, nessun servizio esterno.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coinApi, PERCORSO_COIN, pagamentiAccesi } from "../worker/coin_api.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
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
const richiesta = ({ metodo = "GET", token = TOKEN } = {}) =>
  new Request(SITO + PERCORSO_COIN, { method: metodo, headers: token ? { authorization: `Bearer ${token}` } : {} });

test("spento finché ACCESSO_APP non vale «si»: nessuna chiamata a Supabase", async () => {
  const s = supabaseFinto();
  const r = await coinApi(richiesta(), { ...ENV, ACCESSO_APP: "no" }, s.f);
  assert.equal(r.status, 404);
  assert.equal(s.viste.length, 0);
});

test("senza token valido: 401", async () => {
  assert.equal((await coinApi(richiesta({ token: null }), ENV, supabaseFinto().f)).status, 401);
  assert.equal((await coinApi(richiesta(), ENV, supabaseFinto({ utente: 401 }).f)).status, 401);
});

test("solo GET", async () => {
  const r = await coinApi(richiesta({ metodo: "POST" }), ENV, supabaseFinto().f);
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "GET");
});

test("GET: saldo, prima stanza usata e pagamenti spenti di base", async () => {
  const s = supabaseFinto({ rpc: { saldo_crediti: 15, prima_stanza_usata: true } });
  const r = await coinApi(richiesta(), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, saldo: 15, primaStanzaUsata: true, pagamenti: false });
  assert.deepEqual(s.rpc("saldo_crediti")[0].corpo, { p_persona: ID });
  assert.deepEqual(s.rpc("prima_stanza_usata")[0].corpo, { p_persona: ID });
});

test("risposte strane del database: 503 «riprova», mai numeri inventati", async () => {
  for (const rpc of [{ saldo_crediti: "15", prima_stanza_usata: true }, { saldo_crediti: 15, prima_stanza_usata: "si" },
    { saldo_crediti: 15, prima_stanza_usata: new Response("{}", { status: 500 }) }]) {
    const r = await coinApi(richiesta(), ENV, supabaseFinto({ rpc }).f);
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { ok: false, motivo: "riprova" });
  }
});

test("interruttore PAGAMENTI_GOMRY: acceso solo con «si» esatto", () => {
  assert.equal(pagamentiAccesi({}), false);
  for (const v of ["no", "SI", "true", "1", " si", ""]) assert.equal(pagamentiAccesi({ PAGAMENTI_GOMRY: v }), false, v);
  assert.equal(pagamentiAccesi({ PAGAMENTI_GOMRY: "si" }), true);
});

test("con l'interruttore acceso la risposta lo dice; nessuna chiamata fuori da Supabase", async () => {
  const s = supabaseFinto({ rpc: { saldo_crediti: 0, prima_stanza_usata: false } });
  const r = await coinApi(richiesta(), { ...ENV, PAGAMENTI_GOMRY: "si" }, s.f);
  assert.equal((await r.json()).pagamenti, true);
  assert.ok(s.viste.every((v) => v.percorso === "/auth/v1/user" || v.percorso.startsWith("/rest/v1/rpc/")));
});

test("il Worker instrada /app/api/coin con le intestazioni dell'app", async () => {
  const r = await worker.fetch(richiesta(), { ...ENV, ACCESSO_APP: "no", ASSETS: { fetch: async () => new Response("x") } }, {});
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.ok(r.headers.get("content-security-policy"));
});

test("sicurezza: nessun pagamento, nessun log di persone, interruttore non scritto nella configurazione", () => {
  const src = readFileSync(new URL("../worker/coin_api.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /gomry\.|stripe|console\.(log|info)\(/i);
  const conf = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.doesNotMatch(conf, /PAGAMENTI_GOMRY/);
});
