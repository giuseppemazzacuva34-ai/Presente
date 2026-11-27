// «Cambia luogo» (issue #6, spec v1 del CPO del 3/11, «Casi limite»), passo 2 della linea «sviluppatore-b» (il passo 1,
// solo database, è la PR #535):
//   POST /app/api/incontro { azione: "cambia_luogo", porta, locale | luogo }      → cambia_luogo
//   POST /app/api/incontro { azione: "rispondi_cambio", porta, risposta: "accetto" | "rifiuto" } → rispondi_cambio_luogo
//   GET  /app/api/incontro?porta=<id> → nello stato «cambio_luogo»: { mio, locale, luogo, scade } | null
// Mai l'id di chi ha chiesto il cambio. Supabase finto, dati inventati.
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

function supabaseFinto(risposte) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID });
    const nome = u.pathname.replace("/rest/v1/rpc/", "");
    if (nome in risposte) return Response.json(risposte[nome]);
    return new Response("{}", { status: 404 });
  };
  const rpc = (nome) => viste.filter((v) => v.percorso === `/rest/v1/rpc/${nome}`).map((v) => v.corpo);
  return { f, rpc };
}
const manda = (corpo) => new Request(SITO + PERCORSO_INCONTRO, {
  method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(corpo) });
const leggi = () => new Request(`${SITO}${PERCORSO_INCONTRO}?porta=${PORTA}`, { headers: { authorization: `Bearer ${TOKEN}` } });

test("cambia_luogo: al database porta, persona del token e il luogo scritto", async () => {
  const s = supabaseFinto({ cambia_luogo: "proposto" });
  const r = await incontroApi(manda({ azione: "cambia_luogo", porta: PORTA, luogo: "Libreria del corso", persona: ALTRO }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, esito: "proposto" });
  assert.deepEqual(s.rpc("cambia_luogo"), [{ p_porta: PORTA, p_persona: ID, p_locale: null, p_luogo: "Libreria del corso" }]);
});

test("cambia_luogo: un locale consigliato", async () => {
  const s = supabaseFinto({ cambia_luogo: "proposto" });
  await incontroApi(manda({ azione: "cambia_luogo", porta: PORTA, locale: "loc-7" }), ENV, s.f);
  assert.deepEqual(s.rpc("cambia_luogo"), [{ p_porta: PORTA, p_persona: ID, p_locale: "loc-7", p_luogo: null }]);
});

test("cambia_luogo: i rifiuti del database arrivano al telefono come motivo", async () => {
  for (const motivo of ["non_confermato", "incontro_chiuso", "troppo_tardi", "luogo_non_valido", "stesso_luogo",
                        "attendi_risposta", "rispondi_prima"]) {
    const s = supabaseFinto({ cambia_luogo: motivo });
    const r = await incontroApi(manda({ azione: "cambia_luogo", porta: PORTA, luogo: "Museo" }), ENV, s.f);
    assert.deepEqual(await r.json(), { ok: false, motivo });
  }
});

test("cambia_luogo: porta malformata o luogo non stringa → 400 senza database", async () => {
  for (const corpo of [{ luogo: "Museo" }, { porta: "x", luogo: "Museo" }, { porta: PORTA, luogo: 42 },
                       { porta: PORTA, locale: ["a"] }, { porta: PORTA, luogo: "x".repeat(1000) }]) {
    const s = supabaseFinto({ cambia_luogo: "proposto" });
    const r = await incontroApi(manda({ azione: "cambia_luogo", ...corpo }), ENV, s.f);
    assert.equal(r.status, 400);
    assert.equal(s.rpc("cambia_luogo").length, 0);
  }
});

test("rispondi_cambio: accetto o rifiuto della persona del token", async () => {
  for (const [risposta, esito] of [["accetto", "cambiato"], ["rifiuto", "rifiutato"]]) {
    const s = supabaseFinto({ rispondi_cambio_luogo: esito });
    const r = await incontroApi(manda({ azione: "rispondi_cambio", porta: PORTA, risposta, persona: ALTRO }), ENV, s.f);
    assert.deepEqual(await r.json(), { ok: true, esito });
    assert.deepEqual(s.rpc("rispondi_cambio_luogo"), [{ p_porta: PORTA, p_persona: ID, p_risposta: risposta }]);
  }
});

test("rispondi_cambio: risposta diversa → 400 senza database", async () => {
  for (const risposta of [undefined, "annulla", "si", 1]) {
    const s = supabaseFinto({ rispondi_cambio_luogo: "cambiato" });
    const r = await incontroApi(manda({ azione: "rispondi_cambio", porta: PORTA, risposta }), ENV, s.f);
    assert.equal(r.status, 400);
    assert.equal(s.rpc("rispondi_cambio_luogo").length, 0);
  }
});

test("rispondi_cambio: rifiuti noti come motivo, esito sconosciuto → riprova", async () => {
  for (const motivo of ["nessun_cambio", "non_puoi_rispondere", "troppo_tardi", "non_confermato", "incontro_chiuso"]) {
    const s = supabaseFinto({ rispondi_cambio_luogo: motivo });
    const r = await incontroApi(manda({ azione: "rispondi_cambio", porta: PORTA, risposta: "accetto" }), ENV, s.f);
    assert.deepEqual(await r.json(), { ok: false, motivo });
  }
  const s = supabaseFinto({ rispondi_cambio_luogo: "boh" });
  assert.equal((await incontroApi(manda({ azione: "rispondi_cambio", porta: PORTA, risposta: "accetto" }), ENV, s.f)).status, 503);
});

const STATO = { stato: "confermato", scadenza: "2026-12-05T18:00:00+00:00", orario: "2026-12-01T18:00:00+00:00",
  locale: null, luogo: "Bar della piazza", azioni: ["disdici", "ritardo", "rispondi_cambio"] };

test("stato: la richiesta di cambio arriva ripulita, mai chi l'ha chiesta", async () => {
  const cambio = { mio: false, locale: null, luogo: "Libreria del corso", scade: "2026-12-01T17:00:00+00:00",
                   proposto_da: ALTRO, segreto: "x" };
  const s = supabaseFinto({ stato_incontro: { ...STATO, cambio_luogo: cambio } });
  const { incontro } = await (await incontroApi(leggi(), ENV, s.f)).json();
  assert.deepEqual(incontro.cambio_luogo, { mio: false, locale: null, luogo: "Libreria del corso", scade: "2026-12-01T17:00:00+00:00" });
  assert.ok(!JSON.stringify(incontro).includes(ALTRO));
});

test("stato: senza richiesta o di forma strana → cambio_luogo null", async () => {
  for (const cambio of [undefined, null, "x", [], { mio: "no", luogo: "a", scade: "2026-12-01T17:00:00Z" },
                        { mio: true, locale: null, luogo: null, scade: "2026-12-01T17:00:00Z" },
                        { mio: true, locale: null, luogo: "a".repeat(81), scade: "2026-12-01T17:00:00Z" },
                        { mio: true, locale: null, luogo: "Museo", scade: "domani" }]) {
    const s = supabaseFinto({ stato_incontro: { ...STATO, cambio_luogo: cambio } });
    const { incontro } = await (await incontroApi(leggi(), ENV, s.f)).json();
    assert.equal(incontro.cambio_luogo, null);
  }
});
