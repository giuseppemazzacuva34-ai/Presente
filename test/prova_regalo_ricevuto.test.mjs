// Prova (/app/prova.html): la schermata 27 «Regalo ricevuto» si vede anche nella prova (D149, parità grafica, linea
// «sviluppatore-b»). Ogni persona finta ha una rosa da far vedere: compare durante la chiamata con lei, poi è vista.
// Le risposte passano dai moduli veri dell'app. Nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaApiProva, moduliProva } from "../landing/app/moduli/prova_api.js";
import { PERSONE_PROVA } from "../landing/app/moduli/prova.js";
import { creaRegali } from "../landing/app/moduli/regali.js";
import { creaRegaloRicevuto } from "../landing/app/moduli/regalo_ricevuto.js";
import { avvisoRegalo } from "../api/coin.js";

const token = () => "prova";

test("prova 27: ogni persona finta ha una rosa da vedere, col testo del server vero", async () => {
  const r = await creaRegali({ token, fetch: creaApiProva().fetch }).avvisi();
  assert.equal(r.ok, true);
  assert.equal(r.avvisi.length, PERSONE_PROVA.length);
  for (const a of r.avvisi) {
    const x = PERSONE_PROVA.find((p) => p.id === a.da);
    assert.ok(x);
    assert.equal(a.regalo, "rosa");
    assert.equal(a.testo, avvisoRegalo("rosa", x.nome));
  }
});

test("prova 27: un regalo segnato visto non torna", async () => {
  const regali = creaRegali({ token, fetch: creaApiProva().fetch });
  const prima = (await regali.avvisi()).avvisi;
  assert.deepEqual(await regali.visti([prima[0].id]), { ok: true });
  const dopo = (await regali.avvisi()).avvisi;
  assert.equal(dopo.length, prima.length - 1);
  assert.equal(dopo.some((a) => a.id === prima[0].id), false);
});

test("prova 27: durante la chiamata con una persona finta compare la sua rosa (modulo vero)", async () => {
  const mostrati = [];
  const timer = [];
  const orologio = { setTimeout: (fn) => { timer.push(fn); return timer.length; }, clearTimeout: () => {} };
  const rr = creaRegaloRicevuto({ regali: creaRegali({ token, fetch: creaApiProva().fetch }), mostra: (a) => mostrati.push(a), orologio });
  rr.avvia(() => PERSONE_PROVA[2].id);
  for (let i = 0; i < 5 && mostrati.length === 0; i++) { await new Promise((r) => setTimeout(r, 0)); if (timer.length) timer.shift()(); }
  assert.equal(mostrati.length, 1);
  assert.equal(mostrati[0].da, PERSONE_PROVA[2].id);
  rr.ferma?.();
});

test("moduliProva: con la pagina c'è anche il regalo ricevuto (schermata 27)", () => {
  const nodo = { ownerDocument: null, querySelector: () => null, append() {}, appendChild() {} };
  const m = moduliProva({ contenitore: nodo });
  assert.ok(m.regaloRicevuto && typeof m.regaloRicevuto.avvia === "function");
});
