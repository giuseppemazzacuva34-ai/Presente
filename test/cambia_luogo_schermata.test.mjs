// «Cambia luogo» dentro «Il vostro incontro» (issue #6, spec v1 «Casi limite»; D51 A), linea «sviluppatore-b».
// La schermata mostra il foglio di moduli/cambia_luogo.js solo se chi la apre lo passa (opzione «cambio»), solo
// con l'incontro confermato e non mentre c'è un'altra domanda aperta; il nome dell'altra persona arriva al testo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vistaIncontro } from "../landing/app/moduli/incontro.js";
import { TESTI_CAMBIO, creaFoglioCambio } from "../landing/app/moduli/cambia_luogo.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ADESSO = new Date("2026-11-28T15:00:00Z");
const confermato = { stato: "confermato", scadenza: "2026-11-29T20:00:00Z", orario: "2026-11-28T19:30:00Z", luogo: "Bar Centrale",
  locale: null, locali: [], azioni: ["cambia_luogo", "disdici"], esito: null, checkin_mio: false, checkin_altro: false,
  checkin_da: "2026-11-28T19:00:00Z", checkin_fino: "2026-11-28T20:00:00Z", cambio_luogo: null };
const ricevuto = { ...confermato, azioni: ["rispondi_cambio", "disdici"],
  cambio_luogo: { mio: false, locale: null, luogo: "Pizzeria Tre, Via Po 3", scade: "2026-11-28T18:30:00Z" } };

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];
const inc = (i, extra = {}) => ({ modello: () => ({ porta: PORTA, incontro: i, proposta: false, conferma: null, bozza: {}, nome: "Sara", ...extra }),
  adesso: () => ADESSO, disdici: () => {}, nonAnnullare: () => {} });
const client = { proponi: async () => ({ ok: true, esito: "proposto" }), rispondi: async () => ({ ok: true, esito: "cambiato" }) };

test("senza il foglio la schermata non ha «Cambia luogo»", () => {
  assert.equal(bottone(vistaIncontro(h, inc(confermato)), TESTI_CAMBIO.bottone), undefined);
});

test("con il foglio: «Cambia luogo» nell'incontro confermato; la richiesta ricevuta col nome e i due pulsanti", () => {
  const fc = creaFoglioCambio({ client });
  assert.ok(bottone(vistaIncontro(h, inc(confermato), { cambio: fc }), TESTI_CAMBIO.bottone));
  const v = vistaIncontro(h, inc(ricevuto), { cambio: creaFoglioCambio({ client }) });
  assert.ok(testo(v).includes("Sara propone di vedervi a Pizzeria Tre, Via Po 3"));
  assert.ok(bottone(v, TESTI_CAMBIO.accetto) && bottone(v, TESTI_CAMBIO.rifiuto));
});

test("con un'altra domanda aperta (es. «Disdici») il foglio non c'è", () => {
  const v = vistaIncontro(h, inc(confermato, { conferma: "disdici" }), { cambio: creaFoglioCambio({ client }) });
  assert.equal(bottone(v, TESTI_CAMBIO.bottone), undefined);
});

test("collegato nell'app: avvio.js crea il foglio, flusso.js lo passa, sw.js lo tiene in memoria con una versione nuova", () => {
  const avvio = readFileSync(new URL("../landing/app/avvio.js", import.meta.url), "utf8");
  assert.match(avvio, /import \{ creaClientCambio, creaFoglioCambio \} from "\/app\/moduli\/cambia_luogo\.js";/);
  assert.match(avvio, /incontro\.cambio = creaFoglioCambio\(\{ client: creaClientCambio\(/);
  assert.match(avvio, /ricarica: \(\) => incontro\.riprova\(\)/);
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.match(flusso, /cambio: incontroVostro\.cambio \|\| null/);
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /"\/app\/moduli\/cambia_luogo\.js"/);
  assert.ok(!sw.includes('"presente-app-84"'), "versione della cache aumentata");
});
