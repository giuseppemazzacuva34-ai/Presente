// Riepilogo alla cieca nel profilo (issue #6, spec v1 del CPO del 3/11, «Valutazione (D20)»), passo 3j della linea
// «sviluppatore-b». Il modulo legge GET /app/api/incontro?riepilogo=1 col token e trasforma { valutati, bollini,
// no_ricevuti } in frasi: bollini solo dal terzo incontro valutato, «Una persona ha risposto no a: <domanda>» senza
// nome né data, mai la domanda sulla sicurezza, mai voti o stelle. Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_RIEPILOGO, righeRiepilogo, creaRiepilogo } from "../landing/app/moduli/riepilogo_valutazioni.js";
import { VALUTAZIONE } from "../api/valutazione.js";
import { domandeValutazione } from "../landing/app/moduli/valutazione.js";

test("prima del terzo incontro valutato: nessun bollino", () => {
  assert.deepEqual(righeRiepilogo({ valutati: 2, bollini: null, no_ricevuti: [] }), { bollini: [], no: [] });
  assert.deepEqual(righeRiepilogo({ valutati: 2, bollini: { presentato: 2, foto_sue: 2, come_in_chiamata: 2 }, no_ricevuti: [] }).bollini, []);
  assert.equal(VALUTAZIONE.bolliniDopo, 3);
});

test("dal terzo incontro: tre bollini «X incontri su N» nell'ordine delle domande", () => {
  const r = righeRiepilogo({ valutati: 3, bollini: { presentato: 3, foto_sue: 2, come_in_chiamata: 3 }, no_ricevuti: [] });
  assert.deepEqual(r.bollini, [
    "Si è presentata/o in 3 incontri su 3",
    "Foto confermate in 2 incontri su 3",
    "Come in chiamata in 3 incontri su 3",
  ]);
});

test("«no» ricevuti: la domanda della valutazione, senza nome, data né sicurezza", () => {
  const r = righeRiepilogo({ valutati: 1, bollini: null, no_ricevuti: ["presentato", "sicuro", "aspetto", "foto_sue"] });
  assert.deepEqual(r.no, [
    "Una persona ha risposto no a: «Si è presentata/o?»",
    `Una persona ha risposto no a: «${domandeValutazione(null)[1].testo}»`,
  ]);
  assert.ok(!JSON.stringify(r).includes("sicur"));
});

test("dati strani: nessuna riga, mai un errore", () => {
  for (const x of [null, "ciao", [], { valutati: "3" }, { valutati: 3, bollini: { presentato: "3" }, no_ricevuti: "foto_sue" }]) {
    assert.deepEqual(righeRiepilogo(x), { bollini: [], no: [] });
  }
});

test("testi: niente stelle, voti o aspetto", () => {
  const tutto = JSON.stringify(TESTI_RIEPILOGO).toLowerCase();
  for (const vietato of ["stell", "voto", "bell", "aspetto", "★"]) assert.ok(!tutto.includes(vietato), vietato);
});

function rete(stato, corpo) {
  const viste = [];
  const f = async (url, init = {}) => {
    viste.push({ url, init });
    if (stato === "giu") throw new Error("rete");
    return new Response(JSON.stringify(corpo), { status: stato });
  };
  return { f, viste };
}

test("leggi: una sola GET col token, senza dire chi chiede", async () => {
  const { f, viste } = rete(200, { ok: true, riepilogo: { valutati: 3, bollini: { presentato: 3, foto_sue: 3, come_in_chiamata: 3 }, no_ricevuti: [] } });
  const r = await creaRiepilogo({ token: async () => "tok-di-prova", fetch: f }).leggi();
  assert.equal(r.ok, true);
  assert.equal(r.righe.bollini.length, 3);
  assert.equal(viste.length, 1);
  assert.equal(viste[0].url, "/app/api/incontro?riepilogo=1");
  assert.equal((viste[0].init.method || "GET"), "GET");
  assert.equal(viste[0].init.headers.authorization, "Bearer tok-di-prova");
  assert.equal(viste[0].init.body, undefined);
});

test("leggi: senza token, rete giù o risposta di errore → ok false, nessuna riga inventata", async () => {
  assert.deepEqual(await creaRiepilogo({ token: async () => null, fetch: rete(200, {}).f }).leggi(), { ok: false, motivo: "accesso" });
  assert.deepEqual(await creaRiepilogo({ token: async () => "t", fetch: rete("giu").f }).leggi(), { ok: false, motivo: "rete" });
  assert.deepEqual(await creaRiepilogo({ token: async () => "t", fetch: rete(503, { ok: false, motivo: "riprova" }).f }).leggi(), { ok: false, motivo: "lettura" });
  assert.deepEqual(await creaRiepilogo({ token: async () => "t", fetch: rete(401, {}).f }).leggi(), { ok: false, motivo: "accesso" });
});
