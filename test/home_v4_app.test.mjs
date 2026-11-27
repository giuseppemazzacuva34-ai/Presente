// Design v4 (issue #349, schermata 16 «La home», prototipo #n13; D149 A; linea A del CTO): prima della stanza la
// prima schermata ha una sola cosa da fare. In alto la settimana e il conto alla rovescia, sotto la nota
// «Lunedì alle 9 entri con 11 persone vicine a te. La prima stanza è in regalo.», poi il cerchio e in fondo un solo
// pulsante «Ci sarò lunedì» (prima «Entra nella stanza»). Il resto della home (profilo, aiuto) resta, ma sotto.
// Dopo il tocco: la conferma del server e «Ci ripenso», come prima. Nomi inventati, orologio finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { settimanaHome, vistaIngressoHome, TESTI_SETTIMANA } from "../landing/app/moduli/settimana_home.js";

const roma = (g, ora, min = 0) => new Date(Date.UTC(2026, 10, g, ora - 1, min));
const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testi = (n) => (typeof n === "string" ? [n] : n && n.f ? n.f.flatMap(testi) : []);
const trova = (n, pred) => (!n || typeof n !== "object" ? [] : [...(pred(n) ? [n] : []), ...(n.f || []).flatMap((x) => trova(x, pred))]);
const nulla = () => {};

test("prima della stanza, con l'ingresso: la nota del design dice anche «La prima stanza è in regalo.»", () => {
  const m = settimanaHome(roma(21, 15), { nome: "Giulia", regalo: true });
  assert.equal(m.nota, "Lunedì alle 9 entri con 11 persone vicine a te. La prima stanza è in regalo.");
  assert.equal(settimanaHome(roma(21, 15), { nome: "Giulia" }).nota, "Lunedì alle 9 entri con 11 persone vicine a te.");
  // In stanza la nota non cambia: il regalo vale solo per entrare.
  assert.equal(settimanaHome(new Date(Date.UTC(2026, 10, 25, 12)), { inStanza: true, regalo: true }).nota, "Le porte si aprono domenica alle 21.");
});

test("un solo pulsante in fondo: «Ci sarò lunedì», con sotto il costo dopo la prima stanza", () => {
  const v = vistaIngressoHome(h, { letto: true }, { entra: nulla, ripensa: nulla });
  assert.match(v.a.classe, /\bazioni\b/);
  assert.match(v.a.classe, /\bazioni-home\b/);
  const bottoni = trova(v, (n) => n.tag === "button");
  assert.equal(bottoni.length, 1);
  assert.equal(bottoni[0].a.classe, "bottone");
  assert.deepEqual(testi(bottoni[0]), [TESTI_SETTIMANA.ciSaro]);
  assert.equal(TESTI_SETTIMANA.ciSaro, "Ci sarò lunedì");
  assert.equal(bottoni[0].a.disabled, false);
  assert.ok(testi(v).includes("Poi 80 crediti a stanza. Si conferma entro domenica alle 23:59."));
});

test("il pulsante chiama «entra»; è spento finché il server non ha risposto o mentre manda", () => {
  let entrato = 0;
  const v = vistaIngressoHome(h, { letto: true }, { entra: () => { entrato++; }, ripensa: nulla });
  trova(v, (n) => n.tag === "button")[0].a.onclick();
  assert.equal(entrato, 1);
  assert.equal(trova(vistaIngressoHome(h, { letto: false }, { entra: nulla, ripensa: nulla }), (n) => n.tag === "button")[0].a.disabled, true);
  const inCorso = vistaIngressoHome(h, { letto: true, inCorso: true }, { entra: nulla, ripensa: nulla });
  assert.equal(trova(inCorso, (n) => n.tag === "button")[0].a.disabled, true);
  assert.ok(testi(inCorso).includes("Un attimo…"));
});

test("confermata: il testo del server annunciato e «Ci ripenso», niente pulsante «Ci sarò lunedì»", () => {
  let ripensato = 0;
  const v = vistaIngressoHome(h, { letto: true, conferma: "Ci sei lunedì 30 novembre." }, { entra: nulla, ripensa: () => { ripensato++; } });
  const stato = trova(v, (n) => n.a.id === "conferma-stanza")[0];
  assert.equal(stato.a.role, "status");
  assert.deepEqual(testi(stato), ["Ci sei lunedì 30 novembre."]);
  const bottoni = trova(v, (n) => n.tag === "button");
  assert.equal(bottoni.length, 1);
  assert.deepEqual(testi(bottoni[0]), ["Ci ripenso"]);
  bottoni[0].a.onclick();
  assert.equal(ripensato, 1);
  assert.equal(testi(v).includes(TESTI_SETTIMANA.ciSaro), false);
});

test("avviso ed errore del server restano visibili nel piede", () => {
  const err = h("p", { classe: "errore", role: "alert" }, "Non riusciamo a salvare.");
  const v = vistaIngressoHome(h, { letto: true, avviso: "Ti aspettiamo.", errore: err }, { entra: nulla, ripensa: nulla });
  assert.ok(testi(v).includes("Ti aspettiamo."));
  assert.ok(testi(v).includes("Non riusciamo a salvare."));
});

test("flusso: prima della stanza la home usa il piede unico; in stanza resta com'era", () => {
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.ok(flusso.includes("vistaIngressoHome(h,"), "il piede della schermata 16");
  assert.ok(flusso.includes("home-prima"), "prima schermata della home");
  assert.ok(flusso.includes("home-dopo"), "il resto della home sotto");
  assert.ok(flusso.includes("\"Entra nella stanza\""), "in stanza il pulsante per la settimana dopo non cambia");
});

test("stili: la prima schermata della home riempie lo schermo e il pulsante sta in fondo, largo quanto il piede", () => {
  const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
  assert.match(css, /\.app \.home-prima\s*\{[^}]*min-height:\s*calc\(100dvh - 140px\)/);
  assert.match(css, /\.app \.home-prima > \.azioni-home\s*\{[^}]*margin-top:\s*auto/);
  assert.match(css, /#app \.azioni-home\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/);
  assert.match(css, /\.app \.home-prima \.nota-settimana\s*\{[^}]*line-height/);
});

test("il service worker cambia versione (nuova home)", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(!sw.includes('"presente-app-78"'), "versione della cache aumentata");
});
