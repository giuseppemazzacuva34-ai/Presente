// Dopo la chiamata nella web app (issue #4, spec v1.3 § 3, passo 3c-4b-2): richieste /dopo e /richiameresti dal
// telefono, schermata «La richiameresti?», testo «durata poco», «Segnala un problema» e «Torna alla stanza».
// Tutto finto: nessuna rete, nessun microfono.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaChiamata, schermataDopo } from "../landing/app/moduli/chiamata.js";
import { creaTelefono } from "../landing/app/moduli/telefono.js";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const INIZIO = "2026-11-13T20:00:00.000Z";
const PERSONE = [{ id: ID1, nome: "Giulia", eta: 34, citta: "Torino" }];
const DOPO_SI = { tipo: "richiameresti", passi: ["richiameresti", "diario", "fine"], testo: null, altra: ID1, chiamata: { chi: ID2, inizio: INIZIO } };
const DOPO_BREVE = { tipo: "breve", passi: ["fine"], testo: "La chiamata è durata poco e non conta nei limiti.", altra: ID1, chiamata: null };

function finto(risposte) {
  const chiamate = [];
  const f = async (url, init) => {
    chiamate.push({ url, init, corpo: init.body ? JSON.parse(init.body) : null });
    const r = risposte.shift();
    return { status: 200, ok: true, json: async () => r };
  };
  return { f, chiamate };
}

test("chiamata.dopo: POST /app/api/chiamata/dopo con «appena» e restituisce solo «dopo»", async () => {
  const { f, chiamate } = finto([{ ok: true, dopo: DOPO_SI, altro: "x" }, { ok: true, dopo: null }]);
  const c = creaChiamata({ token: () => "t".repeat(30), fetch: f });
  const r = await c.dopo(true);
  assert.deepEqual(r, { ok: true, dopo: DOPO_SI });
  assert.equal(chiamate[0].url, "/app/api/chiamata/dopo");
  assert.deepEqual(chiamate[0].corpo, { appena: true });
  assert.deepEqual(await c.dopo(), { ok: true, dopo: null });
  assert.deepEqual(chiamate[1].corpo, { appena: false });
});

test("chiamata.richiameresti: manda solo chi, inizio e risposta; risposte sbagliate non partono", async () => {
  const { f, chiamate } = finto([{ ok: true, salvata: true }]);
  const c = creaChiamata({ token: () => "t".repeat(30), fetch: f });
  assert.deepEqual(await c.richiameresti({ chi: ID2, inizio: INIZIO }, "si"), { ok: true, salvata: true });
  assert.equal(chiamate[0].url, "/app/api/chiamata/richiameresti");
  assert.deepEqual(chiamate[0].corpo, { chi: ID2, inizio: INIZIO, risposta: "si" });
  assert.deepEqual(await c.richiameresti({ chi: ID2, inizio: INIZIO }, "forse"), { ok: false, motivo: "dati" });
  assert.deepEqual(await c.richiameresti(null, "no"), { ok: false, motivo: "dati" });
  assert.equal(chiamate.length, 1);
});

test("schermataDopo: «La richiameresti?» con Sì/No/Salta, nota segreta col nome, Segnala in fondo", () => {
  const s = schermataDopo(DOPO_SI, { nomeAltra: "Giulia" });
  assert.equal(s.tipo, "richiameresti");
  assert.equal(s.titolo, "La richiameresti?");
  assert.equal(s.nota, "Resta tra te e Presente. Giulia non lo saprà mai.");
  assert.deepEqual(s.risposte, [["si", "Sì"], ["no", "No"], ["salta", "Salta"]]);
  assert.deepEqual(s.pulsanti, ["segnala_problema"]);
  assert.equal(schermataDopo(DOPO_SI).nota, "Resta tra te e Presente. L'altra persona non lo saprà mai.");
});

test("schermataDopo: sotto i 60 s solo il testo, «Segnala un problema» e «Torna alla stanza»; niente domanda", () => {
  const s = schermataDopo(DOPO_BREVE, { nomeAltra: "Giulia" });
  assert.equal(s.tipo, "dopo_fine");
  assert.equal(s.titolo, "Chiamata finita");
  assert.equal(s.testo, "La chiamata è durata poco e non conta nei limiti.");
  assert.deepEqual(s.pulsanti, ["segnala_problema", "torna"]);
  assert.equal(s.risposte, undefined);
  // caduta lunga: nessun testo (sarebbe falso)
  assert.equal(schermataDopo({ ...DOPO_BREVE, testo: null }).testo, null);
  // dopo la risposta: si passa alla fine
  assert.deepEqual(schermataDopo(DOPO_SI, { risposto: true }).pulsanti, ["segnala_problema", "torna"]);
  assert.equal(schermataDopo(null).tipo, "nessuna");
});

function ambiente({ dopo = async () => ({ ok: true, dopo: DOPO_SI }), richiameresti = async () => ({ ok: true, salvata: true }) } = {}) {
  const fatti = [];
  const t = creaTelefono({
    compagni: { leggi: async () => ({ ok: true, persone: PERSONE }) },
    linea: {
      chiama: async (id) => ({ ok: true, vista: { fase: "squilla", io: "chiama", altra: id, squillo: 30 } }),
      chiudi: async (s) => { fatti.push(`chiudi:${s}`); return { ok: true, vista: { fase: "finita", altra: ID1 } }; },
    },
    chiamata: {
      dopo: async (appena) => { fatti.push(`dopo:${appena === true}`); return dopo(appena); },
      richiameresti: async (c, r) => { fatti.push(`richiameresti:${r}:${c && c.inizio}`); return richiameresti(c, r); },
      rifiuta: async () => ({ ok: true, vista: null }), carta: async () => ({ ok: true, vista: null }), caduta: async () => ({ ok: true, vista: null }),
    },
    voce: { muto: () => {}, chiudi: () => fatti.push("voce-chiusa") },
    subito: () => {}, cambiato: () => {},
  });
  return { t, fatti };
}
const aspetta = () => new Promise((r) => setTimeout(r, 0));
const IN_CORSO = { fase: "in_corso", io: "chiama", altra: ID1, restanti: 500, ascolto: "fatto", altraPersona: "collegata" };

test("telefono: a fine chiamata chiede «dopo» una volta e mostra «La richiameresti?»; poi Segnala e Torna", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  a.t.aggiorna({ ok: true, vista: IN_CORSO });
  a.t.aggiorna({ ok: true, vista: { fase: "finita", altra: ID1 } });
  a.t.aggiorna({ ok: true, vista: { fase: "finita", altra: ID1 } });
  await aspetta();
  assert.deepEqual(a.fatti.filter((x) => x.startsWith("dopo")), ["dopo:true"]);
  let sc = a.t.modello().schermo;
  assert.equal(sc.tipo, "richiameresti");
  assert.equal(sc.nota, "Resta tra te e Presente. Giulia non lo saprà mai.");
  await a.t.richiameresti("si");
  assert.ok(a.fatti.includes(`richiameresti:si:${INIZIO}`));
  sc = a.t.modello().schermo;
  assert.equal(sc.tipo, "dopo_fine");
  assert.deepEqual(sc.pulsanti, ["segnala_problema", "torna"]);
  a.t.torna();
  assert.equal(a.t.modello().schermo.tipo, "nessuna");
});

test("telefono: se il salvataggio non va resta la domanda con l'errore; «Salta» non obbliga a rispondere", async () => {
  let va = false;
  const a = ambiente({ richiameresti: async () => (va ? { ok: true, salvata: true } : { ok: false, motivo: "riprova" }) });
  await a.t.caricaPersone();
  a.t.aggiorna({ ok: true, vista: IN_CORSO });
  a.t.aggiorna({ ok: true, vista: { fase: "finita", altra: ID1 } });
  await aspetta();
  await a.t.richiameresti("no");
  assert.equal(a.t.modello().schermo.tipo, "richiameresti");
  assert.ok(a.t.modello().errore);
  va = true;
  await a.t.richiameresti("salta");
  assert.equal(a.t.modello().schermo.tipo, "dopo_fine");
  assert.equal(a.t.modello().errore, "");
});

test("telefono: chiamata sotto i 60 s → testo «durata poco», nessuna domanda", async () => {
  const a = ambiente({ dopo: async () => ({ ok: true, dopo: DOPO_BREVE }) });
  await a.t.caricaPersone();
  a.t.aggiorna({ ok: true, vista: IN_CORSO });
  a.t.aggiorna({ ok: true, vista: { fase: "finita", altra: ID1 } });
  await aspetta();
  const sc = a.t.modello().schermo;
  assert.equal(sc.tipo, "dopo_fine");
  assert.equal(sc.testo, "La chiamata è durata poco e non conta nei limiti.");
  await a.t.richiameresti("si");
  assert.ok(!a.fatti.some((x) => x.startsWith("richiameresti")));
});

test("telefono: server senza risposta per «dopo» → resta «Chiamata finita» con «Torna alla stanza»", async () => {
  const a = ambiente({ dopo: async () => ({ ok: false, motivo: "riprova" }) });
  await a.t.caricaPersone();
  a.t.aggiorna({ ok: true, vista: IN_CORSO });
  a.t.aggiorna({ ok: true, vista: { fase: "finita", altra: ID1 } });
  await aspetta();
  assert.equal(a.t.modello().schermo.tipo, "finita");
});

test("telefono: «Chiudi e segnala» apre subito il modulo con la persona collegata, senza domanda", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  a.t.aggiorna({ ok: true, vista: IN_CORSO });
  await a.t.chiudi(true);
  await aspetta();
  assert.ok(!a.fatti.some((x) => x.startsWith("dopo")));
  const m = a.t.modello();
  assert.equal(m.schermo.tipo, "segnala");
  assert.deepEqual(m.segnala, { contro: ID1, origine: "chiudi_e_segnala", chiamataIl: null });
  a.t.torna();
  assert.equal(a.t.modello().schermo.tipo, "nessuna");
  assert.equal(a.t.modello().segnala, null);
});

test("telefono: «Segnala un problema» dopo la chiamata collega persona e chiamata", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  a.t.aggiorna({ ok: true, vista: IN_CORSO });
  a.t.aggiorna({ ok: true, vista: { fase: "finita", altra: ID1 } });
  await aspetta();
  a.t.segnalaProblema();
  const m = a.t.modello();
  assert.equal(m.schermo.tipo, "segnala");
  assert.deepEqual(m.segnala, { contro: ID1, origine: "dopo_chiamata", chiamataIl: INIZIO });
});

test("telefono: al rientro nell'app la domanda rimasta in sospeso ricompare (una sola richiesta)", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  a.t.aggiorna({ ok: true, vista: null });
  a.t.aggiorna({ ok: true, vista: null });
  await aspetta();
  assert.deepEqual(a.fatti.filter((x) => x.startsWith("dopo")), ["dopo:false"]);
  assert.equal(a.t.modello().schermo.tipo, "richiameresti");
  assert.equal(a.t.modello().nome, "Giulia");
});

test("telefono: al rientro senza domande in sospeso non appare nulla", async () => {
  const a = ambiente({ dopo: async () => ({ ok: true, dopo: null }) });
  await a.t.caricaPersone();
  a.t.aggiorna({ ok: true, vista: null });
  await aspetta();
  assert.equal(a.t.modello().schermo.tipo, "nessuna");
});
