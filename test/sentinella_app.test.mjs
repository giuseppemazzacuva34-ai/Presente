// Chiamate (issue #4, passo 3c-3b-1): la «sentinella» rilegge GET /app/api/chiamata per sapere di uno squillo in
// arrivo senza notifiche push. Solo con l'app aperta e visibile: ogni 10 s a riposo, ogni secondo durante squillo e
// chiamata, così si resta dentro le 100.000 richieste al giorno del piano gratuito dei Workers.
// Orologio e pagina finti: nessuna rete, nessun timer vero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaSentinella, prossimaAttesa, A_RIPOSO_MS, IN_CHIAMATA_MS, DOPO_TROPPE_MS } from "../landing/app/moduli/sentinella.js";

function ambiente({ visibile = true } = {}) {
  const timer = [];
  let id = 0;
  const ascoltatori = new Map();
  const pagina = {
    visibilityState: visibile ? "visible" : "hidden",
    addEventListener(nome, f) { ascoltatori.set(nome, f); },
    removeEventListener(nome, f) { if (ascoltatori.get(nome) === f) ascoltatori.delete(nome); },
    cambia(stato) { this.visibilityState = stato; ascoltatori.get("visibilitychange")?.(); },
  };
  return {
    pagina,
    ascoltatori,
    timer,
    setTimeout(f, ms) { const t = { id: ++id, f, ms, attivo: true }; timer.push(t); return t.id; },
    clearTimeout(x) { const t = timer.find((y) => y.id === x); if (t) t.attivo = false; },
    attivi() { return timer.filter((t) => t.attivo); },
    async scatta() { const t = this.attivi().at(-1); t.attivo = false; t.f(); await new Promise((r) => setImmediate(r)); },
  };
}
const pausa = () => new Promise((r) => setImmediate(r));

test("attese: 10 s a riposo, 1 s durante squillo e chiamata, 60 s dopo troppi tentativi", () => {
  assert.equal(A_RIPOSO_MS, 10000);
  assert.equal(IN_CHIAMATA_MS, 1000);
  assert.equal(DOPO_TROPPE_MS, 60000);
  assert.equal(prossimaAttesa({ ok: true, vista: null }), A_RIPOSO_MS);
  assert.equal(prossimaAttesa({ ok: true, vista: { fase: "squilla" } }), IN_CHIAMATA_MS);
  assert.equal(prossimaAttesa({ ok: true, vista: { fase: "in_corso" } }), IN_CHIAMATA_MS);
  assert.equal(prossimaAttesa({ ok: true, vista: { fase: "finita" } }), A_RIPOSO_MS);
  assert.equal(prossimaAttesa({ ok: false, motivo: "troppe" }), DOPO_TROPPE_MS);
  assert.equal(prossimaAttesa({ ok: false, motivo: "rete" }), A_RIPOSO_MS);
  assert.equal(prossimaAttesa({ ok: false, motivo: "riprova" }), A_RIPOSO_MS);
});

test("chiamate spente o accesso scaduto: la sentinella si ferma (nessuna richiesta a vuoto)", () => {
  assert.equal(prossimaAttesa({ ok: false, motivo: "spento" }), null);
  assert.equal(prossimaAttesa({ ok: false, motivo: "accesso" }), null);
  assert.equal(prossimaAttesa(null), A_RIPOSO_MS);
});

test("con l'app visibile legge subito, passa la risposta e riprogramma a 10 s", async () => {
  const a = ambiente();
  const visti = [];
  let letture = 0;
  const s = creaSentinella({ leggi: async () => { letture++; return { ok: true, vista: null }; }, quando: (r) => visti.push(r), pagina: a.pagina, setTimeout: a.setTimeout, clearTimeout: a.clearTimeout });
  s.avvia();
  await pausa();
  assert.equal(letture, 1);
  assert.deepEqual(visti, [{ ok: true, vista: null }]);
  assert.equal(a.attivi().length, 1);
  assert.equal(a.attivi()[0].ms, A_RIPOSO_MS);
  await a.scatta();
  assert.equal(letture, 2);
});

test("durante lo squillo rilegge ogni secondo", async () => {
  const a = ambiente();
  const s = creaSentinella({ leggi: async () => ({ ok: true, vista: { fase: "squilla", io: "riceve" } }), quando() {}, pagina: a.pagina, setTimeout: a.setTimeout, clearTimeout: a.clearTimeout });
  s.avvia();
  await pausa();
  assert.equal(a.attivi()[0].ms, IN_CHIAMATA_MS);
});

test("app nascosta: nessuna lettura; torna visibile: legge subito", async () => {
  const a = ambiente({ visibile: false });
  let letture = 0;
  const s = creaSentinella({ leggi: async () => { letture++; return { ok: true, vista: null }; }, quando() {}, pagina: a.pagina, setTimeout: a.setTimeout, clearTimeout: a.clearTimeout });
  s.avvia();
  await pausa();
  assert.equal(letture, 0);
  assert.equal(a.attivi().length, 0);
  a.pagina.cambia("visible");
  await pausa();
  assert.equal(letture, 1);
  assert.equal(a.attivi().length, 1);
});

test("l'app va in secondo piano: il timer si cancella", async () => {
  const a = ambiente();
  const s = creaSentinella({ leggi: async () => ({ ok: true, vista: null }), quando() {}, pagina: a.pagina, setTimeout: a.setTimeout, clearTimeout: a.clearTimeout });
  s.avvia();
  await pausa();
  a.pagina.cambia("hidden");
  assert.equal(a.attivi().length, 0);
});

test("mai due letture insieme: subito() durante una lettura non ne apre un'altra", async () => {
  const a = ambiente();
  let letture = 0;
  let sblocca;
  const s = creaSentinella({ leggi: () => { letture++; return new Promise((r) => { sblocca = r; }); }, quando() {}, pagina: a.pagina, setTimeout: a.setTimeout, clearTimeout: a.clearTimeout });
  s.avvia();
  s.subito();
  s.subito();
  assert.equal(letture, 1);
  sblocca({ ok: true, vista: null });
  await pausa();
  assert.equal(a.attivi().length, 1);
});

test("subito() a riposo legge ora e sostituisce il timer (dopo un'azione dell'utente)", async () => {
  const a = ambiente();
  let letture = 0;
  const s = creaSentinella({ leggi: async () => { letture++; return { ok: true, vista: null }; }, quando() {}, pagina: a.pagina, setTimeout: a.setTimeout, clearTimeout: a.clearTimeout });
  s.avvia();
  await pausa();
  s.subito();
  await pausa();
  assert.equal(letture, 2);
  assert.equal(a.attivi().length, 1);
});

test("chiamate spente: dopo la risposta nessun altro timer", async () => {
  const a = ambiente();
  const s = creaSentinella({ leggi: async () => ({ ok: false, motivo: "spento" }), quando() {}, pagina: a.pagina, setTimeout: a.setTimeout, clearTimeout: a.clearTimeout });
  s.avvia();
  await pausa();
  assert.equal(a.attivi().length, 0);
});

test("errore della lettura o di quando(): la sentinella resta viva", async () => {
  const a = ambiente();
  const s = creaSentinella({ leggi: async () => { throw new Error("x"); }, quando() { throw new Error("y"); }, pagina: a.pagina, setTimeout: a.setTimeout, clearTimeout: a.clearTimeout });
  s.avvia();
  await pausa();
  assert.equal(a.attivi().length, 1);
  assert.equal(a.attivi()[0].ms, A_RIPOSO_MS);
});

test("ferma(): niente timer, niente ascoltatori, le risposte in volo sono ignorate", async () => {
  const a = ambiente();
  const visti = [];
  let sblocca;
  const s = creaSentinella({ leggi: () => new Promise((r) => { sblocca = r; }), quando: (r) => visti.push(r), pagina: a.pagina, setTimeout: a.setTimeout, clearTimeout: a.clearTimeout });
  s.avvia();
  s.ferma();
  sblocca({ ok: true, vista: null });
  await pausa();
  assert.deepEqual(visti, []);
  assert.equal(a.attivi().length, 0);
  assert.equal(a.ascoltatori.size, 0);
  a.pagina.cambia("visible");
  await pausa();
  assert.deepEqual(visti, []);
});

test("il modulo non salva nulla in locale e non usa notifiche o lavori in background", () => {
  const sorgente = readFileSync(new URL("../landing/app/moduli/sentinella.js", import.meta.url), "utf8");
  for (const vietato of ["localStorage", "sessionStorage", "indexedDB", "Notification", "setInterval", "sendBeacon"]) {
    assert.ok(!sorgente.includes(vietato), vietato);
  }
});

test("il service worker tiene sentinella.js e compagni.js e la versione cambia", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"/app/moduli/sentinella.js"'));
  assert.ok(sw.includes('"/app/moduli/compagni.js"'));
  assert.ok(!sw.includes('"presente-app-13"'));
});
