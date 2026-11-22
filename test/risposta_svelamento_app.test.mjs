// Issue #65, passo 8b-3a (spec v1 del CPO, passi 8-9; regola del CPO del 21/11 sull'esito): nella schermata della
// porta, dopo lo svelamento, la domanda segreta «Vuoi incontrare <nome>?» con Sì / No, la conferma «Rispondi sì? Non
// potrai cambiarla.» (Conferma / Annulla, usabile da tastiera), poi «Hai risposto. Saprai com'è andata entro <quando>.»
// e l'esito uguale per entrambi. Le regole (una risposta sola, doppio sì subito, il resto a fine 48 ore) le applica il
// server (passi 8b-1 e 8b-2a). h finto, rete finta, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI, schermataPorta, contoRisposta, creaSvelamento, creaPortaSvelamento, vistaPorta } from "../landing/app/moduli/svelamento.js";
import { TESTI_SVELAMENTO } from "../api/svelamento.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LEI = "11111111-2222-4333-8444-555555555555";
const MARTEDI = new Date("2026-11-17T10:00:00Z");
const svelata = (extra = {}) => ({ porta: PORTA, con: LEI, nome: "Giulia", eta: 31, tipo: "video",
  finito_il: "2026-11-16T19:00:00Z", risposta_scade_il: "2026-11-18T19:00:00Z", ho_risposto: false,
  domanda: "Vuoi incontrare Giulia?", in_attesa: null, ...extra });
const esito = (extra = {}) => ({ porta: PORTA, con: LEI, nome: "Giulia", eta: 31, esito: "doppio_si",
  esito_il: "2026-11-17T09:00:00Z", testo: TESTI_SVELAMENTO.doppioSi, ...extra });
const stato = ({ porte = [], svelate = [], esiti = [] } = {}) => ({ saldo: 0, caparra: 100, beta: true, porte, svelate, esiti });

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];

function reteFinta(...risposte) {
  const chiamate = [];
  const f = async (url, init) => {
    chiamate.push({ url, init });
    const r = risposte.length > 1 ? risposte.shift() : risposte[0];
    return { status: r.status ?? 200, json: async () => r.corpo };
  };
  return { f, chiamate };
}

function svelamentoFinto(...letture) {
  const chiamate = [];
  const risposte = {};
  return {
    chiamate, risposte,
    async leggi() { chiamate.push("leggi"); return letture.length > 1 ? letture.shift() : letture[0]; },
    async rispondi(p, r) { chiamate.push(["rispondi", p, r]); return risposte.rispondi; },
  };
}

test("testi della domanda e della conferma: uguali a quelli del server", () => {
  assert.equal(TESTI.si, "Sì");
  assert.equal(TESTI.no, "No");
  assert.equal(TESTI.confermaSi, TESTI_SVELAMENTO.confermaSi);
  assert.equal(TESTI.confermaNo, TESTI_SVELAMENTO.confermaNo);
  assert.equal(TESTI.conferma, TESTI_SVELAMENTO.conferma);
  assert.equal(TESTI.annulla, TESTI_SVELAMENTO.annulla);
});

test("contoRisposta: ore e minuti per rispondere, null a tempo finito", () => {
  assert.equal(contoRisposta("2026-11-18T19:00:00Z", MARTEDI), "Mancano 33 ore e 0 minuti per rispondere.");
  assert.equal(contoRisposta("2026-11-17T11:01:00Z", MARTEDI), "Manca 1 ora e 1 minuto per rispondere.");
  assert.equal(contoRisposta("2026-11-17T10:00:20Z", MARTEDI), "Manca 1 minuto per rispondere.");
  assert.equal(contoRisposta("2026-11-17T10:00:00Z", MARTEDI), null);
  assert.equal(contoRisposta("domani", MARTEDI), null);
});

test("schermata: porta svelata senza risposta → domanda del server, conto delle 48 ore, nessuna attesa", () => {
  const s = schermataPorta(stato({ svelate: [svelata()] }), PORTA, MARTEDI);
  assert.equal(s.tipo, "risposta");
  assert.equal(s.domanda, "Vuoi incontrare Giulia?");
  assert.equal(s.chi, "Giulia, 31");
  assert.equal(s.conto, "Mancano 33 ore e 0 minuti per rispondere.");
  assert.equal(s.hoRisposto, false);
  assert.equal(s.inAttesa, null);
});

test("schermata: domanda mancante dal server → la si scrive con il nome", () => {
  const s = schermataPorta(stato({ svelate: [svelata({ domanda: null })] }), PORTA, MARTEDI);
  assert.equal(s.domanda, "Vuoi incontrare Giulia?");
});

test("schermata: dopo la risposta solo «Hai risposto…» del server, mai cosa né se l'altra ha risposto", () => {
  const attesa = "Hai risposto. Saprai com'è andata entro mercoledì 18 novembre alle 20:00.";
  const s = schermataPorta(stato({ svelate: [svelata({ ho_risposto: true, in_attesa: attesa })] }), PORTA, MARTEDI);
  assert.equal(s.tipo, "risposta");
  assert.equal(s.hoRisposto, true);
  assert.equal(s.inAttesa, attesa);
  assert.equal(Object.hasOwn(s, "risposta"), false);
});

test("schermata: l'esito vince sulla porta svelata; doppio sì e chiusa col testo del server", () => {
  const d = schermataPorta(stato({ svelate: [svelata()], esiti: [esito()] }), PORTA, MARTEDI);
  assert.equal(d.tipo, "esito");
  assert.equal(d.esito, "doppio_si");
  assert.equal(d.testo, "Vi siete detti sì. Ora fissate l'incontro.");
  const c = schermataPorta(stato({ esiti: [esito({ esito: "chiusa", testo: TESTI_SVELAMENTO.chiusa })] }), PORTA, MARTEDI);
  assert.equal(c.esito, "chiusa");
  assert.equal(c.testo, TESTI_SVELAMENTO.chiusa);
});

test("schermata: esito sconosciuto → porta chiusa, mai un testo inventato", () => {
  const s = schermataPorta(stato({ esiti: [esito({ esito: "boh", testo: "x" })] }), PORTA, MARTEDI);
  assert.equal(s.tipo, "chiusa");
});

test("rispondi: POST { azione: rispondi, porta, risposta } con il token e basta; valori non previsti non partono", async () => {
  const dopo = stato({ svelate: [svelata({ ho_risposto: true, in_attesa: "Hai risposto." })] });
  const rete = reteFinta({ corpo: { ok: true, esito: "risposto", stato: dopo } });
  const s = creaSvelamento({ token: () => "tok", fetch: rete.f });
  const r = await s.rispondi(PORTA, "si");
  assert.equal(r.ok, true);
  assert.equal(r.esito, "risposto");
  assert.deepEqual(r.stato, dopo);
  assert.deepEqual(JSON.parse(rete.chiamate[0].init.body), { azione: "rispondi", porta: PORTA, risposta: "si" });
  assert.equal(rete.chiamate[0].init.method, "POST");
  assert.equal((await s.rispondi(PORTA, "forse")).ok, false);
  assert.equal((await s.rispondi("non-un-id", "no")).ok, false);
  assert.equal(rete.chiamate.length, 1, "nessuna richiesta per dati non validi");
});

test("rispondi: già risposto e tempo scaduto diventano testi brevi", async () => {
  const s1 = creaSvelamento({ token: () => "tok", fetch: reteFinta({ corpo: { ok: false, motivo: "gia_risposto" } }).f });
  const r1 = await s1.rispondi(PORTA, "no");
  assert.equal(r1.motivo, "gia_risposto");
  assert.equal(r1.testo, TESTI.giaRisposto);
  const s2 = creaSvelamento({ token: () => "tok", fetch: reteFinta({ corpo: { ok: false, motivo: "tempo_scaduto", testo: TESTI_SVELAMENTO.chiusa } }).f });
  assert.equal((await s2.rispondi(PORTA, "si")).testo, TESTI_SVELAMENTO.chiusa);
});

test("controllo: Sì apre la conferma, Annulla la chiude, nessuna richiesta senza Conferma", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato({ svelate: [svelata()] }) });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => MARTEDI });
  await ps.apri(PORTA);
  ps.scegliRisposta("si");
  assert.equal(ps.modello().conferma, "si");
  ps.scegliRisposta("forse");
  assert.equal(ps.modello().conferma, "si", "valori non previsti ignorati");
  ps.annullaRisposta();
  assert.equal(ps.modello().conferma, null);
  ps.scegliRisposta("no");
  assert.equal(ps.modello().conferma, "no");
  assert.equal(sv.chiamate.filter((c) => Array.isArray(c)).length, 0);
});

test("controllo: Conferma manda la risposta scelta, poi la schermata dice «Hai risposto…»", async () => {
  const attesa = "Hai risposto. Saprai com'è andata entro mercoledì 18 novembre alle 20:00.";
  const sv = svelamentoFinto({ ok: true, stato: stato({ svelate: [svelata()] }) });
  sv.risposte.rispondi = { ok: true, esito: "risposto", stato: stato({ svelate: [svelata({ ho_risposto: true, in_attesa: attesa })] }) };
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => MARTEDI });
  await ps.apri(PORTA);
  ps.scegliRisposta("no");
  await ps.confermaRisposta();
  assert.deepEqual(sv.chiamate.find((c) => Array.isArray(c)), ["rispondi", PORTA, "no"]);
  const m = ps.modello();
  assert.equal(m.conferma, null);
  assert.equal(m.schermata.inAttesa, attesa);
});

test("controllo: doppio sì → esito subito dallo stato del server", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato({ svelate: [svelata()] }) });
  sv.risposte.rispondi = { ok: true, esito: "doppio_si", testo: TESTI_SVELAMENTO.doppioSi, stato: stato({ esiti: [esito()] }) };
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => MARTEDI });
  await ps.apri(PORTA);
  ps.scegliRisposta("si");
  await ps.confermaRisposta();
  assert.equal(ps.modello().schermata.tipo, "esito");
  assert.equal(ps.modello().schermata.testo, TESTI_SVELAMENTO.doppioSi);
});

test("controllo: «già risposto» dal server → si rilegge e compare il testo, la conferma si chiude", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato({ svelate: [svelata()] }) },
    { ok: true, stato: stato({ svelate: [svelata({ ho_risposto: true, in_attesa: "Hai risposto." })] }) });
  sv.risposte.rispondi = { ok: false, motivo: "gia_risposto", testo: TESTI.giaRisposto };
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => MARTEDI });
  await ps.apri(PORTA);
  ps.scegliRisposta("si");
  await ps.confermaRisposta();
  const m = ps.modello();
  assert.equal(m.conferma, null);
  assert.equal(m.errore, TESTI.giaRisposto);
  assert.equal(m.schermata.hoRisposto, true);
  assert.equal(sv.chiamate.filter((c) => c === "leggi").length, 2);
});

test("controllo: Conferma senza una scelta aperta o con una porta non svelata non manda nulla", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato({ svelate: [svelata()] }) });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => MARTEDI });
  await ps.apri(PORTA);
  await ps.confermaRisposta();
  assert.equal(sv.chiamate.filter((c) => Array.isArray(c)).length, 0);
  const sv2 = svelamentoFinto({ ok: true, stato: stato({ svelate: [svelata({ ho_risposto: true, in_attesa: "Hai risposto." })] }) });
  const ps2 = creaPortaSvelamento({ svelamento: sv2, adesso: () => MARTEDI });
  await ps2.apri(PORTA);
  ps2.scegliRisposta("si");
  assert.equal(ps2.modello().conferma, null, "dopo aver risposto non si apre più la conferma");
});

test("vista: domanda come titolo del gruppo, Sì e No, conto come timer", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato({ svelate: [svelata()] }) });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => MARTEDI });
  await ps.apri(PORTA);
  const v = vistaPorta(h, ps);
  const gruppo = tutti(v, (x) => x.a.classe === "risposta-svelamento")[0];
  assert.ok(gruppo);
  assert.equal(gruppo.a.role, "group");
  const titolo = tutti(gruppo, (x) => x.tag === "h2")[0];
  assert.equal(testo(titolo), "Vuoi incontrare Giulia?");
  assert.equal(gruppo.a["aria-labelledby"], titolo.a.id);
  assert.ok(bottone(v, "Sì"));
  assert.ok(bottone(v, "No"));
  assert.equal(tutti(v, (x) => x.a.role === "timer").map(testo)[0], "Mancano 33 ore e 0 minuti per rispondere.");
  assert.equal(bottone(v, "Conferma"), undefined);
  assert.equal(testo(tutti(v, (x) => x.tag === "h1")[0]), "Svelamento");
});

test("vista: dopo Sì la conferma con il suo testo, Conferma e Annulla; Sì e No spariscono", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato({ svelate: [svelata()] }) });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => MARTEDI });
  await ps.apri(PORTA);
  bottone(vistaPorta(h, ps), "Sì").a.onclick();
  const v = vistaPorta(h, ps);
  const domanda = tutti(v, (x) => x.a.id === "risposta-conferma")[0];
  assert.equal(testo(domanda), "Rispondi sì? Non potrai cambiarla.");
  const conferma = bottone(v, "Conferma");
  assert.ok(conferma);
  assert.equal(conferma.a["aria-describedby"], "risposta-conferma");
  assert.equal(conferma.a.id, "risposta-conferma-bottone", "il fuoco va qui (flusso.js)");
  assert.ok(bottone(v, "Annulla"));
  assert.equal(bottone(v, "Sì"), undefined);
  assert.equal(bottone(v, "No"), undefined);
  bottone(v, "Annulla").a.onclick();
  assert.ok(bottone(vistaPorta(h, ps), "Sì"));
  bottone(vistaPorta(h, ps), "No").a.onclick();
  assert.equal(testo(tutti(vistaPorta(h, ps), (x) => x.a.id === "risposta-conferma")[0]), "Rispondi no? Non potrai cambiarla.");
});

test("vista: dopo la risposta solo il testo di attesa, nessun pulsante di risposta", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato({ svelate: [svelata({ ho_risposto: true, in_attesa: "Hai risposto. Saprai com'è andata entro mercoledì." })] }) });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => MARTEDI });
  await ps.apri(PORTA);
  const v = vistaPorta(h, ps);
  assert.ok(tutti(v, (x) => x.a.role === "status" && testo(x) === "Hai risposto. Saprai com'è andata entro mercoledì.").length);
  assert.equal(bottone(v, "Sì"), undefined);
  assert.equal(bottone(v, "No"), undefined);
  assert.equal(bottone(v, "Conferma"), undefined);
});

test("vista: esito con il testo del server, annunciato; c'è sempre «Torna alla stanza»", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato({ esiti: [esito({ esito: "chiusa", testo: TESTI_SVELAMENTO.chiusa })] }) });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => MARTEDI });
  await ps.apri(PORTA);
  const v = vistaPorta(h, ps);
  assert.ok(tutti(v, (x) => x.a.role === "status" && testo(x) === TESTI_SVELAMENTO.chiusa).length);
  assert.ok(bottone(v, TESTI.torna));
});

test("vista: a video finito («Ecco <nome>.») compare sotto la domanda del sì/no", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato({ svelate: [svelata()] }) });
  const finto = { modello: () => ({ stato: "finito", secondi: 0, sfocato: false, muto: false, riprove: 0, testo: null }),
    nome: () => "Giulia", schermo: () => null, filigrana: () => "", chiudi() {} };
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => MARTEDI });
  await ps.apri(PORTA);
  ps.video = () => finto;
  const v = vistaPorta(h, ps);
  assert.ok(tutti(v, (x) => testo(x) === "Ecco Giulia.").length);
  assert.ok(bottone(v, "Sì"));
});

test("flusso: quando si apre la conferma il fuoco va su «Conferma»; quando si chiude torna al gruppo della domanda", async () => {
  const { readFileSync } = await import("node:fs");
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  const corpo = flusso.slice(flusso.indexOf("export function portaCambiata"), flusso.indexOf("export function avvisiCambiati"));
  assert.match(corpo, /portaSvelamento\.modello\(\)\.conferma/);
  assert.match(corpo, /#risposta-conferma-bottone/);
  assert.match(corpo, /\.risposta-svelamento button/);
});
