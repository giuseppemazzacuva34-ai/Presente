// Prova finta dell'app (D141 A, linea «sviluppatore-c»), passo 6: «Il vostro incontro» (#6) con il modulo vero della
// linea B (incontro.js) e un /app/api/incontro finto in prova.js. Niente rete: la fetch finta risponde in memoria.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaProva, PERSONE_PROVA } from "../landing/app/moduli/prova.js";
import { schermataIncontro, orariProposta } from "../landing/app/moduli/incontro.js";

const INIZIO = Date.parse("2026-11-19T18:00:00Z");
async function conPorta(rispostaMs = 0) {
  let ora = INIZIO;
  const p = creaProva({ adesso: () => ora, attesaMs: 0, rispostaMs });
  const leggi = async () => p.telefono.aggiorna(await p.chiamata.stato());
  p.regista.profiloPronto();
  await p.telefono.caricaPersone();
  await p.telefono.chiama(PERSONE_PROVA[0].id);
  ora += 5000; await leggi(); ora += 90000; await leggi();
  await p.telefono.chiudi(false); await new Promise((r) => setTimeout(r, 0)); p.telefono.torna();
  await p.chiaviServer.dai(PERSONE_PROVA[0].id, "");
  p.regista.apriPorte();
  const sera = await p.chiaviServer.sera();
  return { p, porta: sera.porte[0].id, adesso: () => new Date(ora), avanza: (ms) => { ora += ms; } };
}
const attendi = () => new Promise((r) => setTimeout(r, 5));

test("senza porta aperta l'incontro non c'è (404 come il Worker vero)", async () => {
  const p = creaProva({ attesaMs: 0 });
  await p.incontro.apri("00000000-0000-4000-8000-000000000999");
  assert.equal(p.incontro.modello().incontro, null);
  assert.ok(p.incontro.modello().errore);
});

test("porta aperta: da fissare, scadenza 10 giorni, solo «proponi»", async () => {
  const { p, porta, adesso } = await conPorta();
  await p.incontro.apri(porta);
  const i = p.incontro.modello().incontro;
  assert.equal(i.stato, "da_fissare");
  assert.deepEqual(i.azioni, ["proponi"]);
  assert.equal(Date.parse(i.scadenza) - INIZIO - 95000, 10 * 24 * 3600 * 1000);
  assert.equal(schermataIncontro(i, adesso()).tipo, "da_fissare");
});

test("proponi un orario valido: in attesa, poi la persona finta accetta → confermato", async () => {
  const { p, porta, adesso } = await conPorta();
  await p.incontro.apri(porta);
  const orario = orariProposta(p.incontro.modello().incontro.scadenza, adesso())[0].orari[0].valore;
  p.incontro.apriProposta();
  assert.equal(await p.incontro.proponi({ orario, luogo: "Bar della piazza" }), true);
  const dopo = p.incontro.modello().incontro;
  assert.ok(dopo.stato === "proposto" || dopo.stato === "confermato");
  await attendi();
  const i = p.incontro.modello().incontro;
  assert.equal(i.stato, "confermato");
  assert.equal(i.luogo, "Bar della piazza");
  assert.equal(schermataIncontro(i, adesso()).tipo, "confermato");
});

test("orario fuori dalle regole: rifiutato come dal server vero", async () => {
  const { p, porta } = await conPorta();
  await p.incontro.apri(porta);
  p.incontro.apriProposta();
  assert.equal(await p.incontro.proponi({ orario: new Date(INIZIO + 3600 * 1000).toISOString(), luogo: "Bar" }), false);
  assert.equal(p.incontro.modello().incontro.stato, "da_fissare");
});

test("comando «L'altra persona propone»: Accetto, Altra data (3 volte al massimo) e Annulla", async () => {
  const { p, porta, adesso } = await conPorta();
  await p.incontro.apri(porta);
  assert.equal(p.regista.propostaDallAltra(porta), true);
  await p.incontro.riprova();
  let s = schermataIncontro(p.incontro.modello().incontro, adesso());
  assert.equal(s.tipo, "ricevuta");
  assert.deepEqual(s.azioni, ["accetto", "altra_data", "annulla"]);
  assert.equal(await p.incontro.rispondi("accetto"), true);
  assert.equal(p.incontro.modello().incontro.stato, "confermato");
});

test("annulla al secondo tocco: incontro concluso", async () => {
  const { p, porta, adesso } = await conPorta();
  await p.incontro.apri(porta);
  p.regista.propostaDallAltra(porta);
  await p.incontro.riprova();
  assert.equal(await p.incontro.rispondi("annulla"), false, "primo tocco: chiede conferma");
  assert.equal(await p.incontro.rispondi("annulla"), true);
  assert.equal(schermataIncontro(p.incontro.modello().incontro, adesso()).tipo, "concluso");
});

test("nessuna rete: la fetch finta non chiama mai globalThis.fetch", async () => {
  const vera = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("rete vietata nella prova"); };
  try {
    const { p, porta } = await conPorta();
    await p.incontro.apri(porta);
    assert.equal(p.incontro.modello().incontro.stato, "da_fissare");
  } finally { globalThis.fetch = vera; }
});

test("«Propongo un'altra data» consuma una controproposta; finite le 3, restano Accetto e Annulla", async () => {
  const { p, porta, adesso } = await conPorta(60000); // la persona finta non fa in tempo ad accettare
  await p.incontro.apri(porta);
  const orario = () => orariProposta(p.incontro.modello().incontro.scadenza, adesso())[2].orari[0].valore;
  // 3 controproposte «in tutto» (api/incontro.js): contano quelle di tutti e due.
  p.regista.propostaDallAltra(porta); // proposta, non controproposta: 3
  await p.incontro.riprova();
  p.incontro.apriProposta();
  assert.equal(await p.incontro.proponi({ orario: orario(), luogo: "Altro bar" }), true);
  assert.equal(p.incontro.modello().incontro.controproposte_rimaste, 2);
  p.regista.propostaDallAltra(porta); // controproposta della persona finta: 1
  await p.incontro.riprova();
  p.incontro.apriProposta();
  assert.equal(await p.incontro.proponi({ orario: orario(), luogo: "Altro bar" }), true);
  assert.equal(p.incontro.modello().incontro.controproposte_rimaste, 0);
  p.regista.propostaDallAltra(porta);
  await p.incontro.riprova();
  const s = schermataIncontro(p.incontro.modello().incontro, adesso());
  assert.equal(s.tipo, "ricevuta");
  assert.deepEqual(s.azioni, ["accetto", "annulla"]);
});

// ---- Passo 7: «Sono qui» e segnale (stesse risposte di worker/incontro_api.js passi 2g-2h e delle funzioni
// checkin_incontro / stato_incontro del database). incontro.js non ha ancora checkin(): si prova la fetch finta.
const MIN = 60000;
const SEGNALI = ["Peonia", "Primula", "Ninfea", "Genziana", "Mandorlo", "Zinnia"];
async function confermato(rispostaMs = 0) {
  const c = await conPorta(rispostaMs);
  await c.p.incontro.apri(c.porta);
  c.p.regista.propostaDallAltra(c.porta);
  await c.p.incontro.riprova();
  await c.p.incontro.rispondi("accetto");
  const api = (corpo) => c.p.incontroApi("/app/api/incontro", { method: "POST", body: JSON.stringify({ porta: c.porta, ...corpo }) })
    .then((r) => r.json());
  const stato = async () => { await c.p.incontro.riprova(); return c.p.incontro.modello().incontro; };
  return { ...c, api, stato };
}

test("incontro confermato: finestra del check-in da 30 minuti prima a 30 dopo, nessun segnale, ancora niente «sono_qui»", async () => {
  const { stato } = await confermato();
  const i = await stato();
  assert.equal(i.stato, "confermato");
  assert.equal(i.checkin_mio, false);
  assert.equal(i.checkin_altro, false);
  assert.equal(Date.parse(i.checkin_da), Date.parse(i.orario) - 30 * MIN);
  assert.equal(Date.parse(i.checkin_fino), Date.parse(i.orario) + 30 * MIN);
  assert.equal(i.segnale, null);
  assert.deepEqual(i.azioni, []);
});

test("«Sono qui» prima della finestra → troppo_presto; prima della conferma → non_confermato", async () => {
  const { api } = await confermato();
  assert.deepEqual(await api({ azione: "checkin" }), { ok: false, motivo: "troppo_presto" });
  const c = await conPorta();
  await c.p.incontro.apri(c.porta);
  const r = await c.p.incontroApi("/app/api/incontro", { method: "POST", body: JSON.stringify({ porta: c.porta, azione: "checkin" }) });
  assert.deepEqual(await r.json(), { ok: false, motivo: "non_confermato" });
});

test("comando «È l'ora dell'incontro»: si apre la finestra e compare «sono_qui»", async () => {
  const { p, porta, stato, adesso } = await confermato();
  assert.equal(p.regista.oraDellIncontro(porta), true);
  const i = await stato();
  assert.ok(Date.parse(i.checkin_da) <= adesso().getTime() && adesso().getTime() < Date.parse(i.checkin_fino));
  assert.deepEqual(i.azioni, ["sono_qui"]);
});

test("«Sono qui»: prima si aspetta l'altra persona, poi arriva il segnale uguale per tutti e due", async () => {
  const { p, porta, api, stato } = await confermato(0);
  p.regista.oraDellIncontro(porta);
  assert.deepEqual(await api({ azione: "checkin" }), { ok: true, esito: "sono_qui" });
  await attendi();
  const i = await stato();
  assert.equal(i.stato, "concluso");
  assert.equal(i.esito, "avvenuto");
  assert.equal(i.checkin_mio, true);
  assert.equal(i.checkin_altro, true);
  assert.ok(SEGNALI.includes(i.segnale), i.segnale);
  assert.deepEqual(i.azioni, []);
  assert.deepEqual(await api({ azione: "checkin" }), { ok: true, esito: "avvenuto" });
});

test("prima che arrivi l'altra persona: checkin_mio sì, checkin_altro no, segnale nascosto", async () => {
  const { p, porta, api, stato } = await confermato(60000);
  p.regista.oraDellIncontro(porta);
  assert.deepEqual(await api({ azione: "checkin" }), { ok: true, esito: "sono_qui" });
  assert.deepEqual(await api({ azione: "checkin" }), { ok: false, motivo: "gia_fatto" });
  const i = await stato();
  assert.equal(i.stato, "confermato");
  assert.equal(i.checkin_mio, true);
  assert.equal(i.checkin_altro, false);
  assert.equal(i.segnale, null);
  assert.deepEqual(i.azioni, []);
});

test("finestra passata → troppo_tardi; incontro annullato → incontro_chiuso", async () => {
  const { p, porta, api, avanza } = await confermato();
  p.regista.oraDellIncontro(porta);
  avanza(60 * MIN);
  assert.deepEqual(await api({ azione: "checkin" }), { ok: false, motivo: "troppo_tardi" });
  const c = await conPorta();
  await c.p.incontro.apri(c.porta);
  c.p.regista.propostaDallAltra(c.porta);
  await c.p.incontro.riprova();
  await c.p.incontro.rispondi("annulla"); await c.p.incontro.rispondi("annulla");
  const r = await c.p.incontroApi("/app/api/incontro", { method: "POST", body: JSON.stringify({ porta: c.porta, azione: "checkin" }) });
  assert.deepEqual(await r.json(), { ok: false, motivo: "incontro_chiuso" });
});
