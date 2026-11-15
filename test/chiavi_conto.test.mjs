// Conto alla rovescia che scorre (issue #5 spec v1.1, passi 6, 7 e 8). Linea «sviluppatore-c», passo 10.
// Dalle 20:00 di Roma «Le porte si aprono tra N minuti» cambia da solo ogni minuto, sul posto (senza ridisegnare la
// pagina); alle 20:59 si rilegge lo stato (chiavi chiuse dal server); alle 21:00 si legge la sera.
// Orologio e timer finti: nessuna attesa vera, nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaChiaviStanza } from "../landing/app/moduli/chiavi_stanza.js";

const CHIUDE = "2026-11-15T20:00:00Z"; // domenica 21:00 di Roma
const t = (iso) => new Date(iso);

function banco(inizio) {
  let ora = t(inizio);
  const timer = [];
  const conti = [];
  let ridisegni = 0;
  const chiamate = [];
  const chiavi = {
    async leggi() { chiamate.push("leggi"); return { ok: true, stato: { stanza: true, chiude_il: CHIUDE, chiuse: false, restanti: 2, date: [] } }; },
    async sera() { chiamate.push("sera"); return { ok: true, stato: "attesa" }; },
  };
  const c = creaChiaviStanza({ chiavi, adesso: () => ora, dopo: (fn, ms) => timer.push({ fn, ms }),
    aggiorna: () => { ridisegni += 1; }, conto: (testo) => conti.push(testo) });
  return {
    c, timer, conti, chiamate,
    ridisegni: () => ridisegni,
    // Fa passare il tempo del primo timer del conto e lo esegue.
    async scatta() {
      const i = timer.findIndex((x) => x.ms !== 20000);
      const [x] = timer.splice(i, 1);
      ora = new Date(ora.getTime() + x.ms);
      await x.fn();
    },
    timerConto: () => timer.filter((x) => x.ms !== 20000),
  };
}

test("alle 20:00:30 il prossimo cambio è tra 30 secondi e il testo cambia sul posto", async () => {
  const b = banco("2026-11-15T19:00:30Z");
  await b.c.carica();
  assert.equal(b.c.modello().conto, "Le porte si aprono tra 59 minuti");
  assert.equal(b.timerConto().length, 1);
  assert.ok(b.timerConto()[0].ms >= 30000 && b.timerConto()[0].ms <= 31000);
  const prima = b.ridisegni();
  await b.scatta();
  assert.deepEqual(b.conti, ["Le porte si aprono tra 58 minuti"]);
  assert.equal(b.ridisegni(), prima, "nessun ridisegno: il fuoco non salta");
  assert.equal(b.timerConto().length, 1, "e si riprogramma");
});

test("prima delle 20:00 si aspetta (al massimo 10 minuti alla volta) e all'arrivo il conto compare con un ridisegno", async () => {
  const b = banco("2026-11-15T18:55:00Z");
  await b.c.carica();
  assert.equal(b.c.modello().conto, null);
  assert.ok(b.timerConto()[0].ms <= 600000);
  const r = b.ridisegni();
  let giri = 0;
  while (b.c.modello().conto === null && giri < 5) { await b.scatta(); giri += 1; }
  assert.ok(giri <= 2, "arriva alle 20:00 in pochi giri");
  assert.ok(b.ridisegni() > r, "il conto compare con un ridisegno (prima non c'era l'elemento)");
  assert.equal(b.c.modello().conto, "Le porte si aprono tra 59 minuti");
});

test("alle 20:59 si rilegge lo stato (chiavi chiuse dal server), alle 21:00 si legge la sera", async () => {
  const b = banco("2026-11-15T19:58:30Z");
  await b.c.carica();
  assert.deepEqual(b.chiamate, ["leggi"]);
  await b.scatta(); // 19:59:00 → «chiuse»
  assert.equal(b.chiamate.filter((x) => x === "leggi").length, 2);
  await b.scatta(); // 20:00:00 → porte
  assert.ok(b.chiamate.includes("sera"));
  assert.equal(b.c.modello().conto, null);
});

test("un solo timer del conto anche se lo stato si rilegge più volte", async () => {
  const b = banco("2026-11-15T19:30:10Z");
  await b.c.carica();
  await b.c.carica();
  await b.c.carica();
  assert.equal(b.timerConto().length, 1);
});

test("avvio: il conto si aggiorna sul posto nell'elemento #chiavi-conto", () => {
  const avvio = readFileSync(new URL("../landing/app/avvio.js", import.meta.url), "utf8");
  assert.match(avvio, /conto: \(testo\) =>/);
  assert.match(avvio, /getElementById\("chiavi-conto"\)/);
});
