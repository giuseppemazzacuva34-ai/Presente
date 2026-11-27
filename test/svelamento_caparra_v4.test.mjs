// Design v4 (#349, approvato da Giuseppe il 22/11), schermata 39 «Lo svelamento» (#n27 nel prototipo).
// Linea «sviluppatore-c» (le schermate 39-40 sono della linea C, plancia del CTO 22/11). Modulo proprio
// svelamento_caparra.js con vistaCaparra(h, ps, m, s, { torna, scadeIl, adesso }): solo vista, prima della propria
// caparra. Usa solo ps.blocca e ps.mostraRicarica di svelamento.js, senza cambiarne la logica.
// h finto, ps finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schermataPorta } from "../landing/app/moduli/svelamento.js";
import { TESTI_CAPARRA, vistaCaparra, oreMinuti } from "../landing/app/moduli/svelamento_caparra.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LEI = "11111111-2222-4333-8444-555555555555";
const ADESSO = new Date("2026-11-16T09:40:00Z");
const SCADE = "2026-11-17T20:00:00Z";
const porta = (extra = {}) => ({ porta: PORTA, con: LEI, nome: "Giulia", eta: 31, aperta_il: "2026-11-15T20:00:00Z",
  scade_il: SCADE, mia_caparra: false, sua_caparra: false, aspetta: null, mia_scelta: null,
  mie_fasce: [], fascia_fissata: null, mio_pronto: false, suo_pronto: false, pronto_scade_il: null, pronta: null, ...extra });
const schermata = (p = porta(), saldo = 500) => schermataPorta({ saldo, caparra: 100, beta: true, porte: [p] }, PORTA, ADESSO);

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const conClasse = (n, c) => tutti(n, (x) => String(x.a.classe || "").split(" ").includes(c));
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x).includes(t))[0];

function psFinto(m = {}) {
  const chiamate = [];
  const ps = {};
  for (const f of ["blocca", "mostraRicarica"]) ps[f] = (...a) => { chiamate.push([f, ...a]); };
  let tornato = 0;
  const torna = () => { tornato += 1; };
  return { ps, chiamate, torna, tornati: () => tornato, m: { inCorso: false, ricarica: false, ...m } };
}
const vista = (s, extra = {}, opz = {}) => {
  const f = psFinto(extra);
  return { ...f, v: vistaCaparra(h, f.ps, f.m, s, { torna: f.torna, scadeIl: SCADE, adesso: ADESSO, ...opz }) };
};

test("oreMinuti: «hh:mm» come il timer del prototipo; null a tempo finito o data illeggibile", () => {
  assert.equal(oreMinuti("2026-11-18T09:39:00Z", new Date("2026-11-16T09:40:00Z")), "47:59");
  assert.equal(oreMinuti(SCADE, ADESSO), "34:20");
  assert.equal(oreMinuti("2026-11-16T09:45:30Z", ADESSO), "00:05");
  assert.equal(oreMinuti("2026-11-16T09:40:00Z", ADESSO), null);
  assert.equal(oreMinuti("non è una data", ADESSO), null);
});

test("senza porta, dopo la propria caparra o con la porta chiusa: niente (resta il resto del percorso)", () => {
  const { ps, m, torna } = psFinto();
  assert.equal(vistaCaparra(h, ps, m, null, { torna }), null);
  assert.equal(vistaCaparra(h, ps, m, { tipo: "chiusa", testo: "x" }, { torna }), null);
  assert.equal(vistaCaparra(h, ps, m, schermata(porta({ mia_caparra: true })), { torna }), null);
  assert.equal(vistaCaparra(h, ps, m, schermata(porta({ mia_caparra: true, sua_caparra: true })), { torna }), null);
});

test("occhiello «Svelamento · Giulia, 31» e titolo «Hai 48 ore / per lo svelamento.» con la seconda riga in evidenza", () => {
  const { v } = vista(schermata());
  assert.equal(v.tag, "section");
  assert.ok(conClasse(v, "svelamento-v4").length || String(v.a.classe).includes("svelamento-v4"));
  assert.equal(testo(conClasse(v, "passo")[0]), "Svelamento · Giulia, 31");
  const t = tutti(v, (x) => x.tag === "h1")[0];
  assert.equal(t.a.id, "porta-titolo");
  assert.equal(v.a["aria-labelledby"], "porta-titolo");
  assert.equal(testo(t), "Hai 48 oreper lo svelamento.");
  assert.equal(tutti(t, (x) => x.tag === "br").length, 1);
  assert.equal(testo(tutti(t, (x) => x.tag === "em")[0]), "per lo svelamento.");
});

test("timer grande «hh:mm» con il testo intero per il lettore di schermo", () => {
  const { v } = vista(schermata());
  const t = conClasse(v, "timer")[0];
  assert.equal(t.a.role, "timer");
  assert.equal(testo(t), "34:20");
  assert.equal(t.a["aria-label"], "Mancano 34 ore e 20 minuti per lo svelamento.");
});

test("senza scadenza leggibile il timer mostra il testo del conto, mai un numero inventato", () => {
  const { v } = vista(schermata(), {}, { scadeIl: undefined });
  const t = conClasse(v, "timer")[0];
  assert.equal(testo(t), "Mancano 34 ore e 20 minuti per lo svelamento.");
});

test("caparra in tre righe: la spiegazione del server e il saldo; nessun «10 crediti» del prototipo", () => {
  const s = schermata();
  const { v } = vista(s);
  const sub = conClasse(v, "sub")[0];
  assert.equal(sub.a.id, "caparra-spiegazione");
  assert.equal(testo(sub), s.caparra.spiegazione);
  assert.equal(testo(conClasse(v, "nota").at(-1)), "I tuoi crediti: 500");
  assert.doesNotMatch(testo(v), /\b10 crediti\b/);
});

test("piede: «Più tardi» a sinistra (secondario) e «Blocca 100 crediti» a destra (primario), sulla stessa riga", () => {
  const { v, chiamate, tornati } = vista(schermata());
  const piede = conClasse(v, "azioni");
  assert.equal(piede.length, 1);
  const [a, b] = tutti(piede[0], (x) => x.tag === "button");
  assert.equal(testo(a), TESTI_CAPARRA.piuTardi);
  assert.equal(TESTI_CAPARRA.piuTardi, "Più tardi");
  assert.equal(a.a.classe, "bottone-secondario");
  assert.equal(testo(b), "Blocca 100 crediti");
  assert.equal(b.a.classe, "bottone");
  assert.equal(b.a["aria-describedby"], "caparra-spiegazione");
  a.a.onclick();
  assert.equal(tornati(), 1);
  b.a.onclick();
  assert.deepEqual(chiamate, [["blocca"]]);
});

test("mentre la richiesta è in corso «Un attimo…» e il pulsante è spento", () => {
  const { v } = vista(schermata(), { inCorso: true });
  const b = bottone(v, "Un attimo…");
  assert.ok(b);
  assert.equal(b.a.disabled, true);
});

test("crediti che non bastano: «Ti mancano N crediti», «Ricarica» primario che apre il testo della beta", () => {
  // Saldo 5: sotto qualunque soglia. (Con 40 crediti oggi svelamento.js propone ancora «Blocca»: la soglia del
  // telefono è 10, quella del server 100. È della linea del CTO: segnalato in plancia, il server resta l'arbitro.)
  const s = schermata(porta(), 5);
  const { v, chiamate } = vista(s);
  assert.match(testo(v), /Ti mancano \d+ crediti/);
  const r = bottone(v, "Ricarica");
  assert.equal(r.a.classe, "bottone");
  assert.equal(r.a["aria-expanded"], "false");
  assert.equal(r.a["aria-controls"], "ricarica-beta");
  r.a.onclick();
  assert.deepEqual(chiamate, [["mostraRicarica"]]);
  assert.equal(tutti(v, (x) => x.a.id === "ricarica-beta").length, 0);
  const aperta = vista(s, { ricarica: true }).v;
  const beta = tutti(aperta, (x) => x.a.id === "ricarica-beta")[0];
  assert.equal(testo(beta), "In beta i crediti sono di prova");
  assert.equal(bottone(aperta, "Ricarica").a["aria-expanded"], "true");
  assert.ok(bottone(aperta, "Più tardi"));
});

test("niente nomi di funzioni del server toccati: il modulo usa solo blocca, mostraRicarica e riprova", () => {
  const src = readFileSync(new URL("../landing/app/moduli/svelamento_caparra.js", import.meta.url), "utf8");
  const usate = [...src.matchAll(/ps\.(\w+)\(/g)].map((x) => x[1]).sort();
  assert.deepEqual([...new Set(usate)], ["blocca", "mostraRicarica", "riprova"]);
  assert.doesNotMatch(src, /innerHTML|localStorage|fetch\(/);
});

test("stile della linea C per la 39: occhiello, titolo serif con l'evidenza rossa, timer grande, nota", () => {
  const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
  assert.match(css, /\.app \.svelamento-v4 \.passo \{[^}]*letter-spacing: 0\.2em/);
  assert.match(css, /\.app \.svelamento-v4 h1 em \{[^}]*color: #E8432B/);
  assert.match(css, /\.app \.svelamento-v4 \.timer \{[^}]*font-size: 44px/);
});

// D149 parità grafica (confronto a 400x867 con docs/design/v4/schermate/39-lo-svelamento.png): pulsanti su una riga
// sola («Blocca 100 crediti» andava a capo) e piede in basso come nel disegno (altezza dello schermo meno la testata).
test("D149: piede in basso come la schermata 39 e testi dei pulsanti su una riga", () => {
  const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
  assert.match(css, /\.app \.svelamento-v4 \{[^}]*min-height: calc\(100dvh - 140px\)/);
  assert.match(css, /\.app \.svelamento-v4 \.azioni button \{[^}]*white-space: nowrap/);
});
