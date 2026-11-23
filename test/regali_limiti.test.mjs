// Testi dei due limiti giornalieri dei regali (issue #331, risposta del CPO del 22/11: giorno di calendario di Roma).
// «Oggi hai già mandato 3 regali a <nome>. Domani puoi mandargliene altri.» / «Per oggi hai mandato tutti i regali.
// Domani puoi mandarne altri.» Il foglio resta aperto con «Chiudi», messaggio con role="status", saldo invariato.
// Passo 8c della linea «sviluppatore-c». Rete e documento finti.
import { test } from "node:test";
import assert from "node:assert/strict";
import { testoLimite as testoServer, COIN } from "../api/coin.js";
import { testoLimite, statoFoglio, apriFoglioRegali } from "../landing/app/moduli/regali.js";
import { regaliApi } from "../worker/regali_api.js";

const PERSONA = "Oggi hai già mandato 3 regali a Giulia. Domani puoi mandargliene altri.";
const GIORNO = "Per oggi hai mandato tutti i regali. Domani puoi mandarne altri.";

test("testi del CPO, uguali nel server e nell'app; il 3 viene dal limite vero", () => {
  assert.equal(COIN.regaliAllaPersonaAlGiorno, 3);
  for (const t of [testoServer, testoLimite]) {
    assert.equal(t("limite_persona", "Giulia"), PERSONA);
    assert.equal(t("limite_persona", "  Giulia "), PERSONA);
    assert.equal(t("limite_giorno", "Giulia"), GIORNO);
    assert.equal(t("limite_giorno"), GIORNO);
    assert.equal(t("limite_persona"), "Oggi hai già mandato 3 regali a questa persona. Domani puoi mandargliene altri.");
    assert.equal(t("saldo", "Giulia"), null);
  }
});

test("foglio: un limite è un messaggio (non un errore), con «Chiudi» e nessun «Manda»", () => {
  const s = statoFoglio({ nome: "Giulia", saldo: 145, fase: "limite", errore: PERSONA });
  assert.equal(s.messaggio, PERSONA);
  assert.equal(s.errore, null);
  assert.deepEqual([s.primario.testo, s.primario.attivo, s.secondario], ["Chiudi", true, null]);
  assert.equal(s.saldo, "Hai 145 crediti", "saldo invariato");
});

// documento finto minimo
class Nodo {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parent = null; this.attributi = {}; this.ascoltatori = {}; this.disabled = false; this.className = ""; this._t = ""; }
  get textContent() { return this._t + this.children.map((c) => c.textContent).join(""); }
  set textContent(t) { this._t = String(t); this.children = []; }
  setAttribute(k, v) { this.attributi[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attributi, k) ? this.attributi[k] : null; }
  append(...n) { for (const x of n) { x.parent = this; this.children.push(x); } }
  replaceChildren(...n) { this.children = []; this._t = ""; this.append(...n); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  addEventListener(t, f) { (this.ascoltatori[t] ||= []).push(f); }
  focus() {}
  clic() { if (!this.disabled) for (const f of this.ascoltatori.click || []) f({ preventDefault() {} }); }
  tutti(p, o = []) { for (const c of this.children) { if (p(c)) o.push(c); c.tutti(p, o); } return o; }
}
const documento = () => { const d = {}; d.createElement = (t) => new Nodo(t, d); return d; };
const attesa = () => new Promise((r) => setTimeout(r, 0));

for (const [motivo, atteso] of [["limite_persona", PERSONA], ["limite_giorno", GIORNO]]) {
  test(`foglio: ${motivo} dal server → testo del CPO con il nome, role="status", foglio aperto con «Chiudi»`, async () => {
    const box = new Nodo("div", documento());
    let regalati = 0;
    apriFoglioRegali(box, { a: "x", nome: "Giulia", saldo: 145, alRegalo: () => regalati++, chiave: () => "k",
      regali: { manda: async () => ({ ok: false, motivo, testo: "Non è andata. Riprova tra poco." }) } });
    const pul = (t) => box.tutti((n) => n.tagName === "BUTTON" && n.textContent === t)[0];
    pul("Regala la rosa").clic();
    pul("Manda").clic();
    await attesa();
    const m = box.tutti((n) => n.className === "foglio-regali-messaggio")[0];
    assert.equal(m.textContent, atteso);
    assert.equal(m.getAttribute("role"), "status");
    assert.ok(pul("Chiudi"));
    assert.equal(box.tutti((n) => n.className === "foglio-regali-saldo")[0].textContent, "Hai 145 crediti");
    assert.equal(regalati, 0);
  });
}

// Worker: il testo del giorno sempre; per la persona il Worker non sa il nome (l'app lo mette lei).
const ENV = { SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "chiave-finta", ACCESSO_APP: "si" };
function supabaseFinto(esito) {
  return async (url) => {
    const p = new URL(url).pathname;
    if (p === "/auth/v1/user") return new Response(JSON.stringify({ id: "11111111-2222-4333-8444-555555555555" }), { status: 200 });
    if (p.endsWith("/manda_regalo")) return new Response(JSON.stringify(esito), { status: 200 });
    return new Response("[]", { status: 200 });
  };
}
const manda = () => new Request("https://presenteincontri.app/app/api/regali", { method: "POST",
  headers: { authorization: `Bearer ${"t".repeat(40)}`, "content-type": "application/json" },
  body: JSON.stringify({ azione: "manda", a: "66666666-7777-4888-9999-000000000000", regalo: "rosa", chiave: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }) });

test("Worker: limite_giorno con il testo del CPO, limite_persona con «questa persona»", async () => {
  assert.deepEqual(await (await regaliApi(manda(), ENV, supabaseFinto("limite_giorno"))).json(), { ok: false, motivo: "limite_giorno", testo: GIORNO });
  assert.deepEqual(await (await regaliApi(manda(), ENV, supabaseFinto("limite_persona"))).json(),
    { ok: false, motivo: "limite_persona", testo: testoServer("limite_persona") });
});
