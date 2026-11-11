// Chiamate solo voce (issue #4, passo 3b-2b-2c-2b-1): connessione persa e «Riconnetti».
// Spec v1.2: «Connessione persa: 30 secondi per rientrare con "Riconnetti"; il timer continua. Se non si rientra,
// la chiamata finisce.» Il telefono che perde la voce lo dice al server (/caduta); al tocco su «Riconnetti» manda
// una nuova offerta solo voce (/rientro). Le regole dei 30 secondi le decide il Durable Object; tutto finto, niente rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cadutaChiamata, rientroChiamata } from "../api/apri_chiamata.js";
import { chiamataApi } from "../worker/chiamata_api.js";
import { oraDiRoma } from "../api/stanze.js";

const T0 = oraDiRoma(2026, 11, 10, 20);
const CHIUDE = oraDiRoma(2026, 11, 15, 21);
const A = "11111111-1111-4111-8111-111111111111";
const STANZA = "99999999-9999-4999-8999-999999999999";
const OFFERTA = { type: "offer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\n" };
const RISPOSTA_CF = { type: "answer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\n" };
const VISTA = { fase: "in_corso", altraPersona: "collegata" };

function finti({ cadutaDo, rientroDo, sessione, pubblica, linea = true } = {}) {
  const reg = { cadute: [], rientri: [], chiuse: [], pubblicate: [], sessioni: 0 };
  const d = {
    stanzaDi: async () => ({ id: STANZA, apre: T0, chiude: CHIUDE }),
    centralino: () => ({ linea: async (per) => (linea && per === A ? { chiamata: "chiamata-1", ruolo: "chi", altra: "x" } : null) }),
    chiamata: () => ({
      caduta: async (x) => { reg.cadute.push(x); return cadutaDo || { ok: true, vista: { ...VISTA, io: "riconnessione" } }; },
      rientro: async (x) => { reg.rientri.push(x); return rientroDo || { ok: true, vista: VISTA }; },
    }),
    nuovaSessione: async () => { reg.sessioni += 1; return sessione || { ok: true, sessione: "sessioneNUOVA1" }; },
    pubblicaVoce: async (s, o) => { reg.pubblicate.push([s, o]); return pubblica || { ok: true, descrizione: RISPOSTA_CF }; },
    chiudiSessione: async (s, mids) => { reg.chiuse.push({ sessione: s, mids }); return { ok: true }; },
  };
  return { d, reg };
}

// --- api/apri_chiamata.js -------------------------------------------------------------------------------------------

test("caduta: il telefono dice «ho perso la voce» e il Durable Object fa partire i 30 secondi per chi l'ha detto", async () => {
  const { d, reg } = finti();
  assert.deepEqual(await cadutaChiamata({ per: A, adesso: T0 }, d), { ok: true, vista: { ...VISTA, io: "riconnessione" } });
  assert.deepEqual(reg.cadute, [{ da: A }]);
});

test("caduta: senza chiamata o con dati sbagliati → «no», niente al Durable Object", async () => {
  const { d, reg } = finti({ linea: false });
  assert.deepEqual(await cadutaChiamata({ per: A, adesso: T0 }, d), { ok: false, motivo: "nessuna" });
  assert.deepEqual(await cadutaChiamata({ per: "x", adesso: T0 }, d), { ok: false, motivo: "dati" });
  assert.equal(reg.cadute.length, 0);
  const altro = finti({ cadutaDo: { ok: false, motivo: "non_in_corso" } });
  assert.deepEqual(await cadutaChiamata({ per: A, adesso: T0 }, altro.d), { ok: false, motivo: "non_in_corso" });
});

test("rientro: sessione nuova con la voce, poi il Durable Object; al telefono solo risposta SDP e vista", async () => {
  const { d, reg } = finti();
  const r = await rientroChiamata({ per: A, offerta: OFFERTA, adesso: T0 }, d);
  assert.deepEqual(r, { ok: true, descrizione: RISPOSTA_CF, vista: VISTA });
  assert.deepEqual(reg.pubblicate, [["sessioneNUOVA1", OFFERTA]]);
  assert.deepEqual(reg.rientri, [{ da: A, sessione: "sessioneNUOVA1", mid: "0" }]);
  assert.equal(reg.chiuse.length, 0);
  assert.equal(JSON.stringify(r).includes("sessione"), false);
});

test("rientro: anche se la caduta non era arrivata (rete del tutto assente), prima la segna e poi rientra", async () => {
  const { d, reg } = finti();
  await rientroChiamata({ per: A, offerta: OFFERTA, adesso: T0 }, d);
  assert.deepEqual(reg.cadute, [{ da: A }]);
});

test("rientro: solo voce, controllata prima di toccare qualunque cosa", async () => {
  const { d, reg } = finti();
  const video = { type: "offer", sdp: OFFERTA.sdp + "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:1\r\n" };
  for (const offerta of [video, RISPOSTA_CF, null]) {
    assert.deepEqual(await rientroChiamata({ per: A, offerta, adesso: T0 }, d), { ok: false, motivo: "solo_voce" });
  }
  assert.equal(reg.sessioni + reg.cadute.length, 0);
});

test("rientro: chiamata già finita (oltre i 30 secondi) → nessuna sessione aperta", async () => {
  const { d, reg } = finti({ cadutaDo: { ok: false, motivo: "non_in_corso" } });
  assert.deepEqual(await rientroChiamata({ per: A, offerta: OFFERTA, adesso: T0 }, d), { ok: false, motivo: "non_in_corso" });
  assert.equal(reg.sessioni, 0);
});

test("rientro: se il Durable Object dice no (troppo tardi) la traccia appena pubblicata si chiude", async () => {
  const { d, reg } = finti({ rientroDo: { ok: false, motivo: "troppo_tardi" } });
  assert.deepEqual(await rientroChiamata({ per: A, offerta: OFFERTA, adesso: T0 }, d), { ok: false, motivo: "troppo_tardi" });
  assert.deepEqual(reg.chiuse, [{ sessione: "sessioneNUOVA1", mids: ["0"] }]);
});

test("rientro: Realtime non risponde → «realtime», niente al Durable Object", async () => {
  const { d, reg } = finti({ pubblica: { ok: false, motivo: "realtime" } });
  assert.deepEqual(await rientroChiamata({ per: A, offerta: OFFERTA, adesso: T0 }, d), { ok: false, motivo: "realtime" });
  assert.equal(reg.rientri.length, 0);
});

// --- Worker ---------------------------------------------------------------------------------------------------------

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const f = async (url) => (new URL(url).pathname === "/auth/v1/user" ? Response.json({ id: A }) : new Response("{}", { status: 404 }));
const req = (passo, corpo) => new Request("https://presenteincontri.app/app/api/chiamata/" + passo, {
  method: "POST", headers: { authorization: "Bearer eyJhbGciOi.utente-di-prova.firma12345", "content-type": "application/json" },
  body: JSON.stringify(corpo),
});

test("Worker: /caduta e /rientro con l'utente del token; «troppo_tardi» 200, solo_voce 400, spento 404", async () => {
  const ricevute = [];
  const op = {
    cadutaChiamata: async (x) => { ricevute.push(["caduta", x]); return { ok: true, vista: VISTA }; },
    rientroChiamata: async (x) => { ricevute.push(["rientro", x]); return x.offerta ? { ok: true, descrizione: RISPOSTA_CF, vista: VISTA } : { ok: false, motivo: "solo_voce" }; },
  };
  let r = await chiamataApi(req("caduta", { per: "altro" }), ENV, f, op);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, vista: VISTA });
  assert.equal(ricevute[0][1].per, A);
  r = await chiamataApi(req("rientro", { offerta: OFFERTA }), ENV, f, op);
  assert.deepEqual(await r.json(), { ok: true, descrizione: RISPOSTA_CF, vista: VISTA });
  assert.deepEqual(ricevute[1][1].offerta, OFFERTA);
  r = await chiamataApi(req("rientro", {}), ENV, f, op);
  assert.equal(r.status, 400);
  op.rientroChiamata = async () => ({ ok: false, motivo: "troppo_tardi" });
  r = await chiamataApi(req("rientro", { offerta: OFFERTA }), ENV, f, op);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: false, motivo: "troppo_tardi" });
  r = await chiamataApi(req("caduta", {}), { ...ENV, ACCESSO_APP: "no" }, f, op);
  assert.equal(r.status, 404);
});
