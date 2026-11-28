// «Aggiungi al calendario» dentro «Il vostro incontro» (issue #6, spec v1 passo 4), linea «sviluppatore-b».
// Il pulsante c'è solo con l'incontro confermato, l'ora futura e chi apre la schermata passa «calendario»; il file
// ha il luogo dell'incontro e mai il nome dell'altra persona.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vistaIncontro } from "../landing/app/moduli/incontro.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ADESSO = new Date("2026-11-28T10:00:00Z");
const confermato = { stato: "confermato", scadenza: "2026-12-05T20:00:00Z", orario: "2026-12-03T19:30:00Z", luogo: "Bar Centrale",
  locale: null, locali: [], azioni: ["disdici"], esito: null, checkin_mio: false, checkin_altro: false,
  checkin_da: "2026-12-03T19:00:00Z", checkin_fino: "2026-12-03T20:00:00Z", cambio_luogo: null };

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];
const inc = (i, extra = {}) => ({ modello: () => ({ porta: PORTA, incontro: i, proposta: false, conferma: null, bozza: {}, nome: "Sara", ...extra }),
  adesso: () => ADESSO, disdici: () => {}, nonAnnullare: () => {} });

test("senza «calendario» il pulsante non c'è; con «calendario» sì e il clic passa il file .ics", () => {
  assert.equal(bottone(vistaIncontro(h, inc(confermato)), "Aggiungi al calendario"), undefined);
  const file = [];
  const b = bottone(vistaIncontro(h, inc(confermato), { calendario: (t) => file.push(t) }), "Aggiungi al calendario");
  assert.ok(b);
  b.a.onclick();
  assert.equal(file.length, 1);
  assert.ok(file[0].includes("LOCATION:Bar Centrale"));
  assert.ok(file[0].includes("DTSTART:20261203T193000Z"));
  assert.ok(!file[0].includes("Sara"));
});

test("con un locale consigliato il luogo è nome e indirizzo", () => {
  const i = { ...confermato, luogo: null, locale: "11111111-2222-4333-8444-555555555555",
    locale_scelto: { nome: "Caffè Nero", indirizzo: "Via Po 3, Milano" } };
  const file = [];
  bottone(vistaIncontro(h, inc(i), { calendario: (t) => file.push(t) }), "Aggiungi al calendario").a.onclick();
  assert.ok(file[0].replace(/\r\n /g, "").includes("LOCATION:Caffè Nero · Via Po 3\\, Milano"));
});

test("niente pulsante se l'incontro non è confermato, ha un esito, l'ora è passata o c'è un'altra domanda aperta", () => {
  const cal = { calendario: () => {} };
  assert.equal(bottone(vistaIncontro(h, inc({ ...confermato, stato: "proposto" }), cal), "Aggiungi al calendario"), undefined);
  assert.equal(bottone(vistaIncontro(h, inc({ ...confermato, esito: "buca" }), cal), "Aggiungi al calendario"), undefined);
  assert.equal(bottone(vistaIncontro(h, inc({ ...confermato, orario: "2026-11-28T09:00:00Z" }), cal), "Aggiungi al calendario"), undefined);
  assert.equal(bottone(vistaIncontro(h, inc(confermato, { conferma: "disdici" }), cal), "Aggiungi al calendario"), undefined);
});

test("collegato nell'app: avvio.js passa lo scaricamento, flusso.js lo dà alla schermata, sw.js tiene il modulo con una versione nuova", () => {
  const avvio = readFileSync(new URL("../landing/app/avvio.js", import.meta.url), "utf8");
  assert.match(avvio, /import \{ scaricaIcs \} from "\/app\/moduli\/calendario_incontro\.js";/);
  assert.match(avvio, /incontro\.calendario = \(testo\) => scaricaIcs\(testo\)/);
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.match(flusso, /calendario: incontroVostro\.calendario \|\| null/);
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /"\/app\/moduli\/calendario_incontro\.js"/);
  assert.ok(!sw.includes('"presente-app-88"'), "versione della cache aumentata");
});
