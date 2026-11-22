// Svelamento, passo 8b-2b (issue #65, D48 A; linea «sviluppatore»): il Durable Object della porta dice al database come
// è finito il video. Dieci secondi pieni → fine_svelamento (da lì le 48 ore del sì/no). Nessuno collegato entro 15 minuti,
// o una caduta al terzo avvio → torna_a_quando (passo 4, caparre e scelte restano). «Chiudi e segnala» → niente (lo ha
// già fatto il database). Con le foto la fine vale subito, appena entra_svelamento dice «iniziato_foto».
// Nessuna rete vera: archivio in memoria, orologio finto, Supabase finto. Dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GestoreSvelamento, ATTESA_DOPO_FINE, SCADENZA_MS, RIPROVA_MS, TENTATIVI } from "../api/svelamento_do.js";
import { SVELAMENTO } from "../api/svelamento.js";
import { svelamentoApi, PERCORSO_SVELAMENTO, segnaFineSvelamento } from "../worker/svelamento_api.js";

const T0 = Date.UTC(2026, 10, 23, 20, 30);
const DURATA = SVELAMENTO.durata * 1000;
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const IO = "11111111-2222-4333-8444-555555555555";

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
  };
}

function prepara({ risposte = [] } = {}) {
  const storage = archivio();
  let ora = T0;
  const segnate = [];
  const g = new GestoreSvelamento({
    storage,
    adesso: () => new Date(ora),
    chiudiSessione: async () => ({ ok: true }),
    segna: async (x) => { segnate.push(x); return risposte.length ? risposte.shift() : x.fine; },
  });
  return { g, storage, segnate, vai: (ms) => { ora = T0 + ms; } };
}

const pub = (da, n = 1) => ({ da, sessione: `sessione${da}${n}xxxx`, mids: ["0", "1"], porta: PORTA });
async function avvia(g, n = 1) {
  await g.pubblica(pub("a", n));
  await g.pubblica(pub("b", n));
  await g.ricevuto({ da: "a", mids: ["2", "3"] });
  return g.ricevuto({ da: "b", mids: ["2", "3"] });
}

test("10 secondi pieni: l'allarme segna «finito» nel database una volta sola, con la porta e una delle due persone", async () => {
  const { g, segnate, vai } = prepara();
  await avvia(g);
  vai(DURATA);
  await g.allarme();
  assert.equal(segnate.length, 1);
  assert.equal(segnate[0].porta, PORTA);
  assert.equal(segnate[0].fine, "finito");
  assert.ok(["a", "b"].includes(segnate[0].persona));
  await g.allarme();
  await g.segna();
  assert.equal(segnate.length, 1);
});

test("nessuno svelamento iniziato entro 15 minuti: «quando» nel database e al telefono, mai «Ecco <nome>.»", async () => {
  const { g, segnate, vai } = prepara();
  await g.pubblica(pub("a"));
  vai(SCADENZA_MS);
  await g.allarme();
  assert.deepEqual(segnate.map((x) => x.fine), ["quando"]);
  assert.equal((await g.vista("a")).motivo, "quando");
  assert.equal((await g.pubblica(pub("a", 2))).motivo, "quando");
});

test("«Chiudi e segnala»: il database ha già chiuso la porta, il Durable Object non segna niente", async () => {
  const { g, segnate, vai } = prepara();
  await avvia(g);
  await g.chiudi({ da: "a" });
  vai(DURATA + ATTESA_DOPO_FINE);
  await g.allarme();
  await g.segna();
  assert.equal(segnate.length, 0);
});

test("caduta al terzo avvio: si torna al passo 4 («quando»), tracce chiuse; alla prima e alla seconda si riprova", async () => {
  const { g, segnate } = prepara();
  await avvia(g, 1);
  assert.equal((await g.pubblica(pub("a", 2))).ok, true); // caduta 1: «Riprova»
  await g.pubblica(pub("b", 2));
  await g.ricevuto({ da: "a", mids: ["2", "3"] });
  await g.ricevuto({ da: "b", mids: ["2", "3"] });
  assert.equal((await g.pubblica(pub("a", 3))).ok, true); // caduta 2
  await g.pubblica(pub("b", 3));
  await g.ricevuto({ da: "a", mids: ["2", "3"] });
  await g.ricevuto({ da: "b", mids: ["2", "3"] });
  assert.equal(SVELAMENTO.tentativi, 3);
  const terza = await g.pubblica(pub("a", 4)); // caduta 3
  assert.deepEqual([terza.ok, terza.motivo], [false, "quando"]);
  assert.deepEqual(segnate.map((x) => x.fine), ["quando"]);
  assert.equal((await g.ricevuto({ da: "b", mids: ["2", "3"] })).motivo, "quando");
});

test("«Riprova» prima che partano i 10 secondi non conta come caduta", async () => {
  const { g, segnate } = prepara();
  for (let n = 1; n <= 5; n++) assert.equal((await g.pubblica(pub("a", n))).ok, true);
  assert.equal(segnate.length, 0);
});

test("database che non risponde: riprova al prossimo allarme e cancella tutto solo dopo averlo segnato", async () => {
  const { g, storage, segnate, vai } = prepara({ risposte: [undefined] });
  await avvia(g);
  vai(DURATA);
  await g.allarme();
  assert.equal(segnate.length, 1);
  assert.ok(storage.allarme <= T0 + DURATA + RIPROVA_MS);
  vai(DURATA + ATTESA_DOPO_FINE);
  await g.allarme();
  assert.equal(segnate.length, 2);
  vai(DURATA + 2 * ATTESA_DOPO_FINE + RIPROVA_MS);
  await g.allarme();
  assert.equal(segnate.length, 2);
  assert.equal(storage.dati.has("stato"), false);
});

test("database sempre giù: dopo TENTATIVI giri lascia perdere (lo svelamento fermo torna da solo al passo 4)", async () => {
  const { g, storage, segnate, vai } = prepara({ risposte: Array(20).fill(undefined) });
  await avvia(g);
  for (let i = 0; i <= TENTATIVI + 2; i++) {
    vai(DURATA + i * (ATTESA_DOPO_FINE + RIPROVA_MS));
    await g.allarme();
  }
  assert.equal(segnate.length, TENTATIVI);
  assert.equal(storage.dati.has("stato"), false);
});

test("«segna» chiesto dal Worker a 10 secondi passati: chiude e segna subito, senza aspettare l'allarme", async () => {
  const { g, segnate, vai } = prepara();
  await avvia(g);
  vai(DURATA - 1);
  await g.segna();
  assert.equal(segnate.length, 0); // prima dei 10 secondi niente
  vai(DURATA + 5);
  await g.segna();
  assert.deepEqual(segnate.map((x) => x.fine), ["finito"]);
  assert.equal((await g.vista("a")).vista.fase, "finito");
});

test("senza porta salvata (stato di prima del passo 8b-2b) non segna niente e non si rompe", async () => {
  const { g, segnate, vai } = prepara();
  await g.pubblica({ ...pub("a"), porta: undefined });
  await g.pubblica({ ...pub("b"), porta: "non-una-porta" });
  await g.ricevuto({ da: "a", mids: ["2", "3"] });
  await g.ricevuto({ da: "b", mids: ["2", "3"] });
  vai(DURATA);
  await g.allarme();
  assert.equal(segnate.length, 0);
});

// ── Worker ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function supabase(risposte) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    const corpo = opzioni.body ? JSON.parse(opzioni.body) : null;
    viste.push({ percorso: u.pathname, corpo });
    if (u.pathname === "/auth/v1/user") return Response.json({ id: IO });
    const nome = u.pathname.replace("/rest/v1/rpc/", "");
    if (nome in risposte) return Response.json(risposte[nome]);
    return new Response("no", { status: 500 });
  };
  return { f, viste, rpc: (nome) => viste.filter((v) => v.percorso === "/rest/v1/rpc/" + nome) };
}
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

test("segnaFineSvelamento: «finito» → fine_svelamento, «quando» → torna_a_quando; altro rifiutato senza rete", async () => {
  const s = supabase({ fine_svelamento: "finito", torna_a_quando: "quando" });
  assert.equal(await segnaFineSvelamento(ENV, { porta: PORTA, persona: IO, fine: "finito" }, s.f), "finito");
  assert.equal(await segnaFineSvelamento(ENV, { porta: PORTA, persona: IO, fine: "quando" }, s.f), "quando");
  assert.deepEqual(s.rpc("fine_svelamento")[0].corpo, { p_porta: PORTA, p_persona: IO });
  assert.deepEqual(s.rpc("torna_a_quando")[0].corpo, { p_porta: PORTA, p_persona: IO });
  const n = s.viste.length;
  assert.equal(await segnaFineSvelamento(ENV, { porta: PORTA, persona: IO, fine: "altro" }, s.f), undefined);
  assert.equal(await segnaFineSvelamento(ENV, { porta: "x", persona: IO, fine: "finito" }, s.f), undefined);
  assert.equal(await segnaFineSvelamento({}, { porta: PORTA, persona: IO, fine: "finito" }, s.f), undefined);
  assert.equal(s.viste.length, n);
});

test("«entra» con le foto: la fine dello svelamento vale subito (fine_svelamento per la persona del token)", async () => {
  const s = supabase({ entra_svelamento: "iniziato_foto", fine_svelamento: "finito" });
  const r = await svelamentoApi(new Request("https://presenteincontri.app" + PERCORSO_SVELAMENTO, {
    method: "POST",
    headers: { authorization: "Bearer token-mio.prova.firma12345", "content-type": "application/json" },
    body: JSON.stringify({ azione: "entra", porta: PORTA }),
  }), ENV, s.f);
  const j = await r.json();
  assert.deepEqual([j.ok, j.esito, j.tipo], [true, "iniziato", "foto"]);
  assert.deepEqual(s.rpc("fine_svelamento").map((v) => v.corpo), [{ p_porta: PORTA, p_persona: IO }]);
});

test("«entra» con il video: nessuna fine prima dei 10 secondi", async () => {
  const s = supabase({ entra_svelamento: "iniziato_video" });
  await svelamentoApi(new Request("https://presenteincontri.app" + PERCORSO_SVELAMENTO, {
    method: "POST",
    headers: { authorization: "Bearer token-mio.prova.firma12345", "content-type": "application/json" },
    body: JSON.stringify({ azione: "entra", porta: PORTA }),
  }), ENV, s.f);
  assert.equal(s.rpc("fine_svelamento").length, 0);
});

test("«vista» che dice «finito» o «quando»: il Worker chiede subito al Durable Object di segnarlo", async () => {
  for (const [r, attese] of [
    [{ ok: true, vista: { fase: "finito", ora: 1, inizio: 1 } }, 1],
    [{ ok: false, motivo: "quando" }, 1],
    [{ ok: false, motivo: "finito" }, 1],
    [{ ok: true, vista: { fase: "in_corso", ora: 1, inizio: 1, fine: 2 } }, 0],
    [{ ok: true, vista: { fase: "in_corso", ora: 2, inizio: 1, fine: 2 } }, 1],
    [{ ok: true, vista: { fase: "interrotto", ora: 1 } }, 0],
  ]) {
    const s = supabase({ entra_svelamento: "iniziato_video" });
    let segnati = 0;
    const stub = { vista: async () => r, segna: async () => { segnati++; return { ok: true }; } };
    const env = { ...ENV, SVELAMENTO: { idFromName: (n) => n, get: () => stub } };
    const x = await svelamentoApi(new Request("https://presenteincontri.app" + PERCORSO_SVELAMENTO, {
      method: "POST",
      headers: { authorization: "Bearer token-mio.prova.firma12345", "content-type": "application/json" },
      body: JSON.stringify({ azione: "vista", porta: PORTA }),
    }), env, s.f);
    assert.equal(x.status, 200);
    assert.equal(segnati, attese, JSON.stringify(r));
  }
});

test("«segna» del Durable Object che fallisce non rompe la risposta al telefono", async () => {
  const s = supabase({ entra_svelamento: "iniziato_video" });
  const stub = { vista: async () => ({ ok: false, motivo: "quando" }), segna: async () => { throw new Error("giù"); } };
  const env = { ...ENV, SVELAMENTO: { idFromName: (n) => n, get: () => stub } };
  const x = await svelamentoApi(new Request("https://presenteincontri.app" + PERCORSO_SVELAMENTO, {
    method: "POST",
    headers: { authorization: "Bearer token-mio.prova.firma12345", "content-type": "application/json" },
    body: JSON.stringify({ azione: "vista", porta: PORTA }),
  }), env, s.f);
  assert.deepEqual(await x.json(), { ok: false, motivo: "quando" });
});

test("«pubblica» passa la porta al Durable Object (serve all'allarme per segnare la fine)", async () => {
  const { pubblicaVideo } = await import("../api/video_svelamento.js");
  const TESTA = ["v=0", "o=- 1 2 IN IP4 127.0.0.1", "s=-", "t=0 0", ""].join("\r\n");
  const sez = (tipo, mid) => [`m=${tipo} 9 UDP/TLS/RTP/SAVPF ${tipo === "audio" ? 111 : 96}`, `a=mid:${mid}`, "a=sendonly", ""].join("\r\n");
  let visto = null;
  const d = {
    nuovaSessione: async () => ({ ok: true, sessione: "sessioneProva1xx" }),
    pubblicaSvelamento: async () => ({ ok: true, descrizione: { type: "answer", sdp: "x" } }),
    chiudiSessione: async () => ({ ok: true }),
    svelamento: { pubblica: async (x) => { visto = x; return { ok: true, vista: { fase: "attesa" } }; } },
  };
  const r = await pubblicaVideo({ per: IO, porta: PORTA, offerta: { type: "offer", sdp: TESTA + sez("audio", "0") + sez("video", "1") } }, d);
  assert.equal(r.ok, true);
  assert.equal(visto.porta, PORTA);
});
