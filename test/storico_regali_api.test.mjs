// «I tuoi regali» (schermata 28 del design v4, issue #349; regole dei regali #331). Linea «sviluppatore-b».
// GET /app/api/regali/storico: chi chiede lo dice SOLO il token. Spento finché ACCESSO_APP non vale «si». Supabase finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { storicoRegaliApi, PERCORSO_STORICO_REGALI } from "../worker/storico_regali_api.js";
import { titoloStorico, dettaglioRegali, quandoRegalo, vistaStorico } from "../api/storico_regali.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const LUI = "66666666-7777-4888-9999-000000000000";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const ADESSO = new Date("2026-11-23T18:00:00Z"); // lunedì 23/11, 19:00 a Roma

const DAL_DB = {
  totale: { rosa: 12, spumante: 4, fiori: 1 },
  attuale: { citta: "Milano", persone: [
    { da: LUI, nome: "Marco", eta: 35, rosa: 3, spumante: 1, fiori: 0, ultimo: "2026-11-23T09:00:00+00:00" },
    { da: ID, nome: "Dario", eta: 34, rosa: 2, spumante: 0, fiori: 0, ultimo: "2026-11-22T21:00:00+00:00" },
  ] },
  passate: { stanze: 2, persone: 7, rosa: 7, spumante: 3, fiori: 1 },
};

function supabaseFinto({ utente = 200, storico = DAL_DB } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID }) : new Response("{}", { status: utente });
    if (u.pathname === "/rest/v1/rpc/storico_regali") return storico instanceof Response ? storico : Response.json(storico);
    return new Response("{}", { status: 404 });
  };
  return { f, viste };
}
function richiesta({ metodo = "GET", token = TOKEN, percorso = PERCORSO_STORICO_REGALI } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(SITO + percorso, { method: metodo, headers });
}

test("testi: titolo con il totale, singolare e nessun regalo", () => {
  assert.equal(titoloStorico({ rosa: 12, spumante: 4, fiori: 1 }), "Hai ricevuto 17 regali.");
  assert.equal(titoloStorico({ rosa: 0, spumante: 1, fiori: 0 }), "Hai ricevuto 1 regalo.");
  assert.equal(titoloStorico({ rosa: 0, spumante: 0, fiori: 0 }), "Non hai ancora ricevuto regali.");
});

test("testi: dettaglio come nel design («3 rose · 1 spumante»), senza i tipi a zero", () => {
  assert.equal(dettaglioRegali({ rosa: 3, spumante: 1, fiori: 0 }), "3 rose · 1 spumante");
  assert.equal(dettaglioRegali({ rosa: 1, spumante: 0, fiori: 0 }), "1 rosa");
  assert.equal(dettaglioRegali({ rosa: 7, spumante: 3, fiori: 1 }), "7 rose · 3 spumante · 1 fiori");
  assert.equal(dettaglioRegali({ rosa: 0, spumante: 0, fiori: 2 }), "2 fiori");
});

test("testi: quando, con il giorno di Roma (oggi, ieri, poi il giorno della settimana)", () => {
  assert.equal(quandoRegalo("2026-11-23T09:00:00Z", ADESSO), "oggi");
  assert.equal(quandoRegalo("2026-11-22T23:30:00Z", ADESSO), "oggi"); // 00:30 del 23 a Roma
  assert.equal(quandoRegalo("2026-11-22T21:00:00Z", ADESSO), "ieri");
  assert.equal(quandoRegalo("2026-11-20T10:00:00Z", ADESSO), "venerdì");
  assert.equal(quandoRegalo("non-una-data", ADESSO), "");
});

test("vista: dati del database → schermata 28, senza id delle persone", () => {
  assert.deepEqual(vistaStorico(DAL_DB, ADESSO), {
    titolo: "Hai ricevuto 17 regali.",
    totale: { rosa: 12, spumante: 4, fiori: 1 },
    attuale: { citta: "Milano", persone: [
      { nome: "Marco, 35", dettaglio: "3 rose · 1 spumante", quando: "oggi" },
      { nome: "Dario, 34", dettaglio: "2 rose", quando: "ieri" },
    ] },
    passate: { stanze: 2, persone: "7 persone", dettaglio: "7 rose · 3 spumante · 1 fiori" },
  });
  const vuota = vistaStorico({ totale: { rosa: 0, spumante: 0, fiori: 0 }, attuale: null,
    passate: { stanze: 1, persone: 1, rosa: 1, spumante: 0, fiori: 0 } }, ADESSO);
  assert.equal(vuota.attuale, null);
  assert.equal(vuota.passate.persone, "1 persona");
  assert.equal(vistaStorico({ ...DAL_DB, passate: { stanze: 0, persone: 0, rosa: 0, spumante: 0, fiori: 0 } }, ADESSO).passate, null);
});

test("vista: dati strani del database → null (mai numeri inventati)", () => {
  for (const d of [null, [], { totale: { rosa: "1", spumante: 0, fiori: 0 }, attuale: null, passate: DAL_DB.passate },
    { ...DAL_DB, attuale: { citta: "Milano", persone: [{ nome: "X", eta: 30, rosa: -1, spumante: 0, fiori: 0, ultimo: "2026-11-23T09:00:00Z" }] } },
    { ...DAL_DB, passate: null }]) {
    assert.equal(vistaStorico(d, ADESSO), null, JSON.stringify(d));
  }
});

test("spento finché ACCESSO_APP non vale «si»: nessuna chiamata a Supabase", async () => {
  const s = supabaseFinto();
  const r = await storicoRegaliApi(richiesta(), { ...ENV, ACCESSO_APP: "no" }, s.f);
  assert.equal(r.status, 404);
  assert.equal(s.viste.length, 0);
});

test("solo GET; senza token valido 401", async () => {
  assert.equal((await storicoRegaliApi(richiesta({ metodo: "POST" }), ENV, supabaseFinto().f)).status, 405);
  assert.equal((await storicoRegaliApi(richiesta({ token: null }), ENV, supabaseFinto().f)).status, 401);
  assert.equal((await storicoRegaliApi(richiesta(), ENV, supabaseFinto({ utente: 401 }).f)).status, 401);
});

test("GET: chi chiede lo dice il token, risposta pronta per la schermata", async () => {
  const s = supabaseFinto();
  const r = await storicoRegaliApi(richiesta(), ENV, s.f, () => ADESSO);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.titolo, "Hai ricevuto 17 regali.");
  assert.equal(d.attuale.persone[0].nome, "Marco, 35");
  assert.ok(!JSON.stringify(d).includes(LUI), "nessun id di chi ha mandato");
  assert.deepEqual(s.viste.find((v) => v.percorso === "/rest/v1/rpc/storico_regali").corpo, { p_persona: ID });
});

test("risposte strane del database: 503 «riprova»", async () => {
  for (const storico of [new Response("{}", { status: 500 }), { totale: null }, "17"]) {
    const r = await storicoRegaliApi(richiesta(), ENV, supabaseFinto({ storico }).f, () => ADESSO);
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { ok: false, motivo: "riprova" });
  }
});

test("il Worker instrada /app/api/regali/storico con le intestazioni dell'app", async () => {
  const r = await worker.fetch(richiesta(), { ...ENV, ACCESSO_APP: "no", ASSETS: { fetch: async () => new Response("x") } }, {});
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.ok(r.headers.get("content-security-policy"));
  assert.equal((await r.json()).motivo, "spento");
});

test("sicurezza: nei log niente token o persone", () => {
  const codice = readFileSync(new URL("../worker/storico_regali_api.js", import.meta.url), "utf8");
  for (const riga of codice.split("\n").filter((x) => x.includes("console."))) {
    assert.ok(!/token|chi\.id|nome|persone/.test(riga), riga);
  }
});
