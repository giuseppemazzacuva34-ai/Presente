// Ricorsi nel pannello di chi decide (issue #7, spec «Ricorso», D51 A; linea «sviluppatore-b», passo 13e).
//   GET  /app/api/pannello/ricorsi                       → { ok: true, ricorsi: [...] }
//   POST /app/api/pannello/ricorso { id, esito, testo }  → { ok: true } | { ok: false, motivo }
// Chi decide = token + tabella moderatori, mai un campo del corpo. Le regole (persona diversa da chi ha sanzionato,
// una sola volta) stanno nel database (migrazione 20261116145247). Supabase finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pannelloApi, PERCORSO_PANNELLO, ESITI_RICORSO } from "../worker/pannello_api.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const RIC = "66666666-7777-4888-9999-000000000000";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

function supabase({ moderatore = true, ricorsi = [], decidi = 204, contaRpc = [] } = {}) {
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID });
    contaRpc.push([u.pathname, JSON.parse(init.body || "{}")]);
    if (u.pathname === "/rest/v1/rpc/e_moderatore") return Response.json(moderatore);
    if (u.pathname === "/rest/v1/rpc/ricorsi_da_decidere") return ricorsi === null ? new Response("{}", { status: 500 }) : Response.json(ricorsi);
    if (u.pathname === "/rest/v1/rpc/decidi_ricorso") {
      return decidi === 204 ? new Response(null, { status: 204 }) : Response.json({ message: "no" }, { status: decidi });
    }
    return new Response("{}", { status: 404 });
  };
}
function richiesta(percorso, { metodo = "POST", corpo = {} } = {}) {
  const headers = { authorization: `Bearer ${TOKEN}` };
  if (corpo !== null) headers["content-type"] = "application/json";
  return new Request(SITO + PERCORSO_PANNELLO + percorso, { method: metodo, headers, body: corpo === null ? undefined : JSON.stringify(corpo) });
}

test("esiti ammessi: solo accolto e respinto", () => {
  assert.deepEqual([...ESITI_RICORSO], ["accolto", "respinto"]);
});

test("ricorsi: GET con l'id del token, solo per i moderatori", async () => {
  const viste = [];
  const ricorsi = [{ id: RIC, livello: "sospensione_7", decisa_da_te: false }];
  const r = await pannelloApi(richiesta("/ricorsi", { metodo: "GET", corpo: null }), ENV, supabase({ ricorsi, contaRpc: viste }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, ricorsi });
  assert.deepEqual(viste[1], ["/rest/v1/rpc/ricorsi_da_decidere", { p_moderatore: ID }]);
  assert.equal(r.headers.get("cache-control"), "no-store");

  const nonMod = [];
  const no = await pannelloApi(richiesta("/ricorsi", { metodo: "GET", corpo: null }), ENV, supabase({ moderatore: false, contaRpc: nonMod }));
  assert.equal(no.status, 403);
  assert.deepEqual(nonMod.map((c) => c[0]), ["/rest/v1/rpc/e_moderatore"]);
  assert.equal((await pannelloApi(richiesta("/ricorsi", { corpo: {} }), ENV, supabase())).status, 405);
});

test("ricorsi: errore del database → 503 riprova", async () => {
  const r = await pannelloApi(richiesta("/ricorsi", { metodo: "GET", corpo: null }), ENV, supabase({ ricorsi: null }));
  assert.equal(r.status, 503);
});

test("ricorso: decide chi è nel token, esito e motivo obbligatori", async () => {
  const viste = [];
  const buona = { id: RIC, esito: "accolto", testo: "  il fatto non è provato  ", moderatore: RIC };
  const r = await pannelloApi(richiesta("/ricorso", { corpo: buona }), ENV, supabase({ contaRpc: viste }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.deepEqual(viste[1], ["/rest/v1/rpc/decidi_ricorso", { p_moderatore: ID, p_ricorso: RIC, p_esito: "accolto", p_testo: "il fatto non è provato" }]);
  for (const sbagliata of [
    { ...buona, id: "x" },
    { ...buona, esito: "annulla" },
    { ...buona, testo: "   " },
    { ...buona, testo: "a".repeat(2001) },
  ]) {
    const viste2 = [];
    const no = await pannelloApi(richiesta("/ricorso", { corpo: sbagliata }), ENV, supabase({ contaRpc: viste2 }));
    assert.equal(no.status, 400, JSON.stringify(sbagliata).slice(0, 60));
    assert.ok(!viste2.some((c) => c[0] === "/rest/v1/rpc/decidi_ricorso"));
  }
  assert.equal((await pannelloApi(richiesta("/ricorso", { metodo: "GET", corpo: null }), ENV, supabase())).status, 405);
});

test("ricorso: il database rifiuta (già deciso o stessa persona) → «rifiutata»; rete giù → 503", async () => {
  const no = await pannelloApi(richiesta("/ricorso", { corpo: { id: RIC, esito: "respinto", testo: "confermata" } }), ENV, supabase({ decidi: 400 }));
  assert.equal(no.status, 200);
  assert.deepEqual(await no.json(), { ok: false, motivo: "rifiutata" });
  const giu = await pannelloApi(richiesta("/ricorso", { corpo: { id: RIC, esito: "respinto", testo: "confermata" } }), ENV, supabase({ decidi: 500 }));
  assert.equal(giu.status, 503);
});

test("ricorsi spenti finché ACCESSO_APP non vale «si»", async () => {
  const viste = [];
  const r = await pannelloApi(richiesta("/ricorsi", { metodo: "GET", corpo: null }), { ...ENV, ACCESSO_APP: "no" }, supabase({ contaRpc: viste }));
  assert.equal(r.status, 404);
  assert.equal(viste.length, 0);
});
