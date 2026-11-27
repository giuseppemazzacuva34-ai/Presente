// Issue #65, passo 3b (spec v1 del CPO, passo 3; D48 A): nella schermata della porta, dopo la propria caparra, le due
// scelte «Videochiamata di 10 secondi» (predefinita) e «Preferisco le foto». Si cambia fino all'inizio dello
// svelamento; la scelta dell'altra persona non si vede mai. Le regole le applica il server (passo 3a,
// /app/api/svelamento { azione: "scelta" }). h finto, rete finta, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TESTI, schermataPorta, creaSvelamento, creaPortaSvelamento, vistaPorta } from "../landing/app/moduli/svelamento.js";
import { TESTI_SVELAMENTO } from "../api/svelamento.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LEI = "11111111-2222-4333-8444-555555555555";
const LUNEDI = new Date("2026-11-16T09:30:00Z");
const porta = (extra = {}) => ({ porta: PORTA, con: LEI, nome: "Giulia", eta: 31, aperta_il: "2026-11-15T20:00:00Z",
  scade_il: "2026-11-17T20:00:00Z", mia_caparra: true, sua_caparra: false, aspetta: null, mia_scelta: "video", ...extra });
const stato = (porte = [porta()], saldo = 10) => ({ saldo, caparra: 10, beta: true, porte });

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
  };
}

test("testi delle due scelte: uguali a quelli del server", () => {
  assert.equal(TESTI.sceltaVideo, TESTI_SVELAMENTO.sceltaVideo);
  assert.equal(TESTI.sceltaFoto, TESTI_SVELAMENTO.sceltaFoto);
  assert.equal(TESTI.sceltaTitolo, "Come vuoi lo svelamento?");
});

test("schermata: prima della propria caparra nessuna scelta; dopo, video predefinito o la scelta salvata", () => {
  assert.equal(schermataPorta(stato([porta({ mia_caparra: false })], 20), PORTA, LUNEDI).scelta, null);
  const s = schermataPorta(stato(), PORTA, LUNEDI).scelta;
  assert.equal(s.attuale, "video");
  assert.deepEqual(s.opzioni, [{ valore: "video", testo: "Videochiamata di 10 secondi" }, { valore: "foto", testo: "Preferisco le foto" }]);
  assert.equal(schermataPorta(stato([porta({ mia_scelta: "foto" })]), PORTA, LUNEDI).scelta.attuale, "foto");
  assert.equal(schermataPorta(stato([porta({ mia_scelta: "altro" })]), PORTA, LUNEDI).scelta.attuale, "video", "valore strano = predefinita");
  assert.equal(schermataPorta(stato([porta({ sua_caparra: true })]), PORTA, LUNEDI).scelta.attuale, "video", "anche con entrambe le caparre");
});

test("scegli: POST { azione: scelta, porta, scelta } con il token e basta; valori non previsti non partono", async () => {
  const rete = reteFinta({ corpo: { ok: true, esito: "salvata", stato: stato([porta({ mia_scelta: "foto" })]) } });
  const s = creaSvelamento({ token: () => "tok", fetch: rete.f });
  const r = await s.scegli(PORTA, "foto");
  assert.equal(r.ok, true);
  assert.equal(r.stato.porte[0].mia_scelta, "foto");
  assert.equal(rete.chiamate.length, 1);
  assert.equal(rete.chiamate[0].url, "/app/api/svelamento");
  assert.equal(rete.chiamate[0].init.method, "POST");
  assert.deepEqual(JSON.parse(rete.chiamate[0].init.body), { azione: "scelta", porta: PORTA, scelta: "foto" });
  assert.equal((await s.scegli(PORTA, "audio")).ok, false);
  assert.equal((await s.scegli("non-un-id", "video")).ok, false);
  assert.equal(rete.chiamate.length, 1, "nessuna richiesta per dati non validi");
});

test("scegli: «già iniziato» dal server diventa un testo breve", async () => {
  const s = creaSvelamento({ token: () => "tok", fetch: reteFinta({ corpo: { ok: false, motivo: "gia_iniziato" } }).f });
  const r = await s.scegli(PORTA, "foto");
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "gia_iniziato");
  assert.equal(r.testo, TESTI.giaIniziato);
});

test("controllo: una richiesta alla volta, la stessa scelta non riparte, la schermata segue il server", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato() });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => LUNEDI });
  await ps.apri(PORTA);
  await ps.scegli("video");
  assert.equal(sv.chiamate.filter(Array.isArray).length, 0, "è già la scelta attuale");
  sv.risposte.scegli = { ok: true, esito: "salvata", stato: stato([porta({ mia_scelta: "foto" })]) };
  await Promise.all([ps.scegli("foto"), ps.scegli("foto")]);
  assert.deepEqual(sv.chiamate.filter(Array.isArray), [["scegli", PORTA, "foto"]]);
  assert.equal(ps.modello().schermata.scelta.attuale, "foto");
});

test("controllo: svelamento già iniziato → testo e si rilegge; porta chiusa → solo il testo del server", async () => {
  let sv = svelamentoFinto({ ok: true, stato: stato() });
  let ps = creaPortaSvelamento({ svelamento: sv, adesso: () => LUNEDI });
  await ps.apri(PORTA);
  sv.risposte.scegli = { ok: false, motivo: "gia_iniziato", testo: TESTI.giaIniziato };
  await ps.scegli("foto");
  assert.equal(ps.modello().errore, TESTI.giaIniziato);
  assert.equal(sv.chiamate.filter((c) => c === "leggi").length, 2);
  assert.equal(ps.modello().schermata.scelta.attuale, "video");

  sv = svelamentoFinto({ ok: true, stato: stato() }, { ok: true, stato: stato([]) });
  ps = creaPortaSvelamento({ svelamento: sv, adesso: () => LUNEDI });
  await ps.apri(PORTA);
  sv.risposte.scegli = { ok: false, motivo: "porta_chiusa", testo: "Questa porta si è chiusa." };
  await ps.scegli("foto");
  assert.deepEqual(ps.modello().schermata, { tipo: "chiusa", testo: "Questa porta si è chiusa." });
  assert.equal(ps.modello().errore, null);
});

// Design v4 (#349, schermata 40): la scelta è nelle due schede di vistaCome; il comportamento resta lo stesso.
const scheda = (n, t) => tutti(n, (x) => x.tag === "button" && tutti(x, (y) => y.tag === "b" && testo(y) === t).length > 0)[0];

test("vista: gruppo «Come vi volete vedere?» con due schede a pressione, il tocco salva la scelta", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato() });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => LUNEDI });
  await ps.apri(PORTA);
  let v = vistaPorta(h, ps);
  const gruppo = tutti(v, (x) => x.a.role === "group" && x.a["aria-labelledby"] === "porta-titolo")[0];
  assert.ok(gruppo, "gruppo presente (D149: nella 40 il nome del gruppo è il titolo della pagina)");
  assert.ok(testo(v).includes("Come vi volete vedere?"));
  const video = scheda(v, "Videochiamata");
  const foto = scheda(v, "Le foto");
  assert.equal(video.a["aria-pressed"], "true");
  assert.equal(foto.a["aria-pressed"], "false");
  sv.risposte.scegli = { ok: true, esito: "salvata", stato: stato([porta({ mia_scelta: "foto" })]) };
  await foto.a.onclick();
  assert.deepEqual(sv.chiamate.at(-1), ["scegli", PORTA, "foto"]);
  v = vistaPorta(h, ps);
  assert.equal(scheda(v, "Le foto").a["aria-pressed"], "true");
  assert.equal(scheda(v, "Videochiamata").a["aria-pressed"], "false");
  assert.ok(!testo(v).toLowerCase().includes("giulia ha scelto"), "mai la scelta dell'altra persona");
});

test("vista prima della caparra: nessuna scelta", async () => {
  const sv = svelamentoFinto({ ok: true, stato: stato([porta({ mia_caparra: false })], 20) });
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => LUNEDI });
  await ps.apri(PORTA);
  const v = vistaPorta(h, ps);
  assert.equal(scheda(v, "Le foto"), undefined);
  assert.ok(!testo(v).includes("Come vi volete vedere?"));
});

test("service worker: versione nuova per il modulo cambiato; stile dei pulsanti a pressione", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(!sw.includes('"presente-app-44"'));
  assert.ok(sw.includes('"/app/moduli/svelamento_come.js"'), "il modulo della schermata 40 funziona anche senza rete");
  const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
  assert.match(css, /\.come-svelamento \.opz\[aria-pressed="true"\]/);
  assert.ok(!css.includes(".scelta-svelamento"), "lo stile vecchio non serve più");
});
