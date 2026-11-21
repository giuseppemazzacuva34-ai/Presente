// Locali consigliati nella schermata «Il vostro incontro» (issue #6, spec v1.1 punto 1, decisione D143 B di Giuseppe).
// Passo 2v della linea «sviluppatore-b». I locali li manda lo stato (passo 2u): a Milano i 30 del tab «Locali pilota»
// con «da verificare»; altrove di solito nessuno e resta solo «Un altro luogo pubblico» scritto. h finto, rete finta,
// orologio fisso, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_INCONTRO, schermataIncontro, creaIncontro, vistaIncontro } from "../landing/app/moduli/incontro.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ADESSO = new Date("2026-11-19T09:40:00Z");
const SCADENZA = "2026-11-22T20:00:00Z";
const L1 = "b1b1b1b1-0000-4000-8000-000000000001";
const L2 = "b1b1b1b1-0000-4000-8000-000000000002";
const LOCALI = [
  { id: L1, nome: "Vino", indirizzo: "Via Pier Lombardo 9", tipo: "wine bar", fascia: "Sera", da_verificare: false },
  { id: L2, nome: "Cru Isola", indirizzo: "Via Ugo Bassi 24", tipo: "wine bar", fascia: "Sera", da_verificare: true },
];
const base = (extra = {}) => ({ stato: "da_fissare", scadenza: SCADENZA, orario: null, locale: null, luogo: null,
  proposta_mia: false, proposta_scade: null, controproposte_rimaste: 3, azioni: ["proponi"], ritardo_minuti: null,
  esito: null, locali: LOCALI, locale_scelto: null, ...extra });

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];
const perId = (n, id) => tutti(n, (x) => x.a.id === id)[0];
function rete(risposte) {
  const chiamate = [];
  const f = async (url, opz) => {
    chiamate.push({ url, corpo: opz.body ? JSON.parse(opz.body) : null });
    const r = risposte.shift();
    return { status: r.status ?? 200, json: async () => r.dati };
  };
  return { f, chiamate };
}
async function aperto(incontro = base(), altre = []) {
  const r = rete([{ dati: { ok: true, incontro } }, ...altre]);
  const inc = creaIncontro({ token: async () => "tok", fetch: r.f, adesso: () => ADESSO });
  await inc.apri(PORTA);
  bottone(vistaIncontro(h, inc), TESTI_INCONTRO.proponi).a.onclick();
  return { inc, chiamate: r.chiamate };
}

test("testo della decisione D143 B", () => {
  assert.equal(TESTI_INCONTRO.daVerificare, "da verificare");
});

test("con locali: un menu «Dove» con i locali e «Un altro luogo pubblico»; i non visitati dicono «da verificare»", async () => {
  const { inc } = await aperto();
  const v = vistaIncontro(h, inc);
  const dove = perId(v, "incontro-dove");
  assert.equal(dove.tag, "select");
  assert.ok(tutti(v, (x) => x.tag === "label" && x.a.for === "incontro-dove").length === 1, "il menu ha la sua etichetta");
  const opzioni = tutti(dove, (x) => x.tag === "option").map((o) => [o.a.value, testo(o)]);
  assert.deepEqual(opzioni, [[L1, "Vino · Via Pier Lombardo 9"], [L2, "Cru Isola · Via Ugo Bassi 24 · da verificare"],
    ["", "Un altro luogo pubblico"]]);
  assert.equal(perId(v, "incontro-luogo"), undefined, "con un locale scelto il campo scritto non c'è");
  assert.match(testo(v), /Scegliete sempre un posto pubblico e frequentato\./);
});

test("con locali: si propone l'id del locale, mai il nome", async () => {
  const { inc, chiamate } = await aperto(base(), [{ dati: { ok: true, esito: "proposto" } }, { dati: { ok: true, incontro: base() } }]);
  inc.imposta("locale", L2);
  assert.equal(await inc.proponi({ ...inc.modello().bozza, orario: "2026-11-21T19:30:00.000Z" }), true);
  assert.deepEqual(chiamate[1].corpo, { azione: "proponi", porta: PORTA, orario: "2026-11-21T19:30:00.000Z", locale: L2 });
});

test("con locali: «Un altro luogo pubblico» mostra il campo scritto e si manda il luogo", async () => {
  const { inc, chiamate } = await aperto(base(), [{ dati: { ok: true, esito: "proposto" } }, { dati: { ok: true, incontro: base() } }]);
  inc.imposta("locale", "", true);
  const v = vistaIncontro(h, inc);
  assert.equal(perId(v, "incontro-luogo").tag, "input");
  assert.equal(await inc.proponi({ orario: "2026-11-21T19:30:00.000Z", locale: "", luogo: "Bar Centrale" }), true);
  assert.deepEqual(chiamate[1].corpo, { azione: "proponi", porta: PORTA, orario: "2026-11-21T19:30:00.000Z", luogo: "Bar Centrale" });
});

test("un locale che non è nell'elenco non si manda", async () => {
  const { inc, chiamate } = await aperto();
  assert.equal(await inc.proponi({ orario: "2026-11-21T19:30:00.000Z", locale: "b1b1b1b1-0000-4000-8000-000000000999", luogo: "" }), false);
  assert.equal(inc.modello().errore, TESTI_INCONTRO.luogoNonVa);
  assert.equal(chiamate.length, 1);
});

test("senza locali (fuori Milano): solo il luogo scritto, come prima", async () => {
  const { inc } = await aperto(base({ locali: [] }));
  const v = vistaIncontro(h, inc);
  assert.equal(perId(v, "incontro-dove"), undefined);
  assert.equal(perId(v, "incontro-luogo").tag, "input");
  assert.match(testo(v), /Un altro luogo pubblico/);
});

test("proposta e appuntamento: il locale scelto col suo nome, «da verificare» se non visitato", () => {
  const scelto = { nome: "Cru Isola", indirizzo: "Via Ugo Bassi 24", da_verificare: true };
  const r = schermataIncontro(base({ stato: "proposto", orario: "2026-11-21T19:30:00Z", locale: L2, locale_scelto: scelto,
    azioni: ["accetto"] }), ADESSO);
  assert.equal(r.proposta, "sabato 21 novembre alle 20:30 · Cru Isola · Via Ugo Bassi 24 · da verificare");
  const c = schermataIncontro(base({ stato: "confermato", orario: "2026-11-21T19:30:00Z", locale: L1, azioni: [],
    locale_scelto: { nome: "Vino", indirizzo: "Via Pier Lombardo 9", da_verificare: false } }), ADESSO);
  assert.equal(c.titolo, "Ci vediamo sabato 21 novembre alle 20:30 · Vino · Via Pier Lombardo 9");
  const senza = schermataIncontro(base({ stato: "proposto", orario: "2026-11-21T19:30:00Z", locale: L1, locale_scelto: null,
    azioni: ["accetto"] }), ADESSO);
  assert.equal(senza.proposta, "sabato 21 novembre alle 20:30 · il locale consigliato", "senza nome: come prima");
});
