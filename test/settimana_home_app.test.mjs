// Design v4 (issue #349, schermate 16 «La home» e 35 «Domenica sera»; LEGGIMI punto 8; linea «sviluppatore»): la
// home cambia con la settimana. Prima della stanza: «Ciao <nome>. La tua stanza apre lunedì.» e il conto alla rovescia
// al lunedì alle 9 (ora di Roma). In stanza la barra dei 7 giorni segna i giorni passati e oggi; domenica prima delle
// 21 il conto alla rovescia va alle 21. Mai «Il tuo profilo è pronto» nella home (né la sera delle porte).
// Solo calcoli e testi, orologio finto. Nomi inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { settimanaHome, contoAllaRovescia, vistaSettimanaHome, TESTI_SETTIMANA } from "../landing/app/moduli/settimana_home.js";

// Ore di Roma in novembre = UTC + 1.
const roma = (g, ora, min = 0, s = 0) => new Date(Date.UTC(2026, 10, g, ora - 1, min, s));
// 23/11/2026 è lunedì; 21/11 sabato; 22/11 domenica.

test("prima della stanza, sabato alle 15: «1 g 18 h» al lunedì alle 9, barra vuota, testi della schermata 16", () => {
  const m = settimanaHome(roma(21, 15), { nome: "Giulia", inStanza: false });
  assert.equal(m.titolo, "Ciao Giulia.");
  assert.equal(m.evidenza, "La tua stanza apre lunedì.");
  assert.equal(m.conto, "1 g 18 h");
  assert.equal(m.nota, "Lunedì alle 9 entri con 11 persone vicine a te.");
  assert.deepEqual(m.segmenti, ["", "", "", "", "", "", ""]);
  assert.equal(TESTI_SETTIMANA.etichetta, "La tua settimana");
});

test("conto alla rovescia: giorni e ore sopra le 24 ore, ore:minuti sotto; mai negativo", () => {
  assert.equal(contoAllaRovescia(roma(21, 15), roma(23, 9)), "1 g 18 h");
  assert.equal(contoAllaRovescia(roma(16, 9), roma(23, 9)), "7 g 0 h");
  assert.equal(contoAllaRovescia(roma(22, 20, 18), roma(22, 21)), "00:42");
  assert.equal(contoAllaRovescia(roma(22, 20, 59, 30), roma(22, 21)), "00:00");
  assert.equal(contoAllaRovescia(roma(22, 20, 44, 30), roma(22, 21)), "00:15"); // come «tra 15 minuti» delle chiavi
  assert.equal(contoAllaRovescia(roma(22, 21, 5), roma(22, 21)), "00:00");
  assert.equal(contoAllaRovescia(roma(22, 8, 0), roma(23, 9)), "1 g 1 h");
  assert.equal(contoAllaRovescia(roma(22, 10, 0), roma(23, 9)), "23:00");
});

test("prima della stanza, lunedì alle 8: il conto va alle 9 di oggi; dopo le 9 al lunedì dopo", () => {
  assert.equal(settimanaHome(roma(23, 8, 30), { nome: "Luca" }).conto, "00:30");
  assert.equal(settimanaHome(roma(23, 9, 30), { nome: "Luca" }).conto, "6 g 23 h");
});

test("prima della stanza, domenica sera dopo le 21: conto al lunedì, mai «Il tuo profilo è pronto»", () => {
  const m = settimanaHome(roma(22, 21, 30), { nome: "Giulia" });
  assert.equal(m.conto, "11:30");
  assert.equal(m.evidenza, "La tua stanza apre lunedì.");
});

test("in stanza da lunedì a sabato: giorni passati pieni, oggi in rosso, «Le porte si aprono domenica alle 21.»", () => {
  const mer = settimanaHome(new Date(Date.UTC(2026, 10, 25, 12)), { nome: "Giulia", inStanza: true });
  assert.deepEqual(mer.segmenti, ["on", "on", "oggi", "", "", "", ""]);
  assert.equal(mer.evidenza, "La tua stanza è aperta.");
  assert.equal(mer.conto, null);
  assert.equal(mer.nota, "Le porte si aprono domenica alle 21.");
  const lun = settimanaHome(roma(23, 10), { nome: "Giulia", inStanza: true });
  assert.deepEqual(lun.segmenti, ["oggi", "", "", "", "", "", ""]);
});

test("in stanza domenica prima delle 21: conto alle 21 (schermata 35); dopo le 21 «Le porte sono aperte.»", () => {
  const prima = settimanaHome(roma(22, 20, 18), { nome: "Giulia", inStanza: true });
  assert.deepEqual(prima.segmenti, ["on", "on", "on", "on", "on", "on", "oggi"]);
  assert.equal(prima.evidenza, "Le porte si aprono alle 21.");
  assert.equal(prima.conto, "00:42");
  const dopo = settimanaHome(roma(22, 21, 10), { nome: "Giulia", inStanza: true });
  assert.equal(dopo.evidenza, "Le porte sono aperte.");
  assert.equal(dopo.conto, null);
});

test("nome mancante o solo spazi: «Ciao.»; il nome è testo, mai HTML", () => {
  assert.equal(settimanaHome(roma(21, 15), { nome: "  " }).titolo, "Ciao.");
  assert.equal(settimanaHome(roma(21, 15), {}).titolo, "Ciao.");
  assert.equal(settimanaHome(roma(21, 15), { nome: " <b>Ada</b> " }).titolo, "Ciao <b>Ada</b>.");
});

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testi = (n) => (typeof n === "string" ? [n] : n && n.f ? n.f.flatMap(testi) : []);
const trova = (n, pred) => (!n || typeof n !== "object" ? [] : [...(pred(n) ? [n] : []), ...(n.f || []).flatMap((x) => trova(x, pred))]);

test("vista: etichetta, barra dei 7 giorni nascosta al lettore di schermo, titolo con l'evidenza in corsivo, conto annunciato", () => {
  const m = settimanaHome(roma(21, 15), { nome: "Giulia" });
  const v = vistaSettimanaHome(h, m);
  const t = testi(v);
  assert.ok(t.includes("La tua settimana"));
  assert.ok(t.includes("Ciao Giulia."));
  assert.ok(t.includes("La tua stanza apre lunedì."));
  assert.ok(t.includes("1 g 18 h"));
  const barra = trova(v, (n) => n.a.classe === "settimana")[0];
  assert.equal(barra.a["aria-hidden"], "true");
  assert.equal(barra.f.length, 7);
  const titolo = trova(v, (n) => n.tag === "h1")[0];
  assert.ok(trova(titolo, (n) => n.tag === "em").length === 1);
  const conto = trova(v, (n) => n.a.id === "conto-settimana")[0];
  assert.equal(conto.a.classe, "conto-settimana");
  assert.ok(conto.a["aria-label"].includes("1 g 18 h"));
  const senza = vistaSettimanaHome(h, settimanaHome(new Date(Date.UTC(2026, 10, 25, 12)), { nome: "Giulia", inStanza: true }));
  assert.equal(trova(senza, (n) => n.a.id === "conto-settimana").length, 0);
});

test("la home non dice più «Il tuo profilo è pronto.» (LEGGIMI punto 8)", () => {
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.equal(flusso.includes("Il tuo profilo è pronto."), false);
  assert.ok(flusso.includes("vistaSettimanaHome"));
});

test("stili: barra dei giorni e conto grande con i valori del prototipo v4", () => {
  const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
  assert.match(css, /\.settimana\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*1fr\)/);
  assert.match(css, /\.settimana i\.oggi\s*\{[^}]*#E8432B/i);
  assert.match(css, /\.conto-settimana\s*\{[^}]*font-style:\s*italic/);
});

test("il service worker tiene il modulo della settimana anche senza rete", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"/app/moduli/settimana_home.js"'));
  assert.ok(!sw.includes('"presente-app-40"'), "versione della cache aumentata");
});
