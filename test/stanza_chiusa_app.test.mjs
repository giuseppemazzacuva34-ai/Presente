// Stanza chiusa in sola lettura (issue #5 spec v1.1 passo 9) e telefono.ricaricaPersone() (richiesta di «sviluppatore-b»).
// Dalla domenica alle 21:00 a lunedì alle 9:00 la stanza è «Chiusa»: le schede restano, senza Chiama né Chiave.
// Tutto finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaCompagni } from "../landing/app/moduli/compagni.js";
import { creaTelefono } from "../landing/app/moduli/telefono.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const RIGA = { utente_id: ID1, nome: "Giulia", eta: 34, citta: "Torino" };

function supabase(risposte) {
  const percorsi = [];
  const f = async (url) => {
    const p = new URL(url).pathname;
    percorsi.push(p);
    const [stato, dati] = risposte[p] || [404, {}];
    return new Response(JSON.stringify(dati), { status: stato });
  };
  return { f, percorsi };
}
const compagni = (f) => creaCompagni({ supabaseUrl: BASE, supabaseAnonKey: "anon", token: async () => "tok", fetch: f });
const APERTA = "/rest/v1/rpc/compagni_di_stanza";
const CHIUSA = "/rest/v1/rpc/compagni_stanza_chiusa";

test("compagni: stanza aperta → una sola lettura, niente «chiusa»", async () => {
  const s = supabase({ [APERTA]: [200, [RIGA]], [CHIUSA]: [200, []] });
  const r = await compagni(s.f).leggi();
  assert.deepEqual(r, { ok: true, persone: [{ id: ID1, nome: "Giulia", eta: 34, citta: "Torino" }] });
  assert.deepEqual(s.percorsi, [APERTA]);
});

test("compagni: nessuna stanza aperta → si legge la stanza appena chiusa, in sola lettura", async () => {
  const s = supabase({ [APERTA]: [200, []], [CHIUSA]: [200, [RIGA, { ...RIGA, email: "x@y.z" }]] });
  const r = await compagni(s.f).leggi();
  assert.deepEqual(r, { ok: true, chiusa: true, persone: [{ id: ID1, nome: "Giulia", eta: 34, citta: "Torino" }] });
  assert.deepEqual(s.percorsi, [APERTA, CHIUSA]);
  assert.ok(!JSON.stringify(r).includes("email"));
});

test("compagni: nessuna stanza né aperta né chiusa, o lettura della chiusa che non riesce → stanza vuota", async () => {
  assert.deepEqual(await compagni(supabase({ [APERTA]: [200, []], [CHIUSA]: [200, []] }).f).leggi(), { ok: true, persone: [] });
  assert.deepEqual(await compagni(supabase({ [APERTA]: [200, []], [CHIUSA]: [500, {}] }).f).leggi(), { ok: true, persone: [] });
});

function telefono(letture) {
  const fatti = [];
  const coda = [...letture];
  const t = creaTelefono({
    compagni: { leggi: async () => { fatti.push("compagni"); return coda.length > 1 ? coda.shift() : coda[0]; } },
    linea: { chiama: async (id) => { fatti.push(`chiama:${id}`); return { ok: true, vista: { fase: "squilla", io: "chiama", altra: id, squillo: 30 } }; } },
    chiamata: { pulsanti: async () => { fatti.push("pulsanti"); return { ok: true, pulsanti: [] }; } },
    voce: { muto: () => {}, chiudi: () => {} },
    cambiato: () => fatti.push("disegna"),
  });
  return { t, fatti };
}
const PERSONE = [{ id: ID1, nome: "Giulia", eta: 34, citta: "Torino" }, { id: ID2, nome: "Marco", eta: 38, citta: "Asti" }];

test("telefono: stanza chiusa → schede senza Chiama, niente testi dei pulsanti, il tocco non chiama", async () => {
  const { t, fatti } = telefono([{ ok: true, chiusa: true, persone: PERSONE }]);
  await t.caricaPersone();
  const st = t.modello().stanza;
  assert.equal(st.stato, "pronta");
  assert.equal(st.chiusa, true);
  assert.equal(st.persone.length, 2);
  assert.ok(st.persone.every((p) => p.chiama === false && p.etichetta === ""));
  assert.equal(st.persone[0].titolo, "Giulia, 34");
  assert.ok(!fatti.includes("pulsanti"));
  await t.chiama(ID1);
  assert.ok(!fatti.includes(`chiama:${ID1}`));
});

test("telefono: stanza aperta → chiusa false, Chiama come prima", async () => {
  const { t } = telefono([{ ok: true, persone: PERSONE }]);
  await t.caricaPersone();
  const st = t.modello().stanza;
  assert.equal(st.chiusa, false);
  assert.ok(st.persone.every((p) => p.chiama === true && p.etichetta === "Chiama"));
});

test("ricaricaPersone: rilegge la stanza anche se era già pronta (dopo un blocco, alle 21:00, lunedì alle 9:00)", async () => {
  const { t, fatti } = telefono([{ ok: true, persone: PERSONE }, { ok: true, chiusa: true, persone: [PERSONE[1]] }]);
  await t.caricaPersone();
  await t.caricaPersone(); // già pronta: nessuna nuova lettura
  assert.equal(fatti.filter((x) => x === "compagni").length, 1);
  await t.ricaricaPersone();
  assert.equal(fatti.filter((x) => x === "compagni").length, 2);
  const st = t.modello().stanza;
  assert.equal(st.chiusa, true);
  assert.deepEqual(st.persone.map((p) => p.id), [ID2]);
});

test("ricaricaPersone: se la rilettura non riesce restano le persone di prima", async () => {
  const { t } = telefono([{ ok: true, persone: PERSONE }, { ok: false, motivo: "rete" }]);
  await t.caricaPersone();
  await t.ricaricaPersone();
  const st = t.modello().stanza;
  assert.equal(st.stato, "pronta");
  assert.equal(st.persone.length, 2);
});

test("ricaricaPersone: due tocchi insieme fanno una sola lettura", async () => {
  const { t, fatti } = telefono([{ ok: true, persone: PERSONE }]);
  await t.caricaPersone();
  await Promise.all([t.ricaricaPersone(), t.ricaricaPersone()]);
  assert.equal(fatti.filter((x) => x === "compagni").length, 2);
});

import { readFileSync } from "node:fs";
const leggiFile = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("flusso: stanza chiusa → titolo «Chiusa», schede senza Chiama né Chiave, appunti e ⋯ restano", () => {
  const flusso = leggiFile("../landing/app/moduli/flusso.js");
  const blocco = flusso.slice(flusso.indexOf("function bloccoTuaStanza"), flusso.indexOf("function schermoChiamata"));
  const chiusa = blocco.slice(blocco.indexOf('st.stato === "pronta" && st.chiusa) {'), blocco.indexOf('} else if (st.stato === "pronta") {'));
  assert.ok(chiusa.length > 0, "c'è un ramo per la stanza chiusa");
  assert.doesNotMatch(chiusa, /telefono\.chiama|vistaSchedaChiave|"button"/);
  assert.match(chiusa, /menuDellaScheda\(p\)/);
  assert.match(chiusa, /vistaAppunti\(/);
  // Design v4 (schermata 19): «· Chiusa» lo scrive la testata (testata_stanza.js, provata in stanza_testata_v4).
  assert.match(blocco, /vistaTestataStanza\(h, testataStanza\(st\.info, new Date\(\)\), \{ chiusa: st\.chiusa \}\)/);
  assert.match(blocco, /st\.stato === "pronta" && !st\.chiusa \? \(chiaviSulGruppo \? vistaContoChiavi\(\) : vistaChiavi/);
  assert.match(blocco, /telefono\.ricaricaPersone\(\)/);
});

test("service worker: versione nuova dopo la stanza chiusa", () => {
  assert.ok(!leggiFile("../landing/app/sw.js").includes('"presente-app-26"'));
});
