// Richiesta del Worker /app/api/incontro (issue #6, passo 2c, linea «sviluppatore-b»): proposta e risposta
// dell'incontro dopo il doppio sì. Chi propone o risponde lo dice SOLO il token. Le regole le applica il database
// (proponi_incontro, rispondi_incontro). Spento finché ACCESSO_APP non vale «si». Supabase finto, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { incontroApi, PERCORSO_INCONTRO } from "../worker/incontro_api.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const ALTRO = "66666666-7777-4888-9999-000000000000";
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const ORARIO = "2026-11-20T18:00:00.000Z";

function supabaseFinto({ utente = 200, rpc = {} } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID, email: "prova@example.com" }) : new Response("{}", { status: utente });
    const nome = u.pathname.replace("/rest/v1/rpc/", "");
    if (nome in rpc) return rpc[nome] instanceof Response ? rpc[nome] : Response.json(rpc[nome]);
    return new Response("{}", { status: 404 });
  };
  return { f, viste, rpc: (nome) => viste.filter((v) => v.percorso === `/rest/v1/rpc/${nome}`) };
}
function richiesta({ metodo = "POST", corpo = null, token = TOKEN, percorso = PERCORSO_INCONTRO } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== null) headers["content-type"] = "application/json";
  return new Request(SITO + percorso, { method: metodo, headers, body: corpo === null ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
}
const proponi = (extra = {}) => richiesta({ corpo: { azione: "proponi", porta: PORTA, orario: ORARIO, locale: "bar-1", ...extra } });
const rispondi = (valore, extra = {}) => richiesta({ corpo: { azione: "rispondi", porta: PORTA, risposta: valore, ...extra } });

test("percorso dell'incontro", () => assert.equal(PERCORSO_INCONTRO, "/app/api/incontro"));

test("spento finché ACCESSO_APP non vale «si»: nessuna chiamata a Supabase", async () => {
  const s = supabaseFinto({ rpc: { proponi_incontro: "proposto" } });
  const r = await incontroApi(proponi(), { ...ENV, ACCESSO_APP: "no" }, s.f);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).motivo, "spento");
  assert.equal(s.viste.length, 0);
});

test("altri percorsi e metodi: 404 e 405 (solo GET e POST)", async () => {
  const s = supabaseFinto();
  assert.equal((await incontroApi(richiesta({ percorso: PERCORSO_INCONTRO + "/altro" }), ENV, s.f)).status, 404);
  const r = await incontroApi(richiesta({ metodo: "PUT" }), ENV, s.f);
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "GET, POST");
  assert.equal(s.viste.length, 0);
});

test("senza token valido niente: 401", async () => {
  assert.equal((await incontroApi(richiesta({ token: null, corpo: {} }), ENV, supabaseFinto().f)).status, 401);
  assert.equal((await incontroApi(proponi(), ENV, supabaseFinto({ utente: 401 }).f)).status, 401);
});

test("proponi: la persona è quella del token, mai quella scritta nel corpo", async () => {
  const s = supabaseFinto({ rpc: { proponi_incontro: "proposto" } });
  const r = await incontroApi(proponi({ persona: ALTRO, p_persona: ALTRO }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, esito: "proposto" });
  assert.deepEqual(s.rpc("proponi_incontro")[0].corpo,
    { p_porta: PORTA, p_persona: ID, p_orario: ORARIO, p_locale: "bar-1", p_luogo: null });
});

test("proponi: «Un altro luogo pubblico» scritto passa come luogo, e la controproposta è un successo", async () => {
  const s = supabaseFinto({ rpc: { proponi_incontro: "controproposto" } });
  const r = await incontroApi(proponi({ locale: undefined, luogo: "Caffè in piazza" }), ENV, s.f);
  assert.deepEqual(await r.json(), { ok: true, esito: "controproposto" });
  assert.equal(s.rpc("proponi_incontro")[0].corpo.p_luogo, "Caffè in piazza");
  assert.equal(s.rpc("proponi_incontro")[0].corpo.p_locale, null);
});

test("proponi: dati malformati non arrivano al database (400)", async () => {
  for (const extra of [{ porta: "non-un-id" }, { orario: "domani" }, { orario: 12 }, { locale: 5 }, { luogo: ["x"] },
    { luogo: "x".repeat(201) }]) {
    const s = supabaseFinto({ rpc: { proponi_incontro: "proposto" } });
    const r = await incontroApi(proponi(extra), ENV, s.f);
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.equal(s.rpc("proponi_incontro").length, 0);
  }
});

test("proponi: i rifiuti del database tornano al telefono con il loro motivo", async () => {
  for (const motivo of ["prima_di_domani", "fuori_orario", "non_sul_passo", "dopo_la_scadenza", "luogo_non_valido",
    "attendi_risposta", "controproposte_finite", "gia_confermato", "incontro_chiuso", "incontro_scaduto", "orario_non_valido"]) {
    const r = await incontroApi(proponi(), ENV, supabaseFinto({ rpc: { proponi_incontro: motivo } }).f);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: false, motivo });
  }
});

test("porta non sua o senza incontro: 404, senza dire perché", async () => {
  for (const esito of ["non_nella_porta", "nessun_incontro"]) {
    const r = await incontroApi(proponi(), ENV, supabaseFinto({ rpc: { proponi_incontro: esito } }).f);
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { ok: false, motivo: "non_trovato" });
  }
});

test("rispondi: «accetto» e «annulla» con la persona del token", async () => {
  const s = supabaseFinto({ rpc: { rispondi_incontro: "confermato" } });
  const r = await incontroApi(rispondi("accetto", { persona: ALTRO }), ENV, s.f);
  assert.deepEqual(await r.json(), { ok: true, esito: "confermato" });
  assert.deepEqual(s.rpc("rispondi_incontro")[0].corpo, { p_porta: PORTA, p_persona: ID, p_risposta: "accetto" });
  const r2 = await incontroApi(rispondi("annulla"), ENV, supabaseFinto({ rpc: { rispondi_incontro: "annullato" } }).f);
  assert.deepEqual(await r2.json(), { ok: true, esito: "annullato" });
});

test("rispondi: altre risposte non arrivano al database (400)", async () => {
  const s = supabaseFinto({ rpc: { rispondi_incontro: "confermato" } });
  assert.equal((await incontroApi(rispondi("forse"), ENV, s.f)).status, 400);
  assert.equal((await incontroApi(rispondi(null), ENV, s.f)).status, 400);
  assert.equal(s.rpc("rispondi_incontro").length, 0);
});

test("rispondi: i rifiuti del database tornano con il loro motivo", async () => {
  for (const motivo of ["nessuna_proposta", "proposta_scaduta", "non_puoi_rispondere", "orario_passato", "incontro_chiuso", "incontro_scaduto"]) {
    const r = await incontroApi(rispondi("accetto"), ENV, supabaseFinto({ rpc: { rispondi_incontro: motivo } }).f);
    assert.deepEqual(await r.json(), { ok: false, motivo });
  }
});

test("azione sconosciuta: 400; database che risponde male o con un esito sconosciuto: 503 «riprova»", async () => {
  assert.equal((await incontroApi(richiesta({ corpo: { azione: "boh", porta: PORTA } }), ENV, supabaseFinto().f)).status, 400);
  const guasto = await incontroApi(proponi(), ENV, supabaseFinto({ rpc: { proponi_incontro: new Response("{}", { status: 500 }) } }).f);
  assert.equal(guasto.status, 503);
  const strano = await incontroApi(proponi(), ENV, supabaseFinto({ rpc: { proponi_incontro: "qualcosa_di_nuovo" } }).f);
  assert.equal(strano.status, 503);
  assert.deepEqual(await strano.json(), { ok: false, motivo: "riprova" });
});

test("il Worker instrada /app/api/incontro con le intestazioni dell'app", async () => {
  const r = await worker.fetch(richiesta({ token: null, corpo: {} }), { ...ENV, ACCESSO_APP: "no", ASSETS: { fetch: async () => new Response("x") } }, {});
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.ok(r.headers.get("content-security-policy"));
  assert.equal((await r.json()).motivo, "spento");
});

// ── Lettura dello stato (passo 2d): GET /app/api/incontro?porta=<id> → stato_incontro. ──
const STATO = {
  stato: "proposto", scadenza: "2026-11-28T18:00:00+00:00", orario: "2026-11-20T18:00:00+00:00", locale: "bar-1", luogo: null,
  proposta_mia: false, proposta_scade: "2026-11-20T10:00:00+00:00", controproposte_rimaste: 3,
  azioni: ["accetto", "altra_data", "annulla"], ritardo_minuti: 0, esito: null,
  checkin_mio: false, checkin_altro: false, checkin_da: null, checkin_fino: null, segnale: null,
  disdetta: null, // passo 2q
  ritardo_mio: false, // «Arrivo in ritardo»: solo sì/no, mai chi l'ha dichiarato
};
const leggi = (porta = PORTA, extra = "") => richiesta({ metodo: "GET", percorso: `${PERCORSO_INCONTRO}?porta=${porta}${extra}` });

test("stato: la persona è quella del token, mai quella scritta nell'indirizzo", async () => {
  const s = supabaseFinto({ rpc: { stato_incontro: STATO } });
  const r = await incontroApi(leggi(PORTA, `&persona=${ALTRO}&p_persona=${ALTRO}`), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, incontro: { ...STATO, locali: [], locale_scelto: null } });
  assert.deepEqual(s.rpc("stato_incontro")[0].corpo, { p_porta: PORTA, p_persona: ID });
});

test("stato: passano al telefono solo i campi previsti", async () => {
  const s = supabaseFinto({ rpc: { stato_incontro: { ...STATO, a: ALTRO, proposto_da: ALTRO, segreto: "x" } } });
  const corpo = await (await incontroApi(leggi(), ENV, s.f)).json();
  assert.deepEqual(corpo, { ok: true, incontro: { ...STATO, locali: [], locale_scelto: null } });
});

test("stato: porta mancante o malformata non arriva al database (400)", async () => {
  for (const r of [richiesta({ metodo: "GET" }), leggi("non-un-id")]) {
    const s = supabaseFinto({ rpc: { stato_incontro: STATO } });
    assert.equal((await incontroApi(r, ENV, s.f)).status, 400);
    assert.equal(s.rpc("stato_incontro").length, 0);
  }
});

test("stato: senza token valido niente (401)", async () => {
  const s = supabaseFinto({ rpc: { stato_incontro: STATO } });
  const r = await incontroApi(richiesta({ metodo: "GET", token: null, percorso: `${PERCORSO_INCONTRO}?porta=${PORTA}` }), ENV, s.f);
  assert.equal(r.status, 401);
  assert.equal(s.rpc("stato_incontro").length, 0);
});

test("stato: porta non sua o senza incontro → 404 senza dire perché; guasto → 503", async () => {
  for (const errore of ["non_nella_porta", "nessun_incontro"]) {
    const r = await incontroApi(leggi(), ENV, supabaseFinto({ rpc: { stato_incontro: { errore } } }).f);
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { ok: false, motivo: "non_trovato" });
  }
  for (const rotto of [new Response("{}", { status: 500 }), "testo", { stato: "boh" }]) {
    const r = await incontroApi(leggi(), ENV, supabaseFinto({ rpc: { stato_incontro: rotto } }).f);
    assert.equal(r.status, 503);
  }
});

// ── «Sono qui» (passo 2g): POST { azione: "checkin", porta } → checkin_incontro. ──
const checkin = (extra = {}) => richiesta({ corpo: { azione: "checkin", porta: PORTA, ...extra } });

test("checkin: la persona è quella del token, mai quella del corpo", async () => {
  const s = supabaseFinto({ rpc: { checkin_incontro: "sono_qui" } });
  const r = await incontroApi(checkin({ persona: ALTRO, p_persona: ALTRO }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, esito: "sono_qui" });
  assert.deepEqual(s.rpc("checkin_incontro")[0].corpo, { p_porta: PORTA, p_persona: ID });
});

test("checkin: secondo check-in → «avvenuto»", async () => {
  const r = await incontroApi(checkin(), ENV, supabaseFinto({ rpc: { checkin_incontro: "avvenuto" } }).f);
  assert.deepEqual(await r.json(), { ok: true, esito: "avvenuto" });
});

test("checkin: fuori finestra o non confermato → rifiuto con il motivo del database", async () => {
  for (const motivo of ["troppo_presto", "troppo_tardi", "non_confermato", "gia_fatto", "incontro_chiuso"]) {
    const r = await incontroApi(checkin(), ENV, supabaseFinto({ rpc: { checkin_incontro: motivo } }).f);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: false, motivo });
  }
});

test("checkin: porta non sua → 404; porta malformata non arriva al database; guasto → 503", async () => {
  for (const errore of ["non_nella_porta", "nessun_incontro"]) {
    assert.equal((await incontroApi(checkin(), ENV, supabaseFinto({ rpc: { checkin_incontro: errore } }).f)).status, 404);
  }
  const s = supabaseFinto({ rpc: { checkin_incontro: "sono_qui" } });
  assert.equal((await incontroApi(checkin({ porta: "x" }), ENV, s.f)).status, 400);
  assert.equal(s.rpc("checkin_incontro").length, 0);
  for (const rotto of [new Response("{}", { status: 500 }), "boh"]) {
    assert.equal((await incontroApi(checkin(), ENV, supabaseFinto({ rpc: { checkin_incontro: rotto } }).f)).status, 503);
  }
});

test("stato: dopo i due check-in il segnale arriva al telefono (passo 2h)", async () => {
  const dopo = { ...STATO, stato: "concluso", azioni: [], esito: "avvenuto", checkin_mio: true, checkin_altro: true,
    checkin_da: "2026-11-20T17:30:00+00:00", checkin_fino: "2026-11-20T18:30:00+00:00", segnale: "Lampone" };
  const corpo = await (await incontroApi(leggi(), ENV, supabaseFinto({ rpc: { stato_incontro: dopo } }).f)).json();
  assert.deepEqual(corpo, { ok: true, incontro: { ...dopo, locali: [], locale_scelto: null } });
});

// ── «Arrivo in ritardo» (spec v1, casi limite): POST { azione: "ritardo", porta, minuti } → ritardo_incontro. ──
const ritardo = (extra = {}) => richiesta({ corpo: { azione: "ritardo", porta: PORTA, minuti: 15, ...extra } });

test("ritardo: la persona è quella del token, mai quella del corpo; i minuti arrivano al database", async () => {
  const s = supabaseFinto({ rpc: { ritardo_incontro: "ritardo" } });
  const r = await incontroApi(ritardo({ minuti: 30, persona: ALTRO, p_persona: ALTRO }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, esito: "ritardo" });
  assert.deepEqual(s.rpc("ritardo_incontro")[0].corpo, { p_porta: PORTA, p_persona: ID, p_minuti: 30 });
});

test("ritardo: solo 15 o 30 minuti, il resto non arriva al database (400)", async () => {
  for (const minuti of [0, 10, 20, 45, "15", null, undefined, 15.5]) {
    const s = supabaseFinto({ rpc: { ritardo_incontro: "ritardo" } });
    assert.equal((await incontroApi(ritardo({ minuti }), ENV, s.f)).status, 400, String(minuti));
    assert.equal(s.rpc("ritardo_incontro").length, 0);
  }
});

test("ritardo: i rifiuti del database tornano con il loro motivo", async () => {
  for (const motivo of ["non_confermato", "incontro_chiuso", "ritardo_non_valido", "ritardo_gia_usato", "gia_fatto", "troppo_tardi"]) {
    const r = await incontroApi(ritardo(), ENV, supabaseFinto({ rpc: { ritardo_incontro: motivo } }).f);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: false, motivo });
  }
});

test("ritardo: porta non sua → 404; porta malformata non arriva al database; guasto → 503", async () => {
  for (const errore of ["non_nella_porta", "nessun_incontro"]) {
    assert.equal((await incontroApi(ritardo(), ENV, supabaseFinto({ rpc: { ritardo_incontro: errore } }).f)).status, 404);
  }
  const s = supabaseFinto({ rpc: { ritardo_incontro: "ritardo" } });
  assert.equal((await incontroApi(ritardo({ porta: "x" }), ENV, s.f)).status, 400);
  assert.equal(s.rpc("ritardo_incontro").length, 0);
  for (const rotto of [new Response("{}", { status: 500 }), "boh"]) {
    assert.equal((await incontroApi(ritardo(), ENV, supabaseFinto({ rpc: { ritardo_incontro: rotto } }).f)).status, 503);
  }
});

test("stato: «ritardo_mio» arriva solo come sì/no, mai come id", async () => {
  for (const [dal_db, atteso] of [[true, true], [false, false], [ALTRO, false], [null, false], ["true", false]]) {
    const st = { ...STATO, stato: "confermato", azioni: ["disdici"], ritardo_minuti: 15, ritardo_mio: dal_db };
    const corpo = await (await incontroApi(leggi(), ENV, supabaseFinto({ rpc: { stato_incontro: st } }).f)).json();
    assert.equal(corpo.incontro.ritardo_mio, atteso, String(dal_db));
    assert.doesNotMatch(JSON.stringify(corpo), new RegExp(ALTRO));
  }
});
