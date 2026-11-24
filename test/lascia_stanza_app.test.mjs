// «Lascia la stanza» nella web app (issue #381, spec v1 del CPO del 23/11, design v4 schermata 22). Linea
// «sviluppatore-b», passo 4a: la schermata (stato, richiesta al Worker, vista). Rete e documento finti, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  statoUscita, creaUscita, apriSchermataUscita, MOTIVI_APP, TESTI_APP,
} from "../landing/app/moduli/lascia_stanza.js";
import { MOTIVI_USCITA, TESTI_USCITA, TESTO_ALTRO } from "../api/lascia_stanza.js";

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
const radio = (doc) => doc.body.tutti((n) => n.tagName === "INPUT" && n.type === "radio");
const campo = (doc) => doc.body.conTag("textarea")[0];
const avvisi = (doc, ruolo) => doc.body.tutti((n) => n.getAttribute("role") === ruolo).map((n) => n.textContent);

// ---- rete finta ----
function rete(risposte) {
  const chiamate = [];
  const f = async (percorso, init = {}) => {
    chiamate.push({ percorso, init });
    const r = risposte.shift();
    if (r instanceof Error) throw r;
    return { ok: r.stato < 400, status: r.stato, json: async () => r.corpo };
  };
  return { f, chiamate };
}
const uscita = (risposte) => { const r = rete(risposte); return { r, u: creaUscita({ token: async () => "tok", fetch: r.f }) }; };
const aspetta = () => new Promise((ok) => setTimeout(ok, 0));

test("lascia app: motivi e testi uguali a quelli del Worker (api/lascia_stanza.js)", () => {
  assert.deepEqual(MOTIVI_APP, MOTIVI_USCITA);
  for (const k of Object.keys(TESTI_USCITA)) assert.equal(TESTI_APP[k], TESTI_USCITA[k], k);
});

test("lascia app: senza motivo «Lascia la stanza» è disattivato; «Resto» sempre attivo", () => {
  const s = statoUscita();
  assert.equal(s.titolo, "Vuoi lasciare la stanza?");
  assert.equal(s.lascia.testo, "Lascia la stanza");
  assert.equal(s.lascia.attivo, false);
  assert.equal(s.resto.attivo, true);
  assert.equal(s.motivi.length, 5);
  assert.ok(s.motivi.every((m) => m.scelto === false));
  assert.equal(s.altro, null);
  assert.equal(s.coin, TESTI_USCITA.coin);
});

test("lascia app: con un motivo semplice si può uscire", () => {
  const s = statoUscita({ scelto: "tempo" });
  assert.equal(s.lascia.attivo, true);
  assert.deepEqual(s.motivi.filter((m) => m.scelto).map((m) => m.id), ["tempo"]);
});

test("lascia app: con «Altro» compare il campo e serve un testo di almeno 3 caratteri (spazi esclusi), al massimo 300", () => {
  assert.equal(statoUscita({ scelto: "altro", testo: "" }).lascia.attivo, false);
  assert.equal(statoUscita({ scelto: "altro", testo: "  ab  " }).lascia.attivo, false);
  assert.equal(statoUscita({ scelto: "altro", testo: "abc" }).lascia.attivo, true);
  assert.equal(statoUscita({ scelto: "altro", testo: "x".repeat(TESTO_ALTRO.massimo + 1) }).lascia.attivo, false);
  const s = statoUscita({ scelto: "altro", testo: "abc" });
  assert.ok(s.altro && typeof s.altro.etichetta === "string" && s.altro.etichetta.length > 0);
  assert.equal(s.altro.massimo, TESTO_ALTRO.massimo);
});

test("lascia app: con «Problemi con l'app» compare l'invito all'Aiuto, e si può comunque uscire", () => {
  const s = statoUscita({ scelto: "app" });
  assert.equal(s.aiuto, TESTI_USCITA.app);
  assert.equal(s.lascia.attivo, true);
  assert.equal(statoUscita({ scelto: "tempo" }).aiuto, null);
});

test("lascia app: durante l'invio i pulsanti non rifanno la richiesta", () => {
  const s = statoUscita({ scelto: "tempo", fase: "invio" });
  assert.equal(s.lascia.attivo, false);
  assert.equal(s.resto.attivo, false);
});

test("lascia app: la richiesta va al Worker con il token, solo motivo e testo", async () => {
  const { r, u } = uscita([{ stato: 200, corpo: { ok: true, testo: TESTI_USCITA.fatto } }]);
  const esito = await u.lascia({ motivo: "altro", testo: "  Cambio città " });
  assert.deepEqual(esito, { ok: true, testo: TESTI_USCITA.fatto });
  assert.equal(r.chiamate[0].percorso, "/app/api/stanza/lascia");
  assert.equal(r.chiamate[0].init.method, "POST");
  assert.equal(r.chiamate[0].init.headers.authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(r.chiamate[0].init.body), { motivo: "altro", testo: "Cambio città" });
});

test("lascia app: per un motivo diverso da «Altro» il testo non parte", async () => {
  const { r, u } = uscita([{ stato: 200, corpo: { ok: true, testo: TESTI_USCITA.fatto } }]);
  await u.lascia({ motivo: "tempo", testo: "resto scritto prima" });
  assert.deepEqual(JSON.parse(r.chiamate[0].init.body), { motivo: "tempo", testo: null });
});

test("lascia app: in chiamata, fuori stanza, rete giù o token mancante → errore chiaro, mai un'uscita inventata", async () => {
  let { u } = uscita([{ stato: 200, corpo: { ok: false, motivo: "in_chiamata", testo: TESTI_USCITA.inChiamata } }]);
  assert.deepEqual(await u.lascia({ motivo: "tempo" }), { ok: false, motivo: "in_chiamata", testo: TESTI_USCITA.inChiamata });
  ({ u } = uscita([{ stato: 200, corpo: { ok: false, motivo: "non_nella_stanza" } }]));
  const fuori = await u.lascia({ motivo: "tempo" });
  assert.equal(fuori.ok, false);
  assert.equal(fuori.motivo, "non_nella_stanza");
  assert.equal(fuori.testo, TESTI_APP.nonNellaStanza);
  ({ u } = uscita([new Error("offline")]));
  assert.equal((await u.lascia({ motivo: "tempo" })).testo, TESTI_APP.rete);
  ({ u } = uscita([{ stato: 503, corpo: { ok: false, motivo: "riprova" } }]));
  assert.equal((await u.lascia({ motivo: "tempo" })).testo, TESTI_APP.generico);
  const senza = creaUscita({ token: async () => null, fetch: async () => { throw new Error("non deve partire"); } });
  assert.equal((await senza.lascia({ motivo: "tempo" })).ok, false);
});

test("lascia app: la vista ha un gruppo di scelte con nome, un campo con etichetta e i due pulsanti", () => {
  const doc = documento();
  const { u } = uscita([]);
  apriSchermataUscita(doc.body, { uscita: u });
  const gruppo = doc.body.conTag("fieldset")[0];
  assert.ok(gruppo, "gruppo di scelte");
  assert.equal(doc.body.conTag("legend")[0].textContent, TESTI_USCITA.sotto);
  assert.equal(radio(doc).length, 5);
  assert.ok(radio(doc).every((x) => x.name === radio(doc)[0].name && x.parent.tagName === "LABEL"), "ogni scelta ha la sua etichetta");
  assert.equal(doc.body.conTag("h1")[0].textContent, TESTI_USCITA.titolo);
  assert.equal(doc.body.pulsante("Lascia la stanza").disabled, true);
  assert.equal(doc.body.pulsante("Resto").disabled, false);
  assert.equal(campo(doc), undefined, "niente campo finché non si sceglie «Altro»");
});

test("lascia app: scegliendo «Altro» il campo compare con etichetta visibile e il pulsante si attiva da 3 caratteri", () => {
  const doc = documento();
  const { u } = uscita([]);
  apriSchermataUscita(doc.body, { uscita: u });
  radio(doc).find((x) => x.value === "altro").scegli();
  const c = campo(doc);
  assert.ok(c);
  const etichetta = doc.body.tutti((n) => n.tagName === "LABEL" && n.getAttribute("for") === c.id)[0];
  assert.ok(etichetta && etichetta.textContent.length > 0, "etichetta visibile collegata al campo");
  assert.equal(c.getAttribute("maxlength"), String(TESTO_ALTRO.massimo));
  assert.equal(doc.body.pulsante("Lascia la stanza").disabled, true);
  c.scrivi("ab");
  assert.equal(doc.body.pulsante("Lascia la stanza").disabled, true);
  c.scrivi("abc");
  assert.equal(doc.body.pulsante("Lascia la stanza").disabled, false);
  assert.equal(campo(doc), c, "scrivendo il campo non si ridisegna (fuoco e cursore restano)");
});

test("lascia app: «Problemi con l'app» mostra il link all'Aiuto", () => {
  const doc = documento();
  let aiuto = 0;
  const { u } = uscita([]);
  apriSchermataUscita(doc.body, { uscita: u, alAiuto: () => { aiuto += 1; } });
  radio(doc).find((x) => x.value === "app").scegli();
  assert.ok(doc.body.textContent.includes(TESTI_USCITA.app));
  doc.body.pulsante(TESTI_APP.aiuto).clic();
  assert.equal(aiuto, 1);
  assert.equal(doc.body.pulsante("Lascia la stanza").disabled, false);
});

test("lascia app: «Resto» chiude senza richieste", () => {
  const doc = documento();
  let resto = 0;
  const { r, u } = uscita([]);
  apriSchermataUscita(doc.body, { uscita: u, alResto: () => { resto += 1; } });
  doc.body.pulsante("Resto").clic();
  assert.equal(resto, 1);
  assert.equal(r.chiamate.length, 0);
  assert.equal(doc.body.children.length, 0);
});

test("lascia app: uscita riuscita → alFatto con il testo del server; due tocchi fanno una sola richiesta", async () => {
  const doc = documento();
  const fatti = [];
  const { r, u } = uscita([{ stato: 200, corpo: { ok: true, testo: TESTI_USCITA.fatto } }]);
  apriSchermataUscita(doc.body, { uscita: u, alFatto: (t) => fatti.push(t) });
  radio(doc).find((x) => x.value === "conosciuto").scegli();
  const b = doc.body.pulsante("Lascia la stanza");
  b.clic();
  b.clic();
  await aspetta();
  assert.equal(r.chiamate.length, 1);
  assert.deepEqual(fatti, [TESTI_USCITA.fatto]);
});

test("lascia app: errore annunciato (role=alert) e la schermata resta aperta", async () => {
  const doc = documento();
  const { u } = uscita([{ stato: 200, corpo: { ok: false, motivo: "in_chiamata", testo: TESTI_USCITA.inChiamata } }]);
  apriSchermataUscita(doc.body, { uscita: u });
  radio(doc).find((x) => x.value === "tempo").scegli();
  doc.body.pulsante("Lascia la stanza").clic();
  await aspetta();
  assert.deepEqual(avvisi(doc, "alert"), [TESTI_USCITA.inChiamata]);
  assert.equal(doc.body.pulsante("Lascia la stanza").disabled, false, "si può riprovare");
});

test("lascia app: Esc equivale a «Resto»", () => {
  const doc = documento();
  let resto = 0;
  const { u } = uscita([]);
  apriSchermataUscita(doc.body, { uscita: u, alResto: () => { resto += 1; } });
  doc.body.children[0].tasto("Escape");
  assert.equal(resto, 1);
});

// ---- passo 4b: aggancio alla stanza (schermata 19) ----
import { readFileSync } from "node:fs";
const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("lascia app: la vista restituisce il suo nodo, così il flusso la tiene tra un ridisegno e l'altro", () => {
  const doc = documento();
  const { u } = uscita([]);
  const s = apriSchermataUscita(doc.body, { uscita: u });
  assert.equal(s.nodo, doc.body.children[0]);
  assert.equal(s.nodo.tagName, "SECTION");
});

test("lascia app: il flusso apre la schermata 22 dal link in fondo alla stanza aperta", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /import \{ apriSchermataUscita, creaUscita, TESTI_APP as TESTI_USCITA \} from "\.\/lascia_stanza\.js";/);
  // Solo con l'accesso vero: la richiesta parte col token di chi è entrato (avvio.js non cambia).
  assert.match(flusso, /uscitaStanza = telefono && accesso \? creaUscita\(\{ token: \(\) => accesso\.token\(\) \}\) : null;/);
  // Link solo con la stanza aperta e pronta; la schermata resta la stessa tra un ridisegno e l'altro.
  assert.match(flusso, /st\.stato === "pronta" && !st\.chiusa && uscitaStanza \? h\("button", \{ classe: "link", type: "button"[^)]*onclick: apriUscita \}, TESTI_USCITA\.lascia\)/);
  assert.match(flusso, /if \(uscita\.nodo\) \{/);
  // Dopo l'uscita: il testo del server nella home, come stato annunciato.
  assert.match(flusso, /uscita\.fatto \? h\("p", \{ classe: "nota", role: "status" \}, uscita\.fatto\)/);
});

test("lascia app: service worker con il modulo e versione nuova", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.ok(sw.includes('"/app/moduli/lascia_stanza.js"'));
  assert.ok(!sw.includes('"presente-app-52"'));
});

test("lascia app: scegliendo con la tastiera i nodi non si spostano (il fuoco resta sul motivo)", () => {
  const doc = documento();
  const { u } = uscita([]);
  const s = apriSchermataUscita(doc.body, { uscita: u, alAiuto: () => {} });
  let spostati = 0;
  for (const n of [s.nodo, ...s.nodo.tutti(() => true)]) {
    const orig = n.replaceChildren.bind(n);
    n.replaceChildren = (...x) => { spostati += 1; return orig(...x); };
  }
  for (const v of ["tempo", "app", "altro", "persone"]) radio(doc).find((x) => x.value === v).scegli();
  assert.equal(spostati, 0);
});
