// Richieste del Worker per il Filo per area (issue #360, spec v1.2 del CPO del 25/11), linea «sviluppatore-c»:
//   GET  /app/api/filo-amministratore/aree                              → { ok, aree: [{ tipo, citta, filo_nome, assegnato_il }] }
//   POST /app/api/filo-amministratore/assegna-area { tipo, citta, email } → { ok } | { ok: false, motivo: persona|area }
//   POST /app/api/filo-amministratore/togli-area   { tipo, citta }        → { ok, tolto }
// Chi è lo dice SOLO il token; se è amministratore lo decide il database. Supabase finto, nessuna rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filoAmministratoreApi } from "../worker/filo_amministratore_api.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const EMAIL = "filo.prova@example.com";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const AREE = [{ tipo: "citta", citta: "Milano", filo_nome: "Silvia", assegnato_il: "2026-03-28T10:00:00+00:00" }];

function supabaseFinto({ rpc = {} } = {}) {
  const viste = [];
  const predefiniti = {
    fili_aree_amministratore: { stato: 200, corpo: AREE },
    assegna_filo_area: { stato: 204, corpo: null },
    togli_filo_area: { stato: 200, corpo: true },
  };
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    const corpo = typeof opzioni.body === "string" ? JSON.parse(opzioni.body) : opzioni.body;
    viste.push({ percorso: u.pathname, corpo });
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID });
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const nome = u.pathname.slice("/rest/v1/rpc/".length);
      const r = { ...predefiniti[nome], ...(rpc[nome] || {}) };
      if (r.stato === 204) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(r.corpo), { status: r.stato, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  };
  return { f, viste, rpc: (nome) => viste.filter((v) => v.percorso === `/rest/v1/rpc/${nome}`) };
}

const richiesta = (passo, { metodo = "GET", corpo } = {}) => new Request(`https://presenteincontri.app/app/api/filo-amministratore${passo}`, {
  method: metodo,
  headers: { authorization: `Bearer ${TOKEN}`, ...(corpo === undefined ? {} : { "content-type": "application/json" }) },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});

test("aree: elenco delle aree con il nome del Filo, chi chiede passato al database", async () => {
  const s = supabaseFinto();
  const r = await filoAmministratoreApi(richiesta("/aree"), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, aree: AREE });
  assert.deepEqual(s.rpc("fili_aree_amministratore")[0].corpo, { p_amministratore: ID });
});

test("aree: chi non è amministratore riceve 403", async () => {
  const s = supabaseFinto({ rpc: { fili_aree_amministratore: { stato: 403, corpo: { message: "non_amministratore" } } } });
  const r = await filoAmministratoreApi(richiesta("/aree"), ENV, s.f);
  assert.equal(r.status, 403);
});

test("aree: metodo sbagliato 405", async () => {
  const s = supabaseFinto();
  assert.equal((await filoAmministratoreApi(richiesta("/aree", { metodo: "POST", corpo: {} }), ENV, s.f)).status, 405);
  assert.equal((await filoAmministratoreApi(richiesta("/assegna-area"), ENV, s.f)).status, 405);
  assert.equal((await filoAmministratoreApi(richiesta("/togli-area"), ENV, s.f)).status, 405);
});

test("assegna-area: città con nome ed email, l'ora la mette il server", async () => {
  const s = supabaseFinto();
  const r = await filoAmministratoreApi(richiesta("/assegna-area", { metodo: "POST", corpo: { tipo: "citta", citta: " Milano ", email: ` ${EMAIL} ` } }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const c = s.rpc("assegna_filo_area")[0].corpo;
  assert.equal(c.p_amministratore, ID);
  assert.equal(c.p_tipo, "citta");
  assert.equal(c.p_citta, "Milano");
  assert.equal(c.p_email, EMAIL);
  assert.ok(Math.abs(Date.parse(c.p_ora) - Date.now()) < 5000);
});

test("assegna-area: Stanza Italia senza città", async () => {
  const s = supabaseFinto();
  const r = await filoAmministratoreApi(richiesta("/assegna-area", { metodo: "POST", corpo: { tipo: "italia", email: EMAIL } }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(s.rpc("assegna_filo_area")[0].corpo.p_citta, null);
});

test("assegna-area: dati sbagliati 400 senza chiamare il database", async () => {
  const s = supabaseFinto();
  for (const corpo of [
    { tipo: "regione", citta: "Lombardia", email: EMAIL },
    { tipo: "citta", citta: "", email: EMAIL },
    { tipo: "citta", citta: "x".repeat(81), email: EMAIL },
    { tipo: "italia", citta: "Milano", email: EMAIL },
    { tipo: "citta", citta: "Milano", email: "non-una-email" },
    { tipo: "citta", citta: 3, email: EMAIL },
  ]) {
    const r = await filoAmministratoreApi(richiesta("/assegna-area", { metodo: "POST", corpo }), ENV, s.f);
    assert.equal(r.status, 400, JSON.stringify(corpo));
  }
  assert.equal(s.rpc("assegna_filo_area").length, 0);
});

test("assegna-area: persona sconosciuta torna come motivo, errori ignoti 503", async () => {
  const s = supabaseFinto({ rpc: { assegna_filo_area: { stato: 400, corpo: { message: "persona" } } } });
  const r = await filoAmministratoreApi(richiesta("/assegna-area", { metodo: "POST", corpo: { tipo: "citta", citta: "Milano", email: EMAIL } }), ENV, s.f);
  assert.deepEqual(await r.json(), { ok: false, motivo: "persona" });
  const s2 = supabaseFinto({ rpc: { assegna_filo_area: { stato: 400, corpo: { message: "altro" } } } });
  const r2 = await filoAmministratoreApi(richiesta("/assegna-area", { metodo: "POST", corpo: { tipo: "citta", citta: "Milano", email: EMAIL } }), ENV, s2.f);
  assert.equal(r2.status, 503);
});

test("assegna-area: l'email non torna nella risposta", async () => {
  const s = supabaseFinto();
  const r = await filoAmministratoreApi(richiesta("/assegna-area", { metodo: "POST", corpo: { tipo: "citta", citta: "Milano", email: EMAIL } }), ENV, s.f);
  assert.ok(!(await r.text()).includes(EMAIL));
});

test("togli-area: toglie il Filo dall'area e dice se c'era", async () => {
  const s = supabaseFinto({ rpc: { togli_filo_area: { stato: 200, corpo: false } } });
  const r = await filoAmministratoreApi(richiesta("/togli-area", { metodo: "POST", corpo: { tipo: "citta", citta: "Milano" } }), ENV, s.f);
  assert.deepEqual(await r.json(), { ok: true, tolto: false });
  assert.deepEqual(s.rpc("togli_filo_area")[0].corpo, { p_amministratore: ID, p_tipo: "citta", p_citta: "Milano" });
});

test("togli-area: dati sbagliati 400", async () => {
  const s = supabaseFinto();
  const r = await filoAmministratoreApi(richiesta("/togli-area", { metodo: "POST", corpo: { tipo: "citta" } }), ENV, s.f);
  assert.equal(r.status, 400);
  assert.equal(s.rpc("togli_filo_area").length, 0);
});

test("aree: spento finché ACCESSO_APP non vale «si»", async () => {
  const s = supabaseFinto();
  const r = await filoAmministratoreApi(richiesta("/aree"), { ...ENV, ACCESSO_APP: "no" }, s.f);
  assert.equal(r.status, 404);
  assert.equal(s.viste.length, 0);
});
