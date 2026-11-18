// Issue #65, passo 5b (spec v1 del CPO, passo 4 «Quando»; D48 A): nella schermata della porta, quando tutti e due
// hanno bloccato la caparra, «Sono pronto ora» (5 minuti per l'altra persona) e «Scegli un orario» (fino a 3 mezz'ore
// dentro le 48 ore; l'app fissa la prima comune). Le regole le applica il server (passo 5a, /app/api/svelamento
// { azione: "pronto" | "fasce" }); le fasce dell'altra persona non arrivano mai al telefono. h finto, rete finta,
// nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TESTI, schermataPorta, fascePossibili, etichettaFascia, creaSvelamento, creaPortaSvelamento, vistaPorta }
  from "../landing/app/moduli/svelamento.js";
import { TESTI_SVELAMENTO } from "../api/svelamento.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LEI = "11111111-2222-4333-8444-555555555555";
// Lunedì 16/11 alle 10:40 in Italia (09:40 UTC); la porta scade martedì 17/11 alle 21:00 (20:00 UTC).
const ADESSO = new Date("2026-11-16T09:40:00Z");
const porta = (extra = {}) => ({ porta: PORTA, con: LEI, nome: "Giulia", eta: 31, aperta_il: "2026-11-15T20:00:00Z",
  scade_il: "2026-11-17T20:00:00Z", mia_caparra: true, sua_caparra: true, aspetta: null, mia_scelta: "video",
  mie_fasce: [], fascia_fissata: null, mio_pronto: false, suo_pronto: false, pronto_scade_il: null, pronta: null, ...extra });
const stato = (porte = [porta()], saldo = 0) => ({ saldo, caparra: 10, beta: true, porte });

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
    async blocca(p) { chiamate.push(["blocca", p]); return risposte.blocca; },
    async scegli(p, s) { chiamate.push(["scegli", p, s]); return risposte.scegli; },
    async pronto(p) { chiamate.push(["pronto", p]); return risposte.pronto; },
    async fasce(p, f) { chiamate.push(["fasce", p, f]); return risposte.fasce; },
  };
}

test("testi dei due pulsanti: uguali a quelli del server", () => {
  assert.equal(TESTI.prontoOra, TESTI_SVELAMENTO.prontoOra);
  assert.equal(TESTI.scegliOrario, TESTI_SVELAMENTO.scegliOrario);
  assert.equal(TESTI.fasciaFissata, TESTI_SVELAMENTO.fasciaFissata);
  assert.equal(TESTI.nessunaFascia, TESTI_SVELAMENTO.nessunaFascia);
});

test("fasce possibili: mezz'ore future allineate, che finiscono entro la scadenza", () => {
  const f = fascePossibili("2026-11-17T20:00:00Z", ADESSO);
  assert.equal(f[0], "2026-11-16T10:00:00.000Z", "la prima mezz'ora non ancora iniziata");
  assert.equal(f.at(-1), "2026-11-17T19:30:00.000Z", "l'ultima finisce alla scadenza");
  assert.equal(f.length, 68);
  assert.ok(f.every((x) => Date.parse(x) % 1800000 === 0));
  assert.deepEqual(fascePossibili("2026-11-17T20:00:00Z", new Date("2026-11-17T19:31:00Z")), [], "nessuna mezz'ora intera rimasta");
  assert.deepEqual(fascePossibili("non una data", ADESSO), []);
  assert.equal(fascePossibili("2026-11-17T20:00:00Z", new Date("2026-11-16T10:00:00Z"))[0], "2026-11-16T10:00:00.000Z", "una mezz'ora che inizia adesso vale");
});

test("etichetta di una fascia: giorno e ora italiani", () => {
  const e = etichettaFascia("2026-11-17T20:30:00Z");
  assert.match(e, /^martedì 17 novembre, 21:30$/);
  assert.equal(etichettaFascia("boh"), "");
});

test("schermata: «Quando» solo con la caparra di tutti e due", () => {
  assert.equal(schermataPorta(stato([porta({ sua_caparra: false })]), PORTA, ADESSO).quando, null);
  assert.equal(schermataPorta(stato([porta({ mia_caparra: false, sua_caparra: false })], 20), PORTA, ADESSO).quando, null);
  const q = schermataPorta(stato(), PORTA, ADESSO).quando;
  assert.equal(q.titolo, TESTI.quandoTitolo);
  assert.equal(q.ora, "Sono pronto ora");
  assert.equal(q.orario, "Scegli un orario");
  assert.equal(q.opzioni.length, 68);
  assert.deepEqual(q.opzioni[0], { valore: "2026-11-16T10:00:00.000Z", testo: "lunedì 16 novembre, 11:00" });
  assert.equal(q.fissata, null);
  assert.equal(q.nessuna, null, "nessun orario segnato: niente avviso");
});

test("schermata: «sono pronto» con i minuti rimasti, l'altra pronta, entrambi pronti", () => {
  let q = schermataPorta(stato([porta({ mio_pronto: true, pronto_scade_il: "2026-11-16T09:43:10Z" })]), PORTA, ADESSO).quando;
  assert.equal(q.mioPronto, "Giulia ha ancora 4 minuti per entrare.");
  q = schermataPorta(stato([porta({ mio_pronto: true, pronto_scade_il: "2026-11-16T09:40:30Z" })]), PORTA, ADESSO).quando;
  assert.equal(q.mioPronto, "Giulia ha ancora 1 minuto per entrare.");
  q = schermataPorta(stato([porta({ mio_pronto: true, pronto_scade_il: "2026-11-16T09:39:00Z" })]), PORTA, ADESSO).quando;
  assert.equal(q.mioPronto, null, "finestra dei 5 minuti finita");
  q = schermataPorta(stato([porta({ suo_pronto: true, pronta: "Giulia è pronta per lo svelamento" })]), PORTA, ADESSO).quando;
  assert.equal(q.pronta, "Giulia è pronta per lo svelamento");
  q = schermataPorta(stato([porta({ mio_pronto: true, suo_pronto: true, pronto_scade_il: "2026-11-16T09:44:00Z", pronta: "x" })]), PORTA, ADESSO).quando;
  assert.equal(q.entrambi, TESTI.entrambiPronti);
  assert.equal(q.mioPronto, null);
  assert.equal(q.pronta, null);
});

test("schermata: fascia fissata con giorno e ora; senza fascia comune l'avviso", () => {
  let q = schermataPorta(stato([porta({ mie_fasce: ["2026-11-17T18:00:00.000Z"], fascia_fissata: "2026-11-17T18:00:00.000Z" })]), PORTA, ADESSO).quando;
  assert.equal(q.fissata, "Lo svelamento è fissato: martedì 17 novembre, 19:00");
  assert.equal(q.nessuna, null);
  q = schermataPorta(stato([porta({ mie_fasce: ["2026-11-17T18:00:00.000Z"] })]), PORTA, ADESSO).quando;
  assert.equal(q.fissata, null);
  assert.equal(q.nessuna, "Ancora nessun orario in comune.");
  assert.deepEqual(q.mie, ["2026-11-17T18:00:00.000Z"]);
});

test("rete: pronto e fasce partono con il token e basta; dati non validi non partono", async () => {
  const rete = reteFinta({ corpo: { ok: true, esito: "pronto", stato: stato() } });
  const s = creaSvelamento({ token: () => "tok", fetch: rete.f });
  assert.equal((await s.pronto(PORTA)).ok, true);
  assert.deepEqual(JSON.parse(rete.chiamate[0].init.body), { azione: "pronto", porta: PORTA });
  assert.equal(rete.chiamate[0].init.method, "POST");
  assert.equal(rete.chiamate[0].init.headers.authorization, "Bearer tok");
  const fasce = ["2026-11-17T18:00:00.000Z", "2026-11-16T10:00:00.000Z"];
  assert.equal((await s.fasce(PORTA, fasce)).ok, true);
  assert.deepEqual(JSON.parse(rete.chiamate[1].init.body), { azione: "fasce", porta: PORTA, fasce });
  assert.equal((await s.pronto("x")).ok, false);
  assert.equal((await s.fasce(PORTA, [])).ok, false);
  assert.equal((await s.fasce(PORTA, ["a", "b", "c", "d"])).ok, false);
  assert.equal(rete.chiamate.length, 2, "nessuna richiesta per dati non validi");
});

test("rete: rifiuti del server «manca_caparra» e «fasce_non_valide» diventano testi brevi", async () => {
  let s = creaSvelamento({ token: () => "tok", fetch: reteFinta({ corpo: { ok: false, motivo: "manca_caparra" } }).f });
  assert.equal((await s.pronto(PORTA)).testo, TESTI.mancaCaparra);
  s = creaSvelamento({ token: () => "tok", fetch: reteFinta({ corpo: { ok: false, motivo: "fasce_non_valide" } }).f });
  assert.equal((await s.fasce(PORTA, ["2026-11-17T18:00:00.000Z"])).testo, TESTI.fasceNonValide);
});

test("controllo: «Sono pronto ora» una volta sola, la schermata segue il server", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato() });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => ADESSO });
  await ps.apri(PORTA);
  sv.risposte.pronto = { ok: true, esito: "pronto", stato: stato([porta({ mio_pronto: true, pronto_scade_il: "2026-11-16T09:45:00Z" })]) };
  await Promise.all([ps.pronto(), ps.pronto()]);
  assert.deepEqual(sv.chiamate.filter(Array.isArray), [["pronto", PORTA]]);
  assert.equal(ps.modello().schermata.quando.mioPronto, "Giulia ha ancora 5 minuti per entrare.");
});

test("controllo: orari scelti (al massimo 3, doppioni tolti), invio e fascia fissata", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato() });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => ADESSO });
  await ps.apri(PORTA);
  assert.equal(ps.modello().orari, false);
  ps.mostraOrari();
  assert.equal(ps.modello().orari, true);
  assert.deepEqual(ps.modello().bozza, ["", "", ""]);
  await ps.inviaFasce();
  assert.equal(ps.modello().errore, TESTI.almenoUno);
  assert.equal(sv.chiamate.filter(Array.isArray).length, 0);
  ps.impostaFascia(0, "2026-11-17T18:00:00.000Z");
  ps.impostaFascia(1, "2026-11-17T18:00:00.000Z");
  ps.impostaFascia(2, "2026-11-16T10:00:00.000Z");
  ps.impostaFascia(5, "2026-11-16T11:00:00.000Z");
  assert.equal(ps.modello().errore, null, "toccare un orario toglie l'errore");
  sv.risposte.fasce = { ok: true, esito: "fissata", stato: stato([porta({ mie_fasce: ["2026-11-16T10:00:00.000Z", "2026-11-17T18:00:00.000Z"], fascia_fissata: "2026-11-17T18:00:00.000Z" })]) };
  await ps.inviaFasce();
  assert.deepEqual(sv.chiamate.filter(Array.isArray), [["fasce", PORTA, ["2026-11-16T10:00:00.000Z", "2026-11-17T18:00:00.000Z"]]]);
  const m = ps.modello();
  assert.equal(m.orari, false, "salvato: si torna al riepilogo");
  assert.equal(m.schermata.quando.fissata, "Lo svelamento è fissato: martedì 17 novembre, 19:00");
});

test("controllo: aprendo gli orari si parte dai propri già salvati", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato([porta({ mie_fasce: ["2026-11-16T10:00:00.000Z"] })]) });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => ADESSO });
  await ps.apri(PORTA);
  ps.mostraOrari();
  assert.deepEqual(ps.modello().bozza, ["2026-11-16T10:00:00.000Z", "", ""]);
});

test("controllo: orario non più valido → testo e si rilegge; caparra mancante → testo", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato() });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => ADESSO });
  await ps.apri(PORTA);
  ps.mostraOrari();
  ps.impostaFascia(0, "2026-11-16T10:00:00.000Z");
  sv.risposte.fasce = { ok: false, motivo: "fasce_non_valide", testo: TESTI.fasceNonValide };
  await ps.inviaFasce();
  assert.equal(ps.modello().errore, TESTI.fasceNonValide);
  assert.equal(ps.modello().orari, true, "resta sugli orari per correggere");
  assert.equal(sv.chiamate.filter((c) => c === "leggi").length, 2);
  sv.risposte.pronto = { ok: false, motivo: "manca_caparra", testo: TESTI.mancaCaparra };
  await ps.pronto();
  assert.equal(ps.modello().errore, TESTI.mancaCaparra);
});

test("vista: «Quando?» con i due pulsanti; gli orari in 3 menu con etichetta; nessuna fascia dell'altra", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato() });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => ADESSO });
  await ps.apri(PORTA);
  let v = vistaPorta(h, ps);
  const gruppo = tutti(v, (x) => x.a.role === "group" && x.a["aria-labelledby"] === "quando-titolo")[0];
  assert.ok(gruppo);
  assert.ok(testo(gruppo).includes(TESTI.quandoTitolo));
  sv.risposte.pronto = { ok: true, esito: "pronto", stato: stato([porta({ mio_pronto: true, pronto_scade_il: "2026-11-16T09:45:00Z" })]) };
  await bottone(v, "Sono pronto ora").a.onclick();
  v = vistaPorta(h, ps);
  assert.ok(tutti(v, (x) => x.a.role === "status" && testo(x) === "Giulia ha ancora 5 minuti per entrare.").length === 1);
  bottone(v, "Scegli un orario").a.onclick();
  v = vistaPorta(h, ps);
  const menu = tutti(v, (x) => x.tag === "select");
  assert.equal(menu.length, 3);
  for (const [i, m] of menu.entries()) {
    assert.equal(m.a.id, `fascia-${i + 1}`);
    assert.ok(tutti(v, (x) => x.tag === "label" && x.a.for === m.a.id).length === 1, "ogni menu ha la sua etichetta");
    assert.equal(tutti(m, (x) => x.tag === "option").length, 69, "«nessuno» + 68 mezz'ore");
  }
  menu[0].a.onchange({ target: { value: "2026-11-16T10:00:00.000Z" } });
  assert.deepEqual(ps.modello().bozza, ["2026-11-16T10:00:00.000Z", "", ""]);
  assert.ok(bottone(vistaPorta(h, ps), TESTI.salvaOrari));
  assert.ok(!testo(v).toLowerCase().includes("fasce di giulia"));
});

test("vista prima delle due caparre: niente «Quando?»", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato([porta({ sua_caparra: false })]) });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => ADESSO });
  await ps.apri(PORTA);
  const v = vistaPorta(h, ps);
  assert.equal(bottone(v, "Sono pronto ora"), undefined);
  assert.equal(bottone(v, "Scegli un orario"), undefined);
});

test("service worker: versione nuova per il modulo cambiato", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(!sw.includes('"presente-app-34"'));
});
