// Pagina di chi risponde a «Scrivici» (issue #10, parte A; passo 5a della linea «sviluppatore-c»).
// Il modulo parla solo con /app/api/supporto/coda e /app/api/supporto/risposta col token di chi risponde: il ruolo
// «supporto» lo decide il database. Rete finta, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { vociSupporto, corpoRisposta, testoErroreOperatore, creaSupportoOperatore, MASSIMO_RISPOSTA }
  from "../landing/app/moduli/supporto_operatore.js";
import { CATEGORIE_SCRIVICI } from "../landing/app/moduli/aiuto.js";
import { MAX_RISPOSTA } from "../api/supporto_operatore.js";
import { PERCORSO_CODA, PERCORSO_RISPOSTA } from "../worker/supporto_operatore_api.js";

const ADESSO = new Date("2026-11-17T12:00:00Z");
const A = "11111111-2222-4333-8444-555555555555";
const B = "66666666-7777-4888-9999-000000000000";
const C = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const msg = (id, extra = {}) => ({ id, email: "chi@example.invalid", categoria: "crediti", testo: "Testo di prova",
  creatoIl: "2026-11-17T10:00:00Z", stato: "inviato", sicurezza: false, ...extra });

test("stesso tetto della risposta del server", () => {
  assert.equal(MASSIMO_RISPOSTA, MAX_RISPOSTA);
});

test("voci: categoria leggibile, email, testo, data e tempo che resta alle 48 ore", () => {
  const [v] = vociSupporto([msg(A)], ADESSO);
  assert.equal(v.id, A);
  assert.equal(v.categoria, "Crediti");
  assert.equal(v.email, "chi@example.invalid");
  assert.equal(v.testo, "Testo di prova");
  assert.equal(v.risposto, false);
  assert.equal(v.stato, "Inviato");
  assert.equal(v.resta, "Restano 1 g 22 h");
  assert.equal(v.rossa, false);
  assert.ok(v.quando.length > 0);
});

test("tutte le categorie di «Scrivici» hanno un'etichetta; una sconosciuta diventa «Altro»", () => {
  for (const [codice, etichetta] of CATEGORIE_SCRIVICI) assert.equal(vociSupporto([msg(A, { categoria: codice })], ADESSO)[0].categoria, etichetta);
  assert.equal(vociSupporto([msg(A, { categoria: "boh" })], ADESSO)[0].categoria, "Altro");
});

test("ordine: prima senza risposta, «sicurezza» in cima, poi i più vecchi; le risposte in fondo", () => {
  const voci = vociSupporto([
    msg(A, { stato: "risposto", sicurezza: true, creatoIl: "2026-11-15T10:00:00Z" }),
    msg(B, { creatoIl: "2026-11-16T10:00:00Z" }),
    msg(C, { sicurezza: true, creatoIl: "2026-11-17T11:00:00Z" }),
  ], ADESSO);
  assert.deepEqual(voci.map((v) => v.id), [C, B, A]);
});

test("in rosso: «sicurezza» senza risposta, o meno di 12 ore alla promessa delle 48; mai se già risposto", () => {
  const [s] = vociSupporto([msg(A, { sicurezza: true })], ADESSO);
  assert.equal(s.rossa, true);
  assert.equal(s.avviso, "Parole di pericolo: proponi «Sono in difficoltà» e valuta una segnalazione (#7).");
  const [vicina] = vociSupporto([msg(A, { creatoIl: "2026-11-15T23:00:00Z" })], ADESSO);
  assert.equal(vicina.resta, "Restano 11 h");
  assert.equal(vicina.rossa, true);
  const [scaduta] = vociSupporto([msg(A, { creatoIl: "2026-11-15T10:00:00Z" })], ADESSO);
  assert.equal(scaduta.resta, "Scaduta da 2 h");
  const [fatto] = vociSupporto([msg(A, { stato: "risposto", sicurezza: true, creatoIl: "2026-11-10T10:00:00Z" })], ADESSO);
  assert.equal(fatto.rossa, false);
  assert.equal(fatto.resta, "");
  assert.equal(fatto.stato, "Risposto");
});

test("voci: righe strane ignorate, elenco non valido = vuoto", () => {
  assert.deepEqual(vociSupporto(null, ADESSO), []);
  assert.deepEqual(vociSupporto([null, { id: "x" }, 3], ADESSO), []);
});

test("risposta: vuota o troppo lunga non parte", () => {
  assert.deepEqual(corpoRisposta(A, "  "), { ok: false, motivo: "vuoto" });
  assert.deepEqual(corpoRisposta(A, "x".repeat(MASSIMO_RISPOSTA + 1)), { ok: false, motivo: "lunga" });
  assert.deepEqual(corpoRisposta("non-un-id", "Ciao"), { ok: false, motivo: "dati" });
  assert.deepEqual(corpoRisposta(A, "Ciao"), { ok: true, corpo: { id: A, risposta: "Ciao" } });
});

test("errori in parole semplici", () => {
  assert.equal(testoErroreOperatore("non_autorizzato"), "Questo account non può leggere i messaggi di «Scrivici».");
  assert.equal(testoErroreOperatore("gia_risposto"), "Questo messaggio ha già una risposta.");
  assert.equal(testoErroreOperatore("vuoto"), "Scrivi la risposta prima di inviarla.");
  assert.equal(testoErroreOperatore("lunga"), `La risposta può avere al massimo ${MASSIMO_RISPOSTA} caratteri.`);
  assert.equal(testoErroreOperatore("chissà"), "Qualcosa non ha funzionato. Riprova tra poco.");
});

function reteFinta(risposte) {
  const viste = [];
  const f = async (url, o = {}) => {
    viste.push({ url, metodo: o.method, auth: o.headers && o.headers.authorization, corpo: o.body ? JSON.parse(o.body) : null });
    const r = risposte[url];
    if (r instanceof Error) throw r;
    return Response.json(r.corpo, { status: r.stato || 200 });
  };
  return { f, viste };
}

test("coda: chiede al Worker col token e restituisce i messaggi", async () => {
  const { f, viste } = reteFinta({ [PERCORSO_CODA]: { corpo: { ok: true, messaggi: [msg(A)] } } });
  const p = creaSupportoOperatore({ token: () => "tok", fetch: f });
  const r = await p.coda();
  assert.equal(r.ok, true);
  assert.equal(r.messaggi[0].id, A);
  assert.deepEqual(viste, [{ url: PERCORSO_CODA, metodo: "GET", auth: "Bearer tok", corpo: null }]);
});

test("coda: senza token, non operatore, spento, rete assente", async () => {
  const nessuno = creaSupportoOperatore({ token: () => null, fetch: async () => { throw new Error("non chiamare"); } });
  assert.deepEqual(await nessuno.coda(), { ok: false, motivo: "accesso" });
  const casi = [[{ stato: 403, corpo: { ok: false, motivo: "non_autorizzato" } }, "non_autorizzato"],
    [{ stato: 404, corpo: { ok: false, motivo: "spento" } }, "spento"],
    [{ stato: 401, corpo: { ok: false } }, "accesso"],
    [{ stato: 503, corpo: { ok: false, motivo: "riprova" } }, "riprova"],
    [new Error("offline"), "rete"]];
  for (const [risp, motivo] of casi) {
    const { f } = reteFinta({ [PERCORSO_CODA]: risp });
    assert.deepEqual(await creaSupportoOperatore({ token: () => "tok", fetch: f }).coda(), { ok: false, motivo });
  }
});

test("rispondi: invia id e risposta; «già risposto» e «vuoto» dal server arrivano in chiaro", async () => {
  const { f, viste } = reteFinta({ [PERCORSO_RISPOSTA]: { corpo: { ok: true } } });
  const p = creaSupportoOperatore({ token: () => "tok", fetch: f });
  assert.deepEqual(await p.rispondi(A, "Ciao, ecco come fare."), { ok: true });
  assert.deepEqual(viste[0], { url: PERCORSO_RISPOSTA, metodo: "POST", auth: "Bearer tok", corpo: { id: A, risposta: "Ciao, ecco come fare." } });
  for (const motivo of ["gia_risposto", "vuoto"]) {
    const { f: g } = reteFinta({ [PERCORSO_RISPOSTA]: { corpo: { ok: false, motivo } } });
    assert.deepEqual(await creaSupportoOperatore({ token: () => "tok", fetch: g }).rispondi(A, "Ciao"), { ok: false, motivo });
  }
});

test("rispondi: risposta vuota non chiama la rete", async () => {
  const p = creaSupportoOperatore({ token: () => "tok", fetch: async () => { throw new Error("non chiamare"); } });
  assert.deepEqual(await p.rispondi(A, " "), { ok: false, motivo: "vuoto" });
});
