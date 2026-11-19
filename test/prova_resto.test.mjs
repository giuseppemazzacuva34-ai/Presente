// Prova finta dell'app (D141 A, linea «sviluppatore-c»), passo 5: segnala e blocca (#7), «Le tue chiamate», esiti e
// sanzioni, «I tuoi appunti» (#5) e Aiuto (#10) con i moduli veri e il «server finto» di prova.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaProva, PERSONE_PROVA } from "../landing/app/moduli/prova.js";

const INIZIO = Date.parse("2026-11-19T18:00:00Z");
async function conChiamata() {
  let ora = INIZIO;
  const p = creaProva({ adesso: () => ora, attesaMs: 0 });
  const leggi = async () => p.telefono.aggiorna(await p.chiamata.stato());
  p.regista.profiloPronto();
  await p.telefono.caricaPersone();
  await p.telefono.chiama(PERSONE_PROVA[2].id);
  ora += 5000; await leggi(); ora += 120000; await leggi();
  await p.telefono.chiudi(false); await new Promise((r) => setTimeout(r, 0));
  await p.telefono.richiameresti("si");
  await p.telefono.salvaDiario("Ride come mia sorella.");
  p.telefono.torna();
  return p;
}

test("segnala: ore di priorità come il server, pericolo solo per minacce", async () => {
  const p = creaProva({ attesaMs: 0 });
  assert.deepEqual(await p.segnala.invia({ contro: PERSONE_PROVA[0].id, motivo: "insulti", origine: "scheda", testo: "" }), { ok: true, ore: 24, pericolo: false });
  assert.deepEqual(await p.segnala.invia({ contro: PERSONE_PROVA[0].id, motivo: "minacce_pericolo", origine: "scheda", testo: "" }), { ok: true, ore: 1, pericolo: true });
  assert.deepEqual(await p.segnala.invia({ motivo: "sono_in_difficolta", origine: "menu", testo: "" }), { ok: true, ore: 1, pericolo: true });
});

test("blocca: la persona sparisce dalla stanza alla rilettura", async () => {
  const p = creaProva({ attesaMs: 0 });
  p.regista.profiloPronto();
  assert.deepEqual(await p.blocca.blocca(PERSONE_PROVA[5].id), { ok: true });
  const r = await p.compagniServer.leggi();
  assert.equal(r.persone.length, 10);
  assert.equal(r.persone.some((x) => x.id === PERSONE_PROVA[5].id), false);
});

test("«Le tue chiamate»: le chiamate fatte nella prova, con nome e durata", async () => {
  const p = await conChiamata();
  const r = await p.storico.leggi();
  assert.equal(r.ok, true);
  assert.equal(r.chiamate.length, 1);
  assert.equal(r.chiamate[0].nome, PERSONE_PROVA[2].nome);
  assert.equal(r.chiamate[0].durata, "2 min");
});

test("«I tuoi appunti»: la nota del diario si rilegge, si modifica e si cancella", async () => {
  const p = await conChiamata();
  const id = PERSONE_PROVA[2].id;
  p.appunti.prepara([id]);
  await new Promise((r) => setTimeout(r, 0));
  let a = p.appunti.di(id);
  assert.equal(a.length, 1);
  assert.equal(a[0].testo, "Ride come mia sorella.");
  assert.deepEqual(await p.diarioServer.modifica(a[0].chiamataIl, "Ride forte."), { ok: true });
  assert.equal((await p.diarioServer.appuntiDi([id])).perPersona[id][0].testo, "Ride forte.");
  assert.deepEqual(await p.diarioServer.cancella(a[0].chiamataIl), { ok: true });
  assert.deepEqual((await p.diarioServer.appuntiDi([id])).perPersona, {});
});

test("esiti e sanzioni: nessuno nella prova", async () => {
  const p = creaProva({ attesaMs: 0 });
  assert.deepEqual(await p.esiti.leggi(), { ok: true, esiti: [] });
  assert.deepEqual(await p.sanzioni.leggi(), { ok: true, sanzioni: [] });
});

test("Aiuto: «Scrivici» salva in memoria e «I miei messaggi» lo mostra; parole di pericolo → sicurezza", async () => {
  const p = creaProva({ attesaMs: 0 });
  const r = await p.aiuto.invia({ categoria: "altro", testo: "Come cambio la foto?" });
  assert.equal(r.ok, true);
  assert.equal(r.sicurezza, false);
  assert.equal((await p.aiuto.invia({ categoria: "altro", testo: "Ho paura di una persona" })).sicurezza, true);
  const m = await p.aiuto.miei();
  assert.equal(m.ok, true);
  assert.equal(m.messaggi.length, 2);
  assert.equal(m.messaggi[0].stato, "inviato");
});
