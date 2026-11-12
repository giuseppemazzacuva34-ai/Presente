// Chiamate solo voce (issue #4, passo 3b-2b-2c-2a): ricevere la voce dell'altra persona.
// Ognuno, a chiamata in corso, chiede al server di «ascoltare»: Cloudflare Realtime manda un'offerta per la traccia
// «voce» dell'altra persona, il telefono risponde («conferma»). Le sessioni restano nel server; tutto finto, niente rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nuovaChiamata, rispondi, rientro, caduta, ascolto, sessioniPer, vistaPer } from "../api/stato_chiamata.js";
import { GestoreChiamata } from "../api/chiamata_do.js";
import { ascoltaChiamata, confermaAscolto } from "../api/apri_chiamata.js";
import { chiamataApi } from "../worker/chiamata_api.js";
import { oraDiRoma } from "../api/stanze.js";

const T0 = oraDiRoma(2026, 11, 10, 20);
const CHIUDE = oraDiRoma(2026, 11, 15, 21);
const s = (n) => new Date(T0.getTime() + n * 1000);

const squilla = () => nuovaChiamata({ chi: "a", con: "b", adesso: T0, chiusuraStanza: CHIUDE, sessioneChi: "sessioneA123", midChi: "0" });
const inCorso = () => rispondi(squilla(), { da: "b", adesso: s(5), sessione: "sessioneB123", mid: "0" }).stato;

// --- Stato (solo calcoli) ---------------------------------------------------------------------------------------

test("sessioniPer: solo a chiamata in corso, solo per chi c'è, mai la stessa sessione", () => {
  assert.equal(sessioniPer(squilla(), "a").motivo, "non_in_corso");
  assert.equal(sessioniPer(inCorso(), "c").motivo, "non_tocca_a_te");
  assert.deepEqual(sessioniPer(inCorso(), "a"), { ok: true, mia: "sessioneA123", altra: "sessioneB123" });
  assert.deepEqual(sessioniPer(inCorso(), "b"), { ok: true, mia: "sessioneB123", altra: "sessioneA123" });
  const caduto = caduta(inCorso(), { da: "b", adesso: s(60) }).stato;
  assert.equal(sessioniPer(caduto, "a").motivo, "riconnessione"); // l'altra persona non c'è: niente da ascoltare
});

test("ascolto: salva il mid ricevuto sulla propria sessione e la vista dice «fatto»", () => {
  const c = inCorso();
  assert.equal(vistaPer(c, "a", s(10)).ascolto, "da_fare");
  const r = ascolto(c, { da: "a", mid: "1", di: "sessioneB123" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.stato.sessioni.a, { sessione: "sessioneA123", mid: "0", ascolto: { mid: "1", di: "sessioneB123" } });
  assert.equal(vistaPer(r.stato, "a", s(10)).ascolto, "fatto");
  assert.equal(vistaPer(r.stato, "b", s(10)).ascolto, "da_fare");
  assert.deepEqual(r.chiudiTracce, []);
  // La vista non contiene mai sessioni o mid.
  assert.equal(JSON.stringify(vistaPer(r.stato, "a", s(10))).includes("sessione"), false);
});

test("ascolto: rifiutato se la sessione dell'altra persona nel frattempo è cambiata (rientro)", () => {
  assert.equal(ascolto(inCorso(), { da: "a", mid: "1", di: "sessioneVECCHIA" }).motivo, "cambiata");
  assert.equal(ascolto(squilla(), { da: "a", mid: "1", di: "sessioneB123" }).motivo, "non_in_corso");
  assert.equal(ascolto(inCorso(), { da: "c", mid: "1", di: "sessioneB123" }).motivo, "non_tocca_a_te");
});

test("rientro dell'altra persona: il mio ascolto torna «da_fare»; ascoltare di nuovo chiude la traccia vecchia", () => {
  const c = ascolto(inCorso(), { da: "a", mid: "1", di: "sessioneB123" }).stato;
  const caduto = caduta(c, { da: "b", adesso: s(60) }).stato;
  const dopo = rientro(caduto, { da: "b", adesso: s(70), sessione: "sessioneB456", mid: "0" }).stato;
  assert.equal(vistaPer(dopo, "a", s(71)).ascolto, "da_fare");
  const r = ascolto(dopo, { da: "a", mid: "2", di: "sessioneB456" });
  assert.deepEqual(r.chiudiTracce, [{ sessione: "sessioneA123", mids: ["1"] }]);
  assert.deepEqual(r.stato.sessioni.a.ascolto, { mid: "2", di: "sessioneB456" });
});

// --- Durable Object ---------------------------------------------------------------------------------------------

function archivio() {
  const dati = new Map();
  let allarme = null;
  return {
    get allarme() { return allarme; },
    async get(k) { return dati.has(k) ? structuredClone(dati.get(k)) : undefined; },
    async put(k, v) {
      if (typeof k === "object") for (const [a, b] of Object.entries(k)) dati.set(a, structuredClone(b));
      else dati.set(k, structuredClone(v));
    },
    async deleteAll() { dati.clear(); },
    async setAlarm(t) { allarme = typeof t === "number" ? t : t.getTime(); },
    async deleteAlarm() { allarme = null; },
  };
}

async function gestoreInCorso() {
  let ora = T0.getTime();
  const chiuse = [];
  const g = new GestoreChiamata({ storage: archivio(), adesso: () => new Date(ora),
    chiudiSessione: async (sessione, mids) => { chiuse.push({ sessione, mids }); return { ok: true }; },
    registra: async () => true });
  await g.apri({ chi: "a", con: "b", chiusuraStanza: CHIUDE.getTime(), sessioneChi: "sessioneA123", midChi: "0" });
  ora = s(5).getTime();
  await g.rispondi({ da: "b", sessione: "sessioneB123", mid: "0" });
  return { g, chiuse, vai: (n) => { ora = s(n).getTime(); } };
}

test("Durable Object: sessioni(per) e ascolto; a fine chiamata si chiudono anche le tracce ricevute", async () => {
  const { g, chiuse, vai } = await gestoreInCorso();
  assert.deepEqual(await g.sessioni("a"), { ok: true, mia: "sessioneA123", altra: "sessioneB123" });
  const r = await g.ascolto({ da: "a", mid: "1", di: "sessioneB123" });
  assert.equal(r.ok, true);
  assert.equal(r.vista.ascolto, "fatto");
  vai(100);
  await g.chiudi({ da: "b", esito: "chiusa" });
  const a = chiuse.find((c) => c.sessione === "sessioneA123");
  assert.deepEqual(a.mids.sort(), ["0", "1"]);
});

test("Durable Object: nuovo ascolto dopo un rientro chiude la traccia ricevuta vecchia, non la mia voce", async () => {
  const { g, chiuse, vai } = await gestoreInCorso();
  await g.ascolto({ da: "a", mid: "1", di: "sessioneB123" });
  vai(60); await g.caduta({ da: "b" });
  vai(70); await g.rientro({ da: "b", sessione: "sessioneB456", mid: "0" });
  chiuse.length = 0;
  await g.ascolto({ da: "a", mid: "2", di: "sessioneB456" });
  assert.deepEqual(chiuse, [{ sessione: "sessioneA123", mids: ["1"] }]);
});

// --- Richieste (api/apri_chiamata.js) -----------------------------------------------------------------------------

const A = "11111111-1111-4111-8111-111111111111";
const STANZA = "99999999-9999-4999-8999-999999999999";
const OFFERTA_CF = { type: "offer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:1\r\n" };
const RISPOSTA = { type: "answer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:1\r\n" };

function finti({ sessioni = { ok: true, mia: "sessioneA123", altra: "sessioneB123" }, ricevi, ascoltoDo, conferma } = {}) {
  const reg = { ricevi: [], ascolti: [], chiuse: [], conferme: [] };
  const d = {
    stanzaDi: async () => ({ id: STANZA, apre: T0, chiude: CHIUDE }),
    centralino: () => ({ linea: async (per) => (per === A ? { chiamata: "chiamata-1", ruolo: "chi", altra: "x" } : null) }),
    chiamata: () => ({
      sessioni: async () => sessioni,
      ascolto: async (x) => { reg.ascolti.push(x); return ascoltoDo || { ok: true, vista: { fase: "in_corso", ascolto: "fatto" } }; },
      vista: async () => ({ ok: true, vista: { fase: "in_corso", ascolto: "fatto" } }),
    }),
    riceviVoce: async (mia, altra) => { reg.ricevi.push([mia, altra]); return ricevi || { ok: true, descrizione: OFFERTA_CF, mid: "1" }; },
    confermaRisposta: async (mia, r) => { reg.conferme.push([mia, r]); return conferma || { ok: true }; },
    chiudiSessione: async (sessione, mids) => { reg.chiuse.push({ sessione, mids }); return { ok: true }; },
  };
  return { d, reg };
}

test("ascolta: offerta di Cloudflare al telefono, mid salvato nel Durable Object, mai sessioni al telefono", async () => {
  const { d, reg } = finti();
  const r = await ascoltaChiamata({ per: A, adesso: T0 }, d);
  assert.deepEqual(r, { ok: true, descrizione: OFFERTA_CF, vista: { fase: "in_corso", ascolto: "fatto" } });
  assert.deepEqual(reg.ricevi, [["sessioneA123", "sessioneB123"]]);
  assert.deepEqual(reg.ascolti, [{ da: A, mid: "1", di: "sessioneB123" }]);
  assert.equal(JSON.stringify(r).includes("sessione"), false);
});

test("ascolta: chiamata non in corso o senza linea → il «no» passa, nessuna traccia aperta", async () => {
  const { d, reg } = finti({ sessioni: { ok: false, motivo: "non_in_corso" } });
  assert.deepEqual(await ascoltaChiamata({ per: A, adesso: T0 }, d), { ok: false, motivo: "non_in_corso" });
  assert.equal(reg.ricevi.length, 0);
  assert.deepEqual(await ascoltaChiamata({ per: "22222222-2222-4222-8222-222222222222", adesso: T0 }, d), { ok: false, motivo: "nessuna" });
  assert.deepEqual(await ascoltaChiamata({ per: "x", adesso: T0 }, d), { ok: false, motivo: "dati" });
});

test("ascolta: se il Durable Object dice no (rientro nel frattempo) la traccia appena aperta si chiude", async () => {
  const { d, reg } = finti({ ascoltoDo: { ok: false, motivo: "cambiata" } });
  assert.deepEqual(await ascoltaChiamata({ per: A, adesso: T0 }, d), { ok: false, motivo: "cambiata" });
  assert.deepEqual(reg.chiuse, [{ sessione: "sessioneA123", mids: ["1"] }]);
});

test("ascolta: Realtime non risponde → «realtime», nulla salvato", async () => {
  const { d, reg } = finti({ ricevi: { ok: false, motivo: "realtime" } });
  assert.deepEqual(await ascoltaChiamata({ per: A, adesso: T0 }, d), { ok: false, motivo: "realtime" });
  assert.equal(reg.ascolti.length, 0);
});

test("conferma: solo una risposta solo voce, passata a Realtime sulla propria sessione", async () => {
  const { d, reg } = finti();
  assert.deepEqual(await confermaAscolto({ per: A, risposta: RISPOSTA, adesso: T0 }, d), { ok: true, vista: { fase: "in_corso", ascolto: "fatto" } });
  assert.deepEqual(reg.conferme, [["sessioneA123", RISPOSTA]]);
  const video = { type: "answer", sdp: RISPOSTA.sdp + "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:2\r\n" };
  for (const risposta of [video, OFFERTA_CF, null]) {
    assert.deepEqual(await confermaAscolto({ per: A, risposta, adesso: T0 }, d), { ok: false, motivo: "solo_voce" });
  }
  assert.equal(reg.conferme.length, 1);
});

// --- Worker -----------------------------------------------------------------------------------------------------

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const f = async (url) => (new URL(url).pathname === "/auth/v1/user" ? Response.json({ id: A }) : new Response("{}", { status: 404 }));
const req = (passo, corpo) => new Request("https://presenteincontri.app/app/api/chiamata/" + passo, {
  method: "POST", headers: { authorization: "Bearer eyJhbGciOi.utente-di-prova.firma12345", "content-type": "application/json" },
  body: JSON.stringify(corpo),
});

test("Worker: /ascolta e /conferma con l'utente del token; «no» delle regole 200, solo_voce 400", async () => {
  const ricevute = [];
  const op = {
    ascoltaChiamata: async (x) => { ricevute.push(["ascolta", x]); return { ok: true, descrizione: OFFERTA_CF, vista: { fase: "in_corso" } }; },
    confermaAscolto: async (x) => { ricevute.push(["conferma", x]); return x.risposta ? { ok: true, vista: { fase: "in_corso" } } : { ok: false, motivo: "solo_voce" }; },
  };
  let r = await chiamataApi(req("ascolta", { per: "altro" }), ENV, f, op);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, descrizione: OFFERTA_CF, vista: { fase: "in_corso" } });
  assert.equal(ricevute[0][1].per, A);
  r = await chiamataApi(req("conferma", { risposta: RISPOSTA }), ENV, f, op);
  assert.deepEqual(await r.json(), { ok: true, vista: { fase: "in_corso" } });
  assert.deepEqual(ricevute[1][1].risposta, RISPOSTA);
  r = await chiamataApi(req("conferma", {}), ENV, f, op);
  assert.equal(r.status, 400);
  op.ascoltaChiamata = async () => ({ ok: false, motivo: "non_in_corso" });
  r = await chiamataApi(req("ascolta", {}), ENV, f, op);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: false, motivo: "non_in_corso" });
});

test("conferma: la risposta descrive tutto il collegamento (mia voce + voce ricevuta): due sezioni audio vanno bene", async () => {
  const { d, reg } = finti();
  const due = { type: "answer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:1\r\n" };
  assert.deepEqual(await confermaAscolto({ per: A, risposta: due, adesso: T0 }, d), { ok: true, vista: { fase: "in_corso", ascolto: "fatto" } });
  assert.deepEqual(reg.conferme, [["sessioneA123", due]]);
});
