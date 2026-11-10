// Chiamate solo voce (issue #4, passo 3b-2b-1): il «centralino» di UNA stanza.
// Sa solo chi ha la linea occupata e da quale chiamata: serve per «una chiamata alla volta per persona»
// («È in un'altra chiamata») e perché chi riceve trovi la chiamata in arrivo. Finto archivio in memoria, orologio finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GestoreCentralino, DURATA_MASSIMA_LINEA, DOPO_CHIUSURA } from "../api/centralino.js";
import { CHIAMATA } from "../api/chiamate.js";
import { oraDiRoma } from "../api/stanze.js";

const T0 = oraDiRoma(2026, 11, 10, 20);
const CHIUDE = oraDiRoma(2026, 11, 15, 21);

function archivio() {
  const dati = new Map();
  let allarme = null;
  return {
    dati,
    get allarme() { return allarme; },
    async get(k) { return dati.has(k) ? structuredClone(dati.get(k)) : undefined; },
    async put(k, v) {
      if (typeof k === "object") for (const [a, b] of Object.entries(k)) dati.set(a, structuredClone(b));
      else dati.set(k, structuredClone(v));
    },
    async delete(k) {
      const chiavi = Array.isArray(k) ? k : [k];
      for (const c of chiavi) dati.delete(c);
    },
    async list({ prefix }) {
      return new Map([...dati.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)]));
    },
    async deleteAll() { dati.clear(); },
    async setAlarm(t) { allarme = typeof t === "number" ? t : t.getTime(); },
    async deleteAlarm() { allarme = null; },
  };
}

function prepara() {
  const storage = archivio();
  let ora = T0.getTime();
  const g = new GestoreCentralino({ storage, adesso: () => new Date(ora) });
  return { g, storage, vai: (secondi) => { ora = T0.getTime() + secondi * 1000; } };
}

const OCCUPA = { chi: "a", con: "b", chiamata: "c1", chiusuraStanza: CHIUDE.getTime() };

test("la linea dura al massimo squillo + 15 minuti + rientro + un minuto di margine", () => {
  assert.equal(DURATA_MASSIMA_LINEA, (CHIAMATA.squillo + CHIAMATA.durataMassima + CHIAMATA.riconnessione + 60) * 1000);
});

test("occupa: le linee libere si occupano tutte e due, con il ruolo di ciascuno", async () => {
  const { g } = prepara();
  assert.deepEqual(await g.occupa(OCCUPA), { ok: true });
  assert.deepEqual(await g.linea("a"), { chiamata: "c1", ruolo: "chi", altra: "b" });
  assert.deepEqual(await g.linea("b"), { chiamata: "c1", ruolo: "con", altra: "a" });
  assert.equal(await g.linea("z"), null);
});

test("occupa: chi riceve è già in un'altra chiamata → «È in un'altra chiamata», nulla cambia", async () => {
  const { g } = prepara();
  await g.occupa(OCCUPA);
  const r = await g.occupa({ ...OCCUPA, chi: "c", con: "b", chiamata: "c2" });
  assert.deepEqual(r, { ok: false, motivo: "occupato", testo: "È in un'altra chiamata" });
  assert.equal(await g.linea("c"), null);
  assert.equal((await g.linea("b")).chiamata, "c1");
});

test("occupa: chi chiama ha già la linea occupata → gia_in_chiamata", async () => {
  const { g } = prepara();
  await g.occupa(OCCUPA);
  assert.deepEqual(await g.occupa({ ...OCCUPA, chi: "b", con: "c", chiamata: "c2" }), { ok: false, motivo: "gia_in_chiamata" });
  assert.deepEqual(await g.occupa({ ...OCCUPA, chi: "a", con: "c", chiamata: "c2" }), { ok: false, motivo: "gia_in_chiamata" });
  assert.equal(await g.linea("c"), null);
});

test("occupa: dati sbagliati (stessa persona, campi mancanti) → dati", async () => {
  const { g } = prepara();
  assert.deepEqual(await g.occupa({ ...OCCUPA, con: "a" }), { ok: false, motivo: "dati" });
  assert.deepEqual(await g.occupa({ ...OCCUPA, chiamata: "" }), { ok: false, motivo: "dati" });
  assert.deepEqual(await g.occupa({ ...OCCUPA, chiusuraStanza: "domani" }), { ok: false, motivo: "dati" });
});

test("occupa: a stanza chiusa non si occupa nulla", async () => {
  const { g, vai } = prepara();
  vai((CHIUDE.getTime() - T0.getTime()) / 1000);
  assert.deepEqual(await g.occupa(OCCUPA), { ok: false, motivo: "stanza_chiusa" });
});

test("libera: toglie solo le linee di quella chiamata", async () => {
  const { g } = prepara();
  await g.occupa(OCCUPA);
  await g.occupa({ ...OCCUPA, chi: "c", con: "d", chiamata: "c2" });
  assert.deepEqual(await g.libera({ chiamata: "c1" }), { ok: true });
  assert.equal(await g.linea("a"), null);
  assert.equal(await g.linea("b"), null);
  assert.equal((await g.linea("c")).chiamata, "c2");
  assert.deepEqual(await g.occupa({ ...OCCUPA, chiamata: "c3" }), { ok: true });
});

test("libera: una chiamata vecchia non libera la linea di quella nuova", async () => {
  const { g } = prepara();
  await g.occupa(OCCUPA);
  await g.libera({ chiamata: "c1" });
  await g.occupa({ ...OCCUPA, chiamata: "c2" });
  await g.libera({ chiamata: "c1" });
  assert.equal((await g.linea("a")).chiamata, "c2");
});

test("una linea dimenticata si libera da sola dopo la durata massima", async () => {
  const { g, vai } = prepara();
  await g.occupa(OCCUPA);
  vai(DURATA_MASSIMA_LINEA / 1000 - 1);
  assert.equal((await g.linea("a")).chiamata, "c1");
  vai(DURATA_MASSIMA_LINEA / 1000);
  assert.equal(await g.linea("a"), null);
  assert.deepEqual(await g.occupa({ ...OCCUPA, chi: "b", con: "a", chiamata: "c2" }), { ok: true });
});

test("allarme: dopo la chiusura della stanza il centralino cancella tutto", async () => {
  const { g, storage, vai } = prepara();
  await g.occupa(OCCUPA);
  assert.equal(storage.allarme, CHIUDE.getTime() + DOPO_CHIUSURA);
  vai((CHIUDE.getTime() + DOPO_CHIUSURA - T0.getTime()) / 1000);
  await g.allarme();
  assert.equal(storage.dati.size, 0);
  assert.equal(storage.allarme, null);
});

test("allarme in anticipo (per esempio dopo un riavvio) non cancella e si rimette", async () => {
  const { g, storage } = prepara();
  await g.occupa(OCCUPA);
  await g.allarme();
  assert.equal((await g.linea("a")).chiamata, "c1");
  assert.equal(storage.allarme, CHIUDE.getTime() + DOPO_CHIUSURA);
});

test("nel centralino ci sono solo id e tempi: niente sessioni Realtime, niente nomi", async () => {
  const { g, storage } = prepara();
  await g.occupa({ ...OCCUPA, sessione: "segreta", nome: "Anna" });
  const tutto = JSON.stringify([...storage.dati.values()]);
  assert.ok(!tutto.includes("segreta"));
  assert.ok(!tutto.includes("Anna"));
});
