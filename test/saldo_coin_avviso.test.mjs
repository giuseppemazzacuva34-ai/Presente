// Coin e saldo del design v4 (issue #349), passo 3 della linea «sviluppatore-b»: il foglio «Coin quasi finiti»
// (schermata 21) compare nella home quando il saldo del server non basta per la prossima stanza, una volta per visita.
// In beta «Ricarica» resta spento (nessun pagamento). Documento finto, saldo finto, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apriFoglioQuasiFiniti, quasiFiniti, collegaSaldo, TESTI_SALDO } from "../landing/app/moduli/saldo_coin.js";

class Nodo {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parent = null;
    this.attributi = {}; this.ascoltatori = {}; this.hidden = false; this.disabled = false; this.className = ""; this._testo = "";
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
const pulsante = (r, t) => r.pulsanti().find((b) => b.textContent === t);

test("foglio: titolo, testo, pacchetto da 500 e «Dopo» e «Ricarica» sulla stessa riga", () => {
  const doc = documento();
  apriFoglioQuasiFiniti(doc.body, quasiFiniti(15));
  const [f] = doc.body.children;
  assert.equal(f.getAttribute("role"), "dialog");
  assert.equal(f.getAttribute("aria-modal"), "true");
  assert.match(f.className, /foglio-coin/);
  assert.match(f.textContent, /Ti restano15 Coin\./);
  assert.match(f.textContent, /Bastano per qualche regalo, non per la prossima stanza \(80 Coin\)\./);
  assert.match(f.textContent, /500\+50 in regalo45 €/);
  const riga = f.tutti((n) => n.className === "azioni")[0];
  assert.deepEqual(riga.pulsanti().map((b) => b.textContent), ["Dopo", "Ricarica"]);
});

test("in beta «Ricarica» è spento e la nota dice che i Coin sono di prova", () => {
  const doc = documento();
  apriFoglioQuasiFiniti(doc.body, quasiFiniti(0));
  assert.equal(pulsante(doc.body, "Ricarica").disabled, true);
  assert.match(doc.body.textContent, new RegExp(TESTI_SALDO.notaBeta));
  assert.match(doc.body.textContent, /Hai finitoi Coin\./);
});

test("«Dopo» chiude il foglio e avvisa; l'attenzione parte da «Dopo»", () => {
  const doc = documento();
  let chiuso = 0;
  apriFoglioQuasiFiniti(doc.body, quasiFiniti(15), { alChiudi: () => { chiuso += 1; } });
  const dopo = pulsante(doc.body, "Dopo");
  assert.equal(doc.activeElement, dopo);
  dopo.clic();
  dopo.clic();
  assert.equal(doc.body.children.length, 0);
  assert.equal(chiuso, 1);
});

test("Esc chiude il foglio", () => {
  const doc = documento();
  apriFoglioQuasiFiniti(doc.body, quasiFiniti(15));
  doc.body.children[0].tasto("Escape");
  assert.equal(doc.body.children.length, 0);
});

test("senza dati (saldo che basta) non apre niente", () => {
  const doc = documento();
  assert.equal(apriFoglioQuasiFiniti(doc.body, quasiFiniti(120)), null);
  assert.equal(doc.body.children.length, 0);
});

function paginaFinta() {
  const ascolti = {};
  return { visibilityState: "visible", addEventListener(n, f) { (ascolti[n] ||= []).push(f); }, lancia(n) { (ascolti[n] || []).forEach((f) => f()); } };
}
const attesa = () => new Promise((r) => setImmediate(r));

test("l'avviso arriva una volta per visita quando i Coin non bastano", async () => {
  const visti = [];
  const saldo = { async aggiorna() { return { ok: true, saldo: 15, quasiFiniti: true }; } };
  const pagina = paginaFinta();
  await collegaSaldo({ saldo, pagina, avviso: (n) => visti.push(n) });
  pagina.lancia("visibilitychange");
  await attesa();
  assert.deepEqual(visti, [15]);
});

test("nessun avviso quando il saldo basta o la lettura fallisce", async () => {
  const visti = [];
  await collegaSaldo({ saldo: { async aggiorna() { return { ok: true, saldo: 120, quasiFiniti: false }; } }, pagina: paginaFinta(), avviso: (n) => visti.push(n) });
  await collegaSaldo({ saldo: { async aggiorna() { return { ok: false, motivo: "rete" }; } }, pagina: paginaFinta(), avviso: (n) => visti.push(n) });
  assert.deepEqual(visti, []);
});

test("un errore dell'avviso non ferma la lettura del saldo", async () => {
  const r = await collegaSaldo({ saldo: { async aggiorna() { return { ok: true, saldo: 15, quasiFiniti: true }; } }, pagina: paginaFinta(),
    avviso: () => { throw new Error("vista"); } });
  assert.equal(r.ok, true);
});

test("avvio: l'avviso apre il foglio nella .pagina.app, fuori da #app", () => {
  const avvio = readFileSync(new URL("../landing/app/avvio.js", import.meta.url), "utf8");
  assert.match(avvio, /import \{ apriFoglioQuasiFiniti, quasiFiniti \} from "\/app\/moduli\/saldo_coin\.js";/);
  assert.match(avvio, /avviso: \(n\) => apriFoglioQuasiFiniti\(document\.querySelector\("\.pagina\.app"\), quasiFiniti\(n\)\)/);
});

test("stile: il foglio usa la base del foglio dal basso e il pacchetto acceso del prototipo", () => {
  const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
  assert.match(css, /\.app \.foglio-coin \.pacco \{[^}]*border-radius: 16px;[^}]*grid-template-columns: auto 1fr auto;/);
  assert.match(css, /\.app \.foglio-coin \.pacco \{[^}]*border-color: #E8432B;/);
  assert.match(css, /\.app \.foglio-coin h2 em \{[^}]*color: #E8432B;/);
});
