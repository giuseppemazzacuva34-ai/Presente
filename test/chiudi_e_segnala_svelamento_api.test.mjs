// Svelamento, passo 7d-3a (issue #65, spec v1 del CPO, «Casi limite»; D32 A; linea «sviluppatore»): «Chiudi e segnala»
// durante il video, lato server. POST /app/api/svelamento { azione: "chiudi_e_segnala", porta }: prima il database
// (chiudi_e_segnala_svelamento: porta chiusa, blocco, caparre restituite a entrambi), poi il Durable Object della porta
// chiude SUBITO le tracce di tutti e due. La persona è solo quella del token. Rete finta, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { svelamentoApi, PERCORSO_SVELAMENTO } from "../worker/svelamento_api.js";
import { GestoreSvelamento } from "../api/svelamento_do.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const IO = "11111111-2222-4333-8444-555555555555";
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SITO = "https://presenteincontri.app";

function archivio() {
  const dati = new Map();
  return {
    async get(k) { return dati.has(k) ? structuredClone(dati.get(k)) : undefined; },
    async put(k, v) {
      if (typeof k === "object") for (const [a, b] of Object.entries(k)) dati.set(a, structuredClone(b));
      else dati.set(k, structuredClone(v));
    },
    async deleteAll() { dati.clear(); },
    async setAlarm() {},
    async deleteAlarm() {},
  };
}

function mondo({ esito = "chiusa", conDo = true } = {}) {
  const viste = [];
  const chiuse = [];
  const gestori = new Map();
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    const corpo = opzioni.body ? JSON.parse(opzioni.body) : null;
    viste.push({ percorso: u.pathname, corpo });
    if (u.origin === BASE && u.pathname === "/auth/v1/user") return Response.json({ id: IO });
    if (u.origin === BASE && u.pathname === "/rest/v1/rpc/chiudi_e_segnala_svelamento") return Response.json(esito);
    throw new Error("rete assente");
  };
  const SVELAMENTO = {
    idFromName: (nome) => "id:" + nome,
    get: (id) => {
      if (!gestori.has(id)) {
        gestori.set(id, new GestoreSvelamento({
          storage: archivio(),
          chiudiSessione: async (sessione, mids) => { chiuse.push({ sessione, mids }); return { ok: true }; },
        }));
      }
      return gestori.get(id);
    },
  };
  const env = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta", ...(conDo ? { SVELAMENTO } : {}) };
  return { env, f, viste, chiuse, gestori, SVELAMENTO, rpc: () => viste.filter((v) => v.percorso.startsWith("/rest/v1/rpc/")) };
}

async function chiedi(m, corpo = {}) {
  const r = new Request(SITO + PERCORSO_SVELAMENTO, {
    method: "POST",
    headers: { authorization: "Bearer token-mio.prova.firma12345", "content-type": "application/json" },
    body: JSON.stringify({ porta: PORTA, azione: "chiudi_e_segnala", ...corpo }),
  });
  const x = await svelamentoApi(r, m.env, m.f);
  return { stato: x.status, j: await x.json() };
}

test("chiudi_e_segnala: il database chiude per la persona del token, poi il Durable Object chiude le tracce", async () => {
  const m = mondo();
  const g = m.SVELAMENTO.get(m.SVELAMENTO.idFromName(PORTA));
  await g.pubblica({ da: IO, sessione: "sessioneMia123", mids: ["0", "1"] });
  const { stato, j } = await chiedi(m, { persona: "66666666-7777-4888-9999-000000000000" });
  assert.equal(stato, 200);
  assert.deepEqual(j, { ok: true, esito: "chiusa" });
  assert.deepEqual(m.rpc().map((v) => v.percorso), ["/rest/v1/rpc/chiudi_e_segnala_svelamento"]);
  assert.deepEqual(m.rpc()[0].corpo, { p_porta: PORTA, p_persona: IO }); // mai una persona scritta nel corpo
  assert.deepEqual(m.chiuse.map((c) => c.sessione), ["sessioneMia123"]);
  assert.equal((await g.vista(IO)).vista.fase, "interrotto");
});

test("chiudi_e_segnala: senza il sì del database il Durable Object non si tocca", async () => {
  const casi = [
    ["non_iniziato", 200, "non_iniziato"], ["finito", 200, "finito"], ["porta_chiusa", 200, "porta_chiusa"],
    ["non_nella_porta", 404, "non_trovata"], [null, 503, "riprova"], ["strano", 503, "riprova"],
  ];
  for (const [esito, codice, motivo] of casi) {
    const m = mondo({ esito });
    const { stato, j } = await chiedi(m);
    assert.equal(stato, codice, String(esito));
    assert.equal(j.ok, false);
    assert.equal(j.motivo, motivo, String(esito));
    assert.equal(m.gestori.size, 0, String(esito));
  }
});

test("chiudi_e_segnala: porta chiusa per altro → solo «Questa porta si è chiusa.», mai il motivo", async () => {
  const { j } = await chiedi(mondo({ esito: "porta_chiusa" }));
  assert.equal(typeof j.testo, "string");
  assert.equal(/segnal|blocc/i.test(j.testo), false);
});

test("chiudi_e_segnala: Durable Object assente o in errore → la porta resta chiusa, risposta ok", async () => {
  const m = mondo({ conDo: false });
  assert.deepEqual((await chiedi(m)).j, { ok: true, esito: "chiusa" });
  const m2 = mondo();
  m2.env.SVELAMENTO = { idFromName: (x) => x, get: () => ({ chiudi: async () => { throw new Error("giù"); } }) };
  const r = await chiedi(m2);
  assert.equal(r.stato, 200);
  assert.deepEqual(r.j, { ok: true, esito: "chiusa" });
});
