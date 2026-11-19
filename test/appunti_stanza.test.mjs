// «I tuoi appunti» sulla scheda della persona (issue #5 spec v1.1, passo 3; D51 A). Linea «sviluppatore-c», passo 9.
// Le note di ogni chiamata (data, durata, testo), modificabili e cancellabili, visibili solo a chi le ha scritte.
// Una sola lettura per tutta la stanza, direttamente su Supabase col proprio token (regole per riga).
// h finto che costruisce oggetti, rete e diario finti: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaDiario } from "../landing/app/moduli/diario.js";
import { creaAppuntiStanza, vistaAppunti } from "../landing/app/moduli/appunti_stanza.js";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const LEI = "11111111-2222-4333-8444-555555555555";
const LUI = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const BASE = "https://abcdefghijklmnop.supabase.co";
const INIZIO = "2026-11-12T19:30:00.000Z";
const DOPO = "2026-11-13T18:00:00.000Z";

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];

// --- diario.appuntiDi: una richiesta sola per tutte le persone della stanza ---------------------------------------
function rete(risposte) {
  const chiamate = [];
  const f = async (url, init = {}) => {
    chiamate.push({ url, ...init });
    const r = risposte.shift() ?? { status: 200, body: [] };
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  return { f, chiamate };
}

test("appuntiDi: una sola GET con con=in.(…), raggruppa per persona dalla più recente", async () => {
  const { f, chiamate } = rete([{ status: 200, body: [
    { con: LEI, chiamata_il: DOPO, durata: 600, testo: "Seconda" },
    { con: LUI, chiamata_il: "2026-11-12T17:00:00.000Z", durata: 120, testo: "Lui" },
    { con: LEI, chiamata_il: INIZIO, durata: 61, testo: "Prima" },
  ] }]);
  const d = creaDiario({ supabaseUrl: BASE, supabaseAnonKey: "anon", token: async () => "tok", fetch: f });
  const r = await d.appuntiDi([LEI, LUI]);
  assert.equal(chiamate.length, 1);
  assert.equal(chiamate[0].method, "GET");
  assert.equal(chiamate[0].headers.authorization, "Bearer tok");
  assert.match(chiamate[0].url, new RegExp(`con=in\\.\\(${LEI},${LUI}\\)`));
  assert.match(chiamate[0].url, /order=chiamata_il\.desc/);
  assert.equal(r.ok, true);
  assert.deepEqual(r.perPersona[LEI].map((a) => a.testo), ["Seconda", "Prima"]);
  assert.equal(r.perPersona[LEI][1].durata, "1 min");
  assert.deepEqual(r.perPersona[LUI].map((a) => a.testo), ["Lui"]);
});

test("appuntiDi: id non validi scartati senza rete; nessun id valido = nessuna richiesta", async () => {
  const { f, chiamate } = rete([]);
  const d = creaDiario({ supabaseUrl: BASE, supabaseAnonKey: "anon", token: async () => "tok", fetch: f });
  assert.deepEqual(await d.appuntiDi(["x);drop", null]), { ok: true, perPersona: {} });
  assert.equal(chiamate.length, 0);
  const g = rete([{ status: 401, body: {} }]);
  const d2 = creaDiario({ supabaseUrl: BASE, supabaseAnonKey: "anon", token: async () => "tok", fetch: g.f });
  assert.deepEqual(await d2.appuntiDi([LEI]), { ok: false, motivo: "accesso" });
});

// --- creaAppuntiStanza -------------------------------------------------------------------------------------------
function diarioFinto(perPersona = { [LEI]: [{ chiamataIl: INIZIO, data: "12 novembre", durata: "10 min", testo: "Ride come mia nonna." }] }) {
  const chiamate = [];
  return {
    chiamate,
    async appuntiDi(ids) { chiamate.push(["leggi", [...ids]]); return { ok: true, perPersona: structuredClone(perPersona) }; },
    async modifica(chiamataIl, t) { chiamate.push(["modifica", chiamataIl, t]); return t.trim() ? { ok: true } : { ok: false, motivo: "vuoto" }; },
    async cancella(chiamataIl) { chiamate.push(["cancella", chiamataIl]); return { ok: true }; },
  };
}

test("prepara: legge una volta sola per le stesse persone, di nuovo se la stanza cambia", async () => {
  const diario = diarioFinto();
  const a = creaAppuntiStanza({ diario });
  await a.prepara([LEI, LUI]);
  await a.prepara([LUI, LEI]);
  a.prepara([LEI, LUI]);
  assert.equal(diario.chiamate.length, 1);
  await a.prepara([LEI]);
  assert.equal(diario.chiamate.length, 2);
});

test("rileggi: dopo una nota nuova del diario la prossima prepara rilegge (stesse persone)", async () => {
  const diario = diarioFinto();
  const a = creaAppuntiStanza({ diario });
  await a.prepara([LEI, LUI]);
  a.rileggi();
  await a.prepara([LEI, LUI]);
  assert.equal(diario.chiamate.length, 2);
});

test("vista: senza note nessuna sezione; con note «I tuoi appunti» con data, durata e testo", async () => {
  const a = creaAppuntiStanza({ diario: diarioFinto() });
  assert.equal(vistaAppunti(h, a, LEI, "Giulia"), null, "prima di leggere niente");
  await a.prepara([LEI, LUI]);
  assert.equal(vistaAppunti(h, a, LUI, "Marco"), null);
  const v = vistaAppunti(h, a, LEI, "Giulia");
  assert.match(testo(v), /I tuoi appunti/);
  assert.match(testo(v), /Lo leggi solo tu\./);
  assert.match(testo(v), /12 novembre · 10 min/);
  assert.match(testo(v), /Ride come mia nonna\./);
  assert.ok(bottone(v, "Modifica"));
  assert.ok(bottone(v, "Cancella"));
  assert.match(bottone(v, "Modifica").a["aria-label"], /Giulia/);
});

test("modifica: si apre il campo col testo, Salva manda il nuovo testo e aggiorna la nota", async () => {
  const diario = diarioFinto();
  let avvisi = 0;
  const a = creaAppuntiStanza({ diario, aggiorna: () => { avvisi += 1; } });
  await a.prepara([LEI]);
  bottone(vistaAppunti(h, a, LEI, "Giulia"), "Modifica").a.onclick();
  let v = vistaAppunti(h, a, LEI, "Giulia");
  const campo = tutti(v, (x) => x.tag === "textarea")[0];
  assert.equal(testo(campo), "Ride come mia nonna.");
  assert.equal(campo.a.maxlength, "1000");
  campo.a.oninput({ target: { value: "Ride forte." } });
  await bottone(v, "Salva").a.onclick();
  assert.deepEqual(diario.chiamate.at(-1), ["modifica", INIZIO, "Ride forte."]);
  v = vistaAppunti(h, a, LEI, "Giulia");
  assert.equal(tutti(v, (x) => x.tag === "textarea").length, 0, "finestra chiusa");
  assert.match(testo(v), /Ride forte\./);
  assert.ok(avvisi > 0);
});

test("modifica rifiutata: il campo resta aperto con un errore, la nota non cambia", async () => {
  const a = creaAppuntiStanza({ diario: diarioFinto() });
  await a.prepara([LEI]);
  a.apriModifica(LEI, INIZIO);
  a.scrivi("   ");
  await a.conferma();
  const v = vistaAppunti(h, a, LEI, "Giulia");
  assert.equal(tutti(v, (x) => x.tag === "textarea").length, 1);
  assert.equal(tutti(v, (x) => x.a.role === "alert").length, 1);
  assert.equal(a.di(LEI)[0].testo, "Ride come mia nonna.");
});

test("cancella: chiede conferma, poi la nota sparisce; senza note la sezione sparisce", async () => {
  const diario = diarioFinto();
  const a = creaAppuntiStanza({ diario });
  await a.prepara([LEI]);
  bottone(vistaAppunti(h, a, LEI, "Giulia"), "Cancella").a.onclick();
  let v = vistaAppunti(h, a, LEI, "Giulia");
  assert.match(testo(v), /Cancellare questa nota\?/);
  assert.equal(diario.chiamate.filter((c) => c[0] === "cancella").length, 0, "niente prima della conferma");
  bottone(v, "Annulla").a.onclick();
  assert.doesNotMatch(testo(vistaAppunti(h, a, LEI, "Giulia")), /Cancellare/);
  a.apriCancella(LEI, INIZIO);
  await a.conferma();
  assert.deepEqual(diario.chiamate.at(-1), ["cancella", INIZIO]);
  assert.equal(vistaAppunti(h, a, LEI, "Giulia"), null);
});

test("sicurezza: il modulo non salva nulla in locale, non scrive log e non usa il Worker", () => {
  const src = leggi("../landing/app/moduli/appunti_stanza.js");
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|console\.|fetch\(|\/app\/api/);
});

test("flusso, avvio e service worker: aggiunte minime", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /from "\.\/appunti_stanza\.js"/);
  assert.match(flusso, /vistaAppunti\(h, appuntiStanza, p\.id, nomeScheda\(p\)\)/);
  assert.match(flusso, /export function appuntiCambiati\(/);
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /creaAppuntiStanza\(/);
  assert.match(avvio, /appuntiCambiati\(\)/);
  // Dopo una nota nuova del diario (fine chiamata) la scheda rilegge gli appunti.
  assert.match(avvio, /quandoNotaNuova = \(\) => appunti && appunti\.rileggi\(\)/);
  assert.match(avvio, /dopoSalva: \(\) => quandoNotaNuova\(\)/);
  const sw = leggi("../landing/app/sw.js");
  assert.ok(sw.includes('"/app/moduli/appunti_stanza.js"'));
  assert.ok(!sw.includes('"presente-app-25"'), "versione della cache aumentata");
});
