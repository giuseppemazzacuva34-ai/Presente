// Richiesta del Worker /app/api/svelamento (issue #65, passo 4b, linea «sviluppatore»).
// Chi blocca la caparra lo dice SOLO il token. Spento finché ACCESSO_APP non vale «si». Supabase finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { svelamentoApi, PERCORSO_SVELAMENTO } from "../worker/svelamento_api.js";
import { TESTI_SVELAMENTO } from "../api/svelamento.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const LEI = "66666666-7777-4888-9999-000000000000";
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const UNA_PORTA = {
  porta: PORTA, con: LEI, nome: "Giulia", eta: 31,
  aperta_il: "2026-11-15T20:00:00+00:00", scade_il: "2026-11-17T20:00:00+00:00",
  mia_caparra: false, sua_caparra: true, mia_scelta: "video",
};
const STATO = { saldo: 25, porte: [UNA_PORTA] };
// Passo 5a: campi di «Quando» quando il database non li manda (prima della migrazione o porta senza riga).
const QUANDO_VUOTO = { mie_fasce: [], fascia_fissata: null, mio_pronto: false, suo_pronto: false, pronto_scade_il: null, pronta: null };

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
function richiesta({ metodo = "GET", corpo = null, token = TOKEN, percorso = PERCORSO_SVELAMENTO } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== null) headers["content-type"] = "application/json";
  return new Request(SITO + percorso, { method: metodo, headers, body: corpo === null ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
}
const caparra = (porta = PORTA, extra = {}) => richiesta({ metodo: "POST", corpo: { azione: "caparra", porta, ...extra } });

test("spento finché ACCESSO_APP non vale «si»: nessuna chiamata a Supabase", async () => {
  const s = supabaseFinto({ rpc: { svelamento_di: STATO } });
  const r = await svelamentoApi(richiesta(), { ...ENV, ACCESSO_APP: "no" }, s.f);
  assert.equal(r.status, 404);
  assert.equal(s.viste.length, 0);
});

test("altri percorsi e metodi: 404 e 405", async () => {
  const s = supabaseFinto();
  assert.equal((await svelamentoApi(richiesta({ percorso: PERCORSO_SVELAMENTO + "/altro" }), ENV, s.f)).status, 404);
  const r = await svelamentoApi(richiesta({ metodo: "DELETE" }), ENV, s.f);
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "GET, POST");
});

test("senza token valido niente: 401", async () => {
  assert.equal((await svelamentoApi(richiesta({ token: null }), ENV, supabaseFinto().f)).status, 401);
  assert.equal((await svelamentoApi(richiesta(), ENV, supabaseFinto({ utente: 401 }).f)).status, 401);
});

test("GET: saldo e porte da svelamento_di per la persona del token, con i testi della caparra", async () => {
  const s = supabaseFinto({ rpc: { svelamento_di: STATO } });
  const r = await svelamentoApi(richiesta(), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.saldo, 25);
  assert.equal(j.caparra, 10);
  assert.equal(j.beta, true);
  assert.deepEqual(j.porte, [{ ...UNA_PORTA, aspetta: null, ...QUANDO_VUOTO }]);
  assert.equal(j.testi.blocca, "Blocca 10 crediti");
  assert.equal(j.testi.spiegazione, TESTI_SVELAMENTO.spiegazioneCaparra);
  assert.deepEqual(j.testi.scelta, { video: "Videochiamata di 10 secondi", foto: "Preferisco le foto" });
  assert.deepEqual(s.rpc("svelamento_di")[0].corpo, { p_utente: ID });
});

test("GET: con la mia caparra e senza la sua compare «Aspettiamo che anche <nome> blocchi la caparra.»", async () => {
  const s = supabaseFinto({ rpc: { svelamento_di: { saldo: 5, porte: [{ ...UNA_PORTA, mia_caparra: true, sua_caparra: false }] } } });
  const j = await (await svelamentoApi(richiesta(), ENV, s.f)).json();
  assert.equal(j.porte[0].aspetta, "Aspettiamo che anche Giulia blocchi la caparra.");
});

test("GET: dal database escono solo i campi previsti (niente campi in più)", async () => {
  const s = supabaseFinto({ rpc: { svelamento_di: { saldo: 25, porte: [{ ...UNA_PORTA, email: "x@y.it", data_nascita: "1995-01-01" }] } } });
  const j = await (await svelamentoApi(richiesta(), ENV, s.f)).json();
  assert.equal("email" in j.porte[0], false);
  assert.equal("data_nascita" in j.porte[0], false);
});

test("GET: risposta strana del database → 503 riprova", async () => {
  const s = supabaseFinto({ rpc: { svelamento_di: new Response("{}", { status: 500 }) } });
  const r = await svelamentoApi(richiesta(), ENV, s.f);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { ok: false, motivo: "riprova" });
});

test("POST caparra: la persona è quella del token, anche se il corpo dice altro; poi lo stato aggiornato", async () => {
  const s = supabaseFinto({ rpc: { caparra_svelamento: "bloccata", svelamento_di: STATO } });
  const r = await svelamentoApi(caparra(PORTA, { persona: LEI }), ENV, s.f);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.esito, "bloccata");
  assert.equal(j.stato.saldo, 25);
  assert.deepEqual(s.rpc("caparra_svelamento")[0].corpo, { p_porta: PORTA, p_persona: ID });
});

test("POST caparra già bloccata: ok, niente doppio blocco", async () => {
  const s = supabaseFinto({ rpc: { caparra_svelamento: "gia_bloccata", svelamento_di: STATO } });
  const j = await (await svelamentoApi(caparra(), ENV, s.f)).json();
  assert.equal(j.ok, true);
  assert.equal(j.esito, "gia_bloccata");
});

test("POST con crediti insufficienti: «Ti mancano N crediti», «Ricarica» e il testo della beta", async () => {
  const s = supabaseFinto({ rpc: { caparra_svelamento: "crediti_insufficienti", svelamento_di: { saldo: 7, porte: [UNA_PORTA] } } });
  const j = await (await svelamentoApi(caparra(), ENV, s.f)).json();
  assert.deepEqual(j, {
    ok: false, motivo: "crediti_insufficienti", mancano: 3, testo: "Ti mancano 3 crediti",
    ricarica: "Ricarica", beta: "In beta i crediti sono di prova",
  });
});

test("POST con un solo credito mancante: «Ti manca 1 credito»", async () => {
  const s = supabaseFinto({ rpc: { caparra_svelamento: "crediti_insufficienti", svelamento_di: { saldo: 9, porte: [] } } });
  const j = await (await svelamentoApi(caparra(), ENV, s.f)).json();
  assert.equal(j.mancano, 1);
  assert.equal(j.testo, "Ti manca 1 credito");
});

test("POST su porta scaduta: testo della scadenza; porta chiusa: nessun motivo rivelato", async () => {
  let s = supabaseFinto({ rpc: { caparra_svelamento: "porta_scaduta" } });
  assert.deepEqual(await (await svelamentoApi(caparra(), ENV, s.f)).json(), { ok: false, motivo: "porta_scaduta", testo: TESTI_SVELAMENTO.scaduta });
  s = supabaseFinto({ rpc: { caparra_svelamento: "porta_chiusa" } });
  const j = await (await svelamentoApi(caparra(), ENV, s.f)).json();
  assert.deepEqual(j, { ok: false, motivo: "porta_chiusa", testo: "Questa porta si è chiusa." });
});

test("POST su una porta non sua: 404, stessa risposta di una porta che non esiste", async () => {
  const s = supabaseFinto({ rpc: { caparra_svelamento: "non_nella_porta" } });
  const r = await svelamentoApi(caparra(), ENV, s.f);
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { ok: false, motivo: "non_trovata" });
});

test("POST con dati sbagliati: 400 senza chiamare il database", async () => {
  for (const corpo of [{ azione: "caparra", porta: "non-un-uuid" }, { azione: "svela", porta: PORTA }, "non json", [1]]) {
    const s = supabaseFinto({ rpc: { caparra_svelamento: "bloccata" } });
    const r = await svelamentoApi(richiesta({ metodo: "POST", corpo }), ENV, s.f);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.equal(s.rpc("caparra_svelamento").length, 0);
  }
});

test("POST con risposta sconosciuta del database: 503 riprova", async () => {
  const s = supabaseFinto({ rpc: { caparra_svelamento: "boh" } });
  assert.equal((await svelamentoApi(caparra(), ENV, s.f)).status, 503);
});

test("corpo troppo grande: 413", async () => {
  const s = supabaseFinto();
  const r = await svelamentoApi(richiesta({ metodo: "POST", corpo: JSON.stringify({ azione: "caparra", porta: PORTA, x: "a".repeat(5000) }) }), ENV, s.f);
  assert.equal(r.status, 413);
});

test("troppe richieste dallo stesso indirizzo: 429 prima di toccare Supabase", async () => {
  const s = supabaseFinto();
  const env = { ...ENV, LIMITE_PROVINCIA: { limit: async ({ key }) => ({ success: !key.startsWith("svelamento:") }) } };
  const r = await svelamentoApi(richiesta(), env, s.f);
  assert.equal(r.status, 429);
  assert.equal(s.viste.length, 0);
});

test("nei log niente token, persone o porte", async () => {
  const righe = [];
  const prima = console.error;
  console.error = (...a) => righe.push(a.join(" "));
  try {
    const s = supabaseFinto({ rpc: { caparra_svelamento: new Response("{}", { status: 500 }) } });
    await svelamentoApi(caparra(), ENV, s.f);
  } finally {
    console.error = prima;
  }
  const tutto = righe.join("\n");
  for (const segreto of [TOKEN, ID, PORTA]) assert.equal(tutto.includes(segreto), false);
});

test("il Worker instrada /app/api/svelamento con le intestazioni dell'app", async () => {
  const r = await worker.fetch(richiesta({ token: null }), { ...ENV, ACCESSO_APP: "no", ASSETS: { fetch: async () => new Response("x") } }, {});
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.ok(r.headers.get("content-security-policy"));
  assert.equal((await r.json()).motivo, "spento");
});

// --- Passo 3a: «Come vuoi lo svelamento» (video o foto) ----------------------------------------------------------
const scelta = (valore, extra = {}) => richiesta({ metodo: "POST", corpo: { azione: "scelta", porta: PORTA, scelta: valore, ...extra } });

test("GET: mia_scelta solo «video» o «foto»; valori strani → «video»; mai la scelta dell'altra persona", async () => {
  const s = supabaseFinto({ rpc: { svelamento_di: { saldo: 25, porte: [
    { ...UNA_PORTA, mia_scelta: "foto", sua_scelta: "video", scelta_b: "foto" }, { ...UNA_PORTA, mia_scelta: "audio" }] } } });
  const j = await (await svelamentoApi(richiesta(), ENV, s.f)).json();
  assert.equal(j.porte[0].mia_scelta, "foto");
  assert.equal(j.porte[1].mia_scelta, "video");
  for (const campo of ["sua_scelta", "scelta_a", "scelta_b"]) assert.equal(campo in j.porte[0], false, campo);
});

test("POST scelta: salva per la persona del token (non quella del corpo) e rimanda lo stato", async () => {
  const s = supabaseFinto({ rpc: { scelta_svelamento: "salvata", svelamento_di: STATO } });
  const r = await svelamentoApi(scelta("foto", { persona: LEI }), ENV, s.f);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.esito, "salvata");
  assert.equal(j.stato.saldo, 25);
  assert.deepEqual(s.rpc("scelta_svelamento")[0].corpo, { p_porta: PORTA, p_persona: ID, p_scelta: "foto" });
  assert.equal(s.rpc("caparra_svelamento").length, 0);
});

test("POST scelta con valore sbagliato: 400 senza chiamare il database", async () => {
  for (const valore of ["audio", "", null, 1, "FOTO"]) {
    const s = supabaseFinto({ rpc: { scelta_svelamento: "salvata" } });
    const r = await svelamentoApi(scelta(valore), ENV, s.f);
    assert.equal(r.status, 400, String(valore));
    assert.equal(s.viste.filter((v) => v.percorso.startsWith("/rest/")).length, 0);
  }
});

test("POST scelta dopo l'inizio: non cambia; porta scaduta, chiusa o di altri come per la caparra", async () => {
  let s = supabaseFinto({ rpc: { scelta_svelamento: "gia_iniziato" } });
  assert.deepEqual(await (await svelamentoApi(scelta("foto"), ENV, s.f)).json(), { ok: false, motivo: "gia_iniziato" });
  s = supabaseFinto({ rpc: { scelta_svelamento: "porta_scaduta" } });
  assert.deepEqual(await (await svelamentoApi(scelta("foto"), ENV, s.f)).json(), { ok: false, motivo: "porta_scaduta", testo: TESTI_SVELAMENTO.scaduta });
  s = supabaseFinto({ rpc: { scelta_svelamento: "porta_chiusa" } });
  assert.deepEqual(await (await svelamentoApi(scelta("foto"), ENV, s.f)).json(), { ok: false, motivo: "porta_chiusa", testo: "Questa porta si è chiusa." });
  s = supabaseFinto({ rpc: { scelta_svelamento: "non_nella_porta" } });
  assert.equal((await svelamentoApi(scelta("foto"), ENV, s.f)).status, 404);
  s = supabaseFinto({ rpc: { scelta_svelamento: "boh" } });
  assert.equal((await svelamentoApi(scelta("foto"), ENV, s.f)).status, 503);
});

// --- Passo 5a: «Sono pronto ora» e «Scegli un orario» ----------------------------------------------------------------
const F1 = "2026-11-16T18:00:00.000Z", F2 = "2026-11-16T18:30:00.000Z", F3 = "2026-11-17T09:00:00.000Z";
const pronto = (extra = {}) => richiesta({ metodo: "POST", corpo: { azione: "pronto", porta: PORTA, ...extra } });
const fasce = (valore, extra = {}) => richiesta({ metodo: "POST", corpo: { azione: "fasce", porta: PORTA, fasce: valore, ...extra } });

test("GET: proprie fasce, fascia fissata e «<nome> è pronta per lo svelamento»; mai le fasce dell'altra persona", async () => {
  const s = supabaseFinto({ rpc: { svelamento_di: { saldo: 25, porte: [
    { ...UNA_PORTA, mia_caparra: true, mie_fasce: [F1, F2], fascia_fissata: F1, mio_pronto: false, suo_pronto: true, pronto_scade_il: null, sue_fasce: [F3], fasce_b: [F3] },
    { ...UNA_PORTA, mie_fasce: "strano", fascia_fissata: 7, mio_pronto: "si", suo_pronto: 1, pronto_scade_il: 5 }] } } });
  const j = await (await svelamentoApi(richiesta(), ENV, s.f)).json();
  assert.deepEqual(j.porte[0].mie_fasce, [F1, F2]);
  assert.equal(j.porte[0].fascia_fissata, F1);
  assert.equal(j.porte[0].suo_pronto, true);
  assert.equal(j.porte[0].pronta, "Giulia è pronta per lo svelamento");
  for (const campo of ["sue_fasce", "fasce_a", "fasce_b"]) assert.equal(campo in j.porte[0], false, campo);
  assert.deepEqual(j.porte[1].mie_fasce, []);
  assert.equal(j.porte[1].fascia_fissata, null);
  assert.equal(j.porte[1].mio_pronto, false);
  assert.equal(j.porte[1].suo_pronto, false);
  assert.equal(j.porte[1].pronto_scade_il, null);
  assert.equal(j.porte[1].pronta, null);
  assert.deepEqual(j.testi.quando, { ora: "Sono pronto ora", orario: "Scegli un orario", maxFasce: 3, fasciaMinuti: 30 });
});

test("POST pronto: per la persona del token, risponde se ora siete pronti entrambi e rimanda lo stato", async () => {
  for (const esito of ["pronto", "entrambi_pronti"]) {
    const s = supabaseFinto({ rpc: { pronto_svelamento: esito, svelamento_di: STATO } });
    const r = await svelamentoApi(pronto({ persona: LEI }), ENV, s.f);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.ok, true);
    assert.equal(j.esito, esito);
    assert.equal(j.stato.saldo, 25);
    assert.deepEqual(s.rpc("pronto_svelamento")[0].corpo, { p_porta: PORTA, p_persona: ID });
  }
});

test("POST pronto senza le due caparre: niente; scaduta, chiusa, iniziata o di altri come per la scelta", async () => {
  const prova = async (esito) => svelamentoApi(pronto(), ENV, supabaseFinto({ rpc: { pronto_svelamento: esito } }).f);
  assert.deepEqual(await (await prova("manca_caparra")).json(), { ok: false, motivo: "manca_caparra" });
  assert.deepEqual(await (await prova("gia_iniziato")).json(), { ok: false, motivo: "gia_iniziato" });
  assert.deepEqual(await (await prova("porta_scaduta")).json(), { ok: false, motivo: "porta_scaduta", testo: TESTI_SVELAMENTO.scaduta });
  assert.deepEqual(await (await prova("porta_chiusa")).json(), { ok: false, motivo: "porta_chiusa", testo: "Questa porta si è chiusa." });
  assert.equal((await prova("non_nella_porta")).status, 404);
  assert.equal((await prova("boh")).status, 503);
});

test("POST fasce: per la persona del token, ordinate e senza doppioni; «fissata» o «salvate»", async () => {
  for (const esito of ["fissata", "salvate"]) {
    const s = supabaseFinto({ rpc: { fasce_svelamento: esito, svelamento_di: STATO } });
    const r = await svelamentoApi(fasce([F3, F1, F3], { persona: LEI }), ENV, s.f);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.ok, true);
    assert.equal(j.esito, esito);
    assert.deepEqual(s.rpc("fasce_svelamento")[0].corpo, { p_porta: PORTA, p_persona: ID, p_fasce: [F1, F3] });
  }
});

test("POST fasce con forma sbagliata: 400 senza chiamare il database", async () => {
  for (const valore of [[], null, "x", [F1, F2, F3, "2026-11-17T10:00:00.000Z"], ["2026-11-16T18:15:00.000Z"], ["domani"], [123], ["2026-11-16T18:00:01.000Z"]]) {
    const s = supabaseFinto({ rpc: { fasce_svelamento: "salvate" } });
    const r = await svelamentoApi(fasce(valore), ENV, s.f);
    assert.equal(r.status, 400, JSON.stringify(valore));
    assert.equal(s.viste.filter((v) => v.percorso.startsWith("/rest/")).length, 0);
  }
});

test("POST fasce fuori dalle 48 ore o già iniziate: il database dice no e il telefono lo sa", async () => {
  const prova = async (esito) => (await svelamentoApi(fasce([F1]), ENV, supabaseFinto({ rpc: { fasce_svelamento: esito } }).f)).json();
  assert.deepEqual(await prova("fasce_non_valide"), { ok: false, motivo: "fasce_non_valide" });
  assert.deepEqual(await prova("manca_caparra"), { ok: false, motivo: "manca_caparra" });
  assert.deepEqual(await prova("porta_chiusa"), { ok: false, motivo: "porta_chiusa", testo: "Questa porta si è chiusa." });
});
