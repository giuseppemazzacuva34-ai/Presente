// «Ero lì» / «Non riesco a fare il check-in» nell'app (issue #6, spec v1 casi limite e v1.4 del CPO del 27/11; D51 A,
// D156 A), linea «sviluppatore-b». Il modulo legge GET /app/api/incontro?porta=<id>&buca=1 e manda
// POST { azione: "contesta_buca", porta, testo } col token; dice quale pulsante mostrare e l'esito. Rete finta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_BUCA, testoValidoBuca, rigaContestaBuca, creaContestaBuca } from "../landing/app/moduli/contesta_buca.js";

const PORTA = "11111111-2222-4333-8444-555555555555";

test("testi della spec: nomi dei pulsanti e frase a chi ha aspettato (v1.4)", () => {
  assert.equal(TESTI_BUCA.eroLi, "Ero lì");
  assert.equal(TESTI_BUCA.nonRiesco, "Non riesco a fare il check-in");
  assert.equal(TESTI_BUCA.altroContesta,
    "L'altra persona dice che non è riuscita a fare il check-in. Decidiamo entro 48 ore e ti scriviamo qui.");
  assert.equal(TESTI_BUCA.nota, "Lo legge una persona, non un algoritmo.");
  for (const k of ["domanda", "manda", "annulla", "inviata", "inRevisione", "accolta", "respinta"]) assert.equal(typeof TESTI_BUCA[k], "string");
});

test("testo: da 10 a 500 caratteri senza gli spazi ai lati", () => {
  assert.equal(testoValidoBuca("123456789"), false);
  assert.equal(testoValidoBuca("  1234567890  "), true);
  assert.equal(testoValidoBuca("a".repeat(501)), false);
  assert.equal(testoValidoBuca(undefined), false);
});

test("riga: nella finestra «Non riesco», dopo la buca «Ero lì», in attesa «In revisione», decisa → esito", () => {
  assert.deepEqual(rigaContestaBuca({ contestabile: true, stato: null }, "confermato"), { bottone: "non_riesco", esito: null });
  assert.deepEqual(rigaContestaBuca({ contestabile: true, stato: null }, "concluso"), { bottone: "ero_li", esito: null });
  assert.deepEqual(rigaContestaBuca({ contestabile: false, stato: "in_attesa" }, "concluso"), { bottone: "in_revisione", esito: null });
  assert.deepEqual(rigaContestaBuca({ contestabile: false, stato: "accolta" }, "concluso"), { bottone: null, esito: TESTI_BUCA.accolta });
  assert.deepEqual(rigaContestaBuca({ contestabile: false, stato: "respinta" }, "concluso"), { bottone: null, esito: TESTI_BUCA.respinta });
  assert.deepEqual(rigaContestaBuca({ contestabile: false, stato: null }, "concluso"), { bottone: null, esito: null });
  for (const x of [null, {}, { contestabile: "si" }, { contestabile: true, stato: "boh" }])
    assert.deepEqual(rigaContestaBuca(x, "concluso"), { bottone: null, esito: null });
  assert.deepEqual(rigaContestaBuca({ contestabile: true, stato: null }, "da_fissare"), { bottone: null, esito: null });
});

function rete(risposte) {
  const viste = [];
  const f = async (url, o = {}) => {
    viste.push({ url, metodo: o.method, auth: o.headers && o.headers.authorization, corpo: o.body ? JSON.parse(o.body) : null });
    const r = risposte.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  return { f, viste };
}

test("leggi: GET col token e la porta; solo { contestabile, stato }", async () => {
  const n = rete([Response.json({ ok: true, contestazione: { contestabile: true, stato: null, altro: "x" } })]);
  const c = creaContestaBuca({ token: () => "tok", fetch: n.f });
  assert.deepEqual(await c.leggi(PORTA), { ok: true, contestazione: { contestabile: true, stato: null } });
  assert.deepEqual(n.viste, [{ url: `/app/api/incontro?porta=${PORTA}&buca=1`, metodo: "GET", auth: "Bearer tok", corpo: null }]);
});

test("leggi: porta non valida → nessuna richiesta; 401 → accesso; rete giù → rete; forma strana → lettura", async () => {
  const n = rete([]);
  assert.deepEqual(await creaContestaBuca({ token: () => "t", fetch: n.f }).leggi("x"), { ok: false, motivo: "lettura" });
  assert.equal(n.viste.length, 0);
  const c = (r) => creaContestaBuca({ token: () => "t", fetch: rete([r]).f });
  assert.deepEqual(await c(new Response("{}", { status: 401 })).leggi(PORTA), { ok: false, motivo: "accesso" });
  assert.deepEqual(await c(new Error("giù")).leggi(PORTA), { ok: false, motivo: "rete" });
  assert.deepEqual(await c(Response.json({ ok: true, contestazione: { contestabile: 1 } })).leggi(PORTA), { ok: false, motivo: "lettura" });
  assert.deepEqual(await creaContestaBuca({ token: () => null, fetch: rete([]).f }).leggi(PORTA), { ok: false, motivo: "accesso" });
});

test("manda: POST contesta_buca con porta e testo; «inviata» → ok", async () => {
  const n = rete([Response.json({ ok: true, esito: "inviata" })]);
  const c = creaContestaBuca({ token: () => "tok", fetch: n.f });
  assert.deepEqual(await c.manda(PORTA, "Ero al bancone, la rete non andava."), { ok: true });
  assert.deepEqual(n.viste, [{ url: "/app/api/incontro", metodo: "POST", auth: "Bearer tok",
    corpo: { azione: "contesta_buca", porta: PORTA, testo: "Ero al bancone, la rete non andava." } }]);
});

test("manda: testo corto → errore senza richiesta; motivi del server → frasi; il resto → generico", async () => {
  const n = rete([]);
  assert.deepEqual(await creaContestaBuca({ token: () => "t", fetch: n.f }).manda(PORTA, "corto"),
    { ok: false, testo: TESTI_BUCA.errori.testo_non_valido });
  assert.equal(n.viste.length, 0);
  const c = (r) => creaContestaBuca({ token: () => "t", fetch: rete([r]).f });
  assert.deepEqual(await c(Response.json({ ok: false, motivo: "non_contestabile" })).manda(PORTA, "abbastanza lungo"),
    { ok: false, testo: TESTI_BUCA.errori.non_contestabile });
  assert.deepEqual(await c(Response.json({ ok: false, motivo: "gia_inviata" })).manda(PORTA, "abbastanza lungo"),
    { ok: false, testo: TESTI_BUCA.errori.gia_inviata });
  assert.deepEqual(await c(Response.json({ ok: false, motivo: "boh" })).manda(PORTA, "abbastanza lungo"),
    { ok: false, testo: TESTI_BUCA.errori.generico });
  assert.deepEqual(await c(new Error("giù")).manda(PORTA, "abbastanza lungo"), { ok: false, testo: TESTI_BUCA.errori.generico });
});
