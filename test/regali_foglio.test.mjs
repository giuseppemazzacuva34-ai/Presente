// Foglio dei regali e avviso del regalo ricevuto nella web app (issue #331, spec v1 del CPO, parte C; D145 A;
// design v4 schermate 26 e 27, ramo design/app-v4). Passo 7 della linea «sviluppatore-c».
// Rete e documento finti: nessun dato reale, nessun servizio esterno.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  statoFoglio, creaRegali, apriFoglioRegali, mostraAvvisoRegalo, TESTI_FOGLIO, DURATA_AVVISO_MS,
} from "../landing/app/moduli/regali.js";
import { REGALI, conferma, fatto, TESTI_COIN } from "../api/coin.js";

const A = "11111111-2222-4333-8444-555555555555";
const CHIAVE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

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
const pulsante = (radice, testo) => radice.pulsanti().find((b) => b.textContent === testo);

function rete(risposte) {
  const chiamate = [];
  const f = async (url, init = {}) => {
    chiamate.push({ url, ...init, corpo: init.body ? JSON.parse(init.body) : null });
    const r = risposte.shift() ?? { status: 200, body: { ok: true } };
    if (r.errore) throw new Error("rete");
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  return { f, chiamate };
}
const attesa = () => new Promise((r) => setTimeout(r, 0));

// ---- stato del foglio (puro) ----
test("stato: titolo, saldo e tre regali con nome breve, prezzo ed etichetta di testo completa", () => {
  const s = statoFoglio({ nome: "Marta", saldo: 145 });
  assert.equal(s.titolo, "Fai un regalo a Marta");
  assert.equal(s.saldo, "Hai 145 crediti");
  assert.deepEqual(s.regali.map((r) => [r.id, r.nome, r.prezzo, r.etichetta]), [
    ["rosa", "Rosa", "5 crediti", "Rosa · 5 crediti"],
    ["spumante", "Spumante", "10 crediti", "Bicchiere di spumante · 10 crediti"],
    ["fiori", "Fiori", "20 crediti", "Mazzo di fiori · 20 crediti"],
  ]);
  assert.deepEqual(s.regali.map((r) => r.coin), REGALI.map((r) => r.coin));
  assert.equal(s.regali.filter((r) => r.scelto).length, 1);
  assert.equal(s.regali[0].scelto, true);
  assert.deepEqual([s.secondario, s.primario.testo, s.primario.attivo], ["Chiudi", "Regala la rosa", true]);
});

test("stato: la nota «lo vede subito» solo in chiamata", () => {
  assert.equal(statoFoglio({ nome: "Marta", saldo: 50, inChiamata: true }).nota, "Marta lo vede subito, durante la chiamata.");
  assert.equal(statoFoglio({ nome: "Marta", saldo: 50 }).nota, null);
});

test("stato: «Regala lo spumante» e «Regala i fiori» quando sono scelti", () => {
  assert.equal(statoFoglio({ nome: "M", saldo: 50, scelto: "spumante" }).primario.testo, "Regala lo spumante");
  assert.equal(statoFoglio({ nome: "M", saldo: 50, scelto: "fiori" }).primario.testo, "Regala i fiori");
});

test("stato: saldo che non basta → il pulsante dice «Ti mancano N Coin» ed è spento", () => {
  const s = statoFoglio({ nome: "M", saldo: 12, scelto: "fiori" });
  assert.deepEqual([s.primario.testo, s.primario.attivo], ["Ti mancano 8 crediti", false]);
  assert.equal(statoFoglio({ nome: "M", saldo: 4, scelto: "rosa" }).primario.testo, "Ti manca 1 credito");
});

test("stato: senza saldo dal server nessun numero inventato e nessun invio", () => {
  const s = statoFoglio({ nome: "M", saldo: null });
  assert.equal(s.saldo, null);
  assert.equal(s.primario.attivo, false);
});

test("stato: conferma con il testo della spec, poi «Manda» / «Annulla»", () => {
  const s = statoFoglio({ nome: "Marta", saldo: 50, scelto: "rosa", fase: "conferma" });
  assert.equal(s.domanda, conferma("rosa", "Marta"));
  assert.equal(s.domanda, "Mandi una rosa a Marta? Costa 5 crediti.");
  assert.deepEqual([s.primario.testo, s.secondario], [TESTI_COIN.conferma, TESTI_COIN.annulla]);
});

test("stato: fatto con il testo della spec e un solo pulsante «Chiudi»", () => {
  const s = statoFoglio({ nome: "Marta", saldo: 45, scelto: "rosa", fase: "fatto" });
  assert.equal(s.messaggio, fatto("rosa", "Marta"));
  assert.equal(s.messaggio, "Rosa mandata a Marta.");
  assert.deepEqual([s.primario.testo, s.secondario], ["Chiudi", null]);
});

// ---- richieste al Worker ----
test("manda: POST /app/api/regali con token, persona, regalo e chiave; il server dice il nuovo saldo", async () => {
  const { f, chiamate } = rete([{ status: 200, body: { ok: true, saldo: 140 } }]);
  const r = await creaRegali({ token: async () => "tok", fetch: f }).manda({ a: A, regalo: "rosa", chiave: CHIAVE });
  assert.deepEqual(r, { ok: true, saldo: 140 });
  assert.equal(chiamate[0].url, "/app/api/regali");
  assert.equal(chiamate[0].method, "POST");
  assert.equal(chiamate[0].headers.authorization, "Bearer tok");
  assert.deepEqual(chiamate[0].corpo, { azione: "manda", a: A, regalo: "rosa", chiave: CHIAVE });
});

test("manda: rifiuto del server con il suo testo; limiti senza testo → frase neutra; rete giù → senza connessione", async () => {
  const no = (body) => creaRegali({ token: async () => "t", fetch: rete([{ status: 200, body }]).f }).manda({ a: A, regalo: "rosa", chiave: CHIAVE });
  assert.deepEqual(await no({ ok: false, motivo: "non_puoi", testo: TESTI_COIN.nonPuoi }), { ok: false, motivo: "non_puoi", testo: TESTI_COIN.nonPuoi });
  assert.deepEqual(await no({ ok: false, motivo: "limite_giorno", testo: null }), { ok: false, motivo: "limite_giorno", testo: TESTI_FOGLIO.generico });
  const giu = await creaRegali({ token: async () => "t", fetch: rete([{ errore: true }]).f }).manda({ a: A, regalo: "rosa", chiave: CHIAVE });
  assert.deepEqual(giu, { ok: false, motivo: "rete", testo: TESTI_FOGLIO.rete });
  const senza = await creaRegali({ token: async () => null, fetch: rete([]).f }).manda({ a: A, regalo: "rosa", chiave: CHIAVE });
  assert.equal(senza.motivo, "accesso");
});

test("avvisi e visti: GET per gli avvisi, POST «visti» con gli id", async () => {
  const { f, chiamate } = rete([
    { status: 200, body: { ok: true, saldo: 200, avvisi: [{ id: CHIAVE, da: A, regalo: "rosa", testo: "Marta ti ha mandato una rosa." }] } },
    { status: 200, body: { ok: true } },
  ]);
  const c = creaRegali({ token: async () => "t", fetch: f });
  const a = await c.avvisi();
  assert.equal(a.ok, true);
  assert.equal(a.avvisi[0].testo, "Marta ti ha mandato una rosa.");
  assert.equal(chiamate[0].method, "GET");
  assert.deepEqual(await c.visti([CHIAVE]), { ok: true });
  assert.deepEqual(chiamate[1].corpo, { azione: "visti", ids: [CHIAVE] });
});

// ---- foglio nel documento ----
test("foglio: si apre come finestra con titolo, saldo e tre regali con etichetta di testo; il fuoco va al primo", () => {
  const doc = documento();
  const f = apriFoglioRegali(doc.body, { a: A, nome: "Marta", saldo: 145, inChiamata: true, regali: creaRegali({ token: async () => "t", fetch: rete([]).f }) });
  const foglio = doc.body.conClasse("foglio-regali")[0];
  assert.ok(foglio);
  assert.equal(foglio.getAttribute("role"), "dialog");
  assert.equal(foglio.getAttribute("aria-modal"), "true");
  assert.match(foglio.textContent, /Fai un regalo a Marta/);
  assert.match(foglio.textContent, /Hai 145 crediti/);
  const scelte = foglio.conClasse("regalo-scelta");
  assert.deepEqual(scelte.map((b) => b.getAttribute("aria-label")), REGALI.map((r) => `${r.nome} · ${r.coin} crediti`));
  assert.deepEqual(scelte.map((b) => b.getAttribute("aria-pressed")), ["true", "false", "false"]);
  assert.equal(doc.activeElement, scelte[0]);
  f.chiudi();
});

test("foglio: scelta → conferma → un solo invio anche con due tocchi → fatto, saldo aggiornato", async () => {
  const doc = documento();
  const { f, chiamate } = rete([{ status: 200, body: { ok: true, saldo: 135 } }]);
  let saldoDopo = null;
  apriFoglioRegali(doc.body, {
    a: A, nome: "Marta", saldo: 145, regali: creaRegali({ token: async () => "t", fetch: f }),
    chiave: () => CHIAVE, alRegalo: (s) => { saldoDopo = s; },
  });
  doc.body.pulsanti().find((b) => b.getAttribute("aria-label") === "Bicchiere di spumante · 10 crediti").clic();
  pulsante(doc.body, "Regala lo spumante").clic();
  assert.match(doc.body.textContent, /Mandi un bicchiere di spumante a Marta\? Costa 10 crediti\./);
  const manda = pulsante(doc.body, "Manda");
  manda.clic(); manda.clic();
  await attesa(); await attesa();
  assert.equal(chiamate.length, 1);
  assert.deepEqual(chiamate[0].corpo, { azione: "manda", a: A, regalo: "spumante", chiave: CHIAVE });
  assert.match(doc.body.textContent, /Bicchiere di spumante mandato a Marta\./);
  assert.match(doc.body.textContent, /Hai 135 crediti/);
  assert.equal(saldoDopo, 135);
});

test("foglio: «Annulla» torna alla scelta senza richieste; «Chiudi» ed Esc tolgono il foglio", async () => {
  const doc = documento();
  const { f, chiamate } = rete([]);
  let chiuso = 0;
  apriFoglioRegali(doc.body, { a: A, nome: "Marta", saldo: 145, regali: creaRegali({ token: async () => "t", fetch: f }), alChiudi: () => { chiuso++; } });
  pulsante(doc.body, "Regala la rosa").clic();
  pulsante(doc.body, "Annulla").clic();
  assert.ok(pulsante(doc.body, "Regala la rosa"));
  assert.equal(chiamate.length, 0);
  doc.body.conClasse("foglio-regali")[0].tasto("Escape");
  assert.equal(doc.body.conClasse("foglio-regali").length, 0);
  assert.equal(chiuso, 1);
});

test("foglio: rifiuto del server → il suo testo, Coin non scalati, nessun «fatto»", async () => {
  const doc = documento();
  const { f } = rete([{ status: 200, body: { ok: false, motivo: "stanza_chiusa", testo: TESTI_COIN.stanzaChiusa } }]);
  let chiamato = false;
  apriFoglioRegali(doc.body, { a: A, nome: "Marta", saldo: 145, regali: creaRegali({ token: async () => "t", fetch: f }), chiave: () => CHIAVE, alRegalo: () => { chiamato = true; } });
  pulsante(doc.body, "Regala la rosa").clic();
  pulsante(doc.body, "Manda").clic();
  await attesa(); await attesa();
  assert.match(doc.body.textContent, /La stanza è chiusa\./);
  assert.match(doc.body.textContent, /Hai 145 crediti/);
  assert.doesNotMatch(doc.body.textContent, /mandata a Marta/);
  assert.equal(chiamato, false);
  const err = doc.body.conClasse("foglio-regali-messaggio")[0];
  assert.equal(err.getAttribute("role"), "alert");
});

// ---- avviso del regalo ricevuto (in chiamata) ----
test("avviso: compare con il testo del server come stato letto dal lettore di schermo e sparisce dopo 3 secondi", () => {
  const doc = documento();
  const timer = [];
  const finto = (fn, ms) => { timer.push({ fn, ms }); return timer.length; };
  mostraAvvisoRegalo(doc.body, { regalo: "rosa", testo: "Marta ti ha mandato una rosa." }, { setTimeout: finto });
  const av = doc.body.conClasse("avviso-regalo")[0];
  assert.ok(av);
  assert.equal(av.getAttribute("role"), "status");
  assert.equal(av.textContent, "Marta ti ha mandato una rosa.");
  assert.equal(timer[0].ms, DURATA_AVVISO_MS);
  assert.equal(DURATA_AVVISO_MS, 3000);
  timer[0].fn();
  assert.equal(doc.body.conClasse("avviso-regalo").length, 0);
});

test("avviso: senza testo o con regalo sconosciuto non mostra niente", () => {
  const doc = documento();
  assert.equal(mostraAvvisoRegalo(doc.body, { regalo: "rosa", testo: "" }), null);
  assert.equal(mostraAvvisoRegalo(doc.body, { regalo: "anello", testo: "x" }), null);
  assert.equal(doc.body.children.length, 0);
});
