// Chiamate solo voce (issue #4, passo 3b-2a): il Durable Object che conserva UNA chiamata.
// Qui si prova il «gestore» con un finto archivio in memoria (stesse funzioni di ctx.storage) e un orologio finto:
// nessuna rete, nessun Cloudflare, solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GestoreChiamata, ATTESA_DOPO_FINE, RIPROVA_MS, TENTATIVI } from "../api/chiamata_do.js";
import { registraChiamata } from "../api/registro_chiamate.js";
import { oraDiRoma } from "../api/stanze.js";

const T0 = oraDiRoma(2026, 11, 10, 20);
const CHIUDE = oraDiRoma(2026, 11, 15, 21);
const CARTE = Array.from({ length: 30 }, (_, i) => ({ id: i + 1 }));

function archivio() {
  const dati = new Map();
  let allarme = null;
  return {
    dati,
    get allarme() { return allarme; },
    async get(k) { return dati.has(k) ? structuredClone(dati.get(k)) : undefined; },
    async put(k, v) {
      if (typeof k === "object") for (const [a, b] of Object.entries(k)) dati.set(a, structuredClone(b));
      else dati.set(k, structuredClone(v));
    },
    async deleteAll() { dati.clear(); },
    async setAlarm(t) { allarme = typeof t === "number" ? t : t.getTime(); },
    async deleteAlarm() { allarme = null; },
    async getAlarm() { return allarme; },
  };
}

function prepara({ chiusuraOk = true, registroOk = true } = {}) {
  const storage = archivio();
  let ora = T0.getTime();
  const chiuse = [];
  const righe = [];
  const g = new GestoreChiamata({
    storage,
    adesso: () => new Date(ora),
    chiudiSessione: async (sessione, mids) => { chiuse.push({ sessione, mids }); return { ok: chiusuraOk }; },
    registra: async (riga) => { righe.push(riga); return registroOk; },
  });
  return { g, storage, chiuse, righe, vai: (secondi) => { ora = T0.getTime() + secondi * 1000; } };
}

const APRI = { chi: "a", con: "b", chiusuraStanza: CHIUDE.getTime(), sessioneChi: "sessioneA123", midChi: "0" };

test("apri: salva la chiamata, mette l'allarme allo scadere dello squillo, vista senza sessioni", async () => {
  const { g, storage } = prepara();
  const r = await g.apri(APRI);
  assert.equal(r.ok, true);
  assert.equal(r.vista.fase, "squilla");
  assert.equal(r.vista.io, "chiama");
  assert.equal(JSON.stringify(r).includes("sessioneA123"), false);
  assert.equal(storage.allarme, T0.getTime() + 30000);
  assert.equal((await storage.get("stato")).fase, "squilla");
});

test("apri due volte la stessa chiamata: la seconda è rifiutata", async () => {
  const { g } = prepara();
  await g.apri(APRI);
  assert.equal((await g.apri(APRI)).motivo, "gia_aperta");
});

test("azioni su una chiamata mai aperta: «nessuna»", async () => {
  const { g } = prepara();
  assert.equal((await g.rispondi({ da: "b", sessione: "sessioneB123", mid: "0" })).motivo, "nessuna");
  assert.equal((await g.vista("a")).motivo, "nessuna");
  assert.equal((await g.allarme()).ok, true);
});

test("risposta: in corso, allarme alle 15:00, vale il primo tocco", async () => {
  const { g, storage } = prepara();
  await g.apri(APRI);
  const r = await g.rispondi({ da: "b", sessione: "sessioneB123", mid: "0" });
  assert.equal(r.ok, true);
  assert.equal(r.vista.fase, "in_corso");
  assert.equal(r.vista.io, "riceve");
  assert.equal(storage.allarme, T0.getTime() + 900000);
  assert.equal((await g.rispondi({ da: "b", sessione: "sessioneB999", mid: "0" })).motivo, "gia_finita");
});

test("squillo senza risposta: all'allarme finisce, chiude la sessione di chi chiama, nessuna riga", async () => {
  const { g, chiuse, righe, vai, storage } = prepara();
  await g.apri(APRI);
  vai(30);
  await g.allarme();
  assert.deepEqual(chiuse, [{ sessione: "sessioneA123", mids: ["0"] }]);
  assert.deepEqual(righe, []);
  assert.equal((await g.vista("a")).vista.fase, "finita");
  assert.equal(storage.allarme, T0.getTime() + 30000 + ATTESA_DOPO_FINE);
});

test("allarme prima del tempo: non cambia niente e rimette l'allarme", async () => {
  const { g, vai, storage, chiuse } = prepara();
  await g.apri(APRI);
  vai(10);
  await g.allarme();
  assert.equal((await g.vista("a")).vista.fase, "squilla");
  assert.equal(storage.allarme, T0.getTime() + 30000);
  assert.deepEqual(chiuse, []);
});

test("15 minuti: all'allarme il server chiude le due sessioni e scrive UNA riga", async () => {
  const { g, chiuse, righe, vai } = prepara();
  await g.apri(APRI);
  vai(5);
  await g.rispondi({ da: "b", sessione: "sessioneB123", mid: "1" });
  vai(905);
  await g.allarme();
  assert.deepEqual(chiuse.map((c) => c.sessione).sort(), ["sessioneA123", "sessioneB123"]);
  assert.deepEqual(chiuse.find((c) => c.sessione === "sessioneB123").mids, ["1"]);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].durata, 900);
  assert.equal(righe[0].esito, "tempo_scaduto");
  assert.deepEqual(Object.keys(righe[0]).sort(), ["chi", "con", "durata", "esito", "inizio"]);
});

test("Chiudi e segnala: riga con quell'esito e «segnala» per chi chiama il passo della #7", async () => {
  const { g, righe, vai } = prepara();
  await g.apri(APRI);
  vai(5);
  await g.rispondi({ da: "b", sessione: "sessioneB123", mid: "0" });
  vai(125);
  const r = await g.chiudi({ da: "a", esito: "chiudi_e_segnala" });
  assert.equal(r.ok, true);
  assert.equal(r.segnala, true);
  assert.equal(r.vista.fase, "finita");
  assert.equal(righe[0].durata, 120);
  assert.equal(righe[0].esito, "chiudi_e_segnala");
});

test("rifiuto durante lo squillo: nessuna riga", async () => {
  const { g, righe } = prepara();
  await g.apri(APRI);
  const r = await g.rifiuta({ da: "b" });
  assert.equal(r.ok, true);
  assert.deepEqual(righe, []);
});

test("caduta e rientro: chiude la sessione vecchia, il timer non si ferma", async () => {
  const { g, chiuse, vai, storage } = prepara();
  await g.apri(APRI);
  vai(5);
  await g.rispondi({ da: "b", sessione: "sessioneB123", mid: "0" });
  vai(100);
  await g.caduta({ da: "b" });
  assert.equal(storage.allarme, T0.getTime() + 130000);
  assert.equal((await g.vista("a")).vista.altraPersona, "riconnessione");
  vai(110);
  const r = await g.rientro({ da: "b", sessione: "sessioneB456", mid: "0" });
  assert.equal(r.ok, true);
  assert.deepEqual(chiuse, [{ sessione: "sessioneB123", mids: ["0"] }]);
  assert.equal(storage.allarme, T0.getTime() + 905000);
  assert.equal((await g.vista("a")).vista.altraPersona, "collegata");
});

test("rientro mancato: all'allarme finisce come «caduta» con la durata ferma alla caduta", async () => {
  const { g, righe, vai } = prepara();
  await g.apri(APRI);
  vai(5);
  await g.rispondi({ da: "b", sessione: "sessioneB123", mid: "0" });
  vai(100);
  await g.caduta({ da: "b" });
  vai(130);
  await g.allarme();
  assert.equal(righe[0].esito, "caduta");
  assert.equal(righe[0].durata, 95);
});

test("pescata: stessa carta per i due, 20 secondi tra due pescate, vale il primo tocco", async () => {
  const { g, vai } = prepara();
  await g.apri(APRI);
  vai(5);
  await g.rispondi({ da: "b", sessione: "sessioneB123", mid: "0" });
  vai(20);
  const p = await g.pesca({ da: "a", carte: CARTE, viste: new Set(), casuale: () => 0 });
  assert.equal(p.ok, true);
  assert.equal(typeof p.carta, "number");
  const vb = (await g.vista("b", CARTE.length)).vista;
  assert.deepEqual(vb.carta, { id: p.carta, daMe: false });
  assert.equal((await g.pesca({ da: "b", carte: CARTE, viste: new Set([p.carta]), casuale: () => 0 })).ok, false);
});

test("vista: solo i due partecipanti", async () => {
  const { g } = prepara();
  await g.apri(APRI);
  assert.equal((await g.vista("c")).motivo, "non_tocca_a_te");
});

test("Realtime non risponde alla chiusura: riprova all'allarme, poi pulisce", async () => {
  const p = prepara({ chiusuraOk: false });
  await p.g.apri(APRI);
  p.vai(30);
  await p.g.allarme();
  assert.equal(p.storage.allarme, T0.getTime() + 30000 + RIPROVA_MS);
  assert.equal(p.chiuse.length, 1);
  p.vai(30 + RIPROVA_MS / 1000);
  await p.g.allarme();
  assert.equal(p.chiuse.length, 2);
  // Dopo TENTATIVI tentativi si arrende (Realtime chiude comunque le sessioni inattive) e alla fine cancella tutto.
  for (let i = 0; i < TENTATIVI + 2; i++) {
    p.vai(30 + (i + 2) * RIPROVA_MS / 1000 + 3600);
    await p.g.allarme();
  }
  assert.equal(p.chiuse.length, TENTATIVI);
  assert.equal(p.storage.dati.size, 0);
  assert.equal(p.storage.allarme, null);
});

test("registro non raggiungibile: la riga resta in attesa e si riscrive all'allarme dopo", async () => {
  const p = prepara({ registroOk: false });
  await p.g.apri(APRI);
  p.vai(5);
  await p.g.rispondi({ da: "b", sessione: "sessioneB123", mid: "0" });
  p.vai(65);
  await p.g.chiudi({ da: "b", esito: "chiusa" });
  assert.equal(p.righe.length, 1);
  assert.ok((await p.storage.get("attesa")).riga);
  p.vai(65 + RIPROVA_MS / 1000);
  await p.g.allarme();
  assert.equal(p.righe.length, 2);
  assert.deepEqual(p.righe[0], p.righe[1]);
});

test("a chiamata finita e tutto scritto: dopo l'attesa non resta nulla nel Durable Object", async () => {
  const { g, storage, vai } = prepara();
  await g.apri(APRI);
  vai(5);
  await g.rispondi({ da: "b", sessione: "sessioneB123", mid: "0" });
  vai(65);
  await g.chiudi({ da: "a", esito: "chiusa" });
  assert.equal(storage.allarme, T0.getTime() + 65000 + ATTESA_DOPO_FINE);
  vai(65 + ATTESA_DOPO_FINE / 1000);
  await g.allarme();
  assert.equal(storage.dati.size, 0);
  assert.equal(storage.allarme, null);
  assert.equal((await g.vista("a")).motivo, "nessuna");
});

// ── Registro su Supabase ──
const ENV = { SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "chiave-di-prova-non-reale" };
const RIGA = { chi: "11111111-1111-4111-8111-111111111111", con: "22222222-2222-4222-8222-222222222222",
  inizio: "2026-11-10T19:00:05.000Z", durata: 120, esito: "chiusa" };

test("registraChiamata: una riga in public.chiamate, ripetibile senza doppioni", async () => {
  const fatte = [];
  const f = async (url, init) => { fatte.push({ url, init }); return new Response(null, { status: 201 }); };
  assert.equal(await registraChiamata(ENV, RIGA, f), true);
  assert.equal(fatte.length, 1);
  assert.ok(fatte[0].url.endsWith("/rest/v1/chiamate?on_conflict=chi,inizio"));
  assert.equal(fatte[0].init.method, "POST");
  assert.match(fatte[0].init.headers.prefer, /resolution=ignore-duplicates/);
  assert.deepEqual(JSON.parse(fatte[0].init.body), RIGA);
});

test("registraChiamata: configurazione mancante, risposta d'errore o rete giù → false", async () => {
  const ok = async () => new Response(null, { status: 201 });
  assert.equal(await registraChiamata({}, RIGA, ok), false);
  assert.equal(await registraChiamata(ENV, { ...RIGA, chi: "non-un-id" }, ok), false);
  assert.equal(await registraChiamata(ENV, RIGA, async () => new Response("x", { status: 500 })), false);
  assert.equal(await registraChiamata(ENV, RIGA, async () => { throw new Error("rete"); }), false);
});
