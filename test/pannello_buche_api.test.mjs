// «Ero lì» / «Non riesco» nel pannello di chi decide (issue #6 spec v1.4 del CPO del 27/11; D51 A; D156 A; linea
// «sviluppatore-b»).
//   GET  /app/api/pannello/buche           → { ok: true, buche: [{ id, nome, fase, testo, inviata_il, orario, decidibile, tua }] }
//   POST /app/api/pannello/buca { id, esito: "accolta" | "respinta" } → { ok: true, esito } | { ok: false, motivo }
// Chi decide = token + tabella moderatori; il database controlla di nuovo (decidi_contestazione_buca). Il Worker lascia
// passare SOLO quella forma: l'altra persona e la porta non arrivano mai al browser. Supabase finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pannelloApi, PERCORSO_PANNELLO } from "../worker/pannello_api.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const C = "bbbbbbbb-2222-4333-8444-555555555555";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const RIGA = { id: C, nome: "Ciro", fase: "prima_della_buca", testo: "Non riesco: niente rete.",
  inviata_il: "2026-11-27T18:40:00+00:00", orario: "2026-11-27T19:00:00+00:00", decidibile: true, tua: false };

function supabase({ moderatore = true, elenco = [], decisione = "accolta", viste = [] } = {}) {
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID });
    viste.push([u.pathname, JSON.parse(init.body || "{}")]);
    if (u.pathname === "/rest/v1/rpc/e_moderatore") return Response.json(moderatore);
    if (u.pathname === "/rest/v1/rpc/contestazioni_buca_da_decidere") return elenco === null ? new Response("{}", { status: 500 }) : Response.json(elenco);
    if (u.pathname === "/rest/v1/rpc/decidi_contestazione_buca") return decisione === null ? new Response("{}", { status: 500 }) : Response.json(decisione);
    return new Response("{}", { status: 404 });
  };
}
const get = () => new Request(SITO + PERCORSO_PANNELLO + "/buche", { headers: { authorization: `Bearer ${TOKEN}` } });
const post = (corpo) => new Request(SITO + PERCORSO_PANNELLO + "/buca", {
  method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(corpo) });

test("buche: GET con l'id del token, solo per i moderatori", async () => {
  const viste = [];
  const r = await pannelloApi(get(), ENV, supabase({ elenco: [RIGA, { ...RIGA, fase: "dopo_buca", decidibile: false, tua: true }], viste }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, buche: [RIGA, { ...RIGA, fase: "dopo_buca", decidibile: false, tua: true }] });
  assert.deepEqual(viste[1], ["/rest/v1/rpc/contestazioni_buca_da_decidere", { p_moderatore: ID }]);
  assert.equal(r.headers.get("cache-control"), "no-store");

  const nonMod = [];
  const no = await pannelloApi(get(), ENV, supabase({ moderatore: false, viste: nonMod }));
  assert.equal(no.status, 403);
  assert.deepEqual(nonMod.map((c) => c[0]), ["/rest/v1/rpc/e_moderatore"]);
});

test("buche: campi in più (altra persona, porta, saldo) non passano mai al browser", async () => {
  const r = await pannelloApi(get(), ENV, supabase({ elenco: [{ ...RIGA, porta_id: ID, persona: ID, altra: "Anna", saldo: 900 }] }));
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).buche, [RIGA]);
});

test("buche: forma sconosciuta o errore del database → 503 riprova", async () => {
  for (const elenco of [null, { non: "lista" }, [{ ...RIGA, id: "x" }], [{ ...RIGA, fase: "dopo" }], [{ ...RIGA, testo: 42 }],
    [{ ...RIGA, testo: "x".repeat(501) }], [{ ...RIGA, inviata_il: "ieri" }], [{ ...RIGA, orario: "domani" }],
    [{ ...RIGA, decidibile: "si" }], [{ ...RIGA, tua: null }], [{ ...RIGA, nome: 7 }]]) {
    const r = await pannelloApi(get(), ENV, supabase({ elenco }));
    assert.equal(r.status, 503, JSON.stringify(elenco));
    assert.deepEqual(await r.json(), { ok: false, motivo: "riprova" });
  }
});

test("buca: accolta o respinta, con l'id del token come chi decide", async () => {
  for (const [esito, accolta] of [["accolta", true], ["respinta", false]]) {
    const viste = [];
    const r = await pannelloApi(post({ id: C, esito }), ENV, supabase({ decisione: esito, viste }));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, esito });
    assert.deepEqual(viste[1], ["/rest/v1/rpc/decidi_contestazione_buca", { p_id: C, p_decisore: ID, p_accolta: accolta }]);
  }
});

test("buca: già decisa, inesistente, propria, finestra aperta → risposta chiara, niente 500", async () => {
  for (const motivo of ["gia_decisa", "non_trovata", "propria", "non_moderatore", "non_ancora", "in_attesa_d156"]) {
    const r = await pannelloApi(post({ id: C, esito: "accolta" }), ENV, supabase({ decisione: motivo }));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: false, motivo });
  }
});

test("buca: dati non validi → 400, il database non viene chiamato", async () => {
  for (const corpo of [{ id: "x", esito: "accolta" }, { id: C, esito: "accolto" }, { id: C }, { id: C, esito: true }]) {
    const viste = [];
    const r = await pannelloApi(post(corpo), ENV, supabase({ viste }));
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.ok(!viste.some((v) => v[0] === "/rest/v1/rpc/decidi_contestazione_buca"));
  }
});

test("buca: risposta strana o errore del database → 503 riprova", async () => {
  for (const decisione of [null, "boh", 42]) {
    const r = await pannelloApi(post({ id: C, esito: "respinta" }), ENV, supabase({ decisione }));
    assert.equal(r.status, 503, String(decisione));
  }
});

test("buche: metodi giusti e spento finché ACCESSO_APP non vale «si»", async () => {
  const r = await pannelloApi(new Request(SITO + PERCORSO_PANNELLO + "/buche", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }), ENV, supabase());
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "GET");
  const g = await pannelloApi(new Request(SITO + PERCORSO_PANNELLO + "/buca", { headers: { authorization: `Bearer ${TOKEN}` } }), ENV, supabase());
  assert.equal(g.status, 405);
  const spento = await pannelloApi(get(), { ...ENV, ACCESSO_APP: "tester" }, supabase());
  assert.equal(spento.status, 404);
});
