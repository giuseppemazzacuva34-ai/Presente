// Fascia di disponibilità e testi del pulsante (issue #4, spec v1.3 del CPO, 13/11, § 1 e § 2). Solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FASCIA_DEFAULT, controllaFascia, dentroFascia, inPausa, testoDisponibile, puoChiamare, giornoDiRoma, TESTI_PULSANTE }
  from "../api/chiamate.js";
import { oraDiRoma } from "../api/stanze.js";

const APRE = oraDiRoma(2026, 11, 9, 9);
const CHIUDE = oraDiRoma(2026, 11, 15, 21);
const STANZA = { apre: APRE, chiude: CHIUDE, membri: ["a", "b", "c", "d"] };
const MARTEDI = (h, m = 0) => oraDiRoma(2026, 11, 10, h, m);
const min = (n) => n * 60000;
const base = (extra = {}) => ({ chi: "a", verso: "b", adesso: MARTEDI(20), stanza: STANZA, chiamate: [], blocchi: [],
  inChiamata: new Set(), fascia: null, ...extra });

test("default 9:00–23:00 per chi non ha mai toccato la fascia", () => {
  assert.deepEqual(FASCIA_DEFAULT, { da: "09:00", a: "23:00" });
  assert.equal(dentroFascia(null, MARTEDI(9)), true);
  assert.equal(dentroFascia(null, MARTEDI(22, 59)), true);
});

test("alle 8:59 e alle 23:00 nessuno squillo verso la fascia di default (orologio simulato)", () => {
  for (const adesso of [MARTEDI(8, 59), MARTEDI(23, 0), MARTEDI(23, 30)]) {
    const r = puoChiamare(base({ adesso }));
    assert.equal(r.ok, false);
    assert.equal(r.motivo, "fuori_fascia");
  }
  assert.equal(puoChiamare(base({ adesso: MARTEDI(8, 59) })).testo, "Disponibile da 9:00");
  assert.equal(puoChiamare(base({ adesso: MARTEDI(23, 0) })).testo, "Disponibile domani dalle 9:00");
});

test("prima della fascia «Disponibile da 19:00», dopo «Disponibile domani dalle 19:00»", () => {
  const fascia = { da: "19:00", a: "21:30" };
  assert.equal(testoDisponibile(fascia, MARTEDI(18), false), "Disponibile da 19:00");
  assert.equal(testoDisponibile(fascia, MARTEDI(21, 30), false), "Disponibile domani dalle 19:00");
  assert.equal(puoChiamare(base({ fascia, adesso: MARTEDI(20) })).ok, true);
});

test("la fascia può finire a 24:00", () => {
  const fascia = { da: "20:00", a: "24:00" };
  assert.equal(dentroFascia(fascia, MARTEDI(23, 59)), true);
  assert.equal(controllaFascia("20:00", "24:00").ok, true);
});

test("fascia sotto un'ora, che finisce prima dell'inizio o fuori dal passo di 30 minuti: non si salva", () => {
  const errore = "La fascia deve durare almeno un'ora e finire dopo l'inizio.";
  for (const [da, a] of [["19:00", "19:30"], ["22:00", "01:00"], ["20:00", "20:00"], ["19:00", "18:00"]]) {
    assert.deepEqual(controllaFascia(da, a), { ok: false, errore }, `${da}-${a}`);
  }
  for (const [da, a] of [["19:15", "21:00"], ["25:00", "26:00"], ["", "21:00"], ["7:00", "9:00"], ["00:00", "24:30"]]) {
    assert.equal(controllaFascia(da, a).ok, false, `${da}-${a}`);
  }
  assert.deepEqual(controllaFascia("00:00", "01:00"), { ok: true, fascia: { da: "00:00", a: "01:00" } });
  assert.equal(controllaFascia("09:00", "23:00").ok, true);
});

test("«Oggi non ricevo chiamate» vale solo oggi e si spegne da solo a mezzanotte (orologio simulato)", () => {
  const oggi = giornoDiRoma(MARTEDI(20));
  assert.equal(inPausa(oggi, MARTEDI(20)), true);
  assert.equal(inPausa(oggi, MARTEDI(23, 59)), true);
  assert.equal(inPausa(oggi, oraDiRoma(2026, 11, 11, 0, 0)), false);
  assert.equal(inPausa(null, MARTEDI(20)), false);
  const r = puoChiamare(base({ pausa: oggi }));
  assert.deepEqual(r, { ok: false, motivo: "fuori_fascia", testo: "Disponibile domani dalle 9:00" });
  assert.equal(puoChiamare(base({ pausa: oggi, adesso: oraDiRoma(2026, 11, 11, 10) })).ok, true);
});

test("la pausa non si scopre: stesso testo e stesso motivo di chi è fuori fascia dopo la fine", () => {
  const conPausa = puoChiamare(base({ pausa: giornoDiRoma(MARTEDI(20)) }));
  const dopoFascia = puoChiamare(base({ adesso: MARTEDI(23, 10) }));
  assert.deepEqual(conPausa, dopoFascia);
});

test("B a 5 chiamate oggi: A vede il testo della spec e la richiesta è rifiutata", () => {
  const diB = ["c", "d", "c", "d", "c"].map((x, i) => ({ chi: x, con: "b", inizio: new Date(MARTEDI(20).getTime() - min(100 - i * 16)), durata: 120 }));
  assert.deepEqual(puoChiamare(base({ chiamate: diB })),
    { ok: false, motivo: "cinque_oggi_lei", testo: "Per oggi non può ricevere altre chiamate. Riprova domani." });
});

// Un caso per testo, con tutte le condizioni «più deboli» presenti insieme: vince sempre la priorità della spec.
test("i 6 testi compaiono nel caso giusto, uno solo, nell'ordine di priorità della spec", () => {
  const ora = MARTEDI(20);
  const tre = [0, 1, 2].map((i) => ({ chi: "a", con: "b", inizio: new Date(APRE.getTime() + min(60 * (i + 1))), durata: 120 }));
  const cinqueA = ["c", "d", "c", "d", "c"].map((x, i) => ({ chi: "a", con: x, inizio: new Date(ora.getTime() - min(100 - i * 16)), durata: 120 }));
  const cinqueB = ["c", "d", "c", "d", "c"].map((x, i) => ({ chi: x, con: "b", inizio: new Date(ora.getTime() - min(100 - i * 16)), durata: 120 }));
  const tutto = { inChiamata: new Set(["b"]), fascia: { da: "21:00", a: "23:00" }, soloConPermesso: true, permessi: new Set() };
  const casi = [
    [{ ...tutto, chiamate: [...tre, ...cinqueA, ...cinqueB] }, "tre_con_lei"],
    [{ ...tutto, chiamate: [...cinqueA, ...cinqueB] }, "cinque_oggi"],
    [{ ...tutto, chiamate: cinqueB }, "cinque_oggi_lei"],
    [{ ...tutto }, "occupato"],
    [{ ...tutto, inChiamata: new Set() }, "fuori_fascia"],
    [{ ...tutto, inChiamata: new Set(), fascia: null }, "serve_permesso"],
  ];
  const visti = new Set();
  for (const [extra, motivo] of casi) {
    const r = puoChiamare(base(extra));
    assert.equal(r.motivo, motivo);
    assert.equal(typeof r.testo, "string");
    visti.add(r.testo);
  }
  assert.equal(visti.size, 6);
  assert.deepEqual(Object.keys(TESTI_PULSANTE), ["tre_con_lei", "cinque_oggi", "cinque_oggi_lei", "occupato", "fuori_fascia", "serve_permesso"]);
});

test("nessun testo rivela pausa, numero di chiamate dell'altra persona o con chi ha parlato", () => {
  const testi = [...Object.values(TESTI_PULSANTE).filter((t) => typeof t === "string"),
    testoDisponibile(null, MARTEDI(8), false), testoDisponibile(null, MARTEDI(20), true)];
  for (const t of testi) assert.doesNotMatch(t, /pausa|non ricev[eo] chiamate oggi|\b5\b.*(fatto|ricevut).*lei|con [A-Z]/i, t);
  assert.doesNotMatch(TESTI_PULSANTE.cinque_oggi_lei, /\d/);
});
