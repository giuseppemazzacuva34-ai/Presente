// «Avvisa <nome> che sei qui» dentro «Il vostro incontro» (issue #6, spec v1 del CPO del 3/11, punto 6), linea
// «sviluppatore-b». La schermata mostra il foglio di moduli/avvisa_qui.js solo se chi la apre lo passa (opzione
// «avviso»), con l'incontro confermato e non mentre c'è un'altra domanda aperta; chi aspetta legge il nome
// dell'altra persona: «<nome> non ha ancora fatto il check-in.» (spec).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vistaIncontro, schermataIncontro } from "../landing/app/moduli/incontro.js";
import { creaFoglioAvviso } from "../landing/app/moduli/avvisa_qui.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ADESSO = new Date("2026-11-28T19:50:00Z");
const atteso = { stato: "confermato", scadenza: "2026-11-29T20:00:00Z", orario: "2026-11-28T19:30:00Z", luogo: "Bar Centrale",
  locale: null, locali: [], azioni: ["avvisa_qui"], esito: null, checkin_mio: true, checkin_altro: false,
  checkin_da: "2026-11-28T19:00:00Z", checkin_fino: "2026-11-28T20:00:00Z", cambio_luogo: null,
  avviso_qui_da: "2026-11-28T19:45:00Z", avvisato_mio: false, avvisato_altro: false };

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];
const inc = (i, extra = {}) => ({ modello: () => ({ porta: PORTA, incontro: i, proposta: false, conferma: null, bozza: {}, nome: "Sara", ...extra }),
  adesso: () => ADESSO, disdici: () => {}, nonAnnullare: () => {} });
const client = { avvisa: async () => ({ ok: true, esito: "avvisato" }) };

test("chi aspetta legge il nome: «Sara non ha ancora fatto il check-in.»; senza nome «L'altra persona»", () => {
  assert.equal(schermataIncontro(atteso, ADESSO, "Sara").checkin, "Sara non ha ancora fatto il check-in.");
  assert.equal(schermataIncontro(atteso, ADESSO).checkin, "L'altra persona non ha ancora fatto il check-in.");
});

test("senza il foglio la schermata non ha «Avvisa»; con il foglio sì, col nome", () => {
  assert.equal(bottone(vistaIncontro(h, inc(atteso)), "Avvisa Sara che sei qui"), undefined);
  assert.ok(bottone(vistaIncontro(h, inc(atteso), { avviso: creaFoglioAvviso({ client }) }), "Avvisa Sara che sei qui"));
});

test("con un'altra domanda aperta il foglio non c'è", () => {
  const v = vistaIncontro(h, inc(atteso, { conferma: "ritardo" }), { avviso: creaFoglioAvviso({ client }) });
  assert.equal(bottone(v, "Avvisa Sara che sei qui"), undefined);
});

test("collegato nell'app: avvio.js crea il foglio, flusso.js lo passa, sw.js lo tiene in memoria con una versione nuova", () => {
  const avvio = readFileSync(new URL("../landing/app/avvio.js", import.meta.url), "utf8");
  assert.match(avvio, /import \{ creaClientAvviso, creaFoglioAvviso \} from "\/app\/moduli\/avvisa_qui\.js";/);
  assert.match(avvio, /incontro\.avviso = creaFoglioAvviso\(\{ client: creaClientAvviso\(/);
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.match(flusso, /avviso: incontroVostro\.avviso \|\| null/);
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /"\/app\/moduli\/avvisa_qui\.js"/);
  assert.ok(!sw.includes('"presente-app-87"'), "versione della cache aumentata");
});
