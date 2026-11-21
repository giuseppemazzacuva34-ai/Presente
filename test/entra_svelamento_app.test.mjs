// Issue #65, passo 7d-3b-1 (spec v1 del CPO, passi 5-6 e casi limite; D48 A): dalla sala d'attesa allo svelamento.
// Nella schermata della porta: dopo l'anteprima, «Entra» chiede entra_svelamento al server; finché manca l'altra
// persona «Aspettiamo <nome>…» e si richiede ogni pochi secondi (una richiesta alla volta); con «iniziato» + «video»
// l'anteprima si spegne e si apre la schermata del video (schermata_svelamento.js). 10 minuti senza l'altra persona:
// «<nome> non è arrivata. Proponi un altro momento.» e si torna a scegliere quando. «Chiudi e segnala» chiede subito
// al server di chiudere la porta (azione «chiudi_e_segnala») e prepara il modulo della #7 contro l'altra persona.
// h finto, server finto, fotocamera finta, orologio manuale: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI, creaSvelamento, creaPortaSvelamento, vistaPorta } from "../landing/app/moduli/svelamento.js";
import { creaSalaAttesa } from "../landing/app/moduli/sala_attesa.js";

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" && n.f ? n.f.map(testo).join("") : typeof n === "object" ? "" : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object" && n.f) { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];
const attesa = () => new Promise((x) => setImmediate(x));

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ALTRA = "11111111-2222-4333-8444-555555555555";
const ADESSO = new Date("2026-11-16T09:40:00Z");
const porta = (extra = {}) => ({ porta: PORTA, con: ALTRA, nome: "Giulia", eta: 31,
  aperta_il: "2026-11-15T20:00:00Z", scade_il: "2026-11-17T20:00:00Z", mia_caparra: true, sua_caparra: true, aspetta: null,
  mia_scelta: "video", mie_fasce: [], fascia_fissata: null, mio_pronto: true, suo_pronto: true,
  pronto_scade_il: "2026-11-16T09:44:00Z", pronta: null, momento: true, tipo: "video", ...extra });
const stato = (p) => ({ saldo: 0, caparra: 10, beta: true, porte: p ? [p] : [] });

function fotocameraFinta() {
  const tracce = [];
  const getUserMedia = async () => {
    const t = { kind: "video", ferma: false, stop() { this.ferma = true; } };
    tracce.push(t);
    return { getTracks: () => [t], getAudioTracks: () => [] };
  };
  return { getUserMedia, tracce };
}

// Server finto: «entra» risponde con la prossima risposta in coda (poi con l'ultima).
function server({ entra = [{ ok: true, esito: "in_attesa" }], letture = [stato(porta())], chiudi = { ok: true, esito: "chiusa" } } = {}) {
  const chiamate = [];
  const prossima = (coda) => (coda.length > 1 ? coda.shift() : coda[0]);
  return {
    chiamate,
    leggi: async () => { chiamate.push("leggi"); return { ok: true, stato: prossima(letture) }; },
    scegli: async () => ({ ok: true, esito: "salvata", stato: null }),
    entra: async (id) => { chiamate.push(`entra:${id}`); const r = prossima(entra); return typeof r === "function" ? r() : r; },
    chiudiESegnala: async (id) => { chiamate.push(`chiudi:${id}`); return chiudi; },
  };
}

// Schermata del video finta: registra apertura e chiusura, e tiene le funzioni che la porta le passa.
function videoFinto() {
  const aperte = [];
  const crea = (id, opzioni) => {
    const s = { id, opzioni, stato: "chiusa",
      apri() { this.stato = "aspetta"; },
      chiudi() { this.stato = "chiusa"; },
      modello() { return { stato: this.stato, secondi: 10, sfocato: true, muto: false, riprove: 0, testo: null }; },
      schermo: () => ({ tag: "video", a: {}, f: [] }), nome: () => opzioni.nome, filigrana: () => "Luca · 16/11/2026",
      microfono() {}, riprova() {}, chiudiESegnala() { this.stato = "segnalata"; opzioni.quandoSegnala(); } };
    aperte.push(s);
    return s;
  };
  return { crea, aperte };
}

function prepara(opz = {}) {
  const cam = fotocameraFinta();
  const sv = server(opz);
  const vid = videoFinto();
  let giro = null;
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => ADESSO,
    sala: (passaAlleFoto) => creaSalaAttesa({ getUserMedia: cam.getUserMedia, schermo: { srcObject: null }, passaAlleFoto }),
    video: vid.crea,
    ogni: (fn) => { giro = fn; return 7; }, ferma: () => { giro = null; } });
  const giraUnaVolta = async () => { if (giro) await giro(); await attesa(); };
  return { cam, sv, vid, ps, giro: () => giro, giraUnaVolta };
}

async function inAnteprima(t) {
  await t.ps.apri(PORTA);
  await t.ps.entraSala();
  await t.ps.sala().conferma();
  assert.equal(t.ps.sala().modello().stato, "anteprima");
}

test("sala: «Entra» compare solo con l'anteprima accesa, non prima dell'avviso", async () => {
  const t = prepara();
  await t.ps.apri(PORTA);
  await t.ps.entraSala();
  assert.equal(bottone(vistaPorta(h, t.ps), TESTI.entra), undefined);
  await t.ps.sala().conferma();
  assert.ok(bottone(vistaPorta(h, t.ps), TESTI.entra));
});

test("entra senza l'altra persona: «Aspettiamo <nome>…», anteprima accesa, si richiede ogni giro, una alla volta", async () => {
  const t = prepara();
  await inAnteprima(t);
  await t.ps.entra();
  assert.deepEqual(t.sv.chiamate.filter((c) => c.startsWith("entra")), [`entra:${PORTA}`]);
  const v = vistaPorta(h, t.ps);
  assert.match(testo(v), /Aspettiamo Giulia…/);
  assert.equal(bottone(v, TESTI.entra), undefined);
  assert.equal(t.ps.sala().modello().stato, "anteprima");
  assert.ok(t.giro(), "c'è un giro per richiedere");
  await t.giraUnaVolta();
  await t.giraUnaVolta();
  assert.equal(t.sv.chiamate.filter((c) => c.startsWith("entra")).length, 3);
  // Un secondo «Entra» mentre si aspetta non manda nulla.
  await t.ps.entra();
  assert.equal(t.sv.chiamate.filter((c) => c.startsWith("entra")).length, 3);
});

test("arriva l'altra persona: anteprima spenta, schermata del video aperta per questa porta col nome; giro fermo", async () => {
  const t = prepara({ entra: [{ ok: true, esito: "in_attesa" }, { ok: true, esito: "iniziato", tipo: "video" }] });
  await inAnteprima(t);
  await t.ps.entra();
  await t.giraUnaVolta();
  assert.equal(t.giro(), null);
  assert.ok(t.cam.tracce.every((x) => x.ferma), "anteprima spenta prima del video");
  assert.equal(t.vid.aperte.length, 1);
  const s = t.vid.aperte[0];
  assert.equal(s.id, PORTA);
  assert.equal(s.opzioni.nome, "Giulia");
  assert.equal(s.stato, "aspetta");
  // Mentre il video è attivo la pagina mostra solo lo svelamento: niente «Quando?», niente «Torna alla stanza».
  const v = vistaPorta(h, t.ps);
  assert.ok(bottone(v, "Chiudi e segnala"));
  assert.equal(bottone(v, TESTI.prontoOra), undefined);
  assert.equal(bottone(v, TESTI.torna), undefined);
});

test("subito iniziato al primo «Entra»: si apre il video senza giro", async () => {
  const t = prepara({ entra: [{ ok: true, esito: "iniziato", tipo: "video" }] });
  await inAnteprima(t);
  await t.ps.entra();
  assert.equal(t.giro(), null);
  assert.equal(t.vid.aperte.length, 1);
});

test("iniziato con le foto: nessun video, la fotocamera si spegne e si rilegge lo stato", async () => {
  const t = prepara({ entra: [{ ok: true, esito: "iniziato", tipo: "foto" }],
    letture: [stato(porta()), stato(porta()), stato(porta({ tipo: "foto" }))] });
  await inAnteprima(t);
  await t.ps.entra();
  assert.equal(t.vid.aperte.length, 0);
  assert.ok(t.cam.tracce.every((x) => x.ferma));
  assert.equal(t.ps.sala().modello().stato, "foto");
});

test("10 minuti senza l'altra persona: «<nome> non è arrivata. Proponi un altro momento.», sala chiusa, giro fermo", async () => {
  const t = prepara({ entra: [{ ok: true, esito: "in_attesa" }, { ok: false, motivo: "non_arrivato" }] });
  await inAnteprima(t);
  await t.ps.entra();
  await t.giraUnaVolta();
  assert.equal(t.giro(), null);
  assert.equal(t.ps.sala().modello().stato, "chiusa");
  assert.ok(t.cam.tracce.every((x) => x.ferma));
  const v = vistaPorta(h, t.ps);
  assert.match(testo(v), /Giulia non è arrivata\. Proponi un altro momento\./);
  assert.ok(bottone(v, TESTI.prontoOra), "si torna a scegliere quando");
});

test("rete assente durante l'attesa: si continua ad aspettare; porta chiusa: si smette e si rilegge", async () => {
  const t = prepara({ entra: [{ ok: true, esito: "in_attesa" }, { ok: false, motivo: "rete" }, { ok: false, motivo: "porta_chiusa", testo: TESTI.portaChiusa }],
    letture: [stato(porta()), stato(porta()), stato(null)] });
  await inAnteprima(t);
  await t.ps.entra();
  await t.giraUnaVolta();
  assert.ok(t.giro(), "rete: si riprova al giro dopo");
  assert.match(testo(vistaPorta(h, t.ps)), /Aspettiamo Giulia…/);
  await t.giraUnaVolta();
  assert.equal(t.giro(), null);
  assert.equal(t.ps.sala().modello().stato, "chiusa");
  assert.match(testo(vistaPorta(h, t.ps)), new RegExp(TESTI.portaChiusa));
});

test("«Torna alla stanza» mentre si aspetta: giro fermo, fotocamera spenta", async () => {
  const t = prepara();
  await inAnteprima(t);
  await t.ps.entra();
  t.ps.chiudi();
  assert.equal(t.giro(), null);
  assert.ok(t.cam.tracce.every((x) => x.ferma));
});

test("«Chiudi e segnala»: chiede al server di chiudere la porta e prepara la segnalazione contro l'altra persona", async () => {
  const t = prepara({ entra: [{ ok: true, esito: "iniziato", tipo: "video" }] });
  await inAnteprima(t);
  await t.ps.entra();
  t.vid.aperte[0].chiudiESegnala();
  await attesa();
  assert.ok(t.sv.chiamate.includes(`chiudi:${PORTA}`));
  assert.deepEqual(t.ps.modello().segnala, { contro: ALTRA, origine: "chiudi_e_segnala", nome: "Giulia" });
  t.ps.fineSegnala();
  assert.equal(t.ps.modello().segnala, null);
});

test("la schermata del video esce (caduta, tentativi): si torna alla porta con il suo testo e si rilegge lo stato", async () => {
  const t = prepara({ entra: [{ ok: true, esito: "iniziato", tipo: "video" }] });
  await inAnteprima(t);
  await t.ps.entra();
  const s = t.vid.aperte[0];
  const prima = t.sv.chiamate.filter((c) => c === "leggi").length;
  s.stato = "uscita";
  s.opzioni.quandoEsci("tentativi");
  await attesa();
  assert.ok(t.sv.chiamate.filter((c) => c === "leggi").length > prima);
  const v = vistaPorta(h, t.ps);
  assert.ok(bottone(v, TESTI.prontoOra), "di nuovo «Quando?»");
  assert.ok(bottone(v, TESTI.torna));
});

test("fine dei 10 secondi: resta «Ecco <nome>.» con «Torna alla stanza», senza «Quando?»", async () => {
  const t = prepara({ entra: [{ ok: true, esito: "iniziato", tipo: "video" }] });
  await inAnteprima(t);
  await t.ps.entra();
  const s = t.vid.aperte[0];
  s.stato = "finito";
  s.opzioni.quandoFinito();
  await attesa();
  const v = vistaPorta(h, t.ps);
  assert.equal(bottone(v, TESTI.prontoOra), undefined);
  assert.ok(bottone(v, TESTI.torna));
});

test("chiudere la porta chiude anche il video", async () => {
  const t = prepara({ entra: [{ ok: true, esito: "iniziato", tipo: "video" }] });
  await inAnteprima(t);
  await t.ps.entra();
  t.ps.chiudi();
  assert.equal(t.vid.aperte[0].stato, "chiusa");
});

test("client: «chiudi_e_segnala» manda solo azione e porta, col token", async () => {
  const inviati = [];
  const f = async (url, o) => { inviati.push({ url, o }); return { status: 200, json: async () => ({ ok: true, esito: "chiusa" }) }; };
  const sv = creaSvelamento({ token: () => "tok", fetch: f });
  assert.deepEqual(await sv.chiudiESegnala(PORTA), { ok: true, esito: "chiusa" });
  assert.equal(inviati[0].url, "/app/api/svelamento");
  assert.deepEqual(JSON.parse(inviati[0].o.body), { azione: "chiudi_e_segnala", porta: PORTA });
  assert.equal(inviati[0].o.headers.authorization, "Bearer tok");
  assert.equal((await sv.chiudiESegnala("non-un-id")).ok, false);
  assert.equal(inviati.length, 1);
});

test("senza la schermata del video (configurazione vecchia) «Entra» non compare e non manda nulla", async () => {
  const cam = fotocameraFinta();
  const sv = server();
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => ADESSO,
    sala: (passaAlleFoto) => creaSalaAttesa({ getUserMedia: cam.getUserMedia, schermo: { srcObject: null }, passaAlleFoto }) });
  await ps.apri(PORTA);
  await ps.entraSala();
  await ps.sala().conferma();
  assert.equal(bottone(vistaPorta(h, ps), TESTI.entra), undefined);
  await ps.entra();
  assert.equal(sv.chiamate.filter((c) => c.startsWith("entra")).length, 0);
});

import { readFileSync } from "node:fs";
test("il service worker tiene i moduli del video (li importa svelamento.js) con una versione nuova della cache", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /"\/app\/moduli\/schermata_svelamento\.js"/);
  assert.match(sw, /"\/app\/moduli\/video_svelamento\.js"/);
  assert.ok(!sw.includes('"presente-app-37"'), "versione della cache aumentata");
});

test("i testi nuovi sono quelli del server", async () => {
  const { TESTI_SVELAMENTO } = await import("../api/svelamento.js");
  assert.equal(TESTI.aspetta, TESTI_SVELAMENTO.aspetta);
  assert.equal(TESTI.nonArrivato, TESTI_SVELAMENTO.nonArrivato);
});
