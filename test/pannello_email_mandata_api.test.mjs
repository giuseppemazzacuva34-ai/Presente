// «Ho mandato l'email» nel pannello (issue #7 spec v1.3; D144 A di Giuseppe). Linea «sviluppatore-b», passo 15e.
// POST /app/api/pannello/mandata { id: sanzione } → { ok: true, mandata_il } salva data e ora (una volta sola, nel database);
// POST /app/api/pannello/email dice anche se era già segnata (mandata_il). Chi decide = token + moderatori.
// Nessun invio da qui. Supabase finto, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pannelloApi, PERCORSO_PANNELLO } from "../worker/pannello_api.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const ZID = "66666666-7777-4888-9999-000000000000";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const EMAIL = { a: "persona@example.com", livello: "avviso", regola: "affari", fine_il: null };
const QUANDO = "2026-11-21T15:00:00.123+00:00";

function supabase({ moderatore = true, segna = QUANDO, letta = null, viste = [] } = {}) {
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID });
    viste.push([u.pathname, JSON.parse(init.body || "{}")]);
    if (u.pathname === "/rest/v1/rpc/e_moderatore") return Response.json(moderatore);
    if (u.pathname === "/rest/v1/rpc/email_sanzione") return Response.json(EMAIL);
    if (u.pathname === "/rest/v1/rpc/email_mandata") return letta instanceof Response ? letta : Response.json(letta);
    if (u.pathname === "/rest/v1/rpc/segna_email_mandata") return segna instanceof Response ? segna : Response.json(segna);
    return new Response("{}", { status: 404 });
  };
}
const richiesta = (percorso, corpo, metodo = "POST") => new Request(`https://presenteincontri.app${PERCORSO_PANNELLO}${percorso}`, {
  method: metodo, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
  body: metodo === "POST" ? JSON.stringify(corpo) : undefined });

test("mandata: salva col moderatore del token e restituisce data e ora", async () => {
  const viste = [];
  const r = await pannelloApi(richiesta("/mandata", { id: ZID, p_moderatore: ZID }), ENV, supabase({ viste }));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, mandata_il: QUANDO });
  assert.deepEqual(viste.find((v) => v[0] === "/rest/v1/rpc/segna_email_mandata")[1], { p_moderatore: ID, p_sanzione: ZID });
});

test("mandata: solo POST; chi non è moderatore riceve 403 e non segna nulla", async () => {
  assert.equal((await pannelloApi(richiesta("/mandata", null, "GET"), ENV, supabase())).status, 405);
  const viste = [];
  const r = await pannelloApi(richiesta("/mandata", { id: ZID }), ENV, supabase({ moderatore: false, viste }));
  assert.equal(r.status, 403);
  assert.equal(viste.some((v) => v[0] === "/rest/v1/rpc/segna_email_mandata"), false);
});

test("mandata: id malformato → 400; sanzione non sua → 404; data strana o guasto → 503", async () => {
  assert.equal((await pannelloApi(richiesta("/mandata", { id: "x" }), ENV, supabase())).status, 400);
  assert.equal((await pannelloApi(richiesta("/mandata", { id: ZID }), ENV, supabase({ segna: null }))).status, 404);
  for (const strana of ["non una data", 12, { a: 1 }, new Response("{}", { status: 500 })]) {
    const r = await pannelloApi(richiesta("/mandata", { id: ZID }), ENV, supabase({ segna: strana }));
    assert.equal(r.status, 503, String(strana));
  }
});

test("email: dice anche se «Email mandata» era già segnata", async () => {
  const prima = await pannelloApi(richiesta("/email", { id: ZID }), ENV, supabase());
  assert.deepEqual(await prima.json(), { ok: true, email: EMAIL, mandata_il: null });
  const dopo = await pannelloApi(richiesta("/email", { id: ZID }), ENV, supabase({ letta: QUANDO }));
  assert.deepEqual(await dopo.json(), { ok: true, email: EMAIL, mandata_il: QUANDO });
  // Se la data non si legge, il testo pronto si mostra lo stesso (mandata_il null): la sanzione resta salvata.
  const guasto = await pannelloApi(richiesta("/email", { id: ZID }), ENV, supabase({ letta: new Response("{}", { status: 500 }) }));
  assert.deepEqual(await guasto.json(), { ok: true, email: EMAIL, mandata_il: null });
});
