// Test del salvataggio passo per passo (issue #2). Supabase è finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaSalvataggio, profiloDaStato, filtriDaStato, statoDaSalvato, VERSIONE_INFORMATIVA_APP, PAESE_ESTERO } from "../landing/app/moduli/salvataggio.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";

function finto(rispondi = () => [200, []]) {
  const chiamate = [];
  const f = async (url, o = {}) => {
    const u = new URL(url);
    const tipo = o.headers?.["content-type"];
    const corpo = o.body === undefined ? undefined : (tipo === "application/json" ? JSON.parse(o.body) : o.body);
    const c = { percorso: u.pathname, query: u.searchParams, metodo: o.method || "GET", headers: o.headers, corpo };
    chiamate.push(c);
    if (u.origin !== BASE) throw new Error("rete assente");
    const [stato, dati] = rispondi(c);
    return dati instanceof Blob ? new Response(dati, { status: stato }) : new Response(JSON.stringify(dati), { status: stato });
  };
  return { f, chiamate };
}
const crea = (f, { token = "tok-utente", id = ID } = {}) =>
  creaSalvataggio({ supabaseUrl: BASE, supabaseAnonKey: "anon", token: async () => token, utenteId: () => id, fetch: f });

test("profilo: upsert sulla propria riga con il token dell'utente, solo i campi ammessi", async () => {
  const s = finto(() => [201, null]);
  const r = await crea(s.f).salvaProfilo({ nome: "Giulia", passo: 5, email: "non-deve-passare@example.com", ruolo: "admin" });
  assert.deepEqual(r, { ok: true });
  const c = s.chiamate[0];
  assert.equal(c.percorso, "/rest/v1/profili");
  assert.equal(c.query.get("on_conflict"), "id");
  assert.equal(c.metodo, "POST");
  assert.equal(c.headers.authorization, "Bearer tok-utente");
  assert.match(c.headers.prefer, /resolution=merge-duplicates/);
  assert.deepEqual(c.corpo, { id: ID, nome: "Giulia", passo: 5 });
});

test("filtri: la data del consenso non parte dal telefono, la versione dell'informativa sì", async () => {
  const s = finto(() => [201, null]);
  await crea(s.f).salvaFiltri({ cerco: "donne", consenso_cerco_il: "2020-01-01", eta_min: 25, eta_max: 40 });
  assert.deepEqual(s.chiamate[0].corpo, { utente_id: ID, cerco: "donne", eta_min: 25, eta_max: 40, consenso_versione_informativa: VERSIONE_INFORMATIVA_APP });
  assert.ok(VERSIONE_INFORMATIVA_APP.length <= 10);
});

test("questionario: crea la riga della prossima settimana, poi la aggiorna", async () => {
  let righe = [];
  const s = finto((c) => (c.metodo === "GET" ? [200, righe] : [201, null]));
  const a = crea(s.f);
  await a.salvaQuestionario({ 1: [0, 1] }, { valori: 3 });
  assert.equal(s.chiamate[1].metodo, "POST");
  assert.deepEqual(s.chiamate[1].corpo, { utente_id: ID, risposte: { 1: [0, 1] }, importanza: { valori: 3 }, versione: "v1" });
  righe = [{ in_vigore_dal: "2026-11-02T08:00:00Z" }];
  await a.salvaQuestionario({ 1: [2, 3] }, { valori: 2 });
  assert.equal(s.chiamate[3].metodo, "PATCH");
  assert.match(s.chiamate[3].query.get("in_vigore_dal"), /^gt\./);
  assert.equal(s.chiamate[3].query.get("utente_id"), `eq.${ID}`);
});

test("file: solo nomi fissi nella propria cartella, sostituzione con x-upsert", async () => {
  const s = finto(() => [200, {}]);
  const a = crea(s.f);
  const voce = new Blob(["audio"], { type: "audio/webm;codecs=opus" });
  assert.deepEqual(await a.caricaFile("voci", "presentazione", voce), { ok: true });
  assert.equal(s.chiamate[0].percorso, `/storage/v1/object/voci/${ID}/presentazione`);
  assert.equal(s.chiamate[0].headers["x-upsert"], "true");
  assert.equal(s.chiamate[0].headers["content-type"], "audio/webm");
  assert.equal((await a.caricaFile("foto", "../altro/foto-1", voce)).ok, false);
  assert.equal((await a.caricaFile("foto", "foto-4", voce)).ok, false);
  assert.equal((await a.caricaFile("pubblica", "foto-1", voce)).ok, false);
  assert.equal(s.chiamate.length, 1);
});

test("senza accesso nessuna chiamata; errori tradotti senza dettagli del server", async () => {
  const vuoto = finto();
  assert.deepEqual(await crea(vuoto.f, { token: null }).salvaProfilo({ passo: 3 }), { ok: false, motivo: "accesso" });
  assert.deepEqual(await crea(vuoto.f, { id: "non-un-id" }).salvaProfilo({ passo: 3 }), { ok: false, motivo: "accesso" });
  assert.equal(vuoto.chiamate.length, 0);
  assert.deepEqual(await crea(finto(() => [401, {}]).f).salvaProfilo({ passo: 3 }), { ok: false, motivo: "accesso" });
  assert.deepEqual(await crea(finto(() => [400, { message: "dettaglio interno" }]).f).salvaProfilo({ passo: 3 }), { ok: false, motivo: "salvataggio" });
  const rotto = async () => { throw new Error("offline"); };
  assert.deepEqual(await crea(rotto).salvaProfilo({ passo: 3 }), { ok: false, motivo: "rete" });
});

test("rientro: legge profilo, filtri, ultimo questionario e nomi dei file", async () => {
  const s = finto((c) => {
    if (c.percorso === "/rest/v1/profili") return [200, [{ nome: "Giulia", passo: 7, data_nascita: "1994-05-09", regole_accettate_il: "x", citta: "Lecce", paese: "IT", mi_presento_come: "donna", domande_voce: [4, 0] }]];
    if (c.percorso === "/rest/v1/filtri") return [200, [{ cerco: "uomini", eta_min: 30, eta_max: 45, raggio: "italia", cosa_cerco: "storia_seria", figli: "forse", fumo: "no" }]];
    if (c.percorso === "/rest/v1/questionario") return [200, [{ risposte: { 1: [0, 1] }, importanza: {} }]];
    if (c.percorso === "/storage/v1/object/list/voci") return [200, [{ name: "presentazione", id: "x" }]];
    if (c.percorso === "/storage/v1/object/list/foto") return [200, []];
    return [404, {}];
  });
  const letto = await crea(s.f).leggi();
  assert.equal(letto.ok, true);
  assert.deepEqual(letto.voci, ["presentazione"]);
  assert.equal(s.chiamate.find((c) => c.percorso.endsWith("/list/voci")).corpo.prefix, ID);
  const st = { citta: "", cittaAltra: "", estero: false, domandeVoce: [], questionario: { risposte: {}, importanza: {} }, etaMin: 25, etaMax: 40, raggio: "citta" };
  const passo = statoDaSalvato(st, letto, ["Milano", "Roma"]);
  assert.equal(passo, 7);
  assert.equal(st.citta, "altra");
  assert.equal(st.cittaAltra, "Lecce");
  assert.equal(st.dataNascita, "1994-05-09");
  assert.deepEqual([st.giorno, st.mese, st.anno], ["9", "5", "1994"]);
  assert.equal(st.consensoCerco, true);
  assert.deepEqual(st.domandeVoce, [4, 0]);
  assert.deepEqual(st.questionario.risposte, { 1: [0, 1] });
});

test("dallo stato dell'app ai campi del database", () => {
  const base = { nome: " Giulia ", citta: "altra", cittaAltra: " Lecce ", estero: false, miPresento: "donna", miDescrivo: "x" };
  assert.deepEqual(profiloDaStato(base), { nome: "Giulia", citta: "Lecce", paese: "IT", mi_presento_come: "donna", mi_descrivo: null });
  assert.deepEqual(profiloDaStato({ ...base, estero: true, citta: "estero" }).paese, PAESE_ESTERO);
  assert.equal(profiloDaStato({ ...base, estero: true, citta: "estero" }).citta, null);
  // «cerco» parte solo con il consenso spuntato.
  const filtri = { cerco: "tutti", consensoCerco: false, etaMin: 20, etaMax: 30, raggio: "citta", cosaCerco: "", figli: "no", fumo: "si" };
  assert.equal(filtriDaStato(filtri).cerco, null);
  assert.equal(filtriDaStato({ ...filtri, consensoCerco: true }).cerco, "tutti");
});
