// Il «battito» della stanza viva (issue #380, spec v1 del CPO del 23/11, punto 1), passo 5d della linea CTO: con l'app
// aperta e VISIBILE il telefono manda un segnale ogni 30 secondi e rilegge stati e appuntamenti. In secondo piano non
// parte nessuna richiesta; tornando visibile si riparte subito. Se la rete cade: «Connessione persa. Riprovo…».
// Timer e pagina finti, nessuna rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaBattito, TESTI_FISSA } from "../landing/app/moduli/appuntamenti_stanza.js";

function orologio() {
  const timer = [];
  return {
    setTimeout: (fn, ms) => { timer.push({ fn, ms, vivo: true }); return timer.length - 1; },
    clearTimeout: (i) => { if (timer[i]) timer[i].vivo = false; },
    vivi: () => timer.filter((t) => t.vivo),
    async scatta() { const t = timer.filter((x) => x.vivo).at(-1); t.vivo = false; await t.fn(); },
  };
}
function paginaFinta(stato = "visible") {
  const ascolto = [];
  return {
    get visibilityState() { return stato; },
    set(s) { stato = s; ascolto.forEach((f) => f()); },
    addEventListener: (tipo, f) => { if (tipo === "visibilitychange") ascolto.push(f); },
    removeEventListener: (tipo, f) => { const i = ascolto.indexOf(f); if (i >= 0) ascolto.splice(i, 1); },
  };
}
function vivaFinta({ rete = true } = {}) {
  const chiamate = [];
  const r = (x) => (rete ? x : { ok: false, motivo: "rete", testo: TESTI_FISSA.rete });
  return {
    chiamate,
    segnale: async () => { chiamate.push("segnale"); return r({ ok: true, inStanza: true }); },
    stati: async () => { chiamate.push("stati"); return r({ ok: true, persone: [{ id: "x", stato: "online", testo: "online", con: null, gruppo: "donne" }] }); },
    appuntamenti: async () => { chiamate.push("appuntamenti"); return r({ ok: true, appuntamenti: [] }); },
  };
}

test("avvio: segnale, stati e appuntamenti subito, poi ogni 30 secondi", async () => {
  const o = orologio(), p = paginaFinta(), v = vivaFinta();
  const visti = [];
  const b = creaBattito({ viva: v, pagina: p, quando: (x) => visti.push(x), setTimeout: o.setTimeout, clearTimeout: o.clearTimeout });
  await b.avvia();
  assert.deepEqual(v.chiamate, ["segnale", "stati", "appuntamenti"]);
  assert.equal(visti.at(-1).persa, false);
  assert.equal(visti.at(-1).persone.length, 1);
  assert.deepEqual(visti.at(-1).appuntamenti, []);
  assert.equal(o.vivi().length, 1);
  assert.equal(o.vivi()[0].ms, 30000);
  await o.scatta();
  assert.equal(v.chiamate.length, 6);
});

test("in secondo piano nessuna richiesta; tornando visibile si riparte subito", async () => {
  const o = orologio(), p = paginaFinta("hidden"), v = vivaFinta();
  const b = creaBattito({ viva: v, pagina: p, quando: () => {}, setTimeout: o.setTimeout, clearTimeout: o.clearTimeout });
  await b.avvia();
  assert.equal(v.chiamate.length, 0);
  p.set("visible");
  await new Promise((r) => setImmediate(r));
  assert.equal(v.chiamate[0], "segnale");
  await new Promise((r) => setImmediate(r));
  p.set("hidden");
  assert.equal(o.vivi().length, 0, "nascosta: nessun timer");
});

test("rete giù: «persa», si riprova al giro dopo; stati e appuntamenti di prima restano", async () => {
  const o = orologio(), p = paginaFinta();
  let rete = true;
  const v = vivaFinta();
  const vera = { ...v, segnale: async () => (rete ? v.segnale() : { ok: false, motivo: "rete" }) };
  const visti = [];
  const b = creaBattito({ viva: vera, pagina: p, quando: (x) => visti.push(x), setTimeout: o.setTimeout, clearTimeout: o.clearTimeout });
  await b.avvia();
  rete = false;
  await o.scatta();
  assert.equal(visti.at(-1).persa, true);
  assert.equal(visti.at(-1).persone.length, 1, "si tengono gli stati di prima (diventano grigi nella vista)");
  assert.equal(o.vivi().length, 1);
  rete = true;
  await o.scatta();
  assert.equal(visti.at(-1).persa, false);
});

test("accesso scaduto o funzione spenta: si ferma", async () => {
  const o = orologio(), p = paginaFinta();
  const v = { segnale: async () => ({ ok: false, motivo: "spento" }), stati: async () => ({}), appuntamenti: async () => ({}) };
  const b = creaBattito({ viva: v, pagina: p, quando: () => {}, setTimeout: o.setTimeout, clearTimeout: o.clearTimeout });
  await b.avvia();
  assert.equal(o.vivi().length, 0);
});

test("ferma(): nessun timer e la pagina non si ascolta più", async () => {
  const o = orologio(), p = paginaFinta(), v = vivaFinta();
  const b = creaBattito({ viva: v, pagina: p, quando: () => {}, setTimeout: o.setTimeout, clearTimeout: o.clearTimeout });
  await b.avvia();
  b.ferma();
  assert.equal(o.vivi().length, 0);
  p.set("visible");
  await new Promise((r) => setImmediate(r));
  assert.equal(v.chiamate.length, 3);
});

test("subito(): rilegge adesso (dopo una proposta o una risposta)", async () => {
  const o = orologio(), p = paginaFinta(), v = vivaFinta();
  const b = creaBattito({ viva: v, pagina: p, quando: () => {}, setTimeout: o.setTimeout, clearTimeout: o.clearTimeout });
  await b.avvia();
  await b.subito();
  assert.equal(v.chiamate.length, 6);
  assert.equal(o.vivi().length, 1);
});

test("la web app usa battito e schermata 20; il modulo è nella copia offline (sw.js)", async () => {
  const { readFileSync } = await import("node:fs");
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /"\/app\/moduli\/appuntamenti_stanza\.js"/);
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.match(flusso, /creaBattito\(\{ viva: stanzaViva, pagina: document/);
  assert.match(flusso, /role: "group", "aria-labelledby": "fissa-giorno"/);
  assert.match(flusso, /maxlength: String\(TESTI_FISSA\.massimo\)/);
  assert.doesNotMatch(flusso, /localStorage\.setItem\([^)]*appuntament/);
});
