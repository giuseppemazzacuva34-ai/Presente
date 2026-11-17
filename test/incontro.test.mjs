// Dopo il doppio sì (issue #6, spec v1 del CPO del 3/11): regole dell'incontro calcolate dal server.
// Solo dati inventati, nessun dato vero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INCONTRO, scadenzaIncontro, controllaOrario, risposteProposta } from "../api/incontro.js";
import { oraDiRoma } from "../api/stanze.js";

const DOPPIO_SI = oraDiRoma(2026, 11, 17, 20, 15); // martedì 20:15 di Roma

test("costanti della spec: 10 o 30 giorni, 10:00–23:00 ogni 30 minuti, 3 controproposte, 48 ore", () => {
  assert.equal(INCONTRO.giorniStessaArea, 10);
  assert.equal(INCONTRO.giorniAreeDiverse, 30);
  assert.equal(INCONTRO.primaOra, 10);
  assert.equal(INCONTRO.ultimaOra, 23);
  assert.equal(INCONTRO.passoMinuti, 30);
  assert.equal(INCONTRO.controproposte, 3);
  assert.equal(INCONTRO.propostaOre, 48);
});

test("scadenza: doppio sì + 10 giorni nella stessa provincia, + 30 tra province diverse", () => {
  assert.equal(scadenzaIncontro(DOPPIO_SI, true).getTime(), oraDiRoma(2026, 11, 27, 20, 15).getTime());
  assert.equal(scadenzaIncontro(DOPPIO_SI, false).getTime(), oraDiRoma(2026, 12, 17, 20, 15).getTime());
});

test("scadenza a cavallo del cambio d'ora: resta la stessa ora di Roma", () => {
  const si = oraDiRoma(2026, 10, 20, 21);
  assert.equal(scadenzaIncontro(si, true).getTime(), oraDiRoma(2026, 10, 30, 21).getTime());
  assert.equal(scadenzaIncontro(si, false).getTime(), oraDiRoma(2026, 11, 19, 21).getTime());
});

const prova = (orario, extra = {}) =>
  controllaOrario({ orario, adesso: DOPPIO_SI, scadenza: scadenzaIncontro(DOPPIO_SI, true), ...extra });

test("orario valido: da domani alle 10:00, ogni 30 minuti, fino alle 23:00", () => {
  assert.deepEqual(prova(oraDiRoma(2026, 11, 18, 10)), { ok: true });
  assert.deepEqual(prova(oraDiRoma(2026, 11, 20, 19, 30)), { ok: true });
  assert.deepEqual(prova(oraDiRoma(2026, 11, 20, 23)), { ok: true });
});

test("orario rifiutato: oggi, prima delle 10, dopo le 23, non sul mezz'ora, dopo la scadenza", () => {
  assert.equal(prova(oraDiRoma(2026, 11, 17, 22)).motivo, "prima_di_domani");
  assert.equal(prova(oraDiRoma(2026, 11, 19, 9, 30)).motivo, "fuori_orario");
  assert.equal(prova(oraDiRoma(2026, 11, 18, 23, 30)).motivo, "fuori_orario");
  assert.equal(prova(oraDiRoma(2026, 11, 18, 18, 10)).motivo, "non_sul_passo");
  assert.equal(prova(new Date(oraDiRoma(2026, 11, 18, 18).getTime() + 1000)).motivo, "non_sul_passo");
  assert.equal(prova(oraDiRoma(2026, 11, 27, 20, 30)).motivo, "dopo_la_scadenza");
  assert.equal(prova("non è una data").motivo, "orario_non_valido");
});

test("risposte alla proposta: «Propongo un'altra data» sparisce dopo la terza controproposta", () => {
  assert.deepEqual(risposteProposta(0), ["accetto", "altra_data", "annulla"]);
  assert.deepEqual(risposteProposta(2), ["accetto", "altra_data", "annulla"]);
  assert.deepEqual(risposteProposta(3), ["accetto", "annulla"]);
});

// ── Passo 1b: disdetta, check-in «Sono qui», esito e buca (D12 A: 7 a chi ha aspettato, 3 a Presente). ──
import { disdetta, finestraCheckin, puoCheckin, esitoIncontro, ritardo } from "../api/incontro.js";

const ORA_INCONTRO = oraDiRoma(2026, 11, 20, 20); // venerdì 20:00
const min = (n) => n * 60000;
const alle = (ms) => new Date(ORA_INCONTRO.getTime() + ms);

test("disdetta a 6 h 01 min: gratis, crediti restituiti a entrambi", () => {
  const r = disdetta({ orario: ORA_INCONTRO, adesso: alle(-min(361)), chi: "a", a: "a", b: "b" });
  assert.equal(r.esito, "disdetto");
  assert.deepEqual(r.restituisci, ["a", "b"]);
  assert.equal(r.penale, 0);
});

test("disdetta a 5 h 59 min: è una buca di chi disdice", () => {
  const r = disdetta({ orario: ORA_INCONTRO, adesso: alle(-min(359)), chi: "a", a: "a", b: "b" });
  assert.equal(r.esito, "buca_a");
});

test("disdetta nelle ultime 6 ore con «Sono in difficoltà»: nessuna penale, revisione umana", () => {
  const r = disdetta({ orario: ORA_INCONTRO, adesso: alle(-min(30)), chi: "b", a: "a", b: "b", difficolta: true });
  assert.equal(r.esito, "in_revisione");
  assert.equal(r.penale, 0);
});

test("«Sono qui» solo da 30 minuti prima a 30 minuti dopo l'ora", () => {
  const f = finestraCheckin({ orario: ORA_INCONTRO });
  assert.equal(f.da.getTime(), alle(-min(30)).getTime());
  assert.equal(f.a.getTime(), alle(min(30)).getTime());
  assert.equal(puoCheckin({ orario: ORA_INCONTRO, adesso: alle(-min(31)) }).motivo, "troppo_presto");
  assert.equal(puoCheckin({ orario: ORA_INCONTRO, adesso: alle(-min(30)) }).ok, true);
  assert.equal(puoCheckin({ orario: ORA_INCONTRO, adesso: alle(min(29)) }).ok, true);
  assert.equal(puoCheckin({ orario: ORA_INCONTRO, adesso: alle(min(30)) }).motivo, "troppo_tardi");
});

test("«Arrivo in ritardo» (+15 o +30) sposta la fine della finestra, una volta sola", () => {
  assert.deepEqual(ritardo({ minuti: 15, giaUsato: false }), { ok: true, minuti: 15 });
  assert.equal(ritardo({ minuti: 20, giaUsato: false }).motivo, "ritardo_non_valido");
  assert.equal(ritardo({ minuti: 30, giaUsato: true }).motivo, "ritardo_gia_usato");
  const f = finestraCheckin({ orario: ORA_INCONTRO, ritardoMinuti: 30 });
  assert.equal(f.a.getTime(), alle(min(60)).getTime());
  assert.equal(puoCheckin({ orario: ORA_INCONTRO, ritardoMinuti: 30, adesso: alle(min(45)) }).ok, true);
});

const somma = (movimenti) => movimenti.reduce((s, m) => s + m.crediti, 0);

test("check-in di entrambi: incontro avvenuto, caparre sbloccate subito, valutazione aperta", () => {
  const r = esitoIncontro({ orario: ORA_INCONTRO, checkin: { a: alle(-min(5)), b: alle(min(2)) }, adesso: alle(min(2)), a: "a", b: "b" });
  assert.equal(r.esito, "avvenuto");
  assert.deepEqual(r.movimenti, [
    { persona: "a", tipo: "caparra_restituita", crediti: 10 },
    { persona: "b", tipo: "caparra_restituita", crediti: 10 },
  ]);
  assert.equal(r.valutazione, true);
});

test("buca: check-in di A, niente da B a +30 min → B −10, A +7, Presente +3, e la somma torna", () => {
  const prima = esitoIncontro({ orario: ORA_INCONTRO, checkin: { a: alle(0), b: null }, adesso: alle(min(29)), a: "a", b: "b" });
  assert.equal(prima.esito, "in_corso");
  const r = esitoIncontro({ orario: ORA_INCONTRO, checkin: { a: alle(0), b: null }, adesso: alle(min(30)), a: "a", b: "b" });
  assert.equal(r.esito, "buca_b");
  assert.deepEqual(r.movimenti, [
    { persona: "a", tipo: "caparra_restituita", crediti: 10 },
    { persona: "a", tipo: "buca_ricevuta", crediti: 7 },
  ]);
  assert.equal(r.presente, 3);
  assert.equal(somma(r.movimenti) + r.presente, 20); // le due caparre bloccate, né un credito in più né uno in meno
  assert.equal(r.valutazione, false);
});

test("nessuno dei due fa il check-in: crediti a entrambi, niente valutazione", () => {
  const r = esitoIncontro({ orario: ORA_INCONTRO, checkin: { a: null, b: null }, adesso: alle(min(30)), a: "a", b: "b" });
  assert.equal(r.esito, "nessun_checkin");
  assert.equal(somma(r.movimenti), 20);
  assert.equal(r.presente, 0);
  assert.equal(r.valutazione, false);
});

test("buca con ritardo dichiarato: si aspetta la fine della finestra spostata", () => {
  const r = esitoIncontro({ orario: ORA_INCONTRO, ritardoMinuti: 15, checkin: { a: alle(0), b: null }, adesso: alle(min(40)), a: "a", b: "b" });
  assert.equal(r.esito, "in_corso");
});
