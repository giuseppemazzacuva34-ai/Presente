// Prova (/app/prova.html?crediti=15): la schermata 21 «crediti quasi finiti» si vede anche nella prova (D149, parità
// grafica, linea «sviluppatore-b»). Il saldo finto si sceglie dall'indirizzo; senza parametro resta quello di sempre e
// l'avviso non parte. Le risposte passano dai moduli veri dell'app. Nessun dato reale, nessun salvataggio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaApiProva, creditiDaIndirizzo, SALDO_PROVA } from "../landing/app/moduli/prova_api.js";
import { creaCoinServer, creaSaldo, collegaSaldo } from "../landing/app/moduli/saldo_coin.js";

const token = () => "prova";

test("prova 21: senza parametro il saldo è quello di sempre e la prima stanza non è usata", async () => {
  const r = await creaCoinServer({ token, fetch: creaApiProva().fetch }).saldo();
  assert.deepEqual(r, { ok: true, saldo: SALDO_PROVA, primaStanzaUsata: false, pagamenti: false });
});

test("prova 21: con crediti scelti il server finto dà quel saldo e la prima stanza già usata", async () => {
  const r = await creaCoinServer({ token, fetch: creaApiProva({ crediti: 15 }).fetch }).saldo();
  assert.deepEqual(r, { ok: true, saldo: 15, primaStanzaUsata: true, pagamenti: false });
});

test("prova 21: ?crediti= accetta solo numeri interi da 0 a 79", () => {
  assert.equal(creditiDaIndirizzo("?crediti=15"), 15);
  assert.equal(creditiDaIndirizzo("?crediti=0"), 0);
  assert.equal(creditiDaIndirizzo("?crediti=79"), 79);
  for (const s of ["", "?crediti=80", "?crediti=-1", "?crediti=abc", "?crediti=1.5", "?crediti=", "?altro=3", null, undefined]) {
    assert.equal(creditiDaIndirizzo(s), null, String(s));
  }
});

test("prova 21: con 15 crediti il modulo vero apre l'avviso una volta, con 15", async () => {
  const pagina = { visibilityState: "visible", addEventListener() {} };
  const visti = [];
  const saldo = creaSaldo({ coin: creaCoinServer({ token, fetch: creaApiProva({ crediti: 15 }).fetch }), testata: () => {} });
  await collegaSaldo({ saldo, pagina, avviso: (n) => visti.push(n), momento: () => "home" });
  assert.deepEqual(visti, [15]);
});
