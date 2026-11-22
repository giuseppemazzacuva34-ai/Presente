// Issue #65, passo 8b-3a: nella home, una porta svelata senza risposta resta raggiungibile («Vuoi incontrare <nome>?»
// + «Rispondi») fino alla fine delle 48 ore; l'esito (doppio sì o chiusa) si legge con il testo del server, uguale per
// entrambi, senza pulsanti. Chi ha già risposto non riceve avvisi (mai indizi sull'altra persona). h finto, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { avvisiPorte, prossimaLettura, vistaAvvisiPorte, LETTURA_MS, TESTI_AVVISI } from "../landing/app/moduli/avvisi_porte.js";
import { TESTI_SVELAMENTO } from "../api/svelamento.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LEI = "11111111-2222-4333-8444-555555555555";
const ADESSO = new Date("2026-11-17T10:00:00Z");
const svelata = (extra = {}) => ({ porta: PORTA, con: LEI, nome: "Giulia", eta: 31, tipo: "video",
  finito_il: "2026-11-16T19:00:00Z", risposta_scade_il: "2026-11-18T19:00:00Z", ho_risposto: false,
  domanda: "Vuoi incontrare Giulia?", in_attesa: null, ...extra });
const esito = (extra = {}) => ({ porta: PORTA, con: LEI, nome: "Giulia", eta: 31, esito: "chiusa",
  esito_il: "2026-11-17T09:00:00Z", testo: TESTI_SVELAMENTO.chiusa, ...extra });
const stato = ({ svelate = [], esiti = [] } = {}) => ({ saldo: 0, caparra: 100, beta: true, porte: [], svelate, esiti });

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };

test("porta svelata senza risposta: la domanda del server, «Rispondi», urgente", () => {
  const [a] = avvisiPorte(stato({ svelate: [svelata()] }), ADESSO);
  assert.equal(a.porta, PORTA);
  assert.equal(a.testo, "Vuoi incontrare Giulia?");
  assert.equal(a.urgente, true);
  assert.equal(a.bottone, TESTI_AVVISI.rispondi);
  assert.equal(a.etichetta, "Rispondi a Giulia");
});

test("porta svelata già risposta o con il tempo finito: nessun avviso", () => {
  assert.deepEqual(avvisiPorte(stato({ svelate: [svelata({ ho_risposto: true, in_attesa: "Hai risposto." })] }), ADESSO), []);
  assert.deepEqual(avvisiPorte(stato({ svelate: [svelata({ risposta_scade_il: "2026-11-17T09:59:00Z" })] }), ADESSO), []);
  assert.deepEqual(avvisiPorte(stato({ svelate: [svelata({ porta: "x" })] }), ADESSO), []);
});

test("esito: testo del server, non urgente, senza pulsante; esiti sconosciuti o senza testo non compaiono", () => {
  const [a] = avvisiPorte(stato({ esiti: [esito()] }), ADESSO);
  assert.equal(a.testo, TESTI_SVELAMENTO.chiusa);
  assert.equal(a.urgente, false);
  assert.equal(a.bottone, null);
  const [d] = avvisiPorte(stato({ esiti: [esito({ esito: "doppio_si", testo: TESTI_SVELAMENTO.doppioSi })] }), ADESSO);
  assert.equal(d.testo, TESTI_SVELAMENTO.doppioSi);
  assert.deepEqual(avvisiPorte(stato({ esiti: [esito({ esito: "boh" })] }), ADESSO), []);
  assert.deepEqual(avvisiPorte(stato({ esiti: [esito({ testo: "" })] }), ADESSO), []);
});

test("letture: si continua ogni minuto finché c'è una porta svelata in attesa dell'esito", () => {
  assert.equal(prossimaLettura({ ok: true, stato: stato({ svelate: [svelata()] }) }, ADESSO), LETTURA_MS);
  assert.equal(prossimaLettura({ ok: true, stato: stato({ svelate: [svelata({ ho_risposto: true })] }) }, ADESSO), LETTURA_MS);
  assert.equal(prossimaLettura({ ok: true, stato: stato({ esiti: [esito()] }) }, ADESSO), null);
});

test("vista: avviso senza pulsante = solo il testo; con «Rispondi» il pulsante apre la porta", () => {
  const aperte = [];
  const ap = { modello: () => ({ avvisi: avvisiPorte(stato({ svelate: [svelata()], esiti: [esito({ porta: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" })] }), ADESSO) }) };
  const v = vistaAvvisiPorte(h, ap, { apri: (p) => aperte.push(p) });
  const bottoni = tutti(v, (x) => x.tag === "button");
  assert.equal(bottoni.length, 1);
  assert.equal(testo(bottoni[0]), "Rispondi");
  bottoni[0].a.onclick();
  assert.deepEqual(aperte, [PORTA]);
  assert.ok(testo(v).includes(TESTI_SVELAMENTO.chiusa));
});
