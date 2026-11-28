// «Sono qui» e segnale nella schermata «Il vostro incontro» (issue #6, spec v1 del CPO del 3/11, passi 6 e 8).
// Passo 2i della linea «sviluppatore-b». Stato e check-in passano da /app/api/incontro (worker/incontro_api.js, passi
// 2g e 2h): qui solo cosa si mostra e cosa si manda. h finto, rete finta, orologio fisso, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_INCONTRO, schermataIncontro, testoErroreIncontro, creaIncontro, vistaIncontro } from "../landing/app/moduli/incontro.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORARIO = "2026-11-21T19:30:00Z"; // sabato 20:30 di Roma
const DENTRO = new Date("2026-11-21T19:10:00Z");
const confermato = (extra = {}) => ({ stato: "confermato", scadenza: "2026-11-29T20:00:00Z", orario: ORARIO, locale: null,
  luogo: "Bar Centrale", proposta_mia: false, proposta_scade: null, controproposte_rimaste: 3, azioni: [], ritardo_minuti: null,
  esito: null, checkin_mio: false, checkin_altro: false, checkin_da: "2026-11-21T19:00:00.000Z",
  checkin_fino: "2026-11-21T20:00:00.000Z", segnale: null, ...extra });

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];

function rete(risposte) {
  const chiamate = [];
  const f = async (url, opz) => {
    chiamate.push({ url, metodo: opz.method, corpo: opz.body ? JSON.parse(opz.body) : null });
    const r = risposte.shift();
    if (r instanceof Error) throw r;
    return { status: r.status ?? 200, json: async () => r.dati };
  };
  return { f, chiamate };
}

test("testi della spec per check-in e segnale", () => {
  assert.equal(TESTI_INCONTRO.sonoQui, "Sono qui");
  assert.equal(TESTI_INCONTRO.segnale, "Il vostro segnale: <parola>");
  assert.equal(TESTI_INCONTRO.creditiLiberi, "I tuoi 100 crediti sono di nuovo disponibili.");
});

test("confermato, dentro la finestra: c'è «Sono qui»; fuori: quando si potrà fare", () => {
  const s = schermataIncontro(confermato({ azioni: ["sono_qui"] }), DENTRO);
  assert.deepEqual(s.azioni, ["sono_qui"]);
  const prima = schermataIncontro(confermato(), new Date("2026-11-21T10:00:00Z"));
  assert.deepEqual(prima.azioni, []);
  assert.equal(prima.checkin, "Potrai dire «Sono qui» sabato 21 novembre dalle 20:00 alle 21:00.");
});

test("check-in fatto solo da me: si aspetta l'altra persona, nessun pulsante, nessun segnale", () => {
  const s = schermataIncontro(confermato({ checkin_mio: true }), DENTRO);
  assert.deepEqual(s.azioni, []);
  assert.equal(s.checkin, "L'altra persona non ha ancora fatto il check-in.");
  assert.equal(s.segnale, undefined);
});

test("avvenuto: il segnale (stessa parola dal server) e i crediti di nuovo disponibili", () => {
  const s = schermataIncontro(confermato({ stato: "concluso", esito: "avvenuto", checkin_mio: true, checkin_altro: true, segnale: "Lampone" }), DENTRO);
  assert.equal(s.tipo, "avvenuto");
  assert.equal(s.segnale, "Il vostro segnale: Lampone");
  assert.equal(s.testo, TESTI_INCONTRO.creditiLiberi);
  const senza = schermataIncontro(confermato({ stato: "concluso", esito: "avvenuto", segnale: null }), DENTRO);
  assert.equal(senza.segnale, null, "segnale mancante → niente parola inventata");
});

test("errori del check-in → testi con una via d'uscita", () => {
  for (const m of ["troppo_presto", "troppo_tardi", "non_confermato", "gia_fatto"]) {
    assert.notEqual(testoErroreIncontro(m), "Non è andata. Riprova tra poco.", m);
  }
});

test("«Sono qui»: POST { azione: checkin, porta } solo dentro la finestra, poi si rilegge lo stato", async () => {
  const { f, chiamate } = rete([
    { dati: { ok: true, incontro: confermato({ azioni: ["sono_qui"] }) } },
    { dati: { ok: true, esito: "sono_qui" } },
    { dati: { ok: true, incontro: confermato({ checkin_mio: true }) } },
  ]);
  const inc = creaIncontro({ token: async () => "tok", fetch: f, adesso: () => DENTRO });
  await inc.apri(PORTA);
  assert.equal(await inc.checkin(), true);
  assert.deepEqual(chiamate[1].corpo, { azione: "checkin", porta: PORTA });
  assert.equal(chiamate[1].metodo, "POST");
  assert.equal(inc.modello().incontro.checkin_mio, true);
  assert.equal(await inc.checkin(), false, "già fatto: niente seconda richiesta");
  assert.equal(chiamate.length, 3);
});

test("«Sono qui» rifiutato dal server (troppo tardi): si rilegge e si mostra il motivo", async () => {
  const { f, chiamate } = rete([
    { dati: { ok: true, incontro: confermato({ azioni: ["sono_qui"] }) } },
    { dati: { ok: false, motivo: "troppo_tardi" } },
    { dati: { ok: true, incontro: confermato() } },
  ]);
  const inc = creaIncontro({ token: async () => "tok", fetch: f, adesso: () => DENTRO });
  await inc.apri(PORTA);
  assert.equal(await inc.checkin(), false);
  assert.equal(chiamate.length, 3);
  assert.equal(inc.modello().errore, testoErroreIncontro("troppo_tardi"));
});

test("vista: pulsante grande «Sono qui», poi attesa, poi il segnale in evidenza", async () => {
  const { f } = rete([
    { dati: { ok: true, incontro: confermato({ azioni: ["sono_qui"] }) } },
    { dati: { ok: true, esito: "sono_qui" } },
    { dati: { ok: true, incontro: confermato({ checkin_mio: true }) } },
    { dati: { ok: true, incontro: confermato({ stato: "concluso", esito: "avvenuto", checkin_mio: true, checkin_altro: true, segnale: "Lampone" }) } },
  ]);
  const inc = creaIncontro({ token: async () => "tok", fetch: f, adesso: () => DENTRO });
  await inc.apri(PORTA);
  let v = vistaIncontro(h, inc);
  const b = bottone(v, TESTI_INCONTRO.sonoQui);
  assert.ok(b, "c'è «Sono qui»");
  assert.match(b.a.classe, /grande/);
  await b.a.onclick();
  v = vistaIncontro(h, inc);
  assert.equal(bottone(v, TESTI_INCONTRO.sonoQui), undefined);
  assert.match(testo(v), /L'altra persona non ha ancora fatto il check-in\./);
  await inc.riprova();
  v = vistaIncontro(h, inc);
  const segnale = tutti(v, (x) => x.a.classe === "segnale")[0];
  assert.equal(testo(segnale), "Il vostro segnale: Lampone");
  assert.equal(segnale.a.role, "status");
  assert.match(testo(v), /I tuoi 100 crediti sono di nuovo disponibili\./);
});
