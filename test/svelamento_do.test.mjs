// Svelamento (issue #65, passo 7b): il Durable Object che tiene le sessioni Realtime di UNA porta durante i 10 secondi.
// Si prova il «gestore» con un finto archivio in memoria (stesse funzioni di ctx.storage) e un orologio finto:
// nessuna rete, nessun Cloudflare, solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GestoreSvelamento, ATTESA_DOPO_FINE, SCADENZA_MS, RIPROVA_MS, TENTATIVI } from "../api/svelamento_do.js";
import { SVELAMENTO } from "../api/svelamento.js";

const T0 = Date.UTC(2026, 10, 22, 20, 30);
const DURATA = SVELAMENTO.durata * 1000;

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

function prepara({ chiusuraOk = true } = {}) {
  const storage = archivio();
  let ora = T0;
  const chiuse = [];
  const g = new GestoreSvelamento({
    storage,
    adesso: () => new Date(ora),
    chiudiSessione: async (sessione, mids) => { chiuse.push({ sessione, mids }); return { ok: chiusuraOk }; },
  });
  return { g, storage, chiuse, vai: (ms) => { ora = T0 + ms; } };
}

const PUB_A = { da: "a", sessione: "sessioneA123", mids: ["0", "1"] };
const PUB_B = { da: "b", sessione: "sessioneB123", mids: ["0", "1"] };

async function entrambiRicevono(g) {
  await g.pubblica(PUB_A);
  await g.pubblica(PUB_B);
  await g.ricevuto({ da: "a", mids: ["2", "3"] });
  return g.ricevuto({ da: "b", mids: ["2", "3"] });
}

test("pubblica: salva la sessione, vista «attesa» senza id di sessione, allarme di sicurezza", async () => {
  const { g, storage } = prepara();
  const r = await g.pubblica(PUB_A);
  assert.equal(r.ok, true);
  assert.equal(r.vista.fase, "attesa");
  assert.equal(JSON.stringify(r).includes("sessioneA123"), false);
  assert.equal(storage.allarme, T0 + SCADENZA_MS);
});

test("pubblica: dati sbagliati rifiutati (sessione, mids)", async () => {
  const { g } = prepara();
  assert.equal((await g.pubblica({ da: "a", sessione: "x", mids: ["0", "1"] })).motivo, "dati");
  assert.equal((await g.pubblica({ da: "a", sessione: "sessioneA123", mids: ["0"] })).motivo, "dati");
  assert.equal((await g.pubblica({ da: "a", sessione: "sessioneA123", mids: ["0", "0"] })).motivo, "dati");
  assert.equal((await g.pubblica({ da: "", sessione: "sessioneA123", mids: ["0", "1"] })).motivo, "dati");
});

test("una terza persona non entra mai", async () => {
  const { g } = prepara();
  await g.pubblica(PUB_A);
  await g.pubblica(PUB_B);
  assert.equal((await g.pubblica({ da: "c", sessione: "sessioneC123", mids: ["0", "1"] })).motivo, "non_tocca_a_te");
  assert.equal((await g.altra("c")).motivo, "non_tocca_a_te");
});

test("altra: la sessione dell'altra persona solo dopo che ha pubblicato", async () => {
  const { g } = prepara();
  await g.pubblica(PUB_A);
  assert.equal((await g.altra("a")).motivo, "in_attesa");
  await g.pubblica(PUB_B);
  assert.deepEqual(await g.altra("a"), { ok: true, sessione: "sessioneB123" });
  assert.deepEqual(await g.altra("b"), { ok: true, sessione: "sessioneA123" });
});

test("il timer dei 10 secondi parte solo quando TUTTI E DUE ricevono (B arriva 30 s dopo A)", async () => {
  const { g, storage, vai } = prepara();
  await g.pubblica(PUB_A);
  vai(30000);
  await g.pubblica(PUB_B);
  const soloA = await g.ricevuto({ da: "a", mids: ["2", "3"] });
  assert.equal(soloA.vista.fase, "attesa");
  vai(31000);
  const r = await g.ricevuto({ da: "b", mids: ["2", "3"] });
  assert.equal(r.vista.fase, "in_corso");
  assert.equal(r.vista.inizio, T0 + 31000);
  assert.equal(r.vista.fine, T0 + 31000 + DURATA);
  assert.equal(r.vista.nitidoDal, T0 + 31000 + SVELAMENTO.sfocato * 1000);
  assert.equal(storage.allarme, T0 + 31000 + DURATA);
});

test("ricevuto prima di aver pubblicato o senza l'altra persona: rifiutato", async () => {
  const { g } = prepara();
  assert.equal((await g.ricevuto({ da: "a", mids: ["2", "3"] })).motivo, "nessuna");
  await g.pubblica(PUB_A);
  assert.equal((await g.ricevuto({ da: "a", mids: ["2", "3"] })).motivo, "in_attesa");
  await g.pubblica(PUB_B);
  assert.equal((await g.ricevuto({ da: "a", mids: ["2"] })).motivo, "dati");
});

test("a 10 secondi il server chiude da solo tutte le tracce delle due sessioni", async () => {
  const { g, chiuse, vai, storage } = prepara();
  await entrambiRicevono(g);
  vai(DURATA - 1);
  await g.allarme();
  assert.equal((await g.vista("a")).vista.fase, "in_corso");
  assert.deepEqual(chiuse, []);
  vai(DURATA);
  await g.allarme();
  assert.equal((await g.vista("a")).vista.fase, "finito");
  assert.deepEqual(chiuse.map((c) => c.sessione).sort(), ["sessioneA123", "sessioneB123"]);
  assert.deepEqual(chiuse.find((c) => c.sessione === "sessioneA123").mids, ["0", "1", "2", "3"]);
  assert.equal(storage.allarme, T0 + DURATA + ATTESA_DOPO_FINE);
});

test("dopo la fine non si allunga: niente nuova pubblicazione, niente nuovo timer", async () => {
  const { g, vai } = prepara();
  await entrambiRicevono(g);
  vai(DURATA);
  await g.allarme();
  assert.equal((await g.pubblica(PUB_A)).motivo, "finito");
  assert.equal((await g.ricevuto({ da: "a", mids: ["2", "3"] })).motivo, "finito");
});

test("a fine svelamento, passato il tempo per mostrarlo, il Durable Object cancella tutto", async () => {
  const { g, vai, storage } = prepara();
  await entrambiRicevono(g);
  vai(DURATA);
  await g.allarme();
  vai(DURATA + ATTESA_DOPO_FINE);
  await g.allarme();
  assert.equal(storage.dati.size, 0);
  assert.equal(storage.allarme, null);
  assert.equal((await g.vista("a")).motivo, "nessuna");
});

test("nessuno arriva: dopo SCADENZA_MS il server chiude la sessione rimasta aperta", async () => {
  const { g, vai, chiuse } = prepara();
  await g.pubblica(PUB_A);
  vai(SCADENZA_MS);
  await g.allarme();
  // Passo 8b-2b: senza inizio non è uno svelamento finito, si torna a «Quando?» (test/fine_svelamento_do.test.mjs).
  assert.equal((await g.vista("a")).motivo, "quando");
  assert.deepEqual(chiuse, [{ sessione: "sessioneA123", mids: ["0", "1"] }]);
});

test("ripubblicare (Riprova) prima della fine: chiude la vecchia sessione e le tracce ricevute dall'altro, il timer riparte da 10", async () => {
  const { g, vai, chiuse, storage } = prepara();
  await entrambiRicevono(g);
  vai(4000);
  const r = await g.pubblica({ da: "a", sessione: "sessioneA999", mids: ["0", "1"] });
  assert.equal(r.ok, true);
  assert.equal(r.vista.fase, "attesa");
  assert.deepEqual(chiuse, [
    { sessione: "sessioneA123", mids: ["0", "1", "2", "3"] },
    { sessione: "sessioneB123", mids: ["2", "3"] },
  ]);
  assert.deepEqual(await g.altra("b"), { ok: true, sessione: "sessioneA999" });
  await g.ricevuto({ da: "a", mids: ["2", "3"] });
  vai(6000);
  const di = await g.ricevuto({ da: "b", mids: ["4", "5"] });
  assert.equal(di.vista.fase, "in_corso");
  assert.equal(di.vista.fine, T0 + 6000 + DURATA);
  assert.equal(storage.allarme, T0 + 6000 + DURATA);
});

test("chiusura che non riesce: si riprova all'allarme, al massimo TENTATIVI volte", async () => {
  const { g, vai, storage } = prepara({ chiusuraOk: false });
  await entrambiRicevono(g);
  vai(DURATA);
  await g.allarme();
  assert.equal(storage.allarme, T0 + DURATA + RIPROVA_MS);
  for (let i = 1; i < TENTATIVI; i++) {
    vai(DURATA + i * RIPROVA_MS);
    await g.allarme();
  }
  assert.deepEqual((await storage.get("attesa"))?.chiusure ?? [], []);
});

test("la vista non contiene mai id di sessione né mids", async () => {
  const { g } = prepara();
  const r = await entrambiRicevono(g);
  const testo = JSON.stringify([r, await g.vista("a"), await g.vista("b")]);
  for (const x of ["sessioneA123", "sessioneB123", "mids"]) assert.equal(testo.includes(x), false, x);
  assert.equal((await g.vista("c")).motivo, "non_tocca_a_te");
});

// ── Passo 7c: il Worker chiede le due sessioni, segna le tracce «in arrivo» e le conferma dopo la risposta del telefono.

test("sessioni: per il Worker la mia e quella dell'altra persona, solo quando ci sono tutti e due", async () => {
  const { g } = prepara();
  assert.equal((await g.sessioni("a")).motivo, "nessuna");
  await g.pubblica(PUB_A);
  assert.equal((await g.sessioni("a")).motivo, "in_attesa");
  await g.pubblica(PUB_B);
  assert.deepEqual(await g.sessioni("a"), { ok: true, mia: "sessioneA123", altra: "sessioneB123" });
  assert.deepEqual(await g.sessioni("b"), { ok: true, mia: "sessioneB123", altra: "sessioneA123" });
  assert.equal((await g.sessioni("c")).motivo, "non_tocca_a_te");
});

test("inArrivo + ricevuto senza mids: i 10 secondi partono solo dopo la conferma di tutti e due", async () => {
  const { g, vai, storage } = prepara();
  await g.pubblica(PUB_A);
  await g.pubblica(PUB_B);
  assert.equal((await g.inArrivo({ da: "a", mids: ["2", "3"] })).vista.fase, "attesa");
  assert.equal((await g.inArrivo({ da: "b", mids: ["2", "3"] })).vista.fase, "attesa");
  assert.equal((await g.ricevuto({ da: "a" })).vista.fase, "attesa");
  vai(2000);
  const r = await g.ricevuto({ da: "b" });
  assert.equal(r.vista.fase, "in_corso");
  assert.equal(r.vista.inizio, T0 + 2000);
  assert.equal(storage.allarme, T0 + 2000 + DURATA);
});

test("ricevuto senza mids e senza tracce in arrivo: rifiutato", async () => {
  const { g } = prepara();
  await g.pubblica(PUB_A);
  await g.pubblica(PUB_B);
  assert.equal((await g.ricevuto({ da: "a" })).motivo, "dati");
  assert.equal((await g.inArrivo({ da: "a", mids: ["2"] })).motivo, "dati");
});

test("inArrivo: prima dell'altra persona, da terzi o dopo la fine è rifiutato", async () => {
  const { g, vai } = prepara();
  assert.equal((await g.inArrivo({ da: "a", mids: ["2", "3"] })).motivo, "nessuna");
  await g.pubblica(PUB_A);
  assert.equal((await g.inArrivo({ da: "a", mids: ["2", "3"] })).motivo, "in_attesa");
  await g.pubblica(PUB_B);
  assert.equal((await g.inArrivo({ da: "c", mids: ["2", "3"] })).motivo, "nessuna");
  await entrambiRicevono(g);
  vai(DURATA);
  await g.allarme();
  assert.equal((await g.inArrivo({ da: "a", mids: ["4", "5"] })).motivo, "finito");
});

test("ricevere di nuovo chiude subito le tracce vecchie (mai più di 4 tracce per sessione)", async () => {
  const { g, chiuse } = prepara();
  await g.pubblica(PUB_A);
  await g.pubblica(PUB_B);
  await g.inArrivo({ da: "a", mids: ["2", "3"] });
  await g.inArrivo({ da: "a", mids: ["4", "5"] });
  assert.deepEqual(chiuse, [{ sessione: "sessioneA123", mids: ["2", "3"] }]);
  await g.ricevuto({ da: "a" });
  await g.inArrivo({ da: "a", mids: ["6", "7"] });
  assert.deepEqual(chiuse[1], { sessione: "sessioneA123", mids: ["4", "5"] });
});

test("alla fine si chiudono anche le tracce in arrivo mai confermate", async () => {
  const { g, vai, chiuse } = prepara();
  await g.pubblica(PUB_A);
  await g.pubblica(PUB_B);
  await g.inArrivo({ da: "a", mids: ["2", "3"] });
  vai(SCADENZA_MS);
  await g.allarme();
  assert.deepEqual(chiuse.find((c) => c.sessione === "sessioneA123").mids, ["0", "1", "2", "3"]);
});

test("Riprova dell'altra persona chiude anche le tracce che stavo per ricevere", async () => {
  const { g, chiuse } = prepara();
  await g.pubblica(PUB_A);
  await g.pubblica(PUB_B);
  await g.inArrivo({ da: "b", mids: ["2", "3"] });
  await g.pubblica({ da: "a", sessione: "sessioneA999", mids: ["0", "1"] });
  assert.deepEqual(chiuse, [
    { sessione: "sessioneA123", mids: ["0", "1"] },
    { sessione: "sessioneB123", mids: ["2", "3"] },
  ]);
  assert.equal((await g.ricevuto({ da: "b" })).motivo, "dati");
});

// Passo 7d-1: la vista porta l'ora del server («ora»), così il telefono calcola timer e sfocatura senza fidarsi del
// proprio orologio.
test("la vista porta l'ora del server", async () => {
  const { g, vai } = prepara();
  const r = await g.pubblica(PUB_A);
  assert.equal(r.vista.ora, T0);
  vai(4200);
  assert.equal((await g.vista("a")).vista.ora, T0 + 4200);
});

// Passo 7d-3a: «Chiudi e segnala». Il Worker lo chiama dopo il sì del database: tutte le tracce delle due sessioni si
// chiudono SUBITO (senza aspettare i 10 secondi), e l'altra persona vede «interrotto», mai «Ecco <nome>.».
test("chiudi: chiude subito tutte le tracce delle due sessioni, a metà dei 10 secondi", async () => {
  const { g, chiuse, vai } = prepara();
  await entrambiRicevono(g);
  vai(4000);
  const r = await g.chiudi({ da: "b" });
  assert.equal(r.ok, true);
  const sessioni = chiuse.map((c) => c.sessione).sort();
  assert.deepEqual(sessioni, ["sessioneA123", "sessioneB123"]);
  for (const c of chiuse) assert.deepEqual([...c.mids].sort(), ["0", "1", "2", "3"]);
  assert.equal(JSON.stringify(r).includes("sessione"), false);
});

test("chiudi: dopo, la vista dice «interrotto» a entrambi e niente si riapre", async () => {
  const { g, vai } = prepara();
  await entrambiRicevono(g);
  vai(4000);
  await g.chiudi({ da: "b" });
  assert.equal((await g.vista("a")).vista.fase, "interrotto");
  assert.equal((await g.vista("b")).vista.fase, "interrotto");
  assert.equal((await g.vista("a")).vista.fine, undefined);
  assert.deepEqual(await g.pubblica(PUB_A), { ok: false, motivo: "interrotto" });
  assert.deepEqual(await g.sessioni("a"), { ok: false, motivo: "interrotto" });
});

test("chiudi: chi non è nella porta non chiude nulla", async () => {
  const { g, chiuse } = prepara();
  await entrambiRicevono(g);
  const prima = chiuse.length;
  assert.deepEqual(await g.chiudi({ da: "c" }), { ok: false, motivo: "non_tocca_a_te" });
  assert.equal(chiuse.length, prima);
  assert.equal((await g.vista("a")).vista.fase, "in_corso");
});

test("chiudi: senza nessuno dentro va bene lo stesso (il database ha già chiuso la porta)", async () => {
  const { g } = prepara();
  assert.deepEqual(await g.chiudi({ da: "a" }), { ok: true });
});

test("chiudi: con una sola persona dentro chiude la sua sessione", async () => {
  const { g, chiuse } = prepara();
  await g.pubblica(PUB_A);
  assert.equal((await g.chiudi({ da: "a" })).ok, true);
  assert.deepEqual(chiuse.map((c) => c.sessione), ["sessioneA123"]);
});

test("chiudi: le chiusure fallite restano da riprovare con l'allarme", async () => {
  const { g, storage } = prepara({ chiusuraOk: false });
  await entrambiRicevono(g);
  await g.chiudi({ da: "a" });
  assert.ok((await storage.get("attesa")).chiusure.length > 0);
  assert.ok(storage.allarme <= T0 + RIPROVA_MS);
});
