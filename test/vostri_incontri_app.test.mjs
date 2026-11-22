// «I vostri incontri» nella home (issue #6, spec v1 del CPO del 3/11, punto 1 «Vi incontrate»), passo 3m della linea
// «sviluppatore-b». Il modulo legge GET /app/api/incontro?elenco=1 (passo 3l) col token e trasforma
// { porta, nome, stato, scadenza, orario, esito } in righe brevi per la home, con il pulsante che apre «Il vostro
// incontro». Niente email, numeri o luoghi; solo in memoria. Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_VOSTRI_INCONTRI as T, righeVostriIncontri, creaVostriIncontri, vistaVostriIncontri } from "../landing/app/moduli/vostri_incontri.js";

const P1 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const P2 = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const P3 = "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const P4 = "dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ADESSO = new Date("2026-11-25T10:00:00Z");

test("una riga per stato, con il nome o «l'altra persona»", () => {
  const r = righeVostriIncontri([
    { porta: P1, nome: "Bruno", stato: "da_fissare", scadenza: "2026-12-02T20:00:00Z", orario: null, esito: null },
    { porta: P2, nome: null, stato: "proposto", scadenza: "2026-12-02T20:00:00Z", orario: "2026-11-28T19:00:00Z", esito: null },
    { porta: P3, nome: "Carla", stato: "confermato", scadenza: "2026-12-02T20:00:00Z", orario: "2026-11-28T19:30:00Z", esito: null },
  ], ADESSO);
  assert.deepEqual(r, [
    { porta: P3, nome: "Carla", titolo: "Con Carla", testo: "Ci vediamo sabato 28 novembre alle 20:30", apri: T.apri },
    { porta: P2, nome: null, titolo: "Con l'altra persona", testo: T.proposto, apri: T.apri },
    { porta: P1, nome: "Bruno", titolo: "Con Bruno", testo: "Da fissare entro mercoledì 2 dicembre", apri: T.apri },
  ]);
});

test("incontri chiusi: solo quello avvenuto (per la valutazione), dopo quelli in corso", () => {
  const r = righeVostriIncontri([
    { porta: P1, nome: "Bruno", stato: "concluso", scadenza: "2026-12-02T20:00:00Z", orario: "2026-11-20T19:00:00Z", esito: "avvenuto" },
    { porta: P2, nome: "Dario", stato: "concluso", scadenza: "2026-12-02T20:00:00Z", orario: null, esito: "scaduto" },
    { porta: P3, nome: "Ettore", stato: "concluso", scadenza: "2026-12-02T20:00:00Z", orario: null, esito: "annullato" },
    { porta: P4, nome: "Carla", stato: "da_fissare", scadenza: "2026-12-02T20:00:00Z", orario: null, esito: null },
  ], ADESSO);
  assert.deepEqual(r.map((x) => [x.porta, x.testo]), [[P4, "Da fissare entro mercoledì 2 dicembre"], [P1, T.avvenuto]]);
});

test("dati strani → nessuna riga, mai un errore", () => {
  for (const x of [null, undefined, "x", {}, [null, 3, { porta: "x" }, { porta: P1, stato: "inventato" }]]) {
    assert.deepEqual(righeVostriIncontri(x, ADESSO), []);
  }
  // Data illeggibile: la riga resta, senza la data.
  const r = righeVostriIncontri([{ porta: P1, nome: "Bruno", stato: "confermato", scadenza: "boh", orario: "boh", esito: null }], ADESSO);
  assert.equal(r[0].testo, T.confermatoSenzaOra);
});

test("leggi: GET col token, solo l'elenco; 401 → accesso, guasto → lettura, rete giù → rete", async () => {
  const viste = [];
  const ok = creaVostriIncontri({ token: () => "tok", fetch: async (u, o) => { viste.push([u, o.method, o.headers.authorization]);
    return Response.json({ ok: true, incontri: [{ porta: P1, nome: "Bruno", stato: "da_fissare", scadenza: "2026-12-02T20:00:00Z", orario: null, esito: null }] }); } });
  const r = await ok.leggi(ADESSO);
  assert.deepEqual(viste, [["/app/api/incontro?elenco=1", "GET", "Bearer tok"]]);
  assert.equal(r.ok, true);
  assert.equal(r.righe.length, 1);
  assert.deepEqual(await creaVostriIncontri({ token: () => null, fetch: async () => { throw new Error("no"); } }).leggi(), { ok: false, motivo: "accesso" });
  assert.deepEqual(await creaVostriIncontri({ token: () => "t", fetch: async () => new Response("", { status: 401 }) }).leggi(), { ok: false, motivo: "accesso" });
  assert.deepEqual(await creaVostriIncontri({ token: () => "t", fetch: async () => new Response("", { status: 500 }) }).leggi(), { ok: false, motivo: "lettura" });
  assert.deepEqual(await creaVostriIncontri({ token: () => "t", fetch: async () => Response.json({ ok: false }) }).leggi(), { ok: false, motivo: "lettura" });
  assert.deepEqual(await creaVostriIncontri({ token: () => "t", fetch: async () => { throw new Error("giù"); } }).leggi(), { ok: false, motivo: "rete" });
});

// h finto: oggetti semplici, così si controlla la vista senza browser.
const h = (tag, attr = {}, ...figli) => ({ tag, attr, figli: figli.flat().filter((x) => x !== null && x !== undefined && x !== false) });
const testi = (n) => (typeof n === "string" ? [n] : n && n.figli ? n.figli.flatMap(testi) : []);
const bottoni = (n) => (n && n.figli ? (n.tag === "button" ? [n] : []).concat(n.figli.flatMap(bottoni)) : []);

test("vista: nessuna riga → niente; con righe → titolo e un pulsante «Apri» per incontro", () => {
  assert.equal(vistaVostriIncontri(h, [], { apri: () => {} }), null);
  const aperti = [];
  const righe = righeVostriIncontri([{ porta: P1, nome: "Bruno", stato: "da_fissare", scadenza: "2026-12-02T20:00:00Z", orario: null, esito: null }], ADESSO);
  const v = vistaVostriIncontri(h, righe, { apri: (porta, opz) => aperti.push([porta, opz]) });
  assert.equal(v.attr.role, "region");
  assert.equal(v.attr["aria-label"], T.titolo);
  assert.ok(testi(v).includes(T.titolo));
  assert.ok(testi(v).includes("Con Bruno"));
  const b = bottoni(v);
  assert.equal(b.length, 1);
  assert.equal(b[0].attr.type, "button");
  b[0].attr.onclick();
  assert.deepEqual(aperti, [[P1, { nome: "Bruno" }]]);
});
