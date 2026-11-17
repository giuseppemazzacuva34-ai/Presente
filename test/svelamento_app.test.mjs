// Schermata della porta nella web app (issue #65, spec v1 del CPO, passi 1-2; D48 A, D18 A). Passo 4c, linea del CTO.
// Testi della spec, conto alla rovescia delle 48 ore, «Blocca 10 crediti», «Ti mancano N crediti» + «Ricarica» (in beta
// crediti di prova, nessun pagamento), «Aspettiamo che anche <nome> blocchi la caparra.» e le richieste a
// /app/api/svelamento. h finto, rete finta, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TESTI, contoPorta, schermataPorta, testoErroreSvelamento, creaSvelamento, creaPortaSvelamento, vistaPorta,
} from "../landing/app/moduli/svelamento.js";
import { TESTI_SVELAMENTO } from "../api/svelamento.js";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LEI = "11111111-2222-4333-8444-555555555555";
const APERTA = "2026-11-15T20:00:00Z"; // domenica 21:00 di Roma
const SCADE = "2026-11-17T20:00:00Z"; // martedì 21:00 di Roma
const LUNEDI = new Date("2026-11-16T09:30:00Z");
const porta = (extra = {}) => ({ porta: PORTA, con: LEI, nome: "Giulia", eta: 31, aperta_il: APERTA, scade_il: SCADE,
  mia_caparra: false, sua_caparra: false, aspetta: null, ...extra });
const stato = (porte = [porta()], saldo = 20) => ({ saldo, caparra: 10, beta: true,
  testi: { blocca: TESTI_SVELAMENTO.blocca, spiegazione: TESTI_SVELAMENTO.spiegazioneCaparra, beta: TESTI_SVELAMENTO.beta }, porte });

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];

test("testi: uguali a quelli del server (api/svelamento.js)", () => {
  for (const k of ["blocca", "spiegazioneCaparra", "aspettaCaparra", "ricarica", "beta", "portaChiusa", "scaduta"]) {
    assert.equal(TESTI[k], TESTI_SVELAMENTO[k], k);
  }
  assert.equal(TESTI.aperta, "Una porta si è aperta. Hai 48 ore per lo svelamento.");
});

test("conto alla rovescia: ore e minuti fino alla scadenza delle 48 ore, al singolare quando serve", () => {
  assert.equal(contoPorta(SCADE, new Date("2026-11-15T20:00:00Z")), "Mancano 48 ore e 0 minuti per lo svelamento.");
  assert.equal(contoPorta(SCADE, LUNEDI), "Mancano 34 ore e 30 minuti per lo svelamento.");
  assert.equal(contoPorta(SCADE, new Date("2026-11-17T18:59:00Z")), "Manca 1 ora e 1 minuto per lo svelamento.");
  assert.equal(contoPorta(SCADE, new Date("2026-11-17T19:15:00Z")), "Mancano 45 minuti per lo svelamento.");
  assert.equal(contoPorta(SCADE, new Date("2026-11-17T19:59:30Z")), "Manca 1 minuto per lo svelamento.");
  assert.equal(contoPorta(SCADE, new Date("2026-11-17T20:00:00Z")), null, "scaduta: niente conto");
  assert.equal(contoPorta("non è una data", LUNEDI), null);
});

test("porta senza caparre e crediti sufficienti: nome, età, conto e «Blocca 10 crediti» con la spiegazione", () => {
  const s = schermataPorta(stato(), PORTA, LUNEDI);
  assert.equal(s.tipo, "porta");
  assert.equal(s.titolo, TESTI.aperta);
  assert.equal(s.chi, "Giulia, 31");
  assert.equal(s.conto, "Mancano 34 ore e 30 minuti per lo svelamento.");
  assert.equal(s.saldo, "I tuoi crediti: 20");
  assert.deepEqual(s.caparra, { tipo: "blocca", bottone: "Blocca 10 crediti", spiegazione: TESTI_SVELAMENTO.spiegazioneCaparra });
});

test("meno di 10 crediti: «Ti mancano N crediti», «Ricarica» e il testo della beta; nessun pulsante per bloccare", () => {
  const s = schermataPorta(stato([porta()], 7), PORTA, LUNEDI);
  assert.deepEqual(s.caparra, { tipo: "ricarica", testo: "Ti mancano 3 crediti", bottone: "Ricarica", beta: "In beta i crediti sono di prova",
    spiegazione: TESTI_SVELAMENTO.spiegazioneCaparra });
  assert.equal(schermataPorta(stato([porta()], 9), PORTA, LUNEDI).caparra.testo, "Ti manca 1 credito");
  assert.equal(schermataPorta(stato([porta()], 0), PORTA, LUNEDI).caparra.testo, "Ti mancano 10 crediti");
});

test("caparra bloccata solo da me: «Aspettiamo che anche Giulia blocchi la caparra.»", () => {
  const s = schermataPorta(stato([porta({ mia_caparra: true, aspetta: "Aspettiamo che anche Giulia blocchi la caparra." })], 10), PORTA, LUNEDI);
  assert.deepEqual(s.caparra, { tipo: "aspetta", testo: "Aspettiamo che anche Giulia blocchi la caparra." });
  // Anche se il server non manda il testo, lo si scrive con il nome.
  assert.equal(schermataPorta(stato([porta({ mia_caparra: true })], 10), PORTA, LUNEDI).caparra.testo,
    "Aspettiamo che anche Giulia blocchi la caparra.");
});

test("caparra di entrambi: niente più pulsante, si aspetta il passo dello svelamento", () => {
  const s = schermataPorta(stato([porta({ mia_caparra: true, sua_caparra: true })], 10), PORTA, LUNEDI);
  assert.equal(s.caparra.tipo, "entrambe");
  assert.equal(s.caparra.bottone, undefined);
});

test("porta che non c'è più (chiusa, di altri o non valida): solo «Questa porta si è chiusa.», mai il motivo", () => {
  assert.deepEqual(schermataPorta(stato([]), PORTA, LUNEDI), { tipo: "chiusa", testo: "Questa porta si è chiusa." });
  assert.deepEqual(schermataPorta(stato(), "non-un-id", LUNEDI), { tipo: "chiusa", testo: "Questa porta si è chiusa." });
  assert.equal(schermataPorta(null, PORTA, LUNEDI), null);
});

test("porta oltre le 48 ore: il testo della scadenza", () => {
  assert.deepEqual(schermataPorta(stato(), PORTA, new Date("2026-11-17T20:00:01Z")), { tipo: "scaduta", testo: TESTI_SVELAMENTO.scaduta });
});

test("errori: testi brevi, mai il motivo tecnico", () => {
  assert.equal(testoErroreSvelamento("rete"), "Sei senza connessione. Riprova tra poco.");
  assert.equal(testoErroreSvelamento("accesso"), "Accedi di nuovo per continuare.");
  assert.equal(testoErroreSvelamento("troppe"), "Troppi tentativi. Aspetta un minuto.");
  assert.equal(testoErroreSvelamento("boh"), "Non è andata. Riprova tra poco.");
});

// ---- richieste al Worker -------------------------------------------------------------------------------------------
function reteFinta(...risposte) {
  const chiamate = [];
  const f = async (url, init) => {
    chiamate.push({ url, init });
    const r = risposte.length > 1 ? risposte.shift() : risposte[0];
    if (r instanceof Error) throw r;
    return { status: r.status ?? 200, json: async () => r.corpo };
  };
  return { f, chiamate };
}

test("leggi: GET con il token, nessuna persona nel corpo", async () => {
  const rete = reteFinta({ corpo: { ok: true, ...stato() } });
  const s = creaSvelamento({ token: () => "tok", fetch: rete.f });
  const r = await s.leggi();
  assert.equal(r.ok, true);
  assert.equal(r.stato.saldo, 20);
  assert.equal(r.stato.porte[0].porta, PORTA);
  assert.equal(rete.chiamate[0].url, "/app/api/svelamento");
  assert.equal(rete.chiamate[0].init.method, "GET");
  assert.equal(rete.chiamate[0].init.headers.authorization, "Bearer tok");
  assert.equal(rete.chiamate[0].init.body, undefined);
});

test("blocca: POST { azione: caparra, porta } e basta; chi blocca lo dice solo il token", async () => {
  const rete = reteFinta({ corpo: { ok: true, esito: "bloccata", stato: stato([porta({ mia_caparra: true })], 10) } });
  const s = creaSvelamento({ token: () => "tok", fetch: rete.f });
  const r = await s.blocca(PORTA);
  assert.equal(r.ok, true);
  assert.equal(r.stato.saldo, 10);
  assert.equal(rete.chiamate[0].init.method, "POST");
  assert.deepEqual(JSON.parse(rete.chiamate[0].init.body), { azione: "caparra", porta: PORTA });
  // Una porta non valida non parte nemmeno.
  assert.equal((await s.blocca("x")).ok, false);
  assert.equal(rete.chiamate.length, 1);
});

test("blocca: i rifiuti del server arrivano con il loro testo; 404 = porta chiusa; rete, accesso e troppe con i nostri", async () => {
  const pochi = { ok: false, motivo: "crediti_insufficienti", mancano: 3, testo: "Ti mancano 3 crediti", ricarica: "Ricarica", beta: TESTI_SVELAMENTO.beta };
  let s = creaSvelamento({ token: () => "tok", fetch: reteFinta({ corpo: pochi }).f });
  assert.deepEqual(await s.blocca(PORTA), { ok: false, motivo: "crediti_insufficienti", testo: "Ti mancano 3 crediti" });
  s = creaSvelamento({ token: () => "tok", fetch: reteFinta({ status: 404, corpo: { ok: false, motivo: "non_trovata" } }).f });
  assert.deepEqual(await s.blocca(PORTA), { ok: false, motivo: "non_trovata", testo: "Questa porta si è chiusa." });
  s = creaSvelamento({ token: () => "tok", fetch: reteFinta(new TypeError("offline")).f });
  assert.equal((await s.blocca(PORTA)).testo, "Sei senza connessione. Riprova tra poco.");
  s = creaSvelamento({ token: () => "tok", fetch: reteFinta({ status: 401, corpo: { ok: false } }).f });
  assert.equal((await s.leggi()).motivo, "accesso");
  s = creaSvelamento({ token: () => "tok", fetch: reteFinta({ status: 429, corpo: { ok: false, motivo: "troppe" } }).f });
  assert.equal((await s.leggi()).testo, "Troppi tentativi. Aspetta un minuto.");
  s = creaSvelamento({ token: () => null, fetch: reteFinta({ corpo: {} }).f });
  assert.equal((await s.leggi()).motivo, "accesso");
});

// ---- controllo della schermata e vista ----------------------------------------------------------------------------
function svelamentoFinto(...letture) {
  const chiamate = [];
  const risposte = {};
  return {
    chiamate, risposte,
    async leggi() { chiamate.push("leggi"); return letture.length > 1 ? letture.shift() : letture[0]; },
    async blocca(p) { chiamate.push(["blocca", p]); return risposte.blocca; },
  };
}

test("apri: legge lo stato e mostra la porta; chiudi torna alla home", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato() });
  let aggiornata = 0;
  const ps = creaPortaSvelamento({ svelamento: sv, aggiorna: () => { aggiornata += 1; }, adesso: () => LUNEDI });
  assert.equal(ps.modello().aperta, false);
  await ps.apri(PORTA);
  const m = ps.modello();
  assert.equal(m.aperta, true);
  assert.equal(m.carica, false);
  assert.equal(m.schermata.chi, "Giulia, 31");
  assert.ok(aggiornata >= 2, "si ridisegna all'apertura e dopo la lettura");
  ps.chiudi();
  assert.equal(ps.modello().aperta, false);
  assert.equal(ps.modello().schermata, null);
});

test("Blocca 10 crediti: una richiesta alla volta, poi la schermata dice di aspettare l'altra persona", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato() });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => LUNEDI });
  await ps.apri(PORTA);
  sv.risposte.blocca = { ok: true, esito: "bloccata", stato: stato([porta({ mia_caparra: true, aspetta: "Aspettiamo che anche Giulia blocchi la caparra." })], 10) };
  const prima = ps.blocca();
  const doppio = ps.blocca();
  await Promise.all([prima, doppio]);
  assert.deepEqual(sv.chiamate.filter((c) => Array.isArray(c)), [["blocca", PORTA]]);
  assert.equal(ps.modello().schermata.caparra.tipo, "aspetta");
  assert.equal(ps.modello().schermata.saldo, "I tuoi crediti: 10");
});

test("rifiuto per crediti: testo del server e si rilegge lo stato, che mostra «Ricarica»", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato() }, { ok: true, stato: stato([porta()], 4) });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => LUNEDI });
  await ps.apri(PORTA);
  sv.risposte.blocca = { ok: false, motivo: "crediti_insufficienti", testo: "Ti mancano 6 crediti" };
  await ps.blocca();
  assert.equal(ps.modello().schermata.caparra.tipo, "ricarica");
  assert.equal(ps.modello().schermata.caparra.testo, "Ti mancano 6 crediti");
});

test("rifiuto per porta chiusa o scaduta: resta solo il testo del server", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato() }, { ok: true, stato: stato([]) });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => LUNEDI });
  await ps.apri(PORTA);
  sv.risposte.blocca = { ok: false, motivo: "porta_chiusa", testo: "Questa porta si è chiusa." };
  await ps.blocca();
  assert.deepEqual(ps.modello().schermata, { tipo: "chiusa", testo: "Questa porta si è chiusa." });
});

test("errore di lettura: testo breve e «Riprova»", async () => {
  const sv = svelamentoFinto({ ok: false, motivo: "rete", testo: "Sei senza connessione. Riprova tra poco." }, { ok: true, stato: stato() });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => LUNEDI });
  await ps.apri(PORTA);
  assert.equal(ps.modello().errore, "Sei senza connessione. Riprova tra poco.");
  const v = vistaPorta(h, ps);
  await bottone(v, "Riprova").a.onclick();
  assert.equal(ps.modello().errore, null);
  assert.equal(ps.modello().schermata.tipo, "porta");
});

test("vista: titolo, nome ed età, conto, saldo, pulsante «Blocca 10 crediti» con la spiegazione e «Torna alla stanza»", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato() });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => LUNEDI });
  await ps.apri(PORTA);
  sv.risposte.blocca = { ok: true, esito: "bloccata", stato: stato([porta({ mia_caparra: true })], 10) };
  const v = vistaPorta(h, ps);
  const t = testo(v);
  assert.ok(t.includes(TESTI.aperta));
  assert.ok(t.includes("Giulia, 31"));
  assert.ok(t.includes("Mancano 34 ore e 30 minuti per lo svelamento."));
  assert.ok(t.includes("I tuoi crediti: 20"));
  assert.ok(t.includes(TESTI_SVELAMENTO.spiegazioneCaparra));
  const b = bottone(v, "Blocca 10 crediti");
  assert.ok(b, "pulsante presente");
  assert.equal(b.a["aria-describedby"], "caparra-spiegazione");
  await b.a.onclick();
  assert.deepEqual(sv.chiamate.at(-1), ["blocca", PORTA]);
  assert.ok(bottone(vistaPorta(h, ps), "Torna alla stanza"));
  assert.equal(bottone(vistaPorta(h, ps), "Blocca 10 crediti"), undefined, "dopo la caparra il pulsante sparisce");
});

test("vista con pochi crediti: «Ricarica» mostra solo il testo della beta, nessun pagamento e nessun blocco", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato([porta()], 3) });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => LUNEDI });
  await ps.apri(PORTA);
  let v = vistaPorta(h, ps);
  assert.ok(testo(v).includes("Ti mancano 7 crediti"));
  assert.equal(bottone(v, "Blocca 10 crediti"), undefined);
  assert.ok(!testo(v).includes(TESTI_SVELAMENTO.beta), "il testo della beta arriva dopo il tocco");
  const r = bottone(v, "Ricarica");
  assert.equal(r.a["aria-expanded"], "false");
  r.a.onclick();
  v = vistaPorta(h, ps);
  assert.ok(testo(v).includes(TESTI_SVELAMENTO.beta));
  assert.equal(bottone(v, "Ricarica").a["aria-expanded"], "true");
  assert.ok(!sv.chiamate.some((c) => Array.isArray(c)), "nessuna richiesta di blocco");
  assert.equal(tutti(v, (x) => x.tag === "a").length, 0, "nessun link a pagamenti");
});

test("vista chiusa: niente da mostrare", () => {
  const ps = creaPortaSvelamento({ svelamento: svelamentoFinto({ ok: true, stato: stato() }) });
  assert.equal(vistaPorta(h, ps), null);
});

// ---- collegamenti nella web app -----------------------------------------------------------------------------------
test("avvio e flusso: «Vai allo svelamento» apre la schermata della porta, solo con il telefono acceso", () => {
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /creaSvelamento\(\{ token: \(\) => accesso\.token\(\), fetch: window\.fetch\.bind\(window\) \}\)/);
  assert.match(avvio, /creaPortaSvelamento\(/);
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /portaSvelamento = \(telefono && opzioni\.porta\) \|\| null;/);
  assert.match(flusso, /svelamento = portaSvelamento \? \(id\) => portaSvelamento\.apri\(id\) : null;/);
  const disegnaCorpo = flusso.slice(flusso.indexOf("function disegna()"), flusso.indexOf("function barra()"));
  assert.match(disegnaCorpo, /portaSvelamento && portaSvelamento\.modello\(\)\.aperta/);
  assert.match(flusso, /export function portaCambiata\(\)/);
});

test("service worker: il modulo nuovo è nella cache e la versione è cambiata", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.ok(sw.includes('"/app/moduli/svelamento.js"'));
  assert.ok(!sw.includes('"presente-app-30"'));
});
