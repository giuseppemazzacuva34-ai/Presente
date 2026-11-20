// «Disdici» nella richiesta del Worker /app/api/incontro (issue #6 spec v1.1, passo 2m, linea «sviluppatore-b»):
// POST { azione: "disdici", porta } → public.disdici_incontro. Chi disdice lo dice SOLO il token; le regole (6 ore,
// buca, da fissare) le applica il database. Supabase finto, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { incontroApi, PERCORSO_INCONTRO } from "../worker/incontro_api.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const ALTRO = "66666666-7777-4888-9999-000000000000";
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const ORARIO = "2026-11-20T18:00:00.000Z";

function supabaseFinto({ utente = 200, rpc = {} } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID, email: "prova@example.com" }) : new Response("{}", { status: utente });
    const nome = u.pathname.replace("/rest/v1/rpc/", "");
    if (nome in rpc) return rpc[nome] instanceof Response ? rpc[nome] : Response.json(rpc[nome]);
    return new Response("{}", { status: 404 });
  };
  return { f, viste, rpc: (nome) => viste.filter((v) => v.percorso === `/rest/v1/rpc/${nome}`) };
}
function richiesta({ metodo = "POST", corpo = null, token = TOKEN, percorso = PERCORSO_INCONTRO } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== null) headers["content-type"] = "application/json";
  return new Request(SITO + percorso, { method: metodo, headers, body: corpo === null ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
}
const disdici = (extra = {}) => richiesta({ corpo: { azione: "disdici", porta: PORTA, ...extra } });

test("disdici: la persona è quella del token, mai quella del corpo", async () => {
  const s = supabaseFinto({ rpc: { disdici_incontro: "disdetto" } });
  const r = await incontroApi(disdici({ persona: ALTRO, p_persona: ALTRO }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, esito: "disdetto" });
  assert.deepEqual(s.rpc("disdici_incontro")[0].corpo, { p_porta: PORTA, p_persona: ID });
});

test("disdici: meno di 6 ore prima → «disdetto_tardi» (buca, la decide il database)", async () => {
  const r = await incontroApi(disdici(), ENV, supabaseFinto({ rpc: { disdici_incontro: "disdetto_tardi" } }).f);
  assert.deepEqual(await r.json(), { ok: true, esito: "disdetto_tardi" });
});

test("disdici: rifiuti con il motivo del database", async () => {
  for (const motivo of ["non_confermato", "troppo_tardi", "incontro_chiuso", "incontro_scaduto"]) {
    const r = await incontroApi(disdici(), ENV, supabaseFinto({ rpc: { disdici_incontro: motivo } }).f);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: false, motivo });
  }
});

test("disdici: porta di altri o senza incontro → 404; esito sconosciuto → 503", async () => {
  for (const motivo of ["non_nella_porta", "nessun_incontro"]) {
    const r = await incontroApi(disdici(), ENV, supabaseFinto({ rpc: { disdici_incontro: motivo } }).f);
    assert.equal(r.status, 404);
  }
  const r = await incontroApi(disdici(), ENV, supabaseFinto({ rpc: { disdici_incontro: "boh" } }).f);
  assert.equal(r.status, 503);
});

test("disdici: porta non valida → 400, nessuna chiamata al database", async () => {
  const s = supabaseFinto({ rpc: { disdici_incontro: "disdetto" } });
  const r = await incontroApi(richiesta({ corpo: { azione: "disdici", porta: "x" } }), ENV, s.f);
  assert.equal(r.status, 400);
  assert.equal(s.rpc("disdici_incontro").length, 0);
});
