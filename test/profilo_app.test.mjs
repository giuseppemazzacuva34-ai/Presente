// «Il profilo» (schermata 23 del design v4, issue #349; linea «sviluppatore-b», passo 1: dati e vista).
// Si apre dal cerchio in alto a destra; in fondo «Elimina il mio account», solo qui. Nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { statoProfilo, vistaProfilo, TESTI_PROFILO } from "../landing/app/moduli/profilo.js";

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (typeof n === "string" ? n : n.f.map(testo).join(""));
const tutti = (n, pred, out = []) => { if (typeof n === "object") { if (pred(n)) out.push(n); n.f.forEach((x) => tutti(x, pred, out)); } return out; };
const classe = (n, c) => tutti(n, (x) => String(x.a.classe || "").split(" ").includes(c));
const pulsanti = (n) => tutti(n, (x) => x.tag === "button");
const fn = () => {};

const PIENO = { nome: " Giulia ", eta: 33, citta: "Milano", voce: { url: "blob:voce", secondi: 18.4 }, saldo: 145, regali: 17, inStanza: true };
const AZIONI = { risposte: fn, regali: fn, foto: fn, preferenze: fn, elimina: fn, torna: fn };

test("testi della schermata 23 (design v4), «crediti» al posto di «Coin» (decisione del 23/11)", () => {
  assert.equal(TESTI_PROFILO.voce, "La tua voce");
  assert.equal(TESTI_PROFILO.unita, "crediti");
  assert.equal(TESTI_PROFILO.ricarica, "Ricarica");
  assert.equal(TESTI_PROFILO.risposte, "Le tre risposte a voce");
  assert.equal(TESTI_PROFILO.regali, "Regali ricevuti");
  assert.equal(TESTI_PROFILO.foto, "Le tue foto (nascoste)");
  assert.equal(TESTI_PROFILO.preferenze, "Chi cerchi · Notifiche · Privacy");
  assert.equal(TESTI_PROFILO.elimina, "Elimina il mio account");
  assert.equal(TESTI_PROFILO.tornaStanza, "Torna alla stanza");
  assert.equal(TESTI_PROFILO.tornaHome, "Torna alla home");
});

test("stato: titolo «Giulia, 33» e città; voce con i secondi arrotondati; saldo e regali dal server", () => {
  const s = statoProfilo(PIENO);
  assert.equal(s.titolo, "Giulia, 33");
  assert.equal(s.citta, "Milano");
  assert.deepEqual(s.voce, { url: "blob:voce", testo: "La tua voce · 18 s" });
  assert.deepEqual(s.saldo, { numero: "145", unita: "crediti", ricarica: "Ricarica", attivo: false });
  assert.equal(s.regali, "Regali ricevuti · 17");
  assert.equal(s.torna, "Torna alla stanza");
});

test("stato: senza dati del server nessun numero inventato", () => {
  const s = statoProfilo({ nome: "Giulia", eta: null, citta: "", voce: null, saldo: null, regali: null, inStanza: false });
  assert.equal(s.titolo, "Giulia");
  assert.equal(s.citta, null);
  assert.equal(s.voce, null);
  assert.equal(s.saldo, null);
  assert.equal(s.regali, "Regali ricevuti");
  assert.equal(s.torna, "Torna alla home");
  assert.equal(statoProfilo({ ...PIENO, saldo: -3 }).saldo, null);
  assert.equal(statoProfilo({ ...PIENO, saldo: 1.5 }).saldo, null);
  assert.equal(statoProfilo({ ...PIENO, regali: "17" }).regali, "Regali ricevuti");
  assert.deepEqual(statoProfilo({ ...PIENO, voce: { url: "blob:v" } }).voce, { url: "blob:v", testo: "La tua voce" });
  assert.equal(statoProfilo({ ...PIENO, voce: { secondi: 18 } }).voce, null);
});

test("stato: un solo credito al singolare; Ricarica sempre spenta nella beta", () => {
  assert.equal(statoProfilo({ ...PIENO, saldo: 1 }).saldo.unita, "credito");
  assert.equal(statoProfilo({ ...PIENO, saldo: 0 }).saldo.attivo, false);
});

test("vista: struttura del prototipo (#n16): titolo con la città in corsivo, voce, crediti, 4 righe, elimina, un pulsante", () => {
  const v = vistaProfilo(h, statoProfilo(PIENO), { ...AZIONI, onda: h("div", { classe: "onda-grande" }) });
  assert.equal(v.tag, "section");
  assert.equal(v.a["aria-labelledby"], "profilo-titolo");
  assert.ok(classe(v, "profilo").length === 1);
  const h2 = tutti(v, (x) => x.tag === "h2")[0];
  assert.equal(h2.a.id, "profilo-titolo");
  assert.equal(testo(h2), "Giulia, 33Milano");
  assert.equal(testo(tutti(h2, (x) => x.tag === "em")[0]), "Milano");
  assert.equal(classe(v, "rec").length, 1);
  assert.equal(classe(v, "onda-grande").length, 1);
  assert.equal(tutti(v, (x) => x.tag === "audio")[0].a.src, "blob:voce");
  const nomi = pulsanti(v).map(testo);
  assert.deepEqual(nomi, ["▶ La tua voce · 18 s", "Ricarica", "Le tre risposte a voce›", "Regali ricevuti · 17›",
    "Le tue foto (nascoste)›", "Chi cerchi · Notifiche · Privacy›", "Elimina il mio account", "Torna alla stanza"]);
  assert.equal(pulsanti(v)[1].a.disabled, true);
  assert.equal(testo(classe(v, "pacco")[0]).startsWith("145crediti"), true);
  assert.equal(classe(v, "voce-profilo").length, 4);
  assert.ok(pulsanti(v).every((b) => b.a.type === "button"));
  // «›» è decorazione: non lo legge lo screen reader.
  assert.ok(classe(v, "freccia").every((x) => x.a["aria-hidden"] === "true"));
  const elimina = pulsanti(v)[6];
  assert.ok(String(elimina.a.classe).includes("link") && String(elimina.a.classe).includes("rosso"));
  const piede = classe(v, "azioni")[0];
  assert.equal(pulsanti(piede).length, 1);
  assert.equal(pulsanti(piede)[0].a.classe, "bottone");
});

test("vista: i pulsanti chiamano le azioni giuste", () => {
  const chiamate = [];
  const az = Object.fromEntries(Object.keys(AZIONI).map((k) => [k, () => chiamate.push(k)]));
  const v = vistaProfilo(h, statoProfilo(PIENO), az);
  for (const b of pulsanti(v)) if (b.a.onclick && !b.a.disabled && !testo(b).startsWith("▶")) b.a.onclick();
  assert.deepEqual(chiamate, ["risposte", "regali", "foto", "preferenze", "elimina", "torna"]);
});

test("vista: senza voce, saldo o un'azione, quella parte non compare (mai pulsanti morti)", () => {
  const v = vistaProfilo(h, statoProfilo({ ...PIENO, voce: null, saldo: null }), { elimina: fn, torna: fn, regali: fn });
  assert.equal(classe(v, "rec").length, 0);
  assert.equal(classe(v, "pacco").length, 0);
  assert.deepEqual(pulsanti(v).map(testo), ["Regali ricevuti · 17›", "Elimina il mio account", "Torna alla stanza"]);
});

test("vista: l'errore (per esempio dell'eliminazione) si legge subito", () => {
  const v = vistaProfilo(h, statoProfilo(PIENO), { ...AZIONI, errore: "Non siamo riusciti a eliminare l'account. Riprova tra poco." });
  const e = tutti(v, (x) => x.a.role === "alert");
  assert.equal(e.length, 1);
  assert.match(testo(e[0]), /Riprova tra poco/);
});

test("stile: le regole della schermata 23 stanno in fondo ad app.css, con i valori del prototipo", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
  for (const sel of [".app .profilo .corpo", ".app .profilo h2 em", ".app .profilo .rec", ".app .profilo .onda-grande",
    ".app .profilo .pacco", ".app .profilo .pacco .q small", ".app .profilo .voce-profilo", ".app .profilo .freccia", ".app .profilo .link.rosso"]) {
    assert.ok(css.includes(`${sel} {`), `manca ${sel}`);
  }
  assert.match(css, /\.app \.profilo \.voce-profilo \{[^}]*min-height: 44px/); // area da toccare (WCAG 2.5.8)
  assert.match(css, /\.app \.profilo \.link\.rosso \{[^}]*color: #F05A43/);
});
