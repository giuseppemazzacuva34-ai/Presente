// Design v4 (#349, approvato da Giuseppe il 22/11), schermata 40 «Lo svelamento · Come» (#n28 nel prototipo).
// Linea «sviluppatore-c», d'accordo con il CTO (plancia 22/11): modulo proprio svelamento_come.js con
// vistaCome(h, ps, m, s). Usa solo ps.scegli, ps.pronto, ps.mostraOrari, ps.impostaFascia e ps.inviaFasce di
// svelamento.js, senza cambiarne la logica. h finto, ps finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schermataPorta } from "../landing/app/moduli/svelamento.js";
import { TESTI_COME, vistaCome, orarioBreve } from "../landing/app/moduli/svelamento_come.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LEI = "11111111-2222-4333-8444-555555555555";
const ADESSO = new Date("2026-11-16T09:40:00Z");
const porta = (extra = {}) => ({ porta: PORTA, con: LEI, nome: "Giulia", eta: 31, aperta_il: "2026-11-15T20:00:00Z",
  scade_il: "2026-11-17T20:00:00Z", mia_caparra: true, sua_caparra: true, aspetta: null, mia_scelta: "video",
  mie_fasce: [], fascia_fissata: null, mio_pronto: false, suo_pronto: false, pronto_scade_il: null, pronta: null, ...extra });
const schermata = (p = porta()) => schermataPorta({ saldo: 0, caparra: 10, beta: true, porte: [p] }, PORTA, ADESSO);

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const conClasse = (n, c) => tutti(n, (x) => String(x.a.classe || "").split(" ").includes(c));
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x).includes(t))[0];

function psFinto(m = {}) {
  const chiamate = [];
  const ps = {};
  for (const f of ["scegli", "pronto", "mostraOrari", "impostaFascia", "inviaFasce"]) ps[f] = (...a) => { chiamate.push([f, ...a]); };
  return { ps, chiamate, m: { inCorso: false, orari: false, bozza: ["", "", ""], ...m } };
}

test("senza porta, o prima della propria caparra: niente", () => {
  const { ps, m } = psFinto();
  assert.equal(vistaCome(h, ps, m, null), null);
  assert.equal(vistaCome(h, ps, m, { tipo: "chiusa", testo: "x" }), null);
  assert.equal(vistaCome(h, ps, m, schermata(porta({ mia_caparra: false, sua_caparra: false }))), null);
});

test("titolo «Come vi volete vedere?» con «vedere?» in evidenza", () => {
  const { ps, m } = psFinto();
  const v = vistaCome(h, ps, m, schermata());
  const t = tutti(v, (x) => x.tag === "h2" && x.a.id === "come-titolo")[0];
  assert.equal(testo(t), "Come vi volete vedere?");
  assert.equal(testo(tutti(t, (x) => x.tag === "em")[0]), "vedere?");
});

test("due schede a pressione: videochiamata con il cerchio dei 10 s, foto con la pila; il tocco chiama ps.scegli", () => {
  const { ps, m, chiamate } = psFinto();
  const v = vistaCome(h, ps, m, schermata());
  const gruppo = conClasse(v, "scelta2")[0];
  assert.equal(gruppo.a.role, "group");
  assert.equal(gruppo.a["aria-labelledby"], "come-titolo");
  const schede = tutti(gruppo, (x) => x.tag === "button");
  assert.equal(schede.length, 2);
  const [video, foto] = schede;
  assert.match(testo(video), /Videochiamata/);
  assert.match(testo(video), /Dieci secondi, poi si chiude da sola\./);
  assert.match(testo(foto), /Le foto/);
  assert.match(testo(foto), /Le vostre tre foto, insieme\./);
  assert.equal(video.a["aria-pressed"], "true");
  assert.equal(foto.a["aria-pressed"], "false");
  assert.ok(String(video.a.classe).split(" ").includes("on"));
  const anello = conClasse(video, "anello")[0];
  assert.equal(anello.a["aria-hidden"], "true");
  assert.equal(testo(anello), "10 s");
  const pila = conClasse(foto, "pila")[0];
  assert.equal(pila.a["aria-hidden"], "true");
  assert.equal(tutti(pila, (x) => x.tag === "i").length, 3);
  foto.a.onclick();
  assert.deepEqual(chiamate, [["scegli", "foto"]]);
});

test("la scelta salvata si vede; in corso le schede sono spente; mai la scelta dell'altra persona", () => {
  const { ps, m } = psFinto({ inCorso: true });
  const v = vistaCome(h, ps, m, schermata(porta({ mia_scelta: "foto" })));
  const [video, foto] = tutti(conClasse(v, "scelta2")[0], (x) => x.tag === "button");
  assert.equal(foto.a["aria-pressed"], "true");
  assert.equal(video.a["aria-pressed"], "false");
  assert.equal(video.a.disabled, true);
  assert.ok(!testo(v).toLowerCase().includes("giulia"));
});

test("«Quando»: selettore unico Adesso / Scegli un orario; «Ci sono adesso» chiama ps.pronto", () => {
  const { ps, m, chiamate } = psFinto();
  const v = vistaCome(h, ps, m, schermata());
  assert.equal(testo(tutti(v, (x) => x.a.id === "quando-titolo")[0]), "Quando");
  const seg = conClasse(v, "segmenti")[0];
  assert.equal(seg.a.role, "group");
  assert.equal(seg.a["aria-labelledby"], "quando-titolo");
  const [adesso, orario] = tutti(seg, (x) => x.tag === "button");
  assert.equal(testo(adesso), TESTI_COME.adesso);
  assert.equal(testo(orario), "Scegli un orario");
  assert.equal(adesso.a["aria-pressed"], "true");
  assert.equal(orario.a["aria-pressed"], "false");
  adesso.a.onclick();
  assert.deepEqual(chiamate, [], "già su «Adesso»: nessun cambio");
  orario.a.onclick();
  assert.deepEqual(chiamate, [["mostraOrari"]]);
  assert.equal(tutti(v, (x) => x.tag === "select").length, 0, "gli orari solo dopo «Scegli un orario»");
  bottone(v, "Ci sono adesso").a.onclick();
  assert.deepEqual(chiamate.at(-1), ["pronto"]);
});

test("con gli orari: 3 menu etichettati in fila, orari brevi, «Salva gli orari» chiama ps.inviaFasce", () => {
  const { ps, m, chiamate } = psFinto({ orari: true, bozza: ["2026-11-16T20:30:00.000Z", "", ""] });
  const v = vistaCome(h, ps, m, schermata());
  const [adesso, orario] = tutti(conClasse(v, "segmenti")[0], (x) => x.tag === "button");
  assert.equal(adesso.a["aria-pressed"], "false");
  assert.equal(orario.a["aria-pressed"], "true");
  const fila = conClasse(v, "orari")[0];
  const menu = tutti(fila, (x) => x.tag === "select");
  assert.equal(menu.length, 3);
  for (const [i, s] of menu.entries()) {
    assert.equal(s.a.id, `fascia-${i + 1}`);
    assert.equal(tutti(v, (x) => x.tag === "label" && x.a.for === s.a.id).length, 1);
  }
  const scelta = tutti(menu[0], (x) => x.tag === "option" && x.a.selected)[0];
  assert.equal(testo(scelta), "lun 16, 21:30");
  menu[1].a.onchange({ target: { value: "2026-11-16T21:00:00.000Z" } });
  assert.deepEqual(chiamate.at(-1), ["impostaFascia", 1, "2026-11-16T21:00:00.000Z"]);
  bottone(v, "Salva gli orari").a.onclick();
  assert.deepEqual(chiamate.at(-1), ["inviaFasce"]);
  assert.equal(bottone(v, "Ci sono adesso"), undefined);
  adesso.a.onclick();
  assert.deepEqual(chiamate.at(-1), ["mostraOrari"], "«Adesso» richiude gli orari");
});

test("prima della caparra dell'altra persona: le schede sì, «Quando» no", () => {
  const { ps, m } = psFinto();
  const v = vistaCome(h, ps, m, schermata(porta({ sua_caparra: false })));
  assert.ok(conClasse(v, "scelta2")[0]);
  assert.equal(conClasse(v, "segmenti")[0], undefined);
});

test("gli stati del server restano visibili (es. orario fissato)", () => {
  const { ps, m } = psFinto();
  const v = vistaCome(h, ps, m, schermata(porta({ mie_fasce: ["2026-11-16T20:30:00.000Z"], fascia_fissata: "2026-11-16T20:30:00.000Z" })));
  assert.ok(tutti(v, (x) => x.a.role === "status" && /Lo svelamento è fissato/.test(testo(x))).length === 1);
});

test("orarioBreve: giorno corto e ora italiana; vuoto se non leggibile", () => {
  assert.equal(orarioBreve("2026-11-16T20:30:00.000Z"), "lun 16, 21:30");
  assert.equal(orarioBreve("nulla"), "");
});

test("testi senza genere; stile nel blocco «Linea C (#349)» di app.css", () => {
  for (const t of Object.values(TESTI_COME)) assert.doesNotMatch(t, /\b(pront[oaie]|arrivat[oaie]|tutti|tutte)\b/i);
  const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
  const blocco = css.slice(css.indexOf("Linea C (#349): «Lo svelamento · Come»"));
  assert.ok(blocco.length > 50, "blocco presente");
  for (const sel of [".come-svelamento .scelta2", ".come-svelamento .opz", ".come-svelamento .anello", ".come-svelamento .pila i",
    ".come-svelamento .segmenti", ".come-svelamento .orari"]) assert.ok(blocco.includes(sel), sel);
  assert.match(blocco, /\.come-svelamento \.opz\[aria-pressed="true"\]/);
  assert.match(blocco, /\.come-svelamento \.segmenti \[aria-pressed="true"\]/);
});
