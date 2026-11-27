// Schermata 35 «Domenica sera» del design v4 (issue #349, LEGGIMI punto 35, prototipo #n25), linea C.
// Domenica dalle 20:00 alle 20:59 (ora di Roma), con la stanza aperta: al posto della home la porta socchiusa con la
// luce calda, «La stanza si chiude. / Le porte si aprono alle 21.», il conto alla rovescia e «Rivedi la tua stanza».
// «Rivedi la tua stanza» la toglie per quella domenica. Prima delle 20, dopo le 21, fuori stanza: niente schermata.
// h finto, orologio finto, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaDomenicaSera, vistaDomenicaSera, TESTI_DOMENICA_SERA } from "../landing/app/moduli/domenica_sera.js";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };

// 29/11/2026 è domenica; a Roma è UTC+1 (ora solare).
const DOM_2018 = new Date("2026-11-29T19:18:00Z"); // 20:18 a Roma
const DOM_1959 = new Date("2026-11-29T18:59:00Z"); // 19:59
const DOM_2000 = new Date("2026-11-29T19:00:00Z"); // 20:00
const DOM_2059 = new Date("2026-11-29T19:59:30Z"); // 20:59:30
const DOM_2100 = new Date("2026-11-29T20:00:00Z"); // 21:00
const SAB_2030 = new Date("2026-11-28T19:30:00Z"); // sabato 20:30

test("testi del design: etichetta, titolo, riga rossa e pulsante", () => {
  assert.equal(TESTI_DOMENICA_SERA.etichetta, "Domenica sera");
  assert.equal(TESTI_DOMENICA_SERA.titolo, "La stanza si chiude.");
  assert.equal(TESTI_DOMENICA_SERA.evidenza, "Le porte si aprono alle 21.");
  assert.equal(TESTI_DOMENICA_SERA.bottone, "Rivedi la tua stanza");
});

test("domenica 20:18 in stanza: schermata con conto 00:42 e barra della settimana con oggi in rosso", () => {
  const d = creaDomenicaSera();
  const m = d.modello(DOM_2018, { inStanza: true });
  assert.equal(m.conto, "00:42");
  assert.equal(m.ariaConto, "Mancano 42 minuti alle 21");
  assert.deepEqual(m.segmenti, ["on", "on", "on", "on", "on", "on", "oggi"]);
});

test("conto: 20:00 → 01:00 e 20:59:30 → 00:00 con «Manca meno di un minuto alle 21»", () => {
  const d = creaDomenicaSera();
  assert.equal(d.modello(DOM_2000, { inStanza: true }).conto, "01:00");
  const fine = d.modello(DOM_2059, { inStanza: true });
  assert.equal(fine.conto, "00:00");
  assert.equal(fine.ariaConto, "Manca meno di un minuto alle 21");
  assert.equal(d.modello(new Date("2026-11-29T19:59:00Z"), { inStanza: true }).ariaConto, "Manca 1 minuto alle 21");
});

test("niente schermata prima delle 20, dalle 21, di sabato o fuori stanza", () => {
  const d = creaDomenicaSera();
  assert.equal(d.modello(DOM_1959, { inStanza: true }), null);
  assert.equal(d.modello(DOM_2100, { inStanza: true }), null);
  assert.equal(d.modello(SAB_2030, { inStanza: true }), null);
  assert.equal(d.modello(DOM_2018, { inStanza: false }), null);
  assert.equal(d.modello(DOM_2018), null);
});

test("ora legale: domenica 29/3/2026 alle 20:30 di Roma (18:30 UTC) è dentro, alle 19:30 di Roma no", () => {
  const d = creaDomenicaSera();
  assert.equal(d.modello(new Date("2026-03-29T18:30:00Z"), { inStanza: true }).conto, "00:30");
  assert.equal(d.modello(new Date("2026-03-29T17:30:00Z"), { inStanza: true }), null);
});

test("«Rivedi la tua stanza» la toglie per quella domenica; la domenica dopo torna", () => {
  const d = creaDomenicaSera();
  d.rivedi(DOM_2018);
  assert.equal(d.modello(DOM_2018, { inStanza: true }), null);
  assert.equal(d.modello(DOM_2059, { inStanza: true }), null);
  assert.ok(d.modello(new Date("2026-12-06T19:18:00Z"), { inStanza: true }));
});

test("app già aperta prima delle 20: alle 20 la schermata non interrompe (chi sta scrivendo una chiave non perde nulla)", () => {
  const d = creaDomenicaSera();
  assert.equal(d.modello(DOM_1959, { inStanza: true }), null);
  assert.equal(d.modello(DOM_2018, { inStanza: true }), null);
  // Il giorno prima non conta: aperta sabato, la domenica alle 20:18 la schermata c'è.
  const e = creaDomenicaSera();
  assert.equal(e.modello(SAB_2030, { inStanza: true }), null);
  assert.ok(e.modello(DOM_2018, { inStanza: true }));
});

test("vista: scena decorativa con la porta calda, titolo h1, conto con id e nome accessibile, pulsante", () => {
  const d = creaDomenicaSera();
  const m = d.modello(DOM_2018, { inStanza: true });
  let tocchi = 0;
  const v = vistaDomenicaSera(h, m, { rivedi: () => { tocchi++; } });
  assert.equal(v.tag, "section");
  assert.equal(v.a.classe, "schermata domenica-sera");
  assert.equal(v.a["aria-labelledby"], "domenica-sera-titolo");
  const scena = tutti(v, (x) => x.a.classe === "domenica-sera-scena")[0];
  assert.equal(scena.a["aria-hidden"], "true");
  const img = tutti(scena, (x) => x.tag === "img")[0];
  assert.equal(img.a.src, "/app/img/porta-calda.jpg");
  assert.equal(img.a.alt, "");
  const h1 = tutti(v, (x) => x.tag === "h1")[0];
  assert.equal(h1.a.id, "domenica-sera-titolo");
  assert.equal(testo(h1), "La stanza si chiude.Le porte si aprono alle 21.");
  assert.equal(tutti(h1, (x) => x.tag === "em").length, 1);
  assert.ok(testo(v).includes("Domenica sera"));
  const conto = tutti(v, (x) => x.a.id === "conto-domenica-sera")[0];
  assert.equal(testo(conto), "00:42");
  assert.equal(conto.a["aria-label"], "Mancano 42 minuti alle 21");
  const barra = tutti(v, (x) => x.a.classe === "settimana")[0];
  assert.equal(barra.a["aria-hidden"], "true");
  assert.equal(barra.f.length, 7);
  const b = tutti(v, (x) => x.tag === "button")[0];
  assert.equal(testo(b), "Rivedi la tua stanza");
  assert.equal(b.a.type, "button");
  b.a.onclick();
  assert.equal(tocchi, 1);
});

test("aggiorna sul posto: cambia testo e nome del conto; dopo le 21 dice di ridisegnare", () => {
  const d = creaDomenicaSera();
  const attr = {};
  const el = { textContent: "00:42", setAttribute: (k, v) => { attr[k] = v; } };
  const radice = { querySelector: (s) => (s === "#conto-domenica-sera" ? el : null) };
  assert.equal(d.aggiornaSulPosto(radice, new Date("2026-11-29T19:30:00Z")), false);
  assert.equal(el.textContent, "00:30");
  assert.equal(attr["aria-label"], "Mancano 30 minuti alle 21");
  assert.equal(d.aggiornaSulPosto(radice, DOM_2100), true);
  assert.equal(d.aggiornaSulPosto({ querySelector: () => null }, DOM_2100), false);
});

test("flusso: aggiunte minime (import, schermata prima della home, conto sul posto)", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /import \{ creaDomenicaSera, vistaDomenicaSera \} from "\.\/domenica_sera\.js";/);
  assert.match(flusso, /const domenicaSera = creaDomenicaSera\(\);/);
  assert.match(flusso, /domenicaSera\.modello\(new Date\(\), \{ inStanza: inStanzaAperta\(\) \}\)/);
  assert.match(flusso, /domenicaSera\.aggiornaSulPosto\(radice, new Date\(\)\)/);
});

test("service worker e stile: modulo tra i file dell'app, versione cambiata, regole in fondo a app.css", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.match(sw, /"\/app\/moduli\/domenica_sera\.js"/);
  assert.doesNotMatch(sw, /const VERSIONE = "presente-app-61";/);
  const css = leggi("../landing/app/app.css");
  assert.match(css, /\.app \.domenica-sera \{/);
  assert.match(css, /\.app \.domenica-sera-luce \{[^}]*animation/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.app \.domenica-sera-luce \{ animation: none; \}/);
});

test("stile 35: la porta arriva fino in fondo allo schermo come il design v4 (non più min(80vh, 700px))", () => {
  const css = leggi("../landing/app/app.css");
  const regola = css.match(/\.app \.domenica-sera \{[^}]*\}/)[0];
  assert.match(regola, /min-height: calc\(100dvh - 112px\)/);
  assert.match(regola, /box-sizing: border-box/);
  assert.doesNotMatch(regola, /80vh/);
});
