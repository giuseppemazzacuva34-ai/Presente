// Richiesta del Worker /app/api/stanza/appuntamenti (issue #380 «Fissa una chiamata», spec v1 del CPO del 23/11,
// schermata 20), passo 4b della linea CTO. GET = i miei appuntamenti nella stanza aperta; POST = proponi, conferma,
// no, un altro orario, annulla. Chi è lo dice SOLO il token. Il Worker controlla ciò che il database non sa:
// messaggio senza numeri/link/social (controllaMessaggio) e orari dentro le fasce di tutte e due (oreProponibili).
// Limiti, blocchi, sospesi e 3 chiamate li decide il database (migrazione 20261123190000). Spento finché ACCESSO_APP
// non vale «si». Supabase finto, orologio finto, nessuna rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appuntamentiApi, PERCORSO_APPUNTAMENTI } from "../worker/appuntamenti_api.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const B = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const APP = "aaaaaaaa-0000-4ccc-8ddd-eeeeeeeeeeee";
const STANZA = "55555555-0000-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
// Martedì 24/11/2026 alle 11:00 di Roma; stanza da lunedì 9:00 a domenica 21:00 di Roma.
const ADESSO = new Date("2026-11-24T10:00:00Z");
const orologio = () => ADESSO;
const BUONO = "2026-11-24T17:00:00.000Z"; // 18:00 di Roma, dentro 9–23

function supabaseFinto({ utente = 200, stanza = true, fasce = [], miei = [], esito = "ok", rpcStato = 200 } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    const corpo = typeof opzioni.body === "string" ? JSON.parse(opzioni.body) : opzioni.body;
    viste.push({ percorso: u.pathname, query: u.search, metodo: opzioni.method || "GET", headers: opzioni.headers || {}, corpo });
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID }) : new Response("{}", { status: utente });
    if (rpcStato !== 200) return new Response("{}", { status: rpcStato });
    if (u.pathname === "/rest/v1/membri_stanza") {
      return Response.json(stanza ? [{ stanze: { id: STANZA, apre_il: "2026-11-23T08:00:00Z", chiude_il: "2026-11-29T20:00:00Z" } }] : []);
    }
    if (u.pathname === "/rest/v1/profili") return Response.json(fasce);
    if (u.pathname === "/rest/v1/rpc/appuntamenti_di") return Response.json(miei);
    if (/\/rest\/v1\/rpc\/(proponi|rispondi|annulla)_appuntamento$/.test(u.pathname)) return Response.json(esito);
    return new Response("{}", { status: 404 });
  };
  return { f, viste, dove: (p) => viste.filter((v) => v.percorso.startsWith(p)) };
}

const richiesta = ({ metodo = "GET", token = TOKEN, corpo } = {}) =>
  new Request(`${SITO}${PERCORSO_APPUNTAMENTI}`, {
    method: metodo,
    headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : {},
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
const chiama = (s, opz) => appuntamentiApi(richiesta(opz), ENV, s.f, orologio);
const proponi = (extra = {}) => ({ metodo: "POST", corpo: { azione: "proponi", con: B, quando: BUONO, ...extra } });

const riga = (extra = {}) => ({
  id: APP, altra: B, proposto_da_me: false, stato: "proposto", quando: BUONO, messaggio: "Ti va di sentirci stasera?",
  controproposte: 0, annullato_dall_altra: false, ...extra,
});

test("percorso: /app/api/stanza/appuntamenti", () => assert.equal(PERCORSO_APPUNTAMENTI, "/app/api/stanza/appuntamenti"));

test("spento finché ACCESSO_APP non vale «si»: 404 e nessuna chiamata a Supabase", async () => {
  for (const valore of [undefined, "", "no", "tester", "SI"]) {
    for (const metodo of ["GET", "POST"]) {
      const s = supabaseFinto();
      const r = await appuntamentiApi(richiesta({ metodo, corpo: metodo === "POST" ? {} : undefined }),
        { ...ENV, ACCESSO_APP: valore }, s.f, orologio);
      assert.equal(r.status, 404, `${valore} ${metodo}`);
      assert.equal(s.viste.length, 0);
    }
  }
});

test("solo GET e POST: 405 con allow", async () => {
  for (const metodo of ["PUT", "DELETE", "PATCH"]) {
    const r = await chiama(supabaseFinto(), { metodo });
    assert.equal(r.status, 405, metodo);
    assert.equal(r.headers.get("allow"), "GET, POST");
  }
});

test("senza token o con token rifiutato: 401, il database non si interroga", async () => {
  const s = supabaseFinto();
  assert.equal((await chiama(s, { token: null })).status, 401);
  const s2 = supabaseFinto({ utente: 401 });
  assert.equal((await chiama(s2, proponi())).status, 401);
  assert.equal(s.dove("/rest/").length + s2.dove("/rest/").length, 0);
});

test("GET: i miei appuntamenti con la fase di adesso; chi sono lo dice il token", async () => {
  const miei = [
    riga(),
    riga({ id: "bbbbbbbb-0000-4ccc-8ddd-eeeeeeeeeeee", proposto_da_me: true, stato: "confermato",
      quando: "2026-11-24T10:05:00Z", controproposte: 2 }),
    riga({ id: "cccccccc-0000-4ccc-8ddd-eeeeeeeeeeee", proposto_da_me: true, stato: "scaduto", messaggio: null }),
  ];
  const s = supabaseFinto({ miei });
  const r = await chiama(s);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const { ok, appuntamenti } = await r.json();
  assert.equal(ok, true);
  assert.deepEqual(appuntamenti[0], {
    id: APP, altra: B, propostoDaMe: false, stato: "proposto", quando: BUONO, messaggio: "Ti va di sentirci stasera?",
    fase: "in_attesa", puoControproporre: true, annullatoDallAltra: false,
  });
  assert.equal(appuntamenti[1].fase, "promemoria", "5 minuti prima: promemoria");
  assert.equal(appuntamenti[1].puoControproporre, false, "2 controproposte già fatte");
  assert.equal(appuntamenti[2].fase, "scaduto");
  assert.equal(appuntamenti[2].testo, "Nessuna risposta: la proposta è scaduta.");
  const [rpc] = s.dove("/rest/v1/rpc/appuntamenti_di");
  assert.deepEqual(rpc.corpo, { p_persona: ID });
});

test("GET: riga strana o database giù → 503 riprova, mai appuntamenti inventati", async () => {
  for (const miei of [{}, [riga({ id: "x" })], [riga({ stato: "boh" })], [riga({ quando: "ieri" })]]) {
    assert.equal((await chiama(supabaseFinto({ miei }))).status, 503, JSON.stringify(miei));
  }
  assert.equal((await chiama(supabaseFinto({ rpcStato: 500 }))).status, 503);
});

test("proponi: orario buono → proponi_appuntamento con il token come chi propone e il messaggio ripulito", async () => {
  const s = supabaseFinto();
  const r = await chiama(s, proponi({ chi: B, messaggio: "  Ti va   di sentirci stasera? " }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const [rpc] = s.dove("/rest/v1/rpc/proponi_appuntamento");
  assert.deepEqual(rpc.corpo, { p_chi: ID, p_con: B, p_quando: BUONO, p_messaggio: "Ti va di sentirci stasera?" });
  const [profili] = s.dove("/rest/v1/profili");
  assert.ok(profili.query.includes(ID) && profili.query.includes(B), "fasce di tutte e due");
});

test("proponi: messaggio con numero, link o social → rifiutato dal Worker con il testo della spec", async () => {
  for (const messaggio of ["chiamami al 333 1234567", "scrivimi a nome@esempio.it", "www.esempio.it", "sono @mario.rossi su instagram"]) {
    const s = supabaseFinto();
    const corpo = await (await chiama(s, proponi({ messaggio }))).json();
    assert.deepEqual(corpo, { ok: false, motivo: "contatti", testo: "Niente numeri, link o social prima della porta." }, messaggio);
    assert.equal(s.dove("/rest/v1/rpc/proponi_appuntamento").length, 0);
  }
  const corpo = await (await chiama(supabaseFinto(), proponi({ messaggio: "a".repeat(121) }))).json();
  assert.equal(corpo.motivo, "troppo_lungo");
});

test("proponi: fuori dalla fascia dell'altra persona, troppo presto o fuori passo → «orario», il database non scrive", async () => {
  const fasce = [{ id: B, fascia_da: "09:00", fascia_a: "18:00" }];
  for (const quando of [BUONO, "2026-11-24T10:00:00Z", "2026-11-24T16:15:00Z", "2026-11-29T19:30:00Z", "domani"]) {
    const s = supabaseFinto({ fasce });
    const corpo = await (await chiama(s, proponi({ quando }))).json();
    assert.equal(corpo.ok, false, quando);
    assert.equal(corpo.motivo, "orario", quando);
    assert.equal(s.dove("/rest/v1/rpc/proponi_appuntamento").length, 0);
  }
  const ok = await (await chiama(supabaseFinto({ fasce }), proponi({ quando: "2026-11-24T16:30:00Z" }))).json();
  assert.equal(ok.ok, true, "17:30 di Roma è dentro 9–18");
});

test("proponi: la pausa non conta e non si scopre (si leggono solo le fasce)", async () => {
  const s = supabaseFinto({ fasce: [{ id: B, fascia_da: "09:00", fascia_a: "23:00", pausa_il: "2026-11-24" }] });
  assert.deepEqual(await (await chiama(s, proponi())).json(), { ok: true });
  const [profili] = s.dove("/rest/v1/profili");
  assert.ok(!profili.query.includes("pausa"), "la pausa non si legge");
});

test("proponi: fuori da una stanza aperta → non_disponibile, il database non scrive", async () => {
  const s = supabaseFinto({ stanza: false });
  const corpo = await (await chiama(s, proponi())).json();
  assert.deepEqual(corpo, { ok: false, motivo: "non_disponibile", testo: "Ora non si può fissare una chiamata con questa persona." });
  assert.equal(s.dove("/rest/v1/rpc/proponi_appuntamento").length, 0);
});

test("proponi: i rifiuti del database arrivano con i testi della spec, mai il motivo dell'altra persona", async () => {
  const attesi = {
    tre_aperti: "Hai già 3 appuntamenti aperti.",
    non_disponibile: "Ora non si può fissare una chiamata con questa persona.",
    gia_con_lei: null,
    orario: null,
  };
  for (const [esito, testo] of Object.entries(attesi)) {
    const corpo = await (await chiama(supabaseFinto({ esito }), proponi())).json();
    assert.deepEqual(corpo, { ok: false, motivo: esito, testo }, esito);
  }
  assert.equal((await chiama(supabaseFinto({ esito: "boh" }), proponi())).status, 503, "esito sconosciuto: riprova");
});

test("richiesta malformata → 400 senza toccare il database", async () => {
  for (const corpo of [{}, { azione: "boh" }, { azione: "proponi", con: "x", quando: BUONO }, { azione: "proponi", con: ID, quando: BUONO },
    { azione: "conferma" }, { azione: "annulla", id: "x" }, { azione: "altro", id: APP }]) {
    const s = supabaseFinto();
    const r = await chiama(s, { metodo: "POST", corpo });
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.equal(s.dove("/rest/").length, 0);
  }
});

test("conferma, no, annulla: solo la funzione del database con la persona del token", async () => {
  for (const [azione, funzione, atteso] of [
    ["conferma", "rispondi_appuntamento", { p_persona: ID, p_id: APP, p_azione: "conferma", p_quando: null, p_messaggio: null }],
    ["no", "rispondi_appuntamento", { p_persona: ID, p_id: APP, p_azione: "no", p_quando: null, p_messaggio: null }],
    ["annulla", "annulla_appuntamento", { p_persona: ID, p_id: APP }],
  ]) {
    const s = supabaseFinto();
    const r = await chiama(s, { metodo: "POST", corpo: { azione, id: APP, persona: B } });
    assert.deepEqual(await r.json(), { ok: true }, azione);
    const [rpc] = s.dove(`/rest/v1/rpc/${funzione}`);
    assert.deepEqual(rpc.corpo, atteso, azione);
  }
  const corpo = await (await chiama(supabaseFinto({ esito: "non_trovato" }), { metodo: "POST", corpo: { azione: "annulla", id: APP } })).json();
  assert.deepEqual(corpo, { ok: false, motivo: "non_trovato", testo: null });
});

test("un altro orario: dentro le fasce di tutte e due, con l'altra persona presa dal database", async () => {
  const s = supabaseFinto({ miei: [riga()], fasce: [{ id: B, fascia_da: "09:00", fascia_a: "18:00" }] });
  const corpo = { azione: "altro", id: APP, quando: "2026-11-24T16:30:00Z", messaggio: "Meglio più tardi?" };
  assert.deepEqual(await (await chiama(s, { metodo: "POST", corpo })).json(), { ok: true });
  const [rpc] = s.dove("/rest/v1/rpc/rispondi_appuntamento");
  assert.deepEqual(rpc.corpo, { p_persona: ID, p_id: APP, p_azione: "altro", p_quando: "2026-11-24T16:30:00.000Z", p_messaggio: "Meglio più tardi?" });

  const s2 = supabaseFinto({ miei: [riga()], fasce: [{ id: B, fascia_da: "09:00", fascia_a: "18:00" }] });
  const no = await (await chiama(s2, { metodo: "POST", corpo: { ...corpo, quando: BUONO } })).json();
  assert.equal(no.motivo, "orario");
  assert.equal(s2.dove("/rest/v1/rpc/rispondi_appuntamento").length, 0);
});

test("un altro orario: solo su una proposta ricevuta e ancora aperta, al massimo 2 controproposte", async () => {
  const corpo = { azione: "altro", id: APP, quando: BUONO };
  for (const [miei, motivo] of [
    [[], "non_trovato"],
    [[riga({ proposto_da_me: true })], "non_trovato"],
    [[riga({ stato: "confermato" })], "non_trovato"],
    [[riga({ controproposte: 2 })], "controproposte_finite"],
  ]) {
    const s = supabaseFinto({ miei });
    const r = await (await chiama(s, { metodo: "POST", corpo })).json();
    assert.equal(r.motivo, motivo, JSON.stringify(miei));
    assert.equal(s.dove("/rest/v1/rpc/rispondi_appuntamento").length, 0);
  }
  const s = supabaseFinto({ miei: [riga()] });
  const r = await (await chiama(s, { metodo: "POST", corpo: { ...corpo, messaggio: "333 1234567" } })).json();
  assert.equal(r.motivo, "contatti");
});

test("database giù durante una proposta: 503 riprova", async () => {
  assert.equal((await chiama(supabaseFinto({ rpcStato: 500 }), proponi())).status, 503);
});

test("il Worker instrada /app/api/stanza/appuntamenti (spento senza ACCESSO_APP)", async () => {
  const r = await worker.fetch(richiesta(), { ...ENV, ACCESSO_APP: "no" }, { waitUntil() {} });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).motivo, "spento");
});
