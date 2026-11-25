// «Contesta» un «No» nell'app (issue #6, spec v1.3 del CPO del 22/11, punto 2), passo 3 della linea «sviluppatore-b».
// Il modulo legge GET /app/api/incontro?contestazioni=1 e manda POST { azione: "contesta", domanda, testo } col token;
// dà i testi esatti della spec e, per ogni domanda, se mostrare «Contesta», «In revisione» o l'esito.
// Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_CONTESTA, testoValido, rigaContesta, creaContesta } from "../landing/app/moduli/contesta_no.js";

test("testi esatti della spec v1.3", () => {
  assert.equal(TESTI_CONTESTA.bottone, "Contesta");
  assert.equal(TESTI_CONTESTA.inRevisione, "In revisione");
  assert.equal(TESTI_CONTESTA.domanda, "Cosa non torna?");
  assert.equal(TESTI_CONTESTA.nota, "Lo legge una persona, non un algoritmo.");
  assert.equal(TESTI_CONTESTA.manda, "Manda");
  assert.equal(TESTI_CONTESTA.annulla, "Annulla");
  assert.equal(TESTI_CONTESTA.inviata, "Contestazione inviata. Ti scriviamo qui quando è decisa.");
  assert.equal(TESTI_CONTESTA.accolta, "Abbiamo accolto la tua contestazione: quel no non conta più.");
  assert.equal(TESTI_CONTESTA.respinta, "Abbiamo letto la tua contestazione: il no resta.");
});

test("testo: da 10 a 500 caratteri senza gli spazi ai lati (anche emoji contate una volta)", () => {
  assert.equal(testoValido("123456789"), false);
  assert.equal(testoValido("   123456789   "), false);
  assert.equal(testoValido("1234567890"), true);
  assert.equal(testoValido("a".repeat(500)), true);
  assert.equal(testoValido("a".repeat(501)), false);
  assert.equal(testoValido("😀".repeat(500)), true);
  assert.equal(testoValido(null), false);
});

test("riga: contestabile → «Contesta»; in attesa → «In revisione»; decisa → esito; niente → nulla", () => {
  assert.deepEqual(rigaContesta({ foto_sue: { contestabile: true, stato: null } }, "foto_sue"), { bottone: "contesta", esito: null });
  assert.deepEqual(rigaContesta({ foto_sue: { contestabile: false, stato: "in_attesa" } }, "foto_sue"), { bottone: "in_revisione", esito: null });
  assert.deepEqual(rigaContesta({ foto_sue: { contestabile: false, stato: "respinta" } }, "foto_sue"),
    { bottone: null, esito: TESTI_CONTESTA.respinta });
  assert.deepEqual(rigaContesta({ presentato: { contestabile: false, stato: "accolta" } }, "presentato"),
    { bottone: null, esito: TESTI_CONTESTA.accolta });
  // Un «No» nuovo dopo una contestazione decisa si può contestare di nuovo (è un altro «No»).
  assert.deepEqual(rigaContesta({ presentato: { contestabile: true, stato: "respinta" } }, "presentato"),
    { bottone: "contesta", esito: TESTI_CONTESTA.respinta });
  for (const x of [null, {}, { foto_sue: "boh" }]) assert.deepEqual(rigaContesta(x, "foto_sue"), { bottone: null, esito: null });
});

function rete(risposte) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    viste.push({ url, metodo: opzioni.method, auth: opzioni.headers && opzioni.headers.authorization,
      corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    const r = risposte.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  return { f, viste };
}

test("leggi: GET col token, solo le contestazioni", async () => {
  const n = rete([Response.json({ ok: true, contestazioni: { foto_sue: { contestabile: true, stato: null } } })]);
  const c = creaContesta({ token: () => "tok", fetch: n.f });
  assert.deepEqual(await c.leggi(), { ok: true, contestazioni: { foto_sue: { contestabile: true, stato: null } } });
  assert.deepEqual(n.viste, [{ url: "/app/api/incontro?contestazioni=1", metodo: "GET", auth: "Bearer tok", corpo: null }]);
});

test("manda: POST con domanda e testo, mai altri dati", async () => {
  const n = rete([Response.json({ ok: true, esito: "inviata" })]);
  const c = creaContesta({ token: () => "tok", fetch: n.f });
  assert.deepEqual(await c.manda("presentato", "Ero lì alle 19 in punto."), { ok: true });
  assert.deepEqual(n.viste[0].corpo, { azione: "contesta", domanda: "presentato", testo: "Ero lì alle 19 in punto." });
  assert.equal(n.viste[0].metodo, "POST");
});

test("manda: testo non valido non parte; rifiuti e guasti diventano frasi", async () => {
  const n = rete([]);
  const c = creaContesta({ token: () => "tok", fetch: n.f });
  assert.deepEqual(await c.manda("presentato", "corto"), { ok: false, testo: TESTI_CONTESTA.errori.testo_non_valido });
  assert.equal(n.viste.length, 0);
  const casi = [
    [Response.json({ ok: false, motivo: "nessun_no" }), TESTI_CONTESTA.errori.nessun_no],
    [Response.json({ ok: false, motivo: "riprova" }, { status: 503 }), TESTI_CONTESTA.errori.generico],
    [new Error("rete"), TESTI_CONTESTA.errori.generico],
  ];
  for (const [r, atteso] of casi) {
    const c2 = creaContesta({ token: () => "tok", fetch: rete([r]).f });
    assert.deepEqual(await c2.manda("foto_sue", "Le foto erano mie, tutte."), { ok: false, testo: atteso });
  }
});

test("senza token: niente rete", async () => {
  const n = rete([]);
  const c = creaContesta({ token: () => null, fetch: n.f });
  assert.equal((await c.leggi()).ok, false);
  assert.equal((await c.manda("foto_sue", "Le foto erano mie, tutte.")).ok, false);
  assert.equal(n.viste.length, 0);
});
