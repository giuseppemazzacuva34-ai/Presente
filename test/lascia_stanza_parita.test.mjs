// Parità grafica della schermata 22 «Lascia la stanza» (D149, richiesta del coordinatore del 26/11, linea «sviluppatore-b»):
// titolo su due righe con «la stanza?» in corsivo rosso, sottotitolo grigio, scelte con il cerchio scuro e l'anello
// rosso quando è scelta, pulsanti in fondo allo schermo. Testi invariati (spec v1.2 del CPO). Documento finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apriSchermataUscita } from "../landing/app/moduli/lascia_stanza.js";

// ---- documento finto, quanto basta per il modulo ----
class Nodo {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parent = null;
    this.attributi = {}; this.ascoltatori = {}; this.hidden = false; this.disabled = false; this.className = "";
    this._testo = ""; this.value = ""; this.checked = false; this.type = ""; this.name = ""; this.id = "";
  }
  get textContent() { return this._testo + this.children.map((c) => c.textContent).join(""); }
  set textContent(t) { this._testo = String(t); this.children = []; }
  setAttribute(k, v) { this.attributi[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attributi, k) ? this.attributi[k] : null; }
  removeAttribute(k) { delete this.attributi[k]; }
  append(...n) { for (const x of n) { if (typeof x === "string") { this._testo += x; continue; } x.parent = this; this.children.push(x); } }
  replaceChildren(...n) { this.children = []; this._testo = ""; this.append(...n); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  addEventListener(t, f) { (this.ascoltatori[t] ||= []).push(f); }
  emetti(t) { for (const f of this.ascoltatori[t] || []) f({ target: this, key: undefined, preventDefault() {} }); }
  focus() { this.ownerDocument.activeElement = this; }
  clic() { if (this.disabled) return; this.emetti("click"); }
  scegli() { this.checked = true; this.emetti("change"); }
  scrivi(t) { this.value = t; this.emetti("input"); }
  tasto(key) { for (const f of this.ascoltatori.keydown || []) f({ key, preventDefault() {} }); }
  tutti(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.tutti(pred, out); } return out; }
  conTag(t) { return this.tutti((n) => n.tagName === t.toUpperCase()); }
  pulsante(testo) { return this.conTag("button").find((b) => b.textContent === testo); }
}
function documento() {
  const doc = { activeElement: null };
  doc.createElement = (t) => new Nodo(t, doc);
  doc.body = new Nodo("body", doc);
  return doc;
}
const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");

test("22: la schermata ha la sua classe e il titolo «Vuoi lasciare» / «la stanza?» in corsivo", () => {
  const doc = documento();
  apriSchermataUscita(doc.body, { uscita: { lascia: async () => ({ ok: true }) } });
  const s = doc.body.conTag("section")[0];
  assert.ok(s.className.split(" ").includes("lascia-stanza"));
  const h1 = doc.body.conTag("h1")[0];
  assert.equal(h1.textContent, "Vuoi lasciare la stanza?"); // il lettore di schermo legge la frase intera
  assert.equal(h1.conTag("em")[0].textContent, "la stanza?");
  assert.equal(h1.conTag("br").length, 1);
});

test("22: stile come il design v4 (titolo 31px, em rosso, sottotitolo grigio, cerchi, pulsanti in fondo)", () => {
  assert.match(css, /\.app \.lascia-stanza \{[^}]*min-height: calc\(100dvh - 140px\)/);
  assert.match(css, /\.app \.lascia-stanza > \.azioni \{[^}]*margin-top: auto/);
  assert.match(css, /\.app \.lascia-stanza h1 \{[^}]*font-size: 31px/);
  assert.match(css, /\.app \.lascia-stanza h1 em \{[^}]*color: #E8432B/);
  assert.match(css, /\.app \.lascia-stanza legend \{[^}]*color: #A8A29A/);
  assert.match(css, /\.app \.lascia-stanza input\[type="radio"\] \{[^}]*appearance: none/);
  assert.match(css, /\.app \.lascia-stanza input\[type="radio"\]:checked \{[^}]*border: 5px solid #E8432B/);
  assert.match(css, /\.app \.lascia-stanza input\[type="radio"\]:focus-visible \{[^}]*outline/); // tastiera (WCAG 2.4.7)
});
