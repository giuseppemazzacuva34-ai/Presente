// Chiamate solo voce (issue #4, passo 3b-2b-2c-2b-2): pescata di una carta della conversazione (spec v1.2).
//   POST /app/api/chiamata/carta {} → { ok: true, vista } con vista.carta = { id, testo, daMe } sui due telefoni
//   GET  /app/api/chiamata          → la vista porta il pulsante Carte (quante carte attive) e la carta aperta col testo
// Carte e carte viste le legge e le scrive solo il server; la coppia è sempre in ordine (a < b), come nel database.
// Tutto finto: niente rete, niente dati reali.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pescaCartaChiamata, statoChiamata } from "../api/apri_chiamata.js";
import { carteAttiveDb, carteVisteDb, segnaCartaVista } from "../api/dati_chiamata.js";
import { chiamataApi } from "../worker/chiamata_api.js";
import { GestoreChiamata } from "../api/chiamata_do.js";
import { oraDiRoma } from "../api/stanze.js";

const T0 = oraDiRoma(2026, 11, 10, 20);
const CHIUDE = oraDiRoma(2026, 11, 15, 21);
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const STANZA = "99999999-9999-4999-8999-999999999999";
const CARTE = [{ id: 1, testo: "Prima carta" }, { id: 2, testo: "Seconda carta" }, { id: 3, testo: "Terza carta" }];

function finti({ carte = CARTE, viste = [], pescaDo, vistaDo, segna = true, linea = true, chi = B } = {}) {
  const reg = { pescate: [], segnate: [], lette: [], viste: [] };
  const d = {
    stanzaDi: async () => ({ id: STANZA, apre: T0, chiude: CHIUDE }),
    centralino: () => ({ linea: async (per) => (linea && per === chi ? { chiamata: "chiamata-1", ruolo: "con", altra: A } : null) }),
    chiamata: () => ({
      pesca: async (x) => { reg.pescate.push(x); return pescaDo || { ok: true, carta: 2, ricomincia: false, vista: { fase: "in_corso", carta: { id: 2, daMe: true } } }; },
      vista: async (per, n) => { reg.viste.push([per, n]); return vistaDo || { ok: true, vista: { fase: "in_corso", carta: { id: 3, daMe: false } } }; },
    }),
    carte: async () => carte,
    carteViste: async (q) => { reg.lette.push(q); return viste; },
    segnaVista: async (q) => { reg.segnate.push(q); return segna; },
    casuale: () => 0.5,
  };
  return { d, reg };
}

// --- api/apri_chiamata.js -------------------------------------------------------------------------------------------

test("pesca: la coppia (in ordine) e le sue carte viste vanno al Durable Object; al telefono la carta col testo", async () => {
  const { d, reg } = finti({ viste: [1] });
  const r = await pescaCartaChiamata({ per: B, adesso: T0 }, d);
  assert.deepEqual(r, { ok: true, vista: { fase: "in_corso", carta: { id: 2, testo: "Seconda carta", daMe: true } } });
  assert.deepEqual(reg.lette, [{ stanza: STANZA, a: A, b: B }]);
  assert.deepEqual(reg.pescate, [{ da: B, carte: [{ id: 1 }, { id: 2 }, { id: 3 }], viste: [1], numero: 0.5 }]);
  assert.deepEqual(reg.segnate, [{ stanza: STANZA, a: A, b: B, carta: 2, ricomincia: false }]);
});

test("pesca: al Durable Object non arrivano i testi delle carte, al telefono non arriva l'id della chiamata", async () => {
  const { d, reg } = finti();
  const r = await pescaCartaChiamata({ per: B, adesso: T0 }, d);
  assert.equal(JSON.stringify(reg.pescate).includes("carta\""), false);
  assert.equal(JSON.stringify(reg.pescate).includes("Seconda"), false);
  assert.equal(JSON.stringify(r).includes("chiamata-1"), false);
});

test("pesca: mazzo finito → le carte viste della coppia ripartono da zero (ricomincia)", async () => {
  const { d, reg } = finti({ pescaDo: { ok: true, carta: 1, ricomincia: true, vista: { fase: "in_corso", carta: { id: 1, daMe: true } } } });
  await pescaCartaChiamata({ per: B, adesso: T0 }, d);
  assert.deepEqual(reg.segnate, [{ stanza: STANZA, a: A, b: B, carta: 1, ricomincia: true }]);
});

test("pesca: nessuna carta attiva → «nessuna_carta», niente al Durable Object", async () => {
  const { d, reg } = finti({ carte: [] });
  assert.deepEqual(await pescaCartaChiamata({ per: B, adesso: T0 }, d), { ok: false, motivo: "nessuna_carta" });
  assert.equal(reg.pescate.length, 0);
});

test("pesca: database che non risponde → «riprova», niente pescata", async () => {
  for (const x of [{ carte: null }, { viste: null }]) {
    const { d, reg } = finti(x);
    assert.deepEqual(await pescaCartaChiamata({ per: B, adesso: T0 }, d), { ok: false, motivo: "riprova" });
    assert.equal(reg.pescate.length, 0);
  }
});

test("pesca: i «no» del Durable Object (troppo presto, fuori tempo) tornano col loro motivo, nulla si segna", async () => {
  const { d, reg } = finti({ pescaDo: { ok: false, motivo: "troppo_presto" } });
  assert.deepEqual(await pescaCartaChiamata({ per: B, adesso: T0 }, d), { ok: false, motivo: "troppo_presto" });
  assert.equal(reg.segnate.length, 0);
});

test("pesca: senza chiamata o con id sbagliato → «no»", async () => {
  const { d } = finti({ linea: false });
  assert.deepEqual(await pescaCartaChiamata({ per: B, adesso: T0 }, d), { ok: false, motivo: "nessuna" });
  assert.deepEqual(await pescaCartaChiamata({ per: "x", adesso: T0 }, d), { ok: false, motivo: "dati" });
});

test("pesca: se la carta vista non si salva la carta compare lo stesso (al più si ripeterà)", async () => {
  const { d } = finti({ segna: false });
  const r = await pescaCartaChiamata({ per: B, adesso: T0 }, d);
  assert.equal(r.ok, true);
  assert.equal(r.vista.carta.testo, "Seconda carta");
});

test("stato: la vista conta le carte attive (pulsante) e porta il testo della carta aperta, anche all'altra persona", async () => {
  const { d, reg } = finti();
  const r = await statoChiamata({ per: B, adesso: T0 }, d);
  assert.deepEqual(r, { ok: true, vista: { fase: "in_corso", carta: { id: 3, testo: "Terza carta", daMe: false } } });
  assert.deepEqual(reg.viste, [[B, 3]]);
});

test("stato: se le carte non si leggono il pulsante non c'è (0), la chiamata si vede lo stesso", async () => {
  const { d, reg } = finti({ carte: null, vistaDo: { ok: true, vista: { fase: "in_corso", carta: null } } });
  assert.deepEqual(await statoChiamata({ per: B, adesso: T0 }, d), { ok: true, vista: { fase: "in_corso", carta: null } });
  assert.deepEqual(reg.viste, [[B, 0]]);
});

test("stato: carta aperta disattivata nel frattempo → non si mostra", async () => {
  const { d } = finti({ vistaDo: { ok: true, vista: { fase: "in_corso", carta: { id: 99, daMe: true } } } });
  assert.deepEqual(await statoChiamata({ per: B, adesso: T0 }, d), { ok: true, vista: { fase: "in_corso", carta: null } });
});

// --- Durable Object: dalla richiesta RPC (array e numero) alla pescata -----------------------------------------------

function archivio() {
  const m = new Map();
  return {
    get: async (k) => m.get(k),
    put: async (k, v) => { if (typeof k === "object") for (const [x, y] of Object.entries(k)) m.set(x, y); else m.set(k, v); },
    setAlarm: async () => {}, deleteAlarm: async () => {}, deleteAll: async () => m.clear(),
  };
}

test("Durable Object: pescata con viste in array e numero casuale; la stessa carta per i due", async () => {
  let ora = T0;
  const g = new GestoreChiamata({ storage: archivio(), adesso: () => ora, chiudiSessione: async () => ({ ok: true }), registra: async () => true });
  await g.apri({ chi: A, con: B, chiusuraStanza: CHIUDE.getTime(), sessioneChi: "s1", midChi: "0" });
  await g.rispondi({ da: B, sessione: "s2", mid: "0" });
  ora = new Date(T0.getTime() + 15_000);
  const p = await g.pescaRpc({ da: B, carte: [{ id: 1 }, { id: 2 }, { id: 3 }], viste: [1], numero: 0.99 });
  assert.equal(p.ok, true);
  assert.equal(p.carta, 3);
  assert.deepEqual(p.vista.carta, { id: 3, daMe: true });
  assert.deepEqual((await g.vista(A, 3)).vista.carta, { id: 3, daMe: false });
  // numero fuori da [0, 1) o viste non lista: non si rompe nulla
  ora = new Date(T0.getTime() + 40_000);
  const q = await g.pescaRpc({ da: A, carte: [{ id: 1 }, { id: 2 }, { id: 3 }], viste: "x", numero: 7 });
  assert.equal(q.ok, true);
  assert.ok([1, 2, 3].includes(q.carta));
});

// --- api/dati_chiamata.js: letture e scritture solo server -------------------------------------------------------

const ENV = { SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "chiave-finta" };

function rete(risposte = {}) {
  const chieste = [];
  const f = async (url, init = {}) => {
    const u = new URL(url);
    chieste.push({ metodo: init.method || "GET", percorso: u.pathname + u.search, corpo: init.body, prefer: init.headers?.prefer });
    const r = risposte[(init.method || "GET") + " " + u.pathname];
    if (r === "errore") throw new Error("rete");
    return r instanceof Response ? r : Response.json(r ?? []);
  };
  return { f, chieste };
}

test("carte attive: solo versione v1 e attive, solo id e testo, in ordine", async () => {
  const { f, chieste } = rete({ "GET /rest/v1/carte": [
    { id: 2, versione: "v1", testo: "Due", attiva: true }, { id: 5, versione: "v2", testo: "Altra", attiva: true },
    { id: 1, versione: "v1", testo: "Uno", attiva: true }, { id: 3, versione: "v1", testo: "Spenta", attiva: false }] });
  assert.deepEqual(await carteAttiveDb(ENV, f), [{ id: 1, testo: "Uno" }, { id: 2, testo: "Due" }]);
  assert.match(chieste[0].percorso, /versione=eq\.v1/);
  assert.match(chieste[0].percorso, /attiva=eq\.true/);
  assert.deepEqual(await carteAttiveDb(ENV, rete({ "GET /rest/v1/carte": "errore" }).f), null);
  assert.deepEqual(await carteAttiveDb({}, f), null);
});

test("carte viste: solo gli id della coppia in quella stanza; id non validi → null senza rete", async () => {
  const { f, chieste } = rete({ "GET /rest/v1/carte_viste": [{ carta_id: 4 }, { carta_id: 7 }] });
  assert.deepEqual(await carteVisteDb(ENV, { stanza: STANZA, a: A, b: B }, f), [4, 7]);
  assert.match(chieste[0].percorso, new RegExp(`stanza_id=eq\\.${STANZA}`));
  assert.match(chieste[0].percorso, new RegExp(`a=eq\\.${A}&b=eq\\.${B}`));
  assert.equal(await carteVisteDb(ENV, { stanza: STANZA, a: B, b: A }, f), null); // coppia non in ordine
  assert.equal(chieste.length, 1);
});

test("segna carta vista: inserimento che ignora i doppioni; con «ricomincia» prima si azzera la coppia", async () => {
  const { f, chieste } = rete({ "POST /rest/v1/carte_viste": new Response(null, { status: 201 }),
    "DELETE /rest/v1/carte_viste": new Response(null, { status: 204 }) });
  assert.equal(await segnaCartaVista(ENV, { stanza: STANZA, a: A, b: B, carta: 2, ricomincia: false }, f), true);
  assert.equal(chieste.length, 1);
  assert.equal(chieste[0].metodo, "POST");
  assert.match(chieste[0].prefer, /resolution=ignore-duplicates/);
  assert.deepEqual(JSON.parse(chieste[0].corpo), { stanza_id: STANZA, a: A, b: B, carta_id: 2 });

  chieste.length = 0;
  assert.equal(await segnaCartaVista(ENV, { stanza: STANZA, a: A, b: B, carta: 1, ricomincia: true }, f), true);
  assert.equal(chieste[0].metodo, "DELETE");
  assert.match(chieste[0].percorso, new RegExp(`stanza_id=eq\\.${STANZA}&a=eq\\.${A}&b=eq\\.${B}$`));
  assert.equal(chieste[1].metodo, "POST");
});

test("segna carta vista: dati sbagliati o errore → false, mai una cancellazione senza filtro", async () => {
  const { f, chieste } = rete({ "POST /rest/v1/carte_viste": new Response("{}", { status: 500 }) });
  assert.equal(await segnaCartaVista(ENV, { stanza: STANZA, a: A, b: B, carta: 2, ricomincia: false }, f), false);
  assert.equal(await segnaCartaVista(ENV, { stanza: "x", a: A, b: B, carta: 2, ricomincia: true }, f), false);
  assert.equal(await segnaCartaVista(ENV, { stanza: STANZA, a: A, b: B, carta: 0, ricomincia: true }, f), false);
  assert.equal(chieste.filter((c) => c.metodo === "DELETE").length, 0);
});

// --- Worker: POST /app/api/chiamata/carta --------------------------------------------------------------------------

const SUPA = "https://abcdefghijklmnopqrst.supabase.co";
const authFinta = async (url) => (new URL(url).pathname === "/auth/v1/user" ? Response.json({ id: B }) : new Response("{}", { status: 404 }));
const req = (corpo = {}) => new Request("https://presenteincontri.app/app/api/chiamata/carta", {
  method: "POST", headers: { authorization: "Bearer eyJhbGciOi.utente-di-prova.firma12345", "content-type": "application/json" },
  body: JSON.stringify(corpo),
});

test("Worker: /carta per la persona del token; un «chi» nel corpo non conta; no delle regole 200, riprova 503", async () => {
  const ricevute = [];
  const op = (r) => ({ pescaCarta: async (x) => { ricevute.push(x); return r; } });
  const env = { ACCESSO_APP: "si", SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "k" };
  let r = await chiamataApi(req({ chi: A }), env, authFinta, op({ ok: true, vista: { fase: "in_corso", carta: { id: 1, testo: "Uno", daMe: true } } }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, vista: { fase: "in_corso", carta: { id: 1, testo: "Uno", daMe: true } } });
  assert.equal(ricevute[0].per, B);
  r = await chiamataApi(req(), env, authFinta, op({ ok: false, motivo: "troppo_presto" }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: false, motivo: "troppo_presto" });
  r = await chiamataApi(req(), env, authFinta, op({ ok: false, motivo: "riprova" }));
  assert.equal(r.status, 503);
  r = await chiamataApi(req(), { ...env, ACCESSO_APP: "no" }, authFinta, op({ ok: true }));
  assert.equal(r.status, 404);
});
