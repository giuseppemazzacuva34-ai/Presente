// Chiamate solo voce (issue #4, spec v1.3 § 2, passo 3c-5b-2a): il testo sul pulsante «Chiama» di ogni persona della
// stanza PRIMA del tocco. Il server calcola con le stesse regole di api/chiamate.js e dà al telefono solo
// { id, testo } per chi ha il pulsante spento con uno dei 6 testi; tutti gli altri restano «Chiama».
// Sospesi e blocchi non danno mai un testo: l'altra persona non deve scoprirlo (#7 spec v1.1).
// Tutto finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pulsantiStanza } from "../api/pulsanti.js";
import { datiPerPulsanti } from "../api/dati_chiamata.js";
import { chiamataApi, PERCORSO_CHIAMATA } from "../worker/chiamata_api.js";
import { oraDiRoma } from "../api/stanze.js";
import { TESTI_PULSANTE } from "../api/chiamate.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const E = "55555555-5555-4555-8555-555555555555";
const S = "99999999-9999-4999-8999-999999999999";
const APRE = oraDiRoma(2026, 11, 9, 9);
const CHIUDE = oraDiRoma(2026, 11, 15, 21);
const ADESSO = oraDiRoma(2026, 11, 10, 20);

function finti({ dati = {}, linee = {}, stanza = { id: S, apre: APRE, chiude: CHIUDE } } = {}) {
  const chieste = [];
  return {
    chieste,
    stanzaDi: async () => stanza,
    datiPerPulsanti: async (q) => {
      chieste.push(q);
      return { ok: true, membri: [A, B, C, D, E], chiamate: [], blocchi: [], profili: new Map(), permessi: new Set(),
        sospesi: new Set(), ...dati };
    },
    centralino: (id) => { assert.equal(id, S); return { linea: async (per) => linee[per] || null }; },
  };
}

const tre = (x, y) => [1, 2, 3].map((g) => ({ chi: x, con: y, inizio: oraDiRoma(2026, 11, 9, 10 + g).toISOString(), durata: 120 }));

test("nessun impedimento: lista vuota, tutti restano «Chiama»", async () => {
  const d = finti();
  assert.deepEqual(await pulsantiStanza({ per: A, adesso: ADESSO }, d), { ok: true, pulsanti: [] });
  assert.deepEqual(d.chieste[0].chi, A);
});

test("i testi della spec, uno per persona, mai per sé", async () => {
  const d = finti({
    linee: { [C]: { chiamata: "x" } },
    dati: {
      chiamate: tre(A, B),
      profili: new Map([[D, { fascia: { da: "21:00", a: "23:00" }, pausa: null, soloConPermesso: false }],
        [E, { fascia: null, pausa: null, soloConPermesso: true }]]),
    },
  });
  const r = await pulsantiStanza({ per: A, adesso: ADESSO }, d);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pulsanti, [
    { id: B, testo: TESTI_PULSANTE.tre_con_lei },
    { id: C, testo: TESTI_PULSANTE.occupato },
    { id: D, testo: "Disponibile da 21:00" },
    { id: E, testo: TESTI_PULSANTE.serve_permesso },
  ]);
  assert.ok(!r.pulsanti.some((p) => p.id === A));
});

test("permesso dato: niente «Chiedi di parlare»", async () => {
  const d = finti({ dati: { profili: new Map([[E, { fascia: null, pausa: null, soloConPermesso: true }]]), permessi: new Set([E]) } });
  assert.deepEqual((await pulsantiStanza({ per: A, adesso: ADESSO }, d)).pulsanti, []);
});

test("5 chiamate mie oggi: il testo vale per tutti", async () => {
  const oggi = [0, 1, 2, 3, 4].map((i) => ({ chi: A, con: [B, C, D, E, B][i], inizio: oraDiRoma(2026, 11, 10, 10 + i).toISOString(), durata: 100 }));
  const r = await pulsantiStanza({ per: A, adesso: ADESSO }, finti({ dati: { chiamate: oggi } }));
  // B ha già 2 chiamate con A, ma «5 mie» viene prima di tutto tranne «3 volte».
  assert.deepEqual(r.pulsanti.map((p) => p.testo), Array(4).fill(TESTI_PULSANTE.cinque_oggi));
});

test("sospesi e bloccati: nessun testo (non si scopre), si vede «Chiama» e decide il tocco", async () => {
  const d = finti({ dati: { sospesi: new Set([B]), blocchi: [{ chi: C, bloccato: A }], chiamate: tre(A, B) } });
  assert.deepEqual((await pulsantiStanza({ per: A, adesso: ADESSO }, d)).pulsanti, []);
});

test("io sospeso o fuori dalla stanza: lista vuota", async () => {
  assert.deepEqual((await pulsantiStanza({ per: A, adesso: ADESSO }, finti({ dati: { sospesi: new Set([A]), chiamate: tre(A, B) } }))).pulsanti, []);
  assert.deepEqual(await pulsantiStanza({ per: A, adesso: ADESSO }, finti({ stanza: null })), { ok: true, pulsanti: [] });
});

test("database che non risponde o id sbagliato", async () => {
  const d = finti();
  d.datiPerPulsanti = async () => ({ ok: false, motivo: "riprova" });
  assert.deepEqual(await pulsantiStanza({ per: A, adesso: ADESSO }, d), { ok: false, motivo: "riprova" });
  assert.deepEqual(await pulsantiStanza({ per: "x", adesso: ADESSO }, finti()), { ok: false, motivo: "dati" });
});

// --- Letture dal database --------------------------------------------------------------------------------------------
const ENV = { SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "chiave-server" };
const STANZA = { id: S, apre: APRE, chiude: CHIUDE };

function finto(risposte) {
  const chieste = [];
  const f = async (url, init) => {
    const u = decodeURIComponent(url);
    chieste.push({ url: u, init });
    for (const [pezzo, r] of risposte) if (u.includes(pezzo)) return r instanceof Error ? Promise.reject(r) : new Response(JSON.stringify(r), { status: 200 });
    return new Response("[]", { status: 200 });
  };
  return { f, chieste };
}

test("datiPerPulsanti: membri, chiamate di tutti, blocchi miei, profili, permessi verso di me, sospesi", async () => {
  const { f, chieste } = finto([
    ["membri_stanza", [{ utente_id: A }, { utente_id: B }, { utente_id: "rotto" }]],
    ["/chiamate?", [{ chi: A, con: B, inizio: "2026-11-09T10:00:00+00:00", durata: 120, extra: 1 }]],
    ["blocchi", [{ chi: B, bloccato: A }]],
    ["profili", [{ id: B, fascia_da: "19:00", fascia_a: "24:00", pausa_il: "2026-11-10", solo_con_permesso: true }, { id: A, fascia_da: "x" }]],
    ["permessi_chiamata", [{ utente_id: B }]],
    ["sospensioni", [{ persona: B }]],
  ]);
  const r = await datiPerPulsanti(ENV, { stanza: STANZA, chi: A }, f);
  assert.equal(r.ok, true);
  assert.deepEqual(r.membri, [A, B]);
  assert.deepEqual(r.chiamate, [{ chi: A, con: B, inizio: "2026-11-09T10:00:00+00:00", durata: 120 }]);
  assert.deepEqual(r.blocchi, [{ chi: B, bloccato: A }]);
  assert.deepEqual(r.profili.get(B), { fascia: { da: "19:00", a: "24:00" }, pausa: "2026-11-10", soloConPermesso: true });
  assert.deepEqual(r.profili.get(A), { fascia: null, pausa: null, soloConPermesso: false });
  assert.deepEqual([...r.permessi], [B]);
  assert.deepEqual([...r.sospesi], [B]);
  const testo = chieste.map((c) => c.url).join("\n");
  assert.ok(testo.includes(`membri_stanza?stanza_id=eq.${S}&select=utente_id`));
  assert.ok(testo.includes(`or=(chi.in.(${A},${B}),con.in.(${A},${B}))`));
  assert.ok(testo.includes(`profili?id=in.(${A},${B})&select=id,fascia_da,fascia_a,pausa_il,solo_con_permesso`));
  assert.ok(testo.includes(`permessi_chiamata?permesso_a=eq.${A}&select=utente_id`));
  assert.ok(!/nome|foto|questionario|diario/.test(testo));
  for (const c of chieste) assert.equal(c.init.headers.apikey, "chiave-server");
  assert.ok(chieste.length <= 6);
});

test("datiPerPulsanti: una lettura che non va → riprova; id sbagliati → nessuna lettura", async () => {
  const { f } = finto([["membri_stanza", [{ utente_id: A }]], ["sospensioni", new Error("rete")]]);
  assert.deepEqual(await datiPerPulsanti(ENV, { stanza: STANZA, chi: A }, f), { ok: false, motivo: "riprova" });
  const vuoto = finto([]);
  assert.deepEqual(await datiPerPulsanti(ENV, { stanza: STANZA, chi: "' or 1=1" }, vuoto.f), { ok: false, motivo: "riprova" });
  assert.deepEqual(await datiPerPulsanti({}, { stanza: STANZA, chi: A }, vuoto.f), { ok: false, motivo: "riprova" });
  assert.equal(vuoto.chieste.length, 0);
});

// --- Richiesta del Worker GET /app/api/chiamata/pulsanti -----------------------------------------------------------
const ID = "11111111-2222-4333-8444-555555555555";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const ENV_W = { ACCESSO_APP: "si", SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const auth = async (url) => (new URL(url).pathname === "/auth/v1/user" ? Response.json({ id: ID }) : new Response("{}", { status: 404 }));
const get = (percorso, metodo = "GET") => new Request("https://presenteincontri.app" + percorso, { method: metodo, headers: { authorization: `Bearer ${TOKEN}` } });

test("GET /pulsanti: chi lo dice il token; passano solo id validi e solo i 6 testi della spec", async () => {
  const ricevute = [];
  const op = { pulsantiStanza: async (q) => { ricevute.push(q); return { ok: true, pulsanti: [
    { id: B, testo: TESTI_PULSANTE.occupato }, { id: C, testo: "Disponibile domani dalle 9:00" },
    { id: D, testo: "Sospesa per una segnalazione" }, { id: "rotto", testo: TESTI_PULSANTE.occupato }, { id: E, testo: TESTI_PULSANTE.tre_con_lei, motivo: "tre_con_lei" },
  ] }; } };
  const r = await chiamataApi(get(PERCORSO_CHIAMATA + "/pulsanti"), ENV_W, auth, op);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, pulsanti: [
    { id: B, testo: TESTI_PULSANTE.occupato }, { id: C, testo: "Disponibile domani dalle 9:00" }, { id: E, testo: TESTI_PULSANTE.tre_con_lei },
  ] });
  assert.equal(ricevute[0].per, ID);
});

test("GET /pulsanti: POST non va, database giù → 503 riprova, spento senza ACCESSO_APP", async () => {
  const op = { pulsantiStanza: async () => ({ ok: false, motivo: "riprova" }) };
  assert.equal((await chiamataApi(get(PERCORSO_CHIAMATA + "/pulsanti", "POST"), ENV_W, auth, op)).status, 405);
  const giu = await chiamataApi(get(PERCORSO_CHIAMATA + "/pulsanti"), ENV_W, auth, op);
  assert.equal(giu.status, 503);
  assert.deepEqual(await giu.json(), { ok: false, motivo: "riprova" });
  assert.equal((await chiamataApi(get(PERCORSO_CHIAMATA + "/pulsanti"), { ...ENV_W, ACCESSO_APP: "no" }, auth, op)).status, 404);
  const rotto = { pulsantiStanza: async () => { throw new Error("x"); } };
  assert.equal((await chiamataApi(get(PERCORSO_CHIAMATA + "/pulsanti"), ENV_W, auth, rotto)).status, 503);
});
