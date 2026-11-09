// Test delle regole di segnalazioni, blocco, sanzioni e ricorsi (issue #7, spec v1.1 del CPO, D32 A, D51 A).
// Solo calcoli su dati inventati: nessun database, nessun dato personale.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MOTIVI, ORIGINI, LIVELLI, LIMITI,
  priorita, scadenzaRevisione, grave, cautelare, bloccaDopo, validaSegnalazione,
  sospensioneAutomatica, nuovoAvvisoResponsabile, sanzioneContatti,
  ricorsoPermesso, rispostaRicorsoEntro, validaRicorso, esitoPerChiSegnala, vistaSanzione,
} from "../api/segnalazioni.js";

const ORA = 3600 * 1000;
const s = (da, contro, motivo, quando, extra = {}) => ({ da, contro, motivo, quando, ...extra });

test("nove motivi del modulo più «Sono in difficoltà» e «Non mi sono sentita/o al sicuro»", () => {
  assert.deepEqual(Object.keys(MOTIVI), [
    "contatti_prima_porta", "insulti", "contenuti_sessuali", "minacce_pericolo", "sembra_minorenne",
    "profilo_falso", "soldi", "diffusione_immagini", "altro", "sono_in_difficolta", "non_al_sicuro",
  ]);
  assert.deepEqual([...ORIGINI], ["chiudi_e_segnala", "dopo_chiamata", "scheda", "valutazione", "sono_in_difficolta", "storico_chiamate"]);
});

test("priorità: 1 ora per pericolo, minori e difficoltà; 24 ore per sesso, immagini, insulti, soldi; 72 per il resto", () => {
  for (const m of ["minacce_pericolo", "sembra_minorenne", "sono_in_difficolta", "non_al_sicuro"]) assert.equal(priorita(m), 1, m);
  for (const m of ["contenuti_sessuali", "diffusione_immagini", "insulti", "soldi"]) assert.equal(priorita(m), 24, m);
  for (const m of ["contatti_prima_porta", "profilo_falso", "altro"]) assert.equal(priorita(m), 72, m);
  assert.equal(priorita("inventato"), null);
  assert.equal(scadenzaRevisione("minacce_pericolo", "2026-11-30T20:00:00Z").toISOString(), "2026-11-30T21:00:00.000Z");
  assert.equal(scadenzaRevisione("altro", "2026-11-30T20:00:00Z").toISOString(), "2026-12-03T20:00:00.000Z");
});

test("gravi = priorità 1 ora o 24 ore", () => {
  assert.equal(grave("insulti"), true);
  assert.equal(grave("minacce_pericolo"), true);
  assert.equal(grave("contatti_prima_porta"), false);
  assert.equal(grave("altro"), false);
});

test("sospensione cautelare subito con una sola segnalazione per minacce, minori, immagini diffuse (D51 A)", () => {
  assert.equal(cautelare("minacce_pericolo"), true);
  assert.equal(cautelare("sembra_minorenne"), true);
  assert.equal(cautelare("diffusione_immagini"), true);
  assert.equal(cautelare("insulti"), false);
  assert.equal(cautelare("sono_in_difficolta"), false);
});

test("«Chiudi e segnala» blocca sempre; dagli altri punti il blocco segue la casella", () => {
  assert.equal(bloccaDopo("chiudi_e_segnala", false), true);
  assert.equal(bloccaDopo("chiudi_e_segnala", true), true);
  assert.equal(bloccaDopo("dopo_chiamata", true), true);
  assert.equal(bloccaDopo("dopo_chiamata", false), false);
  assert.equal(bloccaDopo("scheda"), true); // la casella parte spuntata
});

test("modulo: motivo valido, testo al massimo 1000 caratteri, persona obbligatoria tranne «Sono in difficoltà»", () => {
  assert.deepEqual(validaSegnalazione({ motivo: "insulti", origine: "scheda", contro: "b" }), { ok: true });
  assert.equal(validaSegnalazione({ motivo: "boh", origine: "scheda", contro: "b" }).errore, "motivo");
  assert.equal(validaSegnalazione({ motivo: "insulti", origine: "altrove", contro: "b" }).errore, "origine");
  assert.equal(validaSegnalazione({ motivo: "insulti", origine: "scheda", contro: "b", testo: "x".repeat(1001) }).errore, "testo");
  assert.equal(validaSegnalazione({ motivo: "insulti", origine: "scheda", contro: "b", testo: "x".repeat(1000) }).ok, true);
  assert.equal(validaSegnalazione({ motivo: "insulti", origine: "scheda" }).errore, "persona");
  assert.equal(validaSegnalazione({ motivo: "sono_in_difficolta", origine: "sono_in_difficolta" }).ok, true);
  assert.equal(validaSegnalazione({ motivo: "insulti", origine: "scheda", da: "a", contro: "a" }).errore, "persona");
});

test("dallo storico delle chiamate si segnala solo entro 30 giorni dalla chiamata", () => {
  const base = { motivo: "insulti", origine: "storico_chiamate", contro: "b" };
  assert.equal(validaSegnalazione({ ...base, chiamataIl: "2026-11-01T20:00:00Z" }, "2026-12-01T19:59:00Z").ok, true);
  assert.equal(validaSegnalazione({ ...base, chiamataIl: "2026-11-01T20:00:00Z" }, "2026-12-01T20:01:00Z").errore, "scaduta");
});

test("sospensione automatica (D32): 2 gravi da persone diverse in 30 giorni sì; 2 dalla stessa persona no", () => {
  const adesso = "2026-12-01T12:00:00Z";
  assert.equal(sospensioneAutomatica([
    s("a", "x", "insulti", "2026-11-20T10:00:00Z"),
    s("b", "x", "soldi", "2026-11-25T10:00:00Z"),
  ], "x", adesso), true);
  assert.equal(sospensioneAutomatica([
    s("a", "x", "insulti", "2026-11-20T10:00:00Z"),
    s("a", "x", "soldi", "2026-11-25T10:00:00Z"),
  ], "x", adesso), false);
});

test("sospensione automatica: non contano le non gravi, quelle oltre 30 giorni, quelle archiviate o contro altri", () => {
  const adesso = "2026-12-01T12:00:00Z";
  assert.equal(sospensioneAutomatica([s("a", "x", "insulti", "2026-11-20T10:00:00Z"), s("b", "x", "altro", "2026-11-25T10:00:00Z")], "x", adesso), false);
  assert.equal(sospensioneAutomatica([s("a", "x", "insulti", "2026-10-31T11:00:00Z"), s("b", "x", "insulti", "2026-11-25T10:00:00Z")], "x", adesso), false);
  assert.equal(sospensioneAutomatica([s("a", "x", "insulti", "2026-11-20T10:00:00Z", { esito: "archiviata" }), s("b", "x", "insulti", "2026-11-25T10:00:00Z")], "x", adesso), false);
  assert.equal(sospensioneAutomatica([s("a", "y", "insulti", "2026-11-20T10:00:00Z"), s("b", "x", "insulti", "2026-11-25T10:00:00Z")], "x", adesso), false);
  assert.equal(sospensioneAutomatica([], "x", adesso), false);
});

test("responsabile della sicurezza: avviso subito per le 1 ora, nuovo avviso dopo 30 minuti senza apertura", () => {
  const creata = "2026-11-30T20:00:00Z";
  assert.equal(nuovoAvvisoResponsabile({ motivo: "minacce_pericolo", quando: creata }, "2026-11-30T20:29:00Z"), false);
  assert.equal(nuovoAvvisoResponsabile({ motivo: "minacce_pericolo", quando: creata }, "2026-11-30T20:30:00Z"), true);
  assert.equal(nuovoAvvisoResponsabile({ motivo: "minacce_pericolo", quando: creata, apertaIl: "2026-11-30T20:10:00Z" }, "2026-11-30T21:00:00Z"), false);
  assert.equal(nuovoAvvisoResponsabile({ motivo: "insulti", quando: creata }, "2026-11-30T22:00:00Z"), false);
});

test("contatti chiesti prima della porta: avviso e uscita dalla stanza; la seconda in 6 mesi è sospensione di 7 giorni", () => {
  assert.deepEqual(sanzioneContatti([], "2026-12-01T12:00:00Z"), { livello: "avviso", esceDallaStanza: true, rimborso: 0 });
  assert.deepEqual(sanzioneContatti(["2026-07-01T12:00:00Z"], "2026-12-01T12:00:00Z"), { livello: "sospensione_7", esceDallaStanza: true, rimborso: 0 });
  assert.deepEqual(sanzioneContatti(["2026-05-01T12:00:00Z"], "2026-12-01T12:00:00Z"), { livello: "avviso", esceDallaStanza: true, rimborso: 0 });
});

test("livelli di sanzione e durate", () => {
  assert.deepEqual(Object.keys(LIVELLI), ["avviso", "sospensione_7", "sospensione_30", "esclusione"]);
  assert.equal(LIVELLI.sospensione_7.giorni, 7);
  assert.equal(LIVELLI.sospensione_30.giorni, 30);
  assert.equal(LIVELLI.esclusione.giorni, null);
});

test("ricorso: una sola volta, entro 14 giorni dalla sanzione", () => {
  const sanzione = { livello: "sospensione_7", quando: "2026-12-01T12:00:00Z" };
  assert.equal(ricorsoPermesso(sanzione, 0, "2026-12-15T12:00:00Z"), true);
  assert.equal(ricorsoPermesso(sanzione, 0, "2026-12-15T12:01:00Z"), false);
  assert.equal(ricorsoPermesso(sanzione, 1, "2026-12-02T12:00:00Z"), false);
});

test("ricorso: risposta entro 7 giorni, 14 per l'esclusione definitiva", () => {
  assert.equal(rispostaRicorsoEntro("sospensione_30", "2026-12-01T12:00:00Z").toISOString(), "2026-12-08T12:00:00.000Z");
  assert.equal(rispostaRicorsoEntro("esclusione", "2026-12-01T12:00:00Z").toISOString(), "2026-12-15T12:00:00.000Z");
});

test("ricorso: testo al massimo 2000 caratteri, al massimo 3 immagini da 5 MB", () => {
  assert.equal(validaRicorso({ testo: "Non è vero." }).ok, true);
  assert.equal(validaRicorso({ testo: "" }).errore, "testo");
  assert.equal(validaRicorso({ testo: "x".repeat(2001) }).errore, "testo");
  assert.equal(validaRicorso({ testo: "ok", allegati: [1, 2, 3, 4].map(() => ({ tipo: "image/jpeg", byte: 100 })) }).errore, "allegati");
  assert.equal(validaRicorso({ testo: "ok", allegati: [{ tipo: "image/jpeg", byte: 5 * 1024 * 1024 + 1 }] }).errore, "allegati");
  assert.equal(validaRicorso({ testo: "ok", allegati: [{ tipo: "application/pdf", byte: 100 }] }).errore, "allegati");
  assert.equal(LIMITI.ricorsoAllegati, 3);
});

test("chi segnala vede solo uno dei due esiti, mai il dettaglio della sanzione", () => {
  assert.equal(esitoPerChiSegnala("archiviata"), "Abbiamo esaminato la tua segnalazione: non abbiamo trovato violazioni delle regole.");
  for (const l of ["avviso", "sospensione_7", "sospensione_30", "esclusione"]) {
    assert.equal(esitoPerChiSegnala(l), "Abbiamo esaminato la tua segnalazione e preso i provvedimenti necessari.");
  }
});

test("chi è sanzionato vede livello, regola, fine e ricorso, mai chi l'ha segnalato", () => {
  const v = vistaSanzione({
    livello: "sospensione_7", regola: "Rispetto", quando: "2026-12-01T12:00:00Z",
    segnalazione: { da: "id-di-chi-segnala", testo: "racconto privato", motivo: "insulti" },
  }, 0, "2026-12-02T12:00:00Z");
  assert.deepEqual(v, { livello: "sospensione_7", regola: "Rispetto", fine: "2026-12-08T12:00:00.000Z", puoContestare: true });
  assert.ok(!JSON.stringify(v).includes("id-di-chi-segnala"));
  assert.ok(!JSON.stringify(v).includes("racconto"));
  assert.equal(vistaSanzione({ livello: "esclusione", regola: "Sicurezza", quando: "2026-12-01T12:00:00Z" }, 0, "2026-12-02T12:00:00Z").fine, null);
});
