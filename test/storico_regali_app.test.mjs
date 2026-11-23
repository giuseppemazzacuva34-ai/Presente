// «I tuoi regali» nell'app (schermata 28 del design v4, issue #349). Linea «sviluppatore-b», passo 3.
// Lettura di GET /app/api/regali/storico e vista come nel prototipo (#storico-regali). Rete finta, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaStoricoRegali, vistaStoricoRegali, TESTI_STORICO } from "../landing/app/moduli/storico_regali.js";

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (typeof n === "string" ? n : n.f.map(testo).join(""));
const tutti = (n, pred, out = []) => { if (typeof n === "object") { if (pred(n)) out.push(n); n.f.forEach((x) => tutti(x, pred, out)); } return out; };
const classe = (n, c) => tutti(n, (x) => String(x.a.classe || "").split(" ").includes(c));

const VISTA = {
  titolo: "Hai ricevuto 17 regali.",
  totale: { rosa: 12, spumante: 4, fiori: 1 },
  attuale: { citta: "Milano", persone: [
    { nome: "Marco, 35", dettaglio: "3 rose · 1 spumante", quando: "oggi" },
    { nome: "Dario, 34", dettaglio: "2 rose", quando: "ieri" },
  ] },
  passate: { stanze: 2, persone: "7 persone", dettaglio: "7 rose · 3 spumante · 1 fiori" },
};

function rete(r) {
  const chiamate = [];
  const f = async (url, init = {}) => {
    chiamate.push({ url, ...init });
    if (r.errore) throw new Error("rete");
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  return { f, chiamate };
}

test("leggi: GET con il token, la vista arriva com'è dal Worker", async () => {
  const { f, chiamate } = rete({ status: 200, body: { ok: true, ...VISTA } });
  const r = await creaStoricoRegali({ token: () => "tok", fetch: f }).leggi();
  assert.deepEqual(r, { ok: true, vista: VISTA });
  assert.equal(chiamate[0].url, "/app/api/regali/storico");
  assert.equal(chiamate[0].method, "GET");
  assert.equal(chiamate[0].headers.authorization, "Bearer tok");
});

test("leggi: senza token, 401, errore, rete giù o dati strani → ok false, mai numeri inventati", async () => {
  assert.deepEqual(await creaStoricoRegali({ token: () => null, fetch: rete({ status: 200, body: {} }).f }).leggi(), { ok: false, motivo: "accesso" });
  const c = (r) => creaStoricoRegali({ token: () => "tok", fetch: rete(r).f }).leggi();
  assert.deepEqual(await c({ status: 401, body: {} }), { ok: false, motivo: "accesso" });
  assert.deepEqual(await c({ status: 503, body: { ok: false } }), { ok: false, motivo: "lettura" });
  assert.deepEqual(await c({ errore: true }), { ok: false, motivo: "rete" });
  assert.deepEqual(await c({ status: 200, body: { ok: true, titolo: "x", totale: { rosa: "1" } } }), { ok: false, motivo: "lettura" });
});

test("vista: come nel prototipo — etichetta, titolo con il numero in corsivo, tre conteggi con icona", () => {
  const v = vistaStoricoRegali(h, VISTA, { torna: () => {} });
  assert.equal(testo(classe(v, "passo")[0]), TESTI_STORICO.etichetta);
  const h2 = tutti(v, (x) => x.tag === "h2")[0];
  assert.equal(testo(h2), "Hai ricevuto17 regali.");
  assert.equal(testo(tutti(h2, (x) => x.tag === "em")[0]), "17 regali.");
  const c = classe(v, "conteggi")[0].f;
  assert.deepEqual(c.map((d) => testo(d)), ["12Rose", "4Spumante", "1Fiori"]);
  assert.deepEqual(c.map((d) => classe(d, "regalo-icona")[0].a.classe), ["regalo-icona regalo-rosa", "regalo-icona regalo-spumante", "regalo-icona regalo-fiori"]);
  assert.ok(c.every((d) => classe(d, "regalo-icona")[0].a["aria-hidden"] === "true"));
});

test("vista: «Questa stanza · Milano», le persone con dettaglio e quando, poi «Stanze passate · 2»", () => {
  const v = vistaStoricoRegali(h, VISTA, { torna: () => {} });
  assert.deepEqual(classe(v, "lista-t").map(testo), ["Questa stanzaMilano", "Stanze passate2"]);
  assert.deepEqual(classe(v, "persona").map(testo), ["Marco, 353 rose · 1 spumanteoggi", "Dario, 342 roseieri", "7 persone7 rose · 3 spumante · 1 fiori"]);
});

test("vista: senza stanza aperta o senza stanze passate le parti non compaiono; nessun regalo → solo il titolo", () => {
  const v = vistaStoricoRegali(h, { ...VISTA, attuale: null, passate: null }, { torna: () => {} });
  assert.equal(classe(v, "lista-t").length, 0);
  const vuota = vistaStoricoRegali(h, { titolo: "Non hai ancora ricevuto regali.", totale: { rosa: 0, spumante: 0, fiori: 0 }, attuale: null, passate: null }, { torna: () => {} });
  assert.equal(testo(tutti(vuota, (x) => x.tag === "h2")[0]), "Non hai ancora ricevuto regali.");
  assert.equal(classe(vuota, "conteggi").length, 0);
});

test("vista: in basso un solo pulsante «Torna al profilo» a tutta larghezza", () => {
  let tornato = false;
  const v = vistaStoricoRegali(h, VISTA, { torna: () => { tornato = true; } });
  const b = tutti(v, (x) => x.tag === "button");
  assert.equal(b.length, 1);
  assert.equal(testo(b[0]), "Torna al profilo");
  b[0].a.onclick();
  assert.ok(tornato);
});

test("niente salvataggi locali e niente log", () => {
  const codice = readFileSync(new URL("../landing/app/moduli/storico_regali.js", import.meta.url), "utf8");
  assert.ok(!/localStorage|sessionStorage|indexedDB|console\./.test(codice));
});
