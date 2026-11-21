// Email a chi riceve una sanzione nel pannello (issue #7 spec v1.1 punto 7; D144 A di Giuseppe). Linea «sviluppatore-b»,
// passo 15b. POST /app/api/pannello/email { id: sanzione } → { ok: true, email: { a, livello, regola, fine_il } }.
// Chi decide = token + moderatori; il database dà l'indirizzo solo a chi ha deciso quella sanzione (passo 15a).
// Nessun invio: l'email la manda Giuseppe a mano. Mai l'indirizzo nei log. Supabase finto, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pannelloApi, PERCORSO_PANNELLO } from "../worker/pannello_api.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const ZID = "66666666-7777-4888-9999-000000000000";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const EMAIL = { a: "persona@example.com", livello: "sospensione_7", regola: "soldi", fine_il: "2026-11-28T10:00:00+00:00" };

function supabase({ moderatore = true, email = EMAIL, viste = [] } = {}) {
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID });
    viste.push([u.pathname, JSON.parse(init.body || "{}")]);
    if (u.pathname === "/rest/v1/rpc/e_moderatore") return Response.json(moderatore);
    if (u.pathname === "/rest/v1/rpc/email_sanzione") return email instanceof Response ? email : Response.json(email);
    return new Response("{}", { status: 404 });
  };
}
const richiesta = (corpo) => new Request(`https://presenteincontri.app${PERCORSO_PANNELLO}/email`, {
  method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(corpo) });

test("email: chiesta col moderatore del token, mai con uno del corpo", async () => {
  const viste = [];
  const r = await pannelloApi(richiesta({ id: ZID, moderatore: ZID, p_moderatore: ZID }), ENV, supabase({ viste }));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, email: EMAIL });
  assert.deepEqual(viste.find((v) => v[0] === "/rest/v1/rpc/email_sanzione")[1], { p_moderatore: ID, p_sanzione: ZID });
});

test("email: chi non è moderatore riceve 403 e il database non viene chiesto", async () => {
  const viste = [];
  const r = await pannelloApi(richiesta({ id: ZID }), ENV, supabase({ moderatore: false, viste }));
  assert.equal(r.status, 403);
  assert.equal(viste.some((v) => v[0] === "/rest/v1/rpc/email_sanzione"), false);
});

test("email: id malformato → 400; il database dice null → 404", async () => {
  assert.equal((await pannelloApi(richiesta({ id: "x" }), ENV, supabase())).status, 400);
  const r = await pannelloApi(richiesta({ id: ZID }), ENV, supabase({ email: null }));
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { ok: false, motivo: "non_trovato" });
});

test("email: passano solo i campi previsti e di forma giusta", async () => {
  const r = await pannelloApi(richiesta({ id: ZID }), ENV, supabase({ email: { ...EMAIL, motivo: "segreto", segnalato_da: ID } }));
  assert.deepEqual(await r.json(), { ok: true, email: EMAIL });
  for (const strana of [{ ...EMAIL, a: "non-un-indirizzo" }, { ...EMAIL, livello: "multa" }, { ...EMAIL, regola: 3 }, "x"]) {
    const s = await pannelloApi(richiesta({ id: ZID }), ENV, supabase({ email: strana }));
    assert.equal(s.status, 503, JSON.stringify(strana));
  }
});

test("email: guasto del database → 503 e l'indirizzo non finisce nei log", async () => {
  const righe = [];
  const prima = console.error;
  console.error = (...a) => righe.push(a.join(" "));
  try {
    const r = await pannelloApi(richiesta({ id: ZID }), ENV, supabase({ email: new Response("{}", { status: 500 }) }));
    assert.equal(r.status, 503);
    await pannelloApi(richiesta({ id: ZID }), ENV, supabase({ email: { ...EMAIL, livello: "multa" } }));
  } finally {
    console.error = prima;
  }
  assert.ok(!righe.join("\n").includes("example.com"));
});
