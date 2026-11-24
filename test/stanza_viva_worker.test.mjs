// Richiesta del Worker /app/api/stanza/presenza (issue #380, spec v1 del CPO del 23/11, schermata 19), passo 4a della
// linea CTO: il segnale dell'app aperta (POST, ogni 30 s) e lo stato delle persone della stanza (GET).
// Chi è lo dice SOLO il token; chi si vede lo decide il database (segnala_presenza, stati_stanza, migrazione
// 20261123123000). Al telefono mai l'ora esatta dell'ultimo segnale, mai la pausa. Spento finché ACCESSO_APP non vale
// «si». Supabase finto, nessuna rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stanzaVivaApi, PERCORSO_STANZA_VIVA } from "../worker/stanza_viva_api.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const B = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const C = "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const fa = (secondi) => new Date(Date.now() - secondi * 1000).toISOString();

function supabaseFinto({ utente = 200, righe = [], segnale = true, rpcStato = 200 } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    const corpo = typeof opzioni.body === "string" ? JSON.parse(opzioni.body) : opzioni.body;
    viste.push({ percorso: u.pathname, metodo: opzioni.method || "GET", headers: opzioni.headers || {}, corpo });
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID }) : new Response("{}", { status: utente });
    if (rpcStato !== 200) return new Response("{}", { status: rpcStato });
    if (u.pathname === "/rest/v1/rpc/stati_stanza") return Response.json(righe);
    if (u.pathname === "/rest/v1/rpc/segnala_presenza") return Response.json(segnale);
    return new Response("{}", { status: 404 });
  };
  return { f, viste, dove: (p) => viste.filter((v) => v.percorso.startsWith(p)) };
}

const richiesta = ({ metodo = "GET", token = TOKEN, query = "", corpo } = {}) =>
  new Request(`${SITO}${PERCORSO_STANZA_VIVA}${query}`, {
    method: metodo,
    headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : {},
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

test("percorso: /app/api/stanza/presenza", () => assert.equal(PERCORSO_STANZA_VIVA, "/app/api/stanza/presenza"));

test("spento finché ACCESSO_APP non vale «si»: 404 e nessuna chiamata a Supabase", async () => {
  for (const valore of [undefined, "", "no", "tester", "SI"]) {
    for (const metodo of ["GET", "POST"]) {
      const s = supabaseFinto();
      const r = await stanzaVivaApi(richiesta({ metodo }), { ...ENV, ACCESSO_APP: valore }, s.f);
      assert.equal(r.status, 404, `${valore} ${metodo}`);
      assert.equal(s.viste.length, 0);
    }
  }
});

test("solo GET e POST: 405 con allow", async () => {
  for (const metodo of ["PUT", "DELETE", "PATCH"]) {
    const r = await stanzaVivaApi(richiesta({ metodo }), ENV, supabaseFinto().f);
    assert.equal(r.status, 405, metodo);
    assert.equal(r.headers.get("allow"), "GET, POST");
  }
});

test("senza token o con token rifiutato: 401, il database non si interroga", async () => {
  for (const metodo of ["GET", "POST"]) {
    const s = supabaseFinto();
    assert.equal((await stanzaVivaApi(richiesta({ metodo, token: null }), ENV, s.f)).status, 401);
    const s2 = supabaseFinto({ utente: 401 });
    assert.equal((await stanzaVivaApi(richiesta({ metodo }), ENV, s2.f)).status, 401);
    assert.equal(s.dove("/rest/").length + s2.dove("/rest/").length, 0);
  }
});

test("POST = segnale: chi lo dice il token, non il corpo; risponde se si è in una stanza aperta", async () => {
  const s = supabaseFinto();
  const r = await stanzaVivaApi(richiesta({ metodo: "POST", corpo: { persona: B } }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, inStanza: true });
  const [rpc] = s.dove("/rest/v1/rpc/segnala_presenza");
  assert.equal(rpc.metodo, "POST");
  assert.equal(rpc.headers.apikey, "chiave-server-finta");
  assert.deepEqual(rpc.corpo, { p_persona: ID });
  const r2 = await stanzaVivaApi(richiesta({ metodo: "POST" }), ENV, supabaseFinto({ segnale: false }).f);
  assert.deepEqual(await r2.json(), { ok: true, inStanza: false });
});

test("GET = stati: online entro 60 s, non in linea dopo, in chiamata; mai l'ora esatta", async () => {
  const righe = [
    { utente_id: A, ultimo_segnale: fa(30), in_chiamata: false, in_chiamata_con: null },
    { utente_id: B, ultimo_segnale: fa(61), in_chiamata: false, in_chiamata_con: null },
    { utente_id: C, ultimo_segnale: fa(5), in_chiamata: true, in_chiamata_con: A },
  ];
  const s = supabaseFinto({ righe });
  const r = await stanzaVivaApi(richiesta({ query: `?persona=${B}` }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const corpo = await r.json();
  assert.deepEqual(corpo, {
    ok: true,
    persone: [
      { id: A, stato: "online", testo: "online", con: null },
      { id: B, stato: "non_in_linea", testo: "non in linea · da poco", con: null },
      { id: C, stato: "in_chiamata", testo: "in chiamata", con: A },
    ],
  });
  assert.ok(!JSON.stringify(corpo).includes("ultimo_segnale"));
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(JSON.stringify(corpo)), "nessuna data al telefono");
  const [rpc] = s.dove("/rest/v1/rpc/stati_stanza");
  assert.deepEqual(rpc.corpo, { p_persona: ID }, "la persona scritta nella richiesta non conta");
  assert.equal(s.dove("/rest/v1/rpc/segnala_presenza").length, 0, "leggere non vale come segnale");
});

test("mai visto o da ore: testi senza ora esatta", async () => {
  const righe = [
    { utente_id: A, ultimo_segnale: null, in_chiamata: false, in_chiamata_con: null },
    { utente_id: B, ultimo_segnale: fa(3 * 3600 + 10), in_chiamata: false, in_chiamata_con: null },
  ];
  const r = await stanzaVivaApi(richiesta(), ENV, supabaseFinto({ righe }).f);
  const { persone } = await r.json();
  assert.equal(persone[0].testo, "non in linea");
  assert.equal(persone[1].testo, "non in linea · da 3 h");
});

test("in chiamata con qualcuno che non si può vedere: il database manda null e resta «in chiamata»", async () => {
  const righe = [{ utente_id: A, ultimo_segnale: fa(5), in_chiamata: true, in_chiamata_con: null }];
  const { persone } = await (await stanzaVivaApi(richiesta(), ENV, supabaseFinto({ righe }).f)).json();
  assert.deepEqual(persone, [{ id: A, stato: "in_chiamata", testo: "in chiamata", con: null }]);
});

test("fuori da una stanza aperta: elenco vuoto", async () => {
  const r = await stanzaVivaApi(richiesta(), ENV, supabaseFinto({ righe: [] }).f);
  assert.deepEqual(await r.json(), { ok: true, persone: [] });
});

test("risposta strana o database giù: 503 riprova, mai stati inventati", async () => {
  const strane = [
    {},
    [{ utente_id: "x", ultimo_segnale: null, in_chiamata: false, in_chiamata_con: null }],
    [{ utente_id: A, ultimo_segnale: "ieri", in_chiamata: false, in_chiamata_con: null }],
    [{ utente_id: A, ultimo_segnale: null, in_chiamata: "no", in_chiamata_con: null }],
    [{ utente_id: A, ultimo_segnale: null, in_chiamata: true, in_chiamata_con: "x" }],
  ];
  for (const righe of strane) {
    const r = await stanzaVivaApi(richiesta(), ENV, supabaseFinto({ righe }).f);
    assert.equal(r.status, 503, JSON.stringify(righe));
  }
  const r = await stanzaVivaApi(richiesta({ metodo: "POST" }), ENV, supabaseFinto({ segnale: "si" }).f);
  assert.equal(r.status, 503);
  for (const metodo of ["GET", "POST"]) {
    const r2 = await stanzaVivaApi(richiesta({ metodo }), ENV, supabaseFinto({ rpcStato: 500 }).f);
    assert.equal(r2.status, 503);
    assert.deepEqual(await r2.json(), { ok: false, motivo: "riprova" });
  }
});

test("troppe richieste: 429", async () => {
  const env = { ...ENV, LIMITE_PROVINCIA: { limit: async () => ({ success: false }) } };
  assert.equal((await stanzaVivaApi(richiesta(), env, supabaseFinto().f)).status, 429);
});

test("il Worker instrada /app/api/stanza/presenza (spento senza ACCESSO_APP)", async () => {
  const r = await worker.fetch(richiesta(), { ASSETS: { fetch: async () => new Response("asset") } }, { waitUntil() {} });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { ok: false, motivo: "spento" });
});
