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
