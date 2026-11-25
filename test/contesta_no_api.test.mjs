// «Contesta» un «No» ricevuto (issue #6, spec v1.3 del CPO del 22/11, punto 2), passo 2 della linea «sviluppatore-b»
// (il passo 1, solo database, è la PR #482):
//   POST /app/api/incontro { azione: "contesta", domanda, testo } → contesta_no della persona del token
//   GET  /app/api/incontro?contestazioni=1                       → stato_contestazioni_no della persona del token
// Chi contesta non riceve mai id, nome o data dell'altra persona. Supabase finto, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { incontroApi, PERCORSO_INCONTRO } from "../worker/incontro_api.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const ALTRO = "66666666-7777-4888-9999-000000000000";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const TESTO = "Ci siamo visti al bar alle 19, ero lì puntuale.";

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
const leggi = (q = "?contestazioni=1") => new Request(SITO + PERCORSO_INCONTRO + q, { headers: { authorization: `Bearer ${TOKEN}` } });

test("contesta: manda al database solo la persona del token, la domanda e il testo (senza porta)", async () => {
  const s = supabaseFinto({ contesta_no: "inviata" });
  const r = await incontroApi(manda({ azione: "contesta", domanda: "presentato", testo: TESTO, persona: ALTRO }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, esito: "inviata" });
  assert.deepEqual(s.rpc("contesta_no"), [{ p_persona: ID, p_domanda: "presentato", p_testo: TESTO }]);
});

test("contesta: testo sotto i 10 o sopra i 500 caratteri → «testo_non_valido» senza chiamare il database", async () => {
  for (const testo of ["corto", "         x         ", "a".repeat(501), "😀".repeat(501)]) {
    const s = supabaseFinto({ contesta_no: "inviata" });
    const r = await incontroApi(manda({ azione: "contesta", domanda: "foto_sue", testo }), ENV, s.f);
    assert.equal(r.status, 200, testo);
    assert.deepEqual(await r.json(), { ok: false, motivo: "testo_non_valido" });
    assert.equal(s.rpc("contesta_no").length, 0);
  }
  const s = supabaseFinto({ contesta_no: "inviata" });
  const r = await incontroApi(manda({ azione: "contesta", domanda: "foto_sue", testo: "😀".repeat(500) }), ENV, s.f);
  assert.deepEqual(await r.json(), { ok: true, esito: "inviata" });
});

test("contesta: domanda fuori dalle tre dei fatti o testo non stringa → 400", async () => {
  for (const corpo of [{ domanda: "sicuro", testo: TESTO }, { domanda: "aspetto", testo: TESTO }, { domanda: "presentato", testo: 42 },
    { testo: TESTO }]) {
    const s = supabaseFinto({ contesta_no: "inviata" });
    const r = await incontroApi(manda({ azione: "contesta", ...corpo }), ENV, s.f);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.equal(s.rpc("contesta_no").length, 0);
  }
});

test("contesta: seconda contestazione o «No» scaduto → il rifiuto del database arriva al telefono", async () => {
  const s = supabaseFinto({ contesta_no: "nessun_no" });
  const r = await incontroApi(manda({ azione: "contesta", domanda: "come_in_chiamata", testo: TESTO }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: false, motivo: "nessun_no" });
});

test("contesta: esito sconosciuto o errore del database → 503 «riprova», mai un successo", async () => {
  for (const cattivo of ["boh", null, new Response("{}", { status: 500 })]) {
    const s = supabaseFinto({ contesta_no: cattivo });
    const r = await incontroApi(manda({ azione: "contesta", domanda: "presentato", testo: TESTO }), ENV, s.f);
    assert.equal(r.status, 503);
  }
});

test("contestazioni: solo le tre domande, solo { contestabile, stato }; qualunque altro campo si scarta", async () => {
  const s = supabaseFinto({ stato_contestazioni_no: {
    presentato: { contestabile: false, stato: "in_attesa", rispondente: ALTRO, inviata_il: "2026-11-20T10:00:00Z" },
    foto_sue: { contestabile: true, stato: null },
    sicuro: { contestabile: true, stato: null },
    come_in_chiamata: { contestabile: "si", stato: "boh" } } });
  const r = await incontroApi(leggi(`?contestazioni=1&persona=${ALTRO}`), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const corpo = await r.json();
  assert.deepEqual(corpo, { ok: true, contestazioni: {
    presentato: { contestabile: false, stato: "in_attesa" }, foto_sue: { contestabile: true, stato: null } } });
  assert.ok(!JSON.stringify(corpo).includes(ALTRO));
  assert.deepEqual(s.rpc("stato_contestazioni_no"), [{ p_persona: ID }]);
});

test("contestazioni: risposta che non è un oggetto o errore → 503 «riprova»", async () => {
  for (const cattivo of [null, [], "ciao", new Response("{}", { status: 500 })]) {
    const r = await incontroApi(leggi(), ENV, supabaseFinto({ stato_contestazioni_no: cattivo }).f);
    assert.equal(r.status, 503, JSON.stringify(cattivo));
  }
});

test("contesta e contestazioni: spenti finché ACCESSO_APP non vale «si»", async () => {
  const s = supabaseFinto({ contesta_no: "inviata", stato_contestazioni_no: {} });
  const spento = { ...ENV, ACCESSO_APP: "no" };
  assert.equal((await incontroApi(manda({ azione: "contesta", domanda: "presentato", testo: TESTO }), spento, s.f)).status, 404);
  assert.equal((await incontroApi(leggi(), spento, s.f)).status, 404);
  assert.equal(s.viste.length, 0);
});
