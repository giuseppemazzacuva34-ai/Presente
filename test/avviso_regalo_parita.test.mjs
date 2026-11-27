// Parità grafica della schermata 27 «Regalo ricevuto» (D149, linea «sviluppatore-b»): la rosa grande al centro
// sopra la chiamata e la frase su due righe, il regalo in corsivo rosso. Testo del server invariato e letto intero
// (role="status"); l'avviso non blocca i pulsanti della chiamata. Documento finto, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mostraAvvisoRegalo } from "../landing/app/moduli/regali.js";

// ---- documento finto, quanto basta per il modulo ----
class Nodo {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parent = null;
    this.attributi = {}; this.ascoltatori = {}; this.hidden = false; this.disabled = false; this.className = "";
    this._testo = "";
  }
  get textContent() { return this._testo + this.children.map((c) => c.textContent).join(""); }
  set textContent(t) { this._testo = String(t); this.children = []; }
  setAttribute(k, v) { this.attributi[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attributi, k) ? this.attributi[k] : null; }
  removeAttribute(k) { delete this.attributi[k]; }
  append(...n) { for (const x of n) { x.parent = this; this.children.push(x); } }
  replaceChildren(...n) { this.children = []; this._testo = ""; this.append(...n); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  addEventListener(t, f) { (this.ascoltatori[t] ||= []).push(f); }
  focus() { this.ownerDocument.activeElement = this; }
  clic() { if (this.disabled) return; for (const f of this.ascoltatori.click || []) f({ preventDefault() {} }); }
  tasto(key) { for (const f of this.ascoltatori.keydown || []) f({ key, preventDefault() {} }); }
  tutti(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.tutti(pred, out); } return out; }
  conClasse(c) { return this.tutti((n) => n.className.split(" ").includes(c)); }
  pulsanti() { return this.tutti((n) => n.tagName === "BUTTON"); }
}
function documento() {
  const doc = { activeElement: null };
  doc.createElement = (t) => new Nodo(t, doc);
  doc.body = new Nodo("body", doc);
  return doc;
}
const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
const finto = () => 1;

test("27: icona grande del regalo e frase su due righe con il regalo in corsivo", () => {
  const doc = documento();
  const av = mostraAvvisoRegalo(doc.body, { regalo: "rosa", testo: "Marta ti ha mandato una rosa." }, { setTimeout: finto });
  assert.equal(av.textContent, "Marta ti ha mandato una rosa.");
  const icona = av.tutti((n) => n.className.split(" ").includes("regalo-icona"))[0];
  assert.ok(icona && icona.className.includes("regalo-rosa"));
  assert.equal(icona.getAttribute("aria-hidden"), "true");
  const em = av.tutti((n) => n.tagName === "EM")[0];
  assert.equal(em.textContent, "una rosa.");
  assert.equal(av.tutti((n) => n.tagName === "BR").length, 1);
});

test("27: con un testo di forma diversa resta la frase intera, senza corsivo", () => {
  const doc = documento();
  const av = mostraAvvisoRegalo(doc.body, { regalo: "fiori", testo: "Hai ricevuto dei fiori." }, { setTimeout: finto });
  assert.equal(av.textContent, "Hai ricevuto dei fiori.");
  assert.equal(av.tutti((n) => n.tagName === "EM").length, 0);
});

test("27: stile come il design v4 (al centro, serif grande, corsivo rosso, icona 120px, non blocca i tocchi)", () => {
  assert.match(css, /\.app \.avviso-regalo \{[^}]*top: 50%[^}]*pointer-events: none/);
  assert.match(css, /\.app \.avviso-regalo \.avviso-regalo-frase \{[^}]*font-family: var\(--serif\)[^}]*font-size: 30px/);
  assert.match(css, /\.app \.avviso-regalo em \{[^}]*color: #E8432B/);
  assert.match(css, /\.app \.avviso-regalo \.regalo-icona \{[^}]*width: 120px/);
});
