// «Arrivo in ritardo» nella schermata «Il vostro incontro» (issue #6, spec v1 del CPO del 3/11, «Casi limite»):
// +15 o +30 minuti, una volta sola, sposta la finestra del check-in. L'azione «ritardo» e «ritardo_mio» arrivano dallo
// stato (#494, #495); qui solo cosa si mostra e cosa si manda. Linea «sviluppatore-b». h finto, rete finta, orologio
// fisso, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_INCONTRO, schermataIncontro, testoErroreIncontro, creaIncontro, vistaIncontro } from "../landing/app/moduli/incontro.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORARIO = "2026-11-24T19:30:00Z"; // martedì 24 novembre, 20:30 di Roma
const SCADENZA = "2026-11-29T20:00:00Z";
const ADESSO = new Date("2026-11-24T19:00:00Z"); // 30 minuti prima
const base = (extra = {}) => ({ stato: "confermato", scadenza: SCADENZA, orario: ORARIO, locale: null, luogo: "Bar Centrale",
  proposta_mia: false, proposta_scade: null, controproposte_rimaste: 3, azioni: ["sono_qui", "disdici", "ritardo"],
  ritardo_minuti: 0, ritardo_mio: false, esito: null, checkin_mio: false, checkin_altro: false,
  checkin_da: "2026-11-24T19:00:00Z", checkin_fino: "2026-11-24T20:00:00Z", segnale: null, disdetta: null, ...extra });

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];

function rete(risposte) {
  const chiamate = [];
  const f = async (url, opz) => {
    chiamate.push({ url, metodo: opz.method, corpo: opz.body ? JSON.parse(opz.body) : null });
    const r = risposte.shift();
    return { status: r.status ?? 200, json: async () => r.dati };
  };
  return { f, chiamate };
}
const stato = (i) => ({ dati: { ok: true, incontro: i } });

test("testi: «Arrivo in ritardo», +15 e +30 minuti", () => {
  assert.equal(TESTI_INCONTRO.ritardo, "Arrivo in ritardo");
  assert.equal(TESTI_INCONTRO.ritardo15, "+15 minuti");
  assert.equal(TESTI_INCONTRO.ritardo30, "+30 minuti");
});

test("con «ritardo» tra le azioni c'è il pulsante; senza, no", () => {
  assert.ok(schermataIncontro(base(), ADESSO).azioni.includes("ritardo"));
  const conIl = { modello: () => ({ porta: PORTA, incontro: base(), proposta: false, conferma: null, bozza: {} }), adesso: () => ADESSO };
  assert.ok(bottone(vistaIncontro(h, conIl), "Arrivo in ritardo"));
  const senza = { modello: () => ({ porta: PORTA, incontro: base({ azioni: ["sono_qui"] }), proposta: false, conferma: null, bozza: {} }), adesso: () => ADESSO };
  assert.equal(bottone(vistaIncontro(h, senza), "Arrivo in ritardo"), undefined);
});

test("primo tocco: si sceglie +15 o +30 (nessuna richiesta); poi manda { azione: ritardo, minuti } e rilegge", async () => {
  const dopo = base({ azioni: ["sono_qui", "disdici"], ritardo_minuti: 30, ritardo_mio: true, checkin_fino: "2026-11-24T20:30:00Z" });
  const r = rete([stato(base()), { dati: { ok: true, esito: "ritardo" } }, stato(dopo)]);
  const inc = creaIncontro({ token: () => "t", fetch: r.f, adesso: () => ADESSO });
  await inc.apri(PORTA);
  assert.equal(await inc.ritardo(), false, "il primo tocco apre la scelta");
  assert.equal(r.chiamate.length, 1);
  const v = vistaIncontro(h, inc);
  assert.match(testo(v), new RegExp(TESTI_INCONTRO.domandaRitardo.replace(/[?]/g, "\\?")));
  assert.ok(bottone(v, "+15 minuti") && bottone(v, "+30 minuti") && bottone(v, TESTI_INCONTRO.no));
  assert.equal(bottone(v, "Arrivo in ritardo"), undefined, "durante la scelta non c'è di nuovo il pulsante");
  assert.equal(await inc.ritardo(30), true);
  assert.deepEqual(r.chiamate[1].corpo, { azione: "ritardo", minuti: 30, porta: PORTA });
  assert.equal(inc.modello().conferma, null);
  assert.equal(inc.modello().incontro.ritardo_minuti, 30);
});

test("minuti diversi da 15 o 30 non partono; «No, torna indietro» chiude la scelta", async () => {
  const r = rete([stato(base())]);
  const inc = creaIncontro({ token: () => "t", fetch: r.f, adesso: () => ADESSO });
  await inc.apri(PORTA);
  await inc.ritardo();
  for (const m of [10, 45, "15"]) assert.equal(await inc.ritardo(m), false);
  assert.equal(r.chiamate.length, 1);
  inc.nonAnnullare();
  assert.equal(inc.modello().conferma, null);
  assert.ok(bottone(vistaIncontro(h, inc), "Arrivo in ritardo"));
});

test("senza l'azione dal server non manda nulla", async () => {
  const r = rete([stato(base({ azioni: ["sono_qui"] }))]);
  const inc = creaIncontro({ token: () => "t", fetch: r.f, adesso: () => ADESSO });
  await inc.apri(PORTA);
  assert.equal(await inc.ritardo(), false);
  assert.equal(await inc.ritardo(15), false);
  assert.equal(r.chiamate.length, 1);
});

test("dopo il ritardo: a me «Hai avvisato…», all'altra persona col nome; senza ritardo nessun testo", () => {
  const mio = schermataIncontro(base({ ritardo_minuti: 15, ritardo_mio: true }), ADESSO, "Ciro");
  assert.equal(mio.ritardo, "Hai avvisato che arrivi con 15 minuti di ritardo.");
  const altro = schermataIncontro(base({ ritardo_minuti: 30, ritardo_mio: false }), ADESSO, "Ciro");
  assert.equal(altro.ritardo, "Ciro arriva con 30 minuti di ritardo.");
  assert.equal(schermataIncontro(base({ ritardo_minuti: 30 }), ADESSO).ritardo, "L'altra persona arriva con 30 minuti di ritardo.");
  for (const strano of [0, null, 20, "15"]) assert.equal(schermataIncontro(base({ ritardo_minuti: strano }), ADESSO).ritardo, null, String(strano));
  const inc = { modello: () => ({ porta: PORTA, incontro: base({ ritardo_minuti: 15, ritardo_mio: false }), proposta: false, conferma: null, bozza: {}, nome: "Ciro" }), adesso: () => ADESSO };
  assert.match(testo(vistaIncontro(h, inc)), /Ciro arriva con 15 minuti di ritardo\./);
});

test("errori del server per il ritardo: testi con una via d'uscita", () => {
  assert.equal(testoErroreIncontro("ritardo:ritardo_gia_usato"), TESTI_INCONTRO.ritardoGiaUsato);
  assert.equal(testoErroreIncontro("ritardo:troppo_tardi"), TESTI_INCONTRO.troppoTardi);
  assert.equal(testoErroreIncontro("ritardo:gia_fatto"), TESTI_INCONTRO.giaFatto);
  assert.notEqual(testoErroreIncontro("ritardo:ritardo_non_valido"), "Non è andata. Riprova tra poco.");
});

test("i minuti dell'app sono quelli di api/incontro.js", async () => {
  const { INCONTRO } = await import("../api/incontro.js");
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../landing/app/moduli/incontro.js", import.meta.url), "utf8");
  assert.match(src, new RegExp(`const RITARDI = \\[${INCONTRO.ritardi.join(", ")}\\];`));
});
