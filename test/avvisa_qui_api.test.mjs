// «Avvisa <nome> che sei qui» (issue #6, spec v1 del CPO del 3/11, punto 6), passo 2 della linea «sviluppatore-b» (il
// passo 1, solo database, è la PR #546):
//   POST /app/api/incontro { azione: "avvisa_qui", porta } → avvisa_sono_qui
//   GET  /app/api/incontro?porta=<id> → nello stato «avviso_qui_da» (orario o null), «avvisato_mio» e «avvisato_altro»
//   (solo sì/no). Mai l'id di chi ha avvisato. Supabase finto, dati inventati.
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

test("avvisa_qui: al database porta e persona del token, mai quella del corpo", async () => {
  const s = supabaseFinto({ avvisa_sono_qui: "avvisato" });
  const r = await incontroApi(manda({ azione: "avvisa_qui", porta: PORTA, persona: ALTRO, p_persona: ALTRO }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, esito: "avvisato" });
  assert.deepEqual(s.rpc("avvisa_sono_qui"), [{ p_porta: PORTA, p_persona: ID }]);
});

test("avvisa_qui: i rifiuti del database arrivano al telefono come motivo", async () => {
  for (const motivo of ["non_confermato", "incontro_chiuso", "non_ancora_qui", "gia_arrivato", "troppo_presto",
                        "gia_avvisato", "troppo_tardi"]) {
    const s = supabaseFinto({ avvisa_sono_qui: motivo });
    const r = await incontroApi(manda({ azione: "avvisa_qui", porta: PORTA }), ENV, s.f);
    assert.deepEqual(await r.json(), { ok: false, motivo });
  }
});

test("avvisa_qui: porta sconosciuta → 404, esito strano → riprova", async () => {
  let r = await incontroApi(manda({ azione: "avvisa_qui", porta: PORTA }), ENV, supabaseFinto({ avvisa_sono_qui: "non_nella_porta" }).f);
  assert.equal(r.status, 404);
  r = await incontroApi(manda({ azione: "avvisa_qui", porta: PORTA }), ENV, supabaseFinto({ avvisa_sono_qui: "boh" }).f);
  assert.equal(r.status, 503);
});

test("avvisa_qui: porta malformata → 400 senza database", async () => {
  const s = supabaseFinto({ avvisa_sono_qui: "avvisato" });
  const r = await incontroApi(manda({ azione: "avvisa_qui", porta: "x" }), ENV, s.f);
  assert.equal(r.status, 400);
  assert.equal(s.rpc("avvisa_sono_qui").length, 0);
});

const STATO = { stato: "confermato", scadenza: "2026-12-08T10:00:00Z", orario: "2026-12-01T19:00:00Z", locale: null,
  luogo: "Caffè", proposta_mia: false, proposta_scade: null, controproposte_rimaste: 3, azioni: ["avvisa_qui"],
  ritardo_minuti: 0, esito: null, checkin_mio: true, checkin_altro: false };

test("stato: avviso_qui_da, avvisato_mio e avvisato_altro arrivano al telefono", async () => {
  const s = supabaseFinto({ stato_incontro: { ...STATO, avviso_qui_da: "2026-12-01T19:15:00+00:00", avvisato_mio: false,
    avvisato_altro: true }, locali_incontro: { locali: [], scelto: null } });
  const { incontro } = await (await incontroApi(leggi(), ENV, s.f)).json();
  assert.equal(incontro.avviso_qui_da, "2026-12-01T19:15:00+00:00");
  assert.equal(incontro.avvisato_mio, false);
  assert.equal(incontro.avvisato_altro, true);
  assert.deepEqual(incontro.azioni, ["avvisa_qui"]);
});

test("stato: forme strane ripulite (solo vero/falso, un orario o null), mai id", async () => {
  const s = supabaseFinto({ stato_incontro: { ...STATO, avviso_qui_da: { id: ALTRO }, avvisato_mio: "si",
    avvisato_altro: ALTRO, avviso_qui_a_il: "2026-12-01T19:20:00Z" }, locali_incontro: { locali: [], scelto: null } });
  const { incontro } = await (await incontroApi(leggi(), ENV, s.f)).json();
  assert.equal(incontro.avviso_qui_da, null);
  assert.equal(incontro.avvisato_mio, false);
  assert.equal(incontro.avvisato_altro, false);
  assert.ok(!("avviso_qui_a_il" in incontro));
  assert.doesNotMatch(JSON.stringify(incontro), new RegExp(ALTRO));
});
