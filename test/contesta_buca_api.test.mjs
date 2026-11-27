// «Ero lì» e «Non riesco a fare il check-in» (issue #6, spec v1 del CPO del 3/11), passo 2 della linea
// «sviluppatore-b» (il passo 1, solo database, è la PR #515):
//   POST /app/api/incontro { azione: "contesta_buca", porta, testo } → contesta_buca della persona del token
//   GET  /app/api/incontro?porta=<id>&buca=1                     → stato_contestazione_buca: { contestabile, stato }
// Mai id, nomi o date dell'altra persona. Il testo non va mai nei log. Supabase finto, dati inventati.
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
const TESTO = "Ero lì al bancone dalle 20, nessuno è arrivato.";

function supabaseFinto(risposte) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID });
    const nome = u.pathname.replace("/rest/v1/rpc/", "");
    if (nome in risposte) return risposte[nome] instanceof Response ? risposte[nome] : Response.json(risposte[nome]);
    return new Response("{}", { status: 404 });
  };
  const rpc = (nome) => viste.filter((v) => v.percorso === `/rest/v1/rpc/${nome}`).map((v) => v.corpo);
  return { f, viste, rpc };
}
const manda = (corpo) => new Request(SITO + PERCORSO_INCONTRO, {
  method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(corpo) });
const leggi = (q) => new Request(SITO + PERCORSO_INCONTRO + q, { headers: { authorization: `Bearer ${TOKEN}` } });

test("contesta_buca: al database solo porta, persona del token e testo", async () => {
  const s = supabaseFinto({ contesta_buca: "inviata" });
  const r = await incontroApi(manda({ azione: "contesta_buca", porta: PORTA, testo: TESTO, persona: ALTRO, p_persona: ALTRO }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, esito: "inviata" });
  assert.deepEqual(s.rpc("contesta_buca"), [{ p_porta: PORTA, p_persona: ID, p_testo: TESTO }]);
});

test("contesta_buca: testo sotto i 10 o sopra i 500 caratteri → «testo_non_valido» senza chiamare il database", async () => {
  for (const testo of ["corto", "         x         ", "a".repeat(501)]) {
    const s = supabaseFinto({ contesta_buca: "inviata" });
    const r = await incontroApi(manda({ azione: "contesta_buca", porta: PORTA, testo }), ENV, s.f);
    assert.deepEqual(await r.json(), { ok: false, motivo: "testo_non_valido" });
    assert.equal(s.rpc("contesta_buca").length, 0);
  }
});

test("contesta_buca: porta mancante o testo non stringa → 400 senza database", async () => {
  for (const corpo of [{ testo: TESTO }, { porta: "x", testo: TESTO }, { porta: PORTA, testo: 42 }, { porta: PORTA }]) {
    const s = supabaseFinto({ contesta_buca: "inviata" });
    const r = await incontroApi(manda({ azione: "contesta_buca", ...corpo }), ENV, s.f);
    assert.equal(r.status, 400);
    assert.equal(s.rpc("contesta_buca").length, 0);
  }
});

test("contesta_buca: rifiuti noti passano al telefono, «non_nella_porta» è 404, il resto «riprova»", async () => {
  for (const motivo of ["non_contestabile", "gia_inviata", "testo_non_valido"]) {
    const r = await incontroApi(manda({ azione: "contesta_buca", porta: PORTA, testo: TESTO }), ENV, supabaseFinto({ contesta_buca: motivo }).f);
    assert.deepEqual(await r.json(), { ok: false, motivo });
  }
  const r404 = await incontroApi(manda({ azione: "contesta_buca", porta: PORTA, testo: TESTO }), ENV, supabaseFinto({ contesta_buca: "non_nella_porta" }).f);
  assert.equal(r404.status, 404);
  const r503 = await incontroApi(manda({ azione: "contesta_buca", porta: PORTA, testo: TESTO }), ENV, supabaseFinto({ contesta_buca: "boh" }).f);
  assert.equal(r503.status, 503);
});

test("stato buca: solo { contestabile, stato } della persona del token, niente altro", async () => {
  const s = supabaseFinto({ stato_contestazione_buca: { contestabile: true, stato: null, porta: PORTA, altro: ALTRO, inviata_il: "x" } });
  const r = await incontroApi(leggi(`?porta=${PORTA}&buca=1&persona=${ALTRO}`), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, contestazione: { contestabile: true, stato: null } });
  assert.deepEqual(s.rpc("stato_contestazione_buca"), [{ p_porta: PORTA, p_persona: ID }]);
  assert.equal(s.rpc("stato_incontro").length, 0);
});

test("stato buca: in attesa / accolta / respinta passano; null del database → 404; forma sbagliata → 503", async () => {
  for (const stato of ["in_attesa", "accolta", "respinta"]) {
    const r = await incontroApi(leggi(`?porta=${PORTA}&buca=1`), ENV, supabaseFinto({ stato_contestazione_buca: { contestabile: false, stato } }).f);
    assert.deepEqual(await r.json(), { ok: true, contestazione: { contestabile: false, stato } });
  }
  const r404 = await incontroApi(leggi(`?porta=${PORTA}&buca=1`), ENV, supabaseFinto({ stato_contestazione_buca: null }).f);
  assert.equal(r404.status, 404);
  for (const brutto of [{ contestabile: "si", stato: null }, { contestabile: true, stato: "vinta" }, [], "x"]) {
    const r = await incontroApi(leggi(`?porta=${PORTA}&buca=1`), ENV, supabaseFinto({ stato_contestazione_buca: brutto }).f);
    assert.equal(r.status, 503, JSON.stringify(brutto));
  }
  const r400 = await incontroApi(leggi(`?porta=nonuuid&buca=1`), ENV, supabaseFinto({}).f);
  assert.equal(r400.status, 400);
});
