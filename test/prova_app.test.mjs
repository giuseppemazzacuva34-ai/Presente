// Prova finta dell'app (D141 A, linea «sviluppatore-c»): Giuseppe clicca tutta l'app dal telefono con persone e dati
// finti. Qui: il «server finto» (landing/app/moduli/prova.js) non chiama MAI la rete e tiene tutto in memoria.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaProva, UTENTE_PROVA } from "../landing/app/moduli/prova.js";
import { testoConferma } from "../landing/app/moduli/stanza.js";

const ADESSO = Date.parse("2026-11-19T10:00:00Z"); // giovedì
const nuova = () => creaProva({ adesso: () => ADESSO, attesaMs: 0 });

function senzaRete(fn) {
  return async () => {
    const vera = globalThis.fetch;
    globalThis.fetch = () => { throw new Error("la prova non deve mai chiamare la rete"); };
    try { await fn(); } finally { globalThis.fetch = vera; }
  };
}

test("opzioni: gli stessi pezzi dell'app vera, nessuna configurazione né chiave", () => {
  const p = nuova();
  for (const k of ["accesso", "archivio", "lista", "zona", "stanza"]) assert.ok(p[k], `manca ${k}`);
});

test("accesso finto: email valida, qualunque codice di 6 cifre, esci", senzaRete(async () => {
  const { accesso } = nuova();
  assert.equal(accesso.connesso(), false);
  assert.equal(await accesso.token(), null);
  assert.deepEqual(await accesso.mandaLink("non-email", "/app/"), { ok: false, motivo: "email" });
  assert.deepEqual(await accesso.mandaLink("prova@esempio.it", "/app/"), { ok: true });
  assert.deepEqual(await accesso.verificaCodice("prova@esempio.it", "12a"), { ok: false, motivo: "codice" });
  assert.equal((await accesso.verificaCodice("prova@esempio.it", "123456")).ok, true);
  assert.equal(accesso.connesso(), true);
  assert.equal(typeof await accesso.token(), "string");
  assert.equal(accesso.utenteId(), UTENTE_PROVA);
  assert.equal(accesso.daLink("https://x.it/app/prova.html"), null);
  await accesso.esci();
  assert.equal(accesso.connesso(), false);
}));

test("archivio finto: profilo, filtri, questionario e file restano solo in memoria", senzaRete(async () => {
  const { archivio } = nuova();
  const vuoto = await archivio.leggi();
  assert.deepEqual(vuoto, { ok: true, profilo: null, filtri: null, questionario: null, voci: [], foto: [] });
  assert.deepEqual(await archivio.salvaProfilo({ nome: "Prova", passo: 5, ignoto: 1 }), { ok: true });
  assert.deepEqual(await archivio.salvaProfilo({ passo: 6 }), { ok: true });
  assert.deepEqual(await archivio.salvaFiltri({ raggio: "citta" }), { ok: true });
  assert.deepEqual(await archivio.salvaQuestionario({ 1: 2 }, { 1: 1 }), { ok: true });
  assert.deepEqual(await archivio.salvaDisponibilita({ fascia_da: "18:00", fascia_a: "22:00" }), { ok: true });
  const blob = new Blob(["voce"], { type: "audio/webm" });
  assert.deepEqual(await archivio.caricaFile("voci", "presentazione", blob), { ok: true });
  assert.deepEqual(await archivio.caricaFile("voci", "../altro", blob), { ok: false, motivo: "salvataggio" });
  assert.equal(await archivio.scaricaFile("voci", "presentazione"), blob);
  assert.equal(await archivio.scaricaFile("foto", "foto-1"), null);
  const letto = await archivio.leggi();
  assert.equal(letto.profilo.nome, "Prova");
  assert.equal(letto.profilo.passo, 6);
  assert.equal(letto.profilo.fascia_da, "18:00");
  assert.equal("ignoto" in letto.profilo, false);
  assert.equal(letto.filtri.raggio, "citta");
  assert.deepEqual(letto.questionario.risposte, { 1: 2 });
  assert.deepEqual(letto.voci, ["presentazione"]);
}));

test("lista e zona finte: nessuna provincia dalla lista, zona già accesa (niente contatore)", senzaRete(async () => {
  const { lista, zona } = nuova();
  assert.equal(await lista.leggi(), null);
  assert.equal(await lista.conferma("MI"), false);
  assert.equal(await zona.leggi(), null);
}));

test("stanza finta: «Entra nella stanza» conferma il prossimo lunedì alle 9 di Roma, «Ci ripenso» la toglie", senzaRete(async () => {
  const { stanza } = nuova();
  assert.deepEqual(await stanza.leggi(), { ok: true, apreIl: null });
  const r = await stanza.entra();
  assert.equal(r.ok, true);
  assert.equal(r.apreIl, "2026-11-23T08:00:00.000Z");
  assert.match(testoConferma(r.apreIl), /lunedì 23 novembre alle 9:00/);
  assert.deepEqual(await stanza.leggi(), { ok: true, apreIl: r.apreIl });
  assert.deepEqual(await stanza.ritira(r.apreIl), { ok: true });
  assert.deepEqual(await stanza.leggi(), { ok: true, apreIl: null });
}));

const html = readFileSync(new URL("../landing/app/prova.html", import.meta.url), "utf8");
const avvio = readFileSync(new URL("../landing/app/prova_avvio.js", import.meta.url), "utf8");

test("pagina della prova: non indicizzata, banner fisso, solo il suo script", () => {
  assert.match(html, /<html lang="it">/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /class="banner-prova"[^>]*>Prova: persone e dati finti</);
  const script = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(script, ['<script type="module" src="/app/prova_avvio.js">']);
  assert.match(html, /<main id="app">/);
});

test("avvio della prova: schermate vere (flusso.js), nessuna rete, nessuna configurazione, niente salvato sul telefono", () => {
  assert.match(avvio, /from "\/app\/moduli\/flusso\.js"/);
  assert.match(avvio, /from "\/app\/moduli\/prova\.js"/);
  assert.doesNotMatch(avvio, /fetch|config\.json|supabase|localStorage|sessionStorage|indexedDB|serviceWorker/i);
});

test("modulo della prova: nessuna rete e nessun salvataggio sul telefono", () => {
  const codice = readFileSync(new URL("../landing/app/moduli/prova.js", import.meta.url), "utf8");
  assert.doesNotMatch(codice, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|sendBeacon/);
});
