// Schermata 13 «I tuoi crediti» del design v4 (issue #349; spec #331 v1.1, punti 2 e 4), linea «sviluppatore-b»:
// la vista a tutto schermo, fuori da #app. Due pacchetti da toccare (il 500 scelto di base), elenco dei costi,
// «Più tardi» e «Paga <prezzo>». In beta «Paga» resta SEMPRE spento con la frase dei crediti di prova: nessun
// pagamento. Documento finto, saldo finto, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apriTuoiCoin } from "../landing/app/moduli/tuoi_coin.js";
import { schermataTuoiCoin, TESTI_SALDO } from "../landing/app/moduli/saldo_coin.js";

class Nodo {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parent = null;
    this.attributi = {}; this.ascoltatori = {}; this.disabled = false; this.className = ""; this._testo = "";
  }
  get textContent() { return this._testo + this.children.map((c) => c.textContent).join(""); }
  set textContent(t) { this._testo = String(t); this.children = []; }
  setAttribute(k, v) { this.attributi[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attributi, k) ? this.attributi[k] : null; }
  append(...n) { for (const x of n) { x.parent = this; this.children.push(x); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  addEventListener(t, f) { (this.ascoltatori[t] ||= []).push(f); }
  focus() { this.ownerDocument.activeElement = this; }
  clic() { if (this.disabled) return; for (const f of this.ascoltatori.click || []) f({ preventDefault() {} }); }
  tasto(key) { for (const f of this.ascoltatori.keydown || []) f({ key, preventDefault() {} }); }
  tutti(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.tutti(pred, out); } return out; }
  pulsanti() { return this.tutti((n) => n.tagName === "BUTTON"); }
}
function documento() {
  const doc = { activeElement: null };
  doc.createElement = (t) => new Nodo(t, doc);
  doc.body = new Nodo("body", doc);
  return doc;
}
const pulsante = (r, re) => r.pulsanti().find((b) => re.test(b.textContent));

test("vista: passo, titolo in due righe, saldo, due pacchetti, costi e Gomry", () => {
  const doc = documento();
  apriTuoiCoin(doc.body, schermataTuoiCoin(0));
  const [v] = doc.body.children;
  assert.equal(v.tagName, "SECTION");
  assert.equal(v.getAttribute("aria-labelledby"), "tuoi-coin-titolo");
  assert.match(v.className, /tuoi-coin/);
  const t = v.textContent;
  assert.match(t, /Passo 10 di 10 · I tuoi crediti/);
  assert.match(t, /I tuoi creditiper la stanza e i regali\./);
  assert.match(t, /Hai 0 crediti\. La tua prima stanza è in regalo\./);
  assert.match(t, /200crediti2 stanze, o 1 stanza e regali20 €/);
  assert.match(t, /500\+50 in regaloIl più scelto45 €/);
  assert.match(t, /Una stanza al buio, 7 giorni80 crediti/);
  assert.match(t, /Caparra dello svelamento100 crediti/);
  assert.match(t, /Regali in chiamata5 · 10 · 20/);
  assert.match(t, /Paghi con Gomry: carta, Apple Pay, Google Pay\./);
  const h2 = v.tutti((n) => n.tagName === "H2")[0];
  assert.equal(h2.getAttribute("id"), "tuoi-coin-titolo");
});

test("i pacchetti sono pulsanti: il 500 è scelto di base, toccando il 200 «Paga» diventa 20 €", () => {
  const doc = documento();
  apriTuoiCoin(doc.body, schermataTuoiCoin(0));
  const p200 = pulsante(doc.body, /^200/);
  const p500 = pulsante(doc.body, /^500/);
  assert.equal(p500.getAttribute("aria-pressed"), "true");
  assert.equal(p200.getAttribute("aria-pressed"), "false");
  assert.ok(pulsante(doc.body, /^Paga 45 €$/));
  p200.clic();
  assert.equal(p200.getAttribute("aria-pressed"), "true");
  assert.equal(p500.getAttribute("aria-pressed"), "false");
  assert.ok(pulsante(doc.body, /^Paga 20 €$/));
  assert.match(p200.className, /\bon\b/);
  assert.doesNotMatch(p500.className, /\bon\b/);
});

test("in beta «Paga» è spento e c'è la frase dei crediti di prova", () => {
  const doc = documento();
  apriTuoiCoin(doc.body, schermataTuoiCoin(200));
  assert.equal(pulsante(doc.body, /^Paga/).disabled, true);
  assert.match(doc.body.textContent, new RegExp(TESTI_SALDO.notaBeta));
  pulsante(doc.body, /^200/).clic();
  assert.equal(pulsante(doc.body, /^Paga/).disabled, true);
});

test("«Più tardi» a sinistra e «Paga» a destra; «Più tardi» chiude una volta e l'attenzione parte da lì", () => {
  const doc = documento();
  let chiuso = 0;
  apriTuoiCoin(doc.body, schermataTuoiCoin(0), { alChiudi: () => { chiuso += 1; } });
  const riga = doc.body.tutti((n) => n.className === "azioni")[0];
  assert.deepEqual(riga.pulsanti().map((b) => b.textContent), ["Più tardi", "Paga 45 €"]);
  const tardi = pulsante(doc.body, /^Più tardi$/);
  assert.equal(doc.activeElement, tardi);
  tardi.clic();
  tardi.clic();
  assert.equal(doc.body.children.length, 0);
  assert.equal(chiuso, 1);
});

test("la testata resta: la vista prende il posto di #app, che torna com'era alla chiusura", () => {
  const doc = documento();
  const principale = doc.createElement("main");
  apriTuoiCoin(doc.body, schermataTuoiCoin(0), { principale });
  assert.equal(principale.hidden, true);
  pulsante(doc.body, /^Più tardi$/).clic();
  assert.equal(principale.hidden, false);
  const gia = doc.createElement("main");
  gia.hidden = true;
  apriTuoiCoin(doc.body, schermataTuoiCoin(0), { principale: gia });
  pulsante(doc.body, /^Più tardi$/).clic();
  assert.equal(gia.hidden, true);
});

test("Esc chiude la vista", () => {
  const doc = documento();
  apriTuoiCoin(doc.body, schermataTuoiCoin(0));
  doc.body.children[0].tasto("Escape");
  assert.equal(doc.body.children.length, 0);
});

test("senza saldo dal server nessun numero inventato; senza contenitore o dati non apre niente", () => {
  const doc = documento();
  apriTuoiCoin(doc.body, schermataTuoiCoin(null));
  assert.doesNotMatch(doc.body.textContent, /Hai \d/);
  assert.match(doc.body.textContent, /La tua prima stanza è in regalo\./);
  assert.equal(apriTuoiCoin(null, schermataTuoiCoin(0)), null);
  assert.equal(apriTuoiCoin(doc.body, null), null);
});

test("stile: vista nel flusso sotto la testata, pacchetto scelto col bordo rosso, etichetta «Il più scelto» rossa", () => {
  const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
  assert.match(css, /\.app \.tuoi-coin \{[^}]*display: flex;[^}]*flex-direction: column;/);
  assert.doesNotMatch(css, /\.app \.tuoi-coin \{[^}]*position: fixed/);
  assert.match(css, /\.app \.tuoi-coin \.pacco\.on \{[^}]*border-color: #E8432B;/);
  assert.match(css, /\.app \.tuoi-coin \.scelto \{[^}]*background: #E8432B;/);
  assert.match(css, /\.app \.tuoi-coin h2 em \{[^}]*color: #E8432B;/);
});
