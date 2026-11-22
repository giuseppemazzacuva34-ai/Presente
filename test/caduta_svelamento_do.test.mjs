// Svelamento, passo 8b-3b (issue #65, D48 A, spec v1 del CPO, casi limite; linea «sviluppatore»): la caduta della
// connessione PRIMA dei 10 secondi la dice il telefono al server («caduta»). Il server ferma il timer (non vale come
// svelamento finito), chiude le tracce ricevute da tutti e due e aspetta «Riprova» per 2 minuti; il timer riparte da
// 10 solo quando tutti e due ricevono di nuovo. Senza «Riprova» entro 2 minuti, o alla caduta del terzo avvio, si torna
// al passo 4 («quando»). Caduta dopo i 10 secondi: lo svelamento è valido («finito»).
// Nessuna rete vera: archivio in memoria, orologio finto, Supabase e Realtime finti. Dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GestoreSvelamento, CADUTA_MS } from "../api/svelamento_do.js";
import { SVELAMENTO } from "../api/svelamento.js";
import { svelamentoApi, PERCORSO_SVELAMENTO } from "../worker/svelamento_api.js";

const T0 = Date.UTC(2026, 10, 23, 20, 30);
const DURATA = SVELAMENTO.durata * 1000;
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

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

function prepara() {
  const storage = archivio();
  let ora = T0;
  const segnate = [];
  const chiuse = [];
  const g = new GestoreSvelamento({
    storage,
    adesso: () => new Date(ora),
    chiudiSessione: async (sessione, mids) => { chiuse.push({ sessione, mids }); return { ok: true }; },
    segna: async (x) => { segnate.push(x); return x.fine; },
  });
  return { g, storage, segnate, chiuse, vai: (ms) => { ora = T0 + ms; } };
}

const pub = (da, n = 1) => ({ da, sessione: `sessione${da}${n}xxxx`, mids: ["0", "1"], porta: PORTA });
async function ricevonoTutti(g) {
  await g.ricevuto({ da: "a", mids: ["2", "3"] });
  return g.ricevuto({ da: "b", mids: ["2", "3"] });
}
async function avvia(g) {
  await g.pubblica(pub("a"));
  await g.pubblica(pub("b"));
  return ricevonoTutti(g);
}

test("CADUTA_MS: «Riprova» per 2 minuti, come la spec (riprovaSecondi)", () => {
  assert.equal(CADUTA_MS, SVELAMENTO.riprovaSecondi * 1000);
  assert.equal(CADUTA_MS, 120_000);
});

test("caduta a 4 s: il timer si ferma, la vista torna «attesa» per tutti e due, a 10 s NON vale come finito", async () => {
  const { g, segnate, vai } = prepara();
  await avvia(g);
  vai(4000);
  const r = await g.caduta({ da: "a" });
  assert.equal(r.ok, true);
  assert.equal(r.vista.fase, "attesa");
  assert.equal(r.vista.inizio, undefined);
  vai(DURATA + 1);
  await g.allarme();
  const v = await g.vista("b");
  assert.equal(v.ok, true);
  assert.equal(v.vista.fase, "attesa");
  assert.deepEqual(segnate, []);
});

test("caduta: chiude subito le tracce che tutti e due ricevevano (niente video durante la pausa)", async () => {
  const { g, chiuse, vai } = prepara();
  await avvia(g);
  vai(4000);
  chiuse.length = 0;
  await g.caduta({ da: "b" });
  assert.deepEqual(
    chiuse.map((c) => c.sessione + ":" + c.mids.join(",")).sort(),
    ["sessionea1xxxx:2,3", "sessioneb1xxxx:2,3"],
  );
});

test("caduta a 4 s → «Riprova» → il timer riparte da 10 quando tutti e due ricevono di nuovo", async () => {
  const { g, segnate, vai } = prepara();
  await avvia(g);
  vai(4000);
  await g.caduta({ da: "a" });
  vai(30_000);
  const p = await g.pubblica(pub("a", 2));
  assert.equal(p.ok, true);
  const r = await ricevonoTutti(g);
  assert.equal(r.vista.fase, "in_corso");
  assert.equal(r.vista.inizio, T0 + 30_000);
  assert.equal(r.vista.fine, T0 + 30_000 + DURATA);
  vai(30_000 + DURATA);
  await g.allarme();
  assert.deepEqual(segnate.map((x) => x.fine), ["finito"]);
});

test("caduta senza «Riprova» entro 2 minuti: si torna al passo 4 («quando»), mai «Ecco <nome>.»", async () => {
  const { g, storage, segnate, vai } = prepara();
  await avvia(g);
  vai(4000);
  await g.caduta({ da: "a" });
  assert.equal(storage.allarme, T0 + 4000 + CADUTA_MS);
  vai(4000 + CADUTA_MS - 1);
  await g.allarme();
  assert.deepEqual(segnate, []);
  vai(4000 + CADUTA_MS);
  await g.allarme();
  assert.deepEqual(segnate.map((x) => x.fine), ["quando"]);
  const v = await g.vista("a");
  assert.deepEqual(v, { ok: false, motivo: "quando" });
});

test("caduta al terzo avvio: subito «quando» nel database e al telefono", async () => {
  const { g, segnate, vai } = prepara();
  let t = 0;
  for (let n = 1; n <= SVELAMENTO.tentativi; n++) {
    if (n > 1) await g.pubblica(pub("a", n));
    else { await g.pubblica(pub("a")); await g.pubblica(pub("b")); }
    await ricevonoTutti(g);
    t += 4000;
    vai(t);
    const r = await g.caduta({ da: "a" });
    if (n < SVELAMENTO.tentativi) assert.equal(r.ok, true, `caduta ${n}`);
    else assert.deepEqual(r, { ok: false, motivo: "quando" });
  }
  assert.deepEqual(segnate.map((x) => x.fine), ["quando"]);
});

test("caduta dopo i 10 secondi: lo svelamento vale («finito»)", async () => {
  const { g, segnate, vai } = prepara();
  await avvia(g);
  vai(DURATA + 500);
  const r = await g.caduta({ da: "a" });
  assert.deepEqual(r, { ok: false, motivo: "finito" });
  assert.deepEqual(segnate.map((x) => x.fine), ["finito"]);
});

test("caduta prima che partano i 10 secondi, ripetuta o da chi non è nella porta: non cambia niente", async () => {
  const { g, segnate, vai } = prepara();
  await g.pubblica(pub("a"));
  await g.pubblica(pub("b"));
  const prima = await g.caduta({ da: "a" });
  assert.equal(prima.ok, true);
  assert.equal(prima.vista.fase, "attesa");
  await ricevonoTutti(g);
  vai(4000);
  await g.caduta({ da: "a" });
  const due = await g.caduta({ da: "b" }); // la seconda caduta della stessa pausa non conta di nuovo
  assert.equal(due.ok, true);
  assert.deepEqual(await g.caduta({ da: "c" }), { ok: false, motivo: "non_tocca_a_te" });
  assert.deepEqual(await g.caduta({ da: "" }), { ok: false, motivo: "dati" });
  assert.deepEqual(segnate, []);
  const g2 = prepara().g;
  assert.deepEqual(await g2.caduta({ da: "a" }), { ok: false, motivo: "nessuna" });
});

// Worker: POST /app/api/svelamento { azione: "caduta", porta } dopo «iniziato_video», persona solo dal token.
const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const IO = "11111111-2222-4333-8444-555555555555";
function mondo(entra = "iniziato_video") {
  const viste = [];
  const chiamate = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    viste.push(u.pathname);
    if (u.origin === BASE && u.pathname === "/auth/v1/user") return Response.json({ id: IO });
    if (u.origin === BASE && u.pathname === "/rest/v1/rpc/entra_svelamento") return Response.json(entra);
    throw new Error("rete assente");
  };
  const oggetto = {
    caduta: async (x) => { chiamate.push(x); return { ok: true, vista: { fase: "attesa", ora: T0 } }; },
    segna: async () => ({ ok: true }),
  };
  const env = {
    ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta",
    SVELAMENTO: { idFromName: (n) => "id:" + n, get: () => oggetto },
  };
  return { env, f, viste, chiamate };
}
const chiedi = (m, corpo) => svelamentoApi(new Request("https://presenteincontri.app" + PERCORSO_SVELAMENTO, {
  method: "POST",
  headers: { authorization: "Bearer token-mio.prova.firma12345", "content-type": "application/json" },
  body: JSON.stringify({ porta: PORTA, ...corpo }),
}), m.env, m.f).then(async (x) => ({ stato: x.status, j: await x.json() }));

test("Worker «caduta»: solo dopo «iniziato_video», con la persona del token, ridà la vista", async () => {
  const m = mondo();
  const { stato, j } = await chiedi(m, { azione: "caduta", persona: "qualcun-altro" });
  assert.equal(stato, 200);
  assert.deepEqual(j, { ok: true, vista: { fase: "attesa", ora: T0 } });
  assert.deepEqual(m.chiamate, [{ da: IO }]);
  const prima = mondo("in_attesa");
  const r = await chiedi(prima, { azione: "caduta" });
  assert.deepEqual(r.j, { ok: false, motivo: "non_iniziato" });
  assert.deepEqual(prima.chiamate, []);
});
