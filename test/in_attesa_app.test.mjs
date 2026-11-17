// Segnalazione e blocco senza connessione (issue #7, spec v1.1, «Casi limite» › Offline: «il blocco e la segnalazione
// si inviano al rientro della connessione»). Passo 15b della linea «sviluppatore-b». Rete e finestra finte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { conAttesa } from "../landing/app/moduli/in_attesa.js";
import { testoErroreSegnala } from "../landing/app/moduli/segnala.js";

function finestraFinta() {
  const ascolti = new Map();
  return {
    addEventListener(nome, fn) { ascolti.set(nome, [...(ascolti.get(nome) || []), fn]); },
    removeEventListener(nome, fn) { ascolti.set(nome, (ascolti.get(nome) || []).filter((x) => x !== fn)); },
    async scatta(nome) { for (const fn of ascolti.get(nome) || []) await fn(); },
    quanti: (nome) => (ascolti.get(nome) || []).length,
  };
}
function servizioFinto(risposte) {
  const chiamate = [];
  return {
    chiamate,
    async invia(corpo) { chiamate.push(corpo); return risposte.shift() || { ok: true, ore: 24, pericolo: false }; },
    altro: () => "invariato",
  };
}

test("con la rete: passa la risposta così com'è e non resta niente in attesa", async () => {
  const fin = finestraFinta();
  const s = servizioFinto([{ ok: true, ore: 1, pericolo: true }]);
  const a = conAttesa(s, "invia", { finestra: fin, inAttesa: { ok: false, motivo: "in_attesa" } });
  assert.deepEqual(await a.invia({ x: 1 }), { ok: true, ore: 1, pericolo: true });
  assert.equal(a.inAttesa(), 0);
  assert.equal(fin.quanti("online"), 0);
  assert.equal(a.altro(), "invariato", "gli altri metodi restano come sono");
});

test("senza rete: resta in attesa e parte da sola al rientro della connessione", async () => {
  const fin = finestraFinta();
  const s = servizioFinto([{ ok: false, motivo: "rete" }, { ok: true, ore: 24, pericolo: false }]);
  const a = conAttesa(s, "invia", { finestra: fin, inAttesa: { ok: false, motivo: "in_attesa" } });
  assert.deepEqual(await a.invia({ x: 1 }), { ok: false, motivo: "in_attesa" });
  assert.equal(a.inAttesa(), 1);
  await fin.scatta("online");
  assert.equal(s.chiamate.length, 2);
  assert.deepEqual(s.chiamate[1], { x: 1 });
  assert.equal(a.inAttesa(), 0);
  assert.equal(fin.quanti("online"), 0, "finita la coda, smette di ascoltare");
});

test("se al rientro manca ancora la rete resta in attesa per il rientro dopo", async () => {
  const fin = finestraFinta();
  const s = servizioFinto([{ ok: false, motivo: "rete" }, { ok: false, motivo: "rete" }, { ok: true, ore: 72, pericolo: false }]);
  const a = conAttesa(s, "invia", { finestra: fin, inAttesa: { ok: false, motivo: "in_attesa" } });
  await a.invia({ x: 1 });
  await fin.scatta("online");
  assert.equal(a.inAttesa(), 1);
  await fin.scatta("online");
  assert.equal(a.inAttesa(), 0);
  assert.equal(s.chiamate.length, 3);
});

test("lo stesso invio ripetuto senza rete resta uno solo", async () => {
  const fin = finestraFinta();
  const s = servizioFinto([{ ok: false, motivo: "rete" }, { ok: false, motivo: "rete" }]);
  const a = conAttesa(s, "invia", { finestra: fin, inAttesa: { ok: false, motivo: "in_attesa" } });
  await a.invia({ x: 1, testo: "a" });
  await a.invia({ x: 1, testo: "a" });
  assert.equal(a.inAttesa(), 1);
  assert.equal(fin.quanti("online"), 1);
});

test("un altro errore (accesso, troppi tentativi) non resta in attesa: si mostra subito", async () => {
  const fin = finestraFinta();
  const s = servizioFinto([{ ok: false, motivo: "accesso" }]);
  const a = conAttesa(s, "invia", { finestra: fin, inAttesa: { ok: false, motivo: "in_attesa" } });
  assert.deepEqual(await a.invia({ x: 1 }), { ok: false, motivo: "accesso" });
  assert.equal(a.inAttesa(), 0);
});

test("al massimo 20 invii in attesa (solo nella memoria della pagina, mai salvati sul telefono)", async () => {
  const fin = finestraFinta();
  const s = { async invia() { return { ok: false, motivo: "rete" }; } };
  const a = conAttesa(s, "invia", { finestra: fin, inAttesa: { ok: false, motivo: "in_attesa" } });
  for (let i = 0; i < 25; i++) await a.invia({ i });
  assert.equal(a.inAttesa(), 20);
});

test("un errore lanciato conta come rete mancante", async () => {
  const fin = finestraFinta();
  const s = { async invia() { throw new Error("giù"); } };
  const a = conAttesa(s, "invia", { finestra: fin, inAttesa: { ok: true, inAttesa: true } });
  assert.deepEqual(await a.invia("persona"), { ok: true, inAttesa: true });
  assert.equal(a.inAttesa(), 1);
});

test("testo per chi segnala senza connessione", () => {
  assert.equal(testoErroreSegnala("in_attesa"), "Sei senza connessione: la segnalazione partirà da sola appena torni online.");
});

import { readFileSync } from "node:fs";
const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("avvio: segnalazione e blocco passano da conAttesa, il blocco in attesa nasconde subito la persona", () => {
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /import \{ conAttesa \} from "\/app\/moduli\/in_attesa\.js";/);
  assert.match(avvio, /conAttesa\(creaSegnala\(/);
  assert.match(avvio, /conAttesa\(creaBlocca\([\s\S]*?"blocca", \{ finestra: window, inAttesa: \{ ok: true, inAttesa: true \} \}\)/);
});

test("service worker: in_attesa.js in memoria e versione nuova", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.ok(sw.includes('"/app/moduli/in_attesa.js"'));
  assert.ok(!sw.includes('"presente-app-31"'));
});
