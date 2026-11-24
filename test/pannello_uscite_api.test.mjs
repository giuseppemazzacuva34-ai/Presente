// Motivi di «Lascia la stanza» nel pannello di chi decide (issue #381, spec v1 del CPO del 23/11, «Dati»; linea
// «sviluppatore-b», passo 6b).
//   GET /app/api/pannello/uscite → { ok: true, uscite: [{ settimana, motivo, quante, testi }] }
// Chi decide = token + tabella moderatori. Il database dà solo conteggi e testi senza nome (migrazione
// 20261124143935_motivi_uscite.sql); qui il Worker lascia passare SOLO quella forma: un campo in più (persona,
// stanza, nome) non arriva mai al browser. Supabase finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pannelloApi, PERCORSO_PANNELLO } from "../worker/pannello_api.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

function supabase({ moderatore = true, uscite = [], viste = [] } = {}) {
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID });
    viste.push([u.pathname, JSON.parse(init.body || "{}")]);
    if (u.pathname === "/rest/v1/rpc/e_moderatore") return Response.json(moderatore);
    if (u.pathname === "/rest/v1/rpc/motivi_uscite") return uscite === null ? new Response("{}", { status: 500 }) : Response.json(uscite);
    return new Response("{}", { status: 404 });
  };
}
const get = () => new Request(SITO + PERCORSO_PANNELLO + "/uscite", { headers: { authorization: `Bearer ${TOKEN}` } });

test("uscite: GET con l'id del token, solo per i moderatori", async () => {
  const viste = [];
  const uscite = [
    { settimana: "2026-11-23", motivo: "altro", quante: 2, testi: ["Orari scomodi"] },
    { settimana: "2026-11-23", motivo: "tempo", quante: 3, testi: [] },
  ];
  const r = await pannelloApi(get(), ENV, supabase({ uscite, viste }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, uscite });
  assert.deepEqual(viste[1], ["/rest/v1/rpc/motivi_uscite", { p_moderatore: ID }]);
  assert.equal(r.headers.get("cache-control"), "no-store");

  const nonMod = [];
  const no = await pannelloApi(get(), ENV, supabase({ moderatore: false, viste: nonMod }));
  assert.equal(no.status, 403);
  assert.deepEqual(nonMod.map((c) => c[0]), ["/rest/v1/rpc/e_moderatore"]);
});

test("uscite: solo GET", async () => {
  const r = await pannelloApi(new Request(SITO + PERCORSO_PANNELLO + "/uscite", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }), ENV, supabase());
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "GET");
});

test("uscite: campi in più (persona, stanza) non passano mai al browser", async () => {
  const uscite = [{ settimana: "2026-11-23", motivo: "app", quante: 1, testi: [], persona: ID, stanza_id: ID, nome: "Ada" }];
  const r = await pannelloApi(get(), ENV, supabase({ uscite }));
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).uscite, [{ settimana: "2026-11-23", motivo: "app", quante: 1, testi: [] }]);
});

test("uscite: forma sconosciuta o errore del database → 503 riprova, mai numeri inventati", async () => {
  for (const uscite of [null, { non: "lista" }, [{ settimana: "ieri", motivo: "app", quante: 1, testi: [] }],
    [{ settimana: "2026-11-23", motivo: "boh", quante: 1, testi: [] }], [{ settimana: "2026-11-23", motivo: "app", quante: -1, testi: [] }],
    [{ settimana: "2026-11-23", motivo: "altro", quante: 1, testi: [42] }]]) {
    const r = await pannelloApi(get(), ENV, supabase({ uscite }));
    assert.equal(r.status, 503, JSON.stringify(uscite));
    assert.deepEqual(await r.json(), { ok: false, motivo: "riprova" });
  }
});

test("uscite: spento finché ACCESSO_APP non vale «si»", async () => {
  const r = await pannelloApi(get(), { ...ENV, ACCESSO_APP: "tester" }, supabase());
  assert.equal(r.status, 404);
});
