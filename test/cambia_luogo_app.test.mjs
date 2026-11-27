// «Cambia luogo» nell'app (issue #6, spec v1 «Casi limite»: «Locale chiuso o cambiato all'ultimo»; D51 A), linea
// «sviluppatore-b». Il modulo legge dallo stato dell'incontro le azioni «cambia_luogo» / «rispondi_cambio» e
// «cambio_luogo» { mio, locale, luogo, scade }, manda POST { azione: "cambia_luogo", porta, locale | luogo } e
// POST { azione: "rispondi_cambio", porta, risposta } col token e poi fa rileggere lo stato. Rete finta, h finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_CAMBIO, rigaCambio, creaClientCambio, creaFoglioCambio, vistaFoglioCambio } from "../landing/app/moduli/cambia_luogo.js";

const PORTA = "11111111-2222-4333-8444-555555555555";
const LOCALE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ALTRO_LOCALE = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const SCADE = "2026-11-28T18:30:00Z";
const locali = [{ id: LOCALE, nome: "Caffè Uno", indirizzo: "Via Roma 1", da_verificare: false },
  { id: ALTRO_LOCALE, nome: "Bar Due", indirizzo: "Corso Po 2", da_verificare: true }];
const base = { stato: "confermato", orario: "2026-11-28T19:30:00Z", luogo: null, locale: LOCALE, locali, esito: null,
  azioni: ["cambia_luogo", "disdici"], cambio_luogo: null };

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];

function rete(risposte) {
  const viste = [];
  const f = async (url, o = {}) => {
    viste.push({ url, metodo: o.method, auth: o.headers && o.headers.authorization, corpo: o.body ? JSON.parse(o.body) : null });
    const r = risposte.shift();
    if (r instanceof Error) throw r;
    return { status: r.status || 200, ok: (r.status || 200) < 400, json: async () => r.corpo };
  };
  return { f, viste };
}

test("testo della spec: il pulsante si chiama «Cambia luogo»; gli altri testi ci sono", () => {
  assert.equal(TESTI_CAMBIO.bottone, "Cambia luogo");
  for (const k of ["domanda", "nota", "manda", "lascia", "mio", "altro", "accetto", "rifiuto", "proposto", "cambiato", "rifiutato"])
    assert.equal(typeof TESTI_CAMBIO[k], "string", k);
});

test("riga: con l'azione dal server si può cambiare; senza, o se non è confermato, niente", () => {
  assert.deepEqual(rigaCambio(base), { cambia: true, rispondi: false, richiesta: null });
  assert.deepEqual(rigaCambio({ ...base, azioni: ["disdici"] }), { cambia: false, rispondi: false, richiesta: null });
  assert.deepEqual(rigaCambio({ ...base, stato: "proposto" }), { cambia: false, rispondi: false, richiesta: null });
  for (const x of [null, undefined, "x", {}]) assert.deepEqual(rigaCambio(x), { cambia: false, rispondi: false, richiesta: null });
});

test("riga: la mia richiesta dice il posto e che aspettiamo; quella dell'altra persona col nome e i pulsanti", () => {
  const mia = rigaCambio({ ...base, azioni: ["disdici"], cambio_luogo: { mio: true, locale: null, luogo: "Pizzeria Tre, Via Po 3", scade: SCADE } });
  assert.equal(mia.cambia, false);
  assert.equal(mia.rispondi, false);
  assert.ok(mia.richiesta.includes("Pizzeria Tre, Via Po 3"));
  assert.ok(mia.richiesta.startsWith(TESTI_CAMBIO.mio.split("<")[0]));
  const sua = rigaCambio({ ...base, azioni: ["rispondi_cambio"], cambio_luogo: { mio: false, locale: ALTRO_LOCALE, luogo: null, scade: SCADE } }, "Sara");
  assert.equal(sua.rispondi, true);
  assert.ok(sua.richiesta.includes("Sara") && sua.richiesta.includes("Bar Due · Corso Po 2"));
  const senzaNome = rigaCambio({ ...base, azioni: ["rispondi_cambio"], cambio_luogo: { mio: false, locale: null, luogo: "Bar X", scade: SCADE } });
  assert.ok(senzaNome.richiesta.includes("L'altra persona"));
  // Forme strane: nessuna richiesta, nessun pulsante per rispondere.
  for (const c of [{ mio: "no" }, { mio: false, locale: null, luogo: null, scade: SCADE }, { mio: false, luogo: "X", locale: null, scade: "ieri" }])
    assert.deepEqual(rigaCambio({ ...base, azioni: ["rispondi_cambio"], cambio_luogo: c }), { cambia: false, rispondi: false, richiesta: null });
});

test("client: propone un locale dell'elenco o un posto scritto, col token; poi l'esito", async () => {
  const { f, viste } = rete([{ corpo: { ok: true, esito: "proposto" } }, { corpo: { ok: true, esito: "proposto" } }]);
  const c = creaClientCambio({ token: () => "tok", fetch: f });
  assert.deepEqual(await c.proponi(PORTA, { locale: ALTRO_LOCALE }), { ok: true, esito: "proposto" });
  assert.deepEqual(await c.proponi(PORTA, { luogo: "  Bar X, Via Po 4 " }), { ok: true, esito: "proposto" });
  assert.deepEqual(viste.map((v) => v.corpo), [{ azione: "cambia_luogo", porta: PORTA, locale: ALTRO_LOCALE },
    { azione: "cambia_luogo", porta: PORTA, luogo: "Bar X, Via Po 4" }]);
  assert.ok(viste.every((v) => v.url === "/app/api/incontro" && v.metodo === "POST" && v.auth === "Bearer tok"));
});

test("client: posto vuoto o troppo lungo, porta strana → errore senza rete", async () => {
  const { f, viste } = rete([]);
  const c = creaClientCambio({ token: () => "tok", fetch: f });
  assert.equal((await c.proponi(PORTA, { luogo: "  " })).ok, false);
  assert.equal((await c.proponi(PORTA, { luogo: "a".repeat(81) })).testo, TESTI_CAMBIO.errori.luogo_non_valido);
  assert.equal((await c.proponi("porta", { locale: LOCALE })).ok, false);
  assert.equal((await c.rispondi(PORTA, "forse")).ok, false);
  assert.equal(viste.length, 0);
});

test("client: risponde «accetto» o «rifiuto»; i rifiuti del server diventano frasi, il resto «generico»", async () => {
  const { f, viste } = rete([{ corpo: { ok: true, esito: "cambiato" } }, { corpo: { ok: false, motivo: "troppo_tardi" } },
    { corpo: { ok: false, motivo: "stesso_luogo" } }, { corpo: { ok: false, motivo: "boh" } }, new Error("rete")]);
  const c = creaClientCambio({ token: () => "tok", fetch: f });
  assert.deepEqual(await c.rispondi(PORTA, "accetto"), { ok: true, esito: "cambiato" });
  assert.deepEqual(viste[0].corpo, { azione: "rispondi_cambio", porta: PORTA, risposta: "accetto" });
  assert.deepEqual(await c.rispondi(PORTA, "rifiuto"), { ok: false, testo: TESTI_CAMBIO.errori.troppo_tardi });
  assert.deepEqual(await c.proponi(PORTA, { locale: LOCALE }), { ok: false, testo: TESTI_CAMBIO.errori.stesso_luogo });
  assert.deepEqual(await c.proponi(PORTA, { locale: LOCALE }), { ok: false, testo: TESTI_CAMBIO.errori.generico });
  assert.deepEqual(await c.rispondi(PORTA, "accetto"), { ok: false, testo: TESTI_CAMBIO.errori.generico });
});

function finto(esiti = []) {
  const viste = { proponi: [], rispondi: [] };
  return { viste, proponi: async (p, d) => { viste.proponi.push([p, d]); return esiti.shift() || { ok: true, esito: "proposto" }; },
    rispondi: async (p, r) => { viste.rispondi.push([p, r]); return esiti.shift() || { ok: true, esito: "cambiato" }; } };
}

test("vista: «Cambia luogo» apre il foglio con i locali (meno quello attuale) e «Un altro luogo pubblico»", () => {
  const fc = creaFoglioCambio({ client: finto() });
  let v = vistaFoglioCambio(h, fc, PORTA, base);
  assert.ok(bottone(v, TESTI_CAMBIO.bottone));
  bottone(v, TESTI_CAMBIO.bottone).a.onclick();
  v = vistaFoglioCambio(h, fc, PORTA, base);
  assert.equal(bottone(v, TESTI_CAMBIO.bottone), undefined, "col foglio aperto il pulsante non c'è");
  const menu = tutti(v, (x) => x.tag === "select")[0];
  const etichetta = tutti(v, (x) => x.tag === "label" && x.a.for === menu.a.id)[0];
  assert.ok(etichetta, "il menu ha un'etichetta vera");
  const voci = tutti(menu, (x) => x.tag === "option").map(testo);
  assert.deepEqual(voci, ["Bar Due · Corso Po 2 · da verificare", TESTI_CAMBIO.altroLuogo]);
  const nota = tutti(v, (x) => x.a.id === menu.a["aria-describedby"])[0];
  assert.equal(testo(nota), TESTI_CAMBIO.nota);
  assert.ok(bottone(v, TESTI_CAMBIO.manda) && bottone(v, TESTI_CAMBIO.lascia));
  bottone(v, TESTI_CAMBIO.lascia).a.onclick();
  assert.ok(bottone(vistaFoglioCambio(h, fc, PORTA, base), TESTI_CAMBIO.bottone));
});

test("vista: senza locali c'è solo il posto scritto, con etichetta; non confermato o senza azione → niente", () => {
  const fc = creaFoglioCambio({ client: finto() });
  const solo = { ...base, locale: null, luogo: "Bar Centrale", locali: [] };
  fc.apri(solo);
  const v = vistaFoglioCambio(h, fc, PORTA, solo);
  assert.equal(tutti(v, (x) => x.tag === "select").length, 0);
  const campo = tutti(v, (x) => x.tag === "input")[0];
  assert.equal(campo.a.maxlength, "80");
  assert.ok(tutti(v, (x) => x.tag === "label" && x.a.for === campo.a.id).length === 1);
  assert.equal(vistaFoglioCambio(h, creaFoglioCambio({ client: finto() }), PORTA, { ...base, azioni: [] }), null);
  assert.equal(vistaFoglioCambio(h, creaFoglioCambio({ client: finto() }), PORTA, { ...base, stato: "concluso" }), null);
});

test("foglio: manda il locale scelto, chiude, dice «proposto» e fa rileggere lo stato; errore resta nel foglio", async () => {
  const c = finto([{ ok: false, testo: TESTI_CAMBIO.errori.attendi_risposta }, { ok: true, esito: "proposto" }]);
  let riletto = 0;
  const fc = creaFoglioCambio({ client: c, ricarica: () => { riletto += 1; } });
  fc.apri(base);
  assert.equal(fc.modello().bozza.locale, ALTRO_LOCALE, "parte dal primo locale diverso da quello attuale");
  await fc.manda(PORTA);
  assert.match(testo(vistaFoglioCambio(h, fc, PORTA, base)), new RegExp(TESTI_CAMBIO.errori.attendi_risposta));
  assert.equal(riletto, 0);
  await fc.manda(PORTA);
  assert.deepEqual(c.viste.proponi[1], [PORTA, { locale: ALTRO_LOCALE }]);
  assert.equal(riletto, 1);
  assert.equal(fc.modello().aperto, false);
  assert.ok(testo(vistaFoglioCambio(h, fc, PORTA, { ...base, azioni: [] , cambio_luogo: { mio: true, locale: ALTRO_LOCALE, luogo: null, scade: SCADE } }))
    .includes(TESTI_CAMBIO.proposto));
});

test("foglio: «Un altro luogo pubblico» manda il testo scritto; vuoto → errore senza invio", async () => {
  const c = finto();
  const fc = creaFoglioCambio({ client: c });
  fc.apri(base);
  fc.imposta("locale", "");
  fc.imposta("luogo", " ");
  await fc.manda(PORTA);
  assert.equal(c.viste.proponi.length, 0);
  assert.equal(fc.modello().errore, TESTI_CAMBIO.errori.luogo_non_valido);
  fc.imposta("luogo", "Trattoria Quattro, Via Po 4");
  await fc.manda(PORTA);
  assert.deepEqual(c.viste.proponi[0], [PORTA, { luogo: "Trattoria Quattro, Via Po 4" }]);
});

test("foglio: l'altra persona risponde «accetto» o «rifiuto», poi si rilegge; due tocchi insieme → un invio", async () => {
  const c = finto([{ ok: true, esito: "cambiato" }, { ok: true, esito: "rifiutato" }]);
  let riletto = 0;
  const fc = creaFoglioCambio({ client: c, ricarica: () => { riletto += 1; } });
  const sua = { ...base, azioni: ["rispondi_cambio"], cambio_luogo: { mio: false, locale: null, luogo: "Bar X, Via Po 5", scade: SCADE } };
  const v = vistaFoglioCambio(h, fc, PORTA, sua, "Sara");
  assert.ok(testo(v).includes("Sara"));
  const [a, b] = [fc.rispondi(PORTA, "accetto"), fc.rispondi(PORTA, "accetto")];
  assert.deepEqual(await Promise.all([a, b]), [true, false]);
  assert.equal(riletto, 1);
  assert.ok(testo(vistaFoglioCambio(h, fc, PORTA, { ...base, azioni: [] })).includes(TESTI_CAMBIO.cambiato));
  await fc.rispondi(PORTA, "rifiuto");
  assert.deepEqual(c.viste.rispondi.map((x) => x[1]), ["accetto", "rifiuto"]);
  assert.ok(testo(vistaFoglioCambio(h, fc, PORTA, { ...base, azioni: [] })).includes(TESTI_CAMBIO.rifiutato));
  assert.ok(bottone(vistaFoglioCambio(h, creaFoglioCambio({ client: finto() }), PORTA, sua), TESTI_CAMBIO.accetto));
  assert.ok(bottone(vistaFoglioCambio(h, creaFoglioCambio({ client: finto() }), PORTA, sua), TESTI_CAMBIO.rifiuto));
});

test("foglio: cambiando porta si azzera tutto", async () => {
  const fc = creaFoglioCambio({ client: finto() });
  fc.apri(base);
  await fc.manda(PORTA);
  vistaFoglioCambio(h, fc, "22222222-2222-4333-8444-555555555555", base);
  assert.equal(testo(vistaFoglioCambio(h, fc, "22222222-2222-4333-8444-555555555555", base)).includes(TESTI_CAMBIO.proposto), false);
});
