// «Avvisa <nome> che sei qui» nell'app (issue #6, spec v1 del CPO del 3/11, punto 6), linea «sviluppatore-b». Il modulo
// legge dallo stato dell'incontro l'azione «avvisa_qui», «avviso_qui_da», «avvisato_mio» e «avvisato_altro» (#546,
// #547), manda POST { azione: "avvisa_qui", porta } col token e poi fa rileggere lo stato. Rete finta, h finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_AVVISO, rigaAvviso, creaClientAvviso, creaFoglioAvviso, vistaFoglioAvviso } from "../landing/app/moduli/avvisa_qui.js";

const PORTA = "11111111-2222-4333-8444-555555555555";
const ADESSO = new Date("2026-11-28T19:50:00Z");
const base = { stato: "confermato", orario: "2026-11-28T19:30:00Z", esito: null, azioni: ["avvisa_qui"], checkin_mio: true,
  checkin_altro: false, avviso_qui_da: "2026-11-28T19:45:00Z", avvisato_mio: false, avvisato_altro: false };

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];

function rete(risposte) {
  const viste = [];
  const f = async (url, o = {}) => {
    viste.push({ url, metodo: o.method, auth: o.headers && o.headers.authorization, corpo: o.body ? JSON.parse(o.body) : null });
    const r = risposte.shift();
    if (r instanceof Error) throw r;
    return { status: r.status || 200, ok: (r.status || 200) < 400, json: async () => r.corpo };
  };
  return { f, viste };
}

test("testo della spec: «Avvisa <nome> che sei qui»; gli altri testi ci sono", () => {
  assert.equal(TESTI_AVVISO.bottone, "Avvisa <nome> che sei qui");
  for (const k of ["presto", "avvisato", "arrivato", "attimo"]) assert.equal(typeof TESTI_AVVISO[k], "string", k);
});

test("riga: con l'azione dal server il pulsante porta il nome", () => {
  const r = rigaAvviso(base, "Bea", ADESSO);
  assert.equal(r.avvisa, true);
  assert.equal(r.bottone, "Avvisa Bea che sei qui");
  assert.equal(r.nota, null);
});

test("riga: senza azione, o non confermato, o chiuso, nessun pulsante", () => {
  assert.equal(rigaAvviso({ ...base, azioni: [] }, "Bea", ADESSO).avvisa, false);
  assert.equal(rigaAvviso({ ...base, stato: "proposto" }, "Bea", ADESSO).avvisa, false);
  assert.equal(rigaAvviso({ ...base, esito: "buca_b" }, "Bea", ADESSO).avvisa, false);
  assert.equal(rigaAvviso(null, "Bea", ADESSO).avvisa, false);
});

test("riga: prima dei 15 minuti dice da che ora si potrà avvisare (ora di Roma)", () => {
  const r = rigaAvviso({ ...base, azioni: [], avviso_qui_da: "2026-11-28T20:05:00Z" }, "Bea", ADESSO);
  assert.equal(r.avvisa, false);
  assert.equal(r.nota, "Dalle 21:05 potrai avvisare Bea che sei qui.");
});

test("riga: dopo l'avviso, a me «avvisato», all'altra persona «è già lì»; senza nome «L'altra persona»", () => {
  assert.equal(rigaAvviso({ ...base, azioni: [], avvisato_mio: true }, "Bea", ADESSO).nota, "Hai avvisato Bea che sei qui.");
  assert.equal(rigaAvviso({ ...base, azioni: [], checkin_mio: false, avviso_qui_da: null, avvisato_altro: true }, null, ADESSO).nota,
    "L'altra persona ti ha avvisato: è già lì e ti aspetta.");
});

test("client: manda azione e porta col token; esito «avvisato»", async () => {
  const r = rete([{ corpo: { ok: true, esito: "avvisato" } }]);
  const c = creaClientAvviso({ token: () => "tok", fetch: r.f });
  assert.deepEqual(await c.avvisa(PORTA), { ok: true, esito: "avvisato" });
  assert.deepEqual(r.viste[0], { url: "/app/api/incontro", metodo: "POST", auth: "Bearer tok", corpo: { azione: "avvisa_qui", porta: PORTA } });
});

test("client: rifiuti con frase; porta strana o rete giù → generico, senza rete per la porta strana", async () => {
  const r = rete([{ corpo: { ok: false, motivo: "gia_avvisato" } }, new Error("giù")]);
  const c = creaClientAvviso({ token: () => "tok", fetch: r.f });
  assert.deepEqual(await c.avvisa(PORTA), { ok: false, testo: TESTI_AVVISO.errori.gia_avvisato });
  assert.deepEqual(await c.avvisa(PORTA), { ok: false, testo: TESTI_AVVISO.errori.generico });
  assert.deepEqual(await c.avvisa("x"), { ok: false, testo: TESTI_AVVISO.errori.generico });
  assert.equal(r.viste.length, 2);
});

test("foglio e vista: il tocco manda, mostra l'esito e rilegge lo stato; un solo invio alla volta", async () => {
  let ricariche = 0;
  let manda;
  const client = { avvisa: () => new Promise((ok) => { manda = ok; }) };
  const fa = creaFoglioAvviso({ client, ricarica: () => { ricariche++; } });
  const v = vistaFoglioAvviso(h, fa, PORTA, base, "Bea", ADESSO);
  const b = bottone(v, "Avvisa Bea che sei qui");
  assert.equal(b.a.type, "button");
  const p = b.a.onclick();
  assert.equal(await fa.manda(PORTA), false); // già in corso
  assert.equal(fa.modello().invio, true);
  manda({ ok: true, esito: "avvisato" });
  assert.equal(await p, true);
  assert.equal(ricariche, 1);
  const dopo = vistaFoglioAvviso(h, fa, PORTA, { ...base, azioni: [], avvisato_mio: true }, "Bea", ADESSO);
  assert.match(testo(dopo), /Hai avvisato Bea che sei qui\./);
  assert.ok(tutti(dopo, (x) => x.a.role === "status").length >= 1);
});

test("vista: un errore si legge (role alert) e il pulsante resta", async () => {
  const fa = creaFoglioAvviso({ client: { avvisa: async () => ({ ok: false, testo: TESTI_AVVISO.errori.troppo_presto }) } });
  await fa.manda(PORTA);
  const v = vistaFoglioAvviso(h, fa, PORTA, base, "Bea", ADESSO);
  assert.equal(testo(tutti(v, (x) => x.a.role === "alert")[0]), TESTI_AVVISO.errori.troppo_presto);
  assert.ok(bottone(v, "Avvisa Bea che sei qui"));
});

test("vista: niente da dire → null (nessun riquadro vuoto)", () => {
  const fa = creaFoglioAvviso({ client: { avvisa: async () => ({ ok: true }) } });
  assert.equal(vistaFoglioAvviso(h, fa, PORTA, { ...base, azioni: [], checkin_mio: false, avviso_qui_da: null }, "Bea", ADESSO), null);
  assert.equal(vistaFoglioAvviso(h, fa, PORTA, { ...base, checkin_altro: true, azioni: [], avviso_qui_da: null }, "Bea", ADESSO), null);
});
