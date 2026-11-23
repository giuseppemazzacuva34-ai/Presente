// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 3a della linea «sviluppatore-c»:
// il pannello del Filo lato server (api/filo.js). Il Filo vede le sue stanze con i soli nomi di battesimo e la riga
// delle regole da ricordare. Chi è Filo lo decide il database (fili_stanza). Supabase finto, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pannelloFilo, stanzeFiloDb, nomiFiloDb, REGOLE_FILO } from "../api/filo.js";

const FILO = "11111111-2222-4333-8444-555555555555";
const S1 = "aaaaaaaa-0000-4000-8000-000000000001";
const S2 = "aaaaaaaa-0000-4000-8000-000000000002";
const ORA = "2026-11-30T00:40:00.000Z";
const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ENV = { SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

test("la riga delle regole è quella della spec", () => {
  assert.equal(REGOLE_FILO, "Le regole: solo voce, 15 minuti · niente numeri né social prima della porta · rispetto, sempre · chi dà buca paga.");
});

test("pannello: le stanze del Filo con i nomi di battesimo, nient'altro", async () => {
  const chiesti = [];
  const r = await pannelloFilo({ filo: FILO, ora: ORA }, {
    stanze: async (q) => { chiesti.push(["stanze", q]); return [
      { id: S1, nome: null, apre_il: "2026-11-30T08:00:00+00:00", chiude_il: "2026-12-06T20:00:00+00:00", email: "x@example.invalid" },
      { id: S2, nome: "La stanza di prova", apre_il: "2026-11-30T08:00:00+00:00", chiude_il: "2026-12-06T20:00:00+00:00" },
    ]; },
    nomi: async (q) => { chiesti.push(["nomi", q]); return q.stanza === S1 ? [{ nome: "Anna" }, { nome: "Bruno", telefono: "1" }] : []; },
  });
  assert.deepEqual(r, {
    ok: true,
    regole: REGOLE_FILO,
    stanze: [
      { id: S1, nome: null, apreIl: "2026-11-30T08:00:00+00:00", chiudeIl: "2026-12-06T20:00:00+00:00", nomi: ["Anna", "Bruno"] },
      { id: S2, nome: "La stanza di prova", apreIl: "2026-11-30T08:00:00+00:00", chiudeIl: "2026-12-06T20:00:00+00:00", nomi: [] },
    ],
  });
  assert.deepEqual(chiesti[0], ["stanze", { filo: FILO, ora: ORA }]);
  assert.deepEqual(chiesti[1], ["nomi", { filo: FILO, stanza: S1, ora: ORA }]);
});

test("pannello: chi non segue stanze vede un pannello vuoto", async () => {
  const r = await pannelloFilo({ filo: FILO, ora: ORA }, { stanze: async () => [], nomi: async () => assert.fail("non serve") });
  assert.deepEqual(r, { ok: true, regole: REGOLE_FILO, stanze: [] });
});

test("pannello: dati sbagliati o database che non risponde", async () => {
  assert.deepEqual(await pannelloFilo({ filo: "x", ora: ORA }, {}), { ok: false, motivo: "dati" });
  assert.deepEqual(await pannelloFilo({ filo: FILO, ora: "ieri" }, {}), { ok: false, motivo: "dati" });
  assert.deepEqual(await pannelloFilo({ filo: FILO, ora: ORA }, { stanze: async () => null }), { ok: false, motivo: "riprova" });
  assert.deepEqual(await pannelloFilo({ filo: FILO, ora: ORA }, {
    stanze: async () => [{ id: S1, apre_il: ORA, chiude_il: ORA }], nomi: async () => null,
  }), { ok: false, motivo: "riprova" });
  // Stanza chiusa tra le due letture: il database dice «non_filo» → la stanza non si mostra.
  assert.deepEqual(await pannelloFilo({ filo: FILO, ora: ORA }, {
    stanze: async () => [{ id: S1, apre_il: ORA, chiude_il: ORA }], nomi: async () => "non_filo",
  }), { ok: true, regole: REGOLE_FILO, stanze: [] });
});

function supabaseFinto(risposte) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    viste.push({ percorso: u.pathname, corpo: JSON.parse(opzioni.body), chiave: opzioni.headers.apikey });
    const v = risposte[u.pathname.replace("/rest/v1/rpc/", "")];
    return v && v.stato ? Response.json(v.corpo, { status: v.stato }) : Response.json(v);
  };
  return { f, viste };
}

test("database: le due funzioni del ruolo «filo» con la chiave del server", async () => {
  const { f, viste } = supabaseFinto({
    stanze_del_filo: [{ id: S1 }],
    nomi_stanza_filo: { stato: 403, corpo: { code: "42501", message: "non_filo" } },
  });
  assert.deepEqual(await stanzeFiloDb(ENV, { filo: FILO, ora: ORA }, f), [{ id: S1 }]);
  assert.equal(await nomiFiloDb(ENV, { filo: FILO, stanza: S1, ora: ORA }, f), "non_filo");
  assert.deepEqual(viste, [
    { percorso: "/rest/v1/rpc/stanze_del_filo", corpo: { p_filo: FILO, p_ora: ORA }, chiave: "chiave-server-finta" },
    { percorso: "/rest/v1/rpc/nomi_stanza_filo", corpo: { p_filo: FILO, p_stanza: S1, p_ora: ORA }, chiave: "chiave-server-finta" },
  ]);
  assert.equal(await stanzeFiloDb({}, { filo: FILO, ora: ORA }, f), null, "senza configurazione niente chiamate");
  assert.equal(await stanzeFiloDb(ENV, { filo: "x", ora: ORA }, f), null);
});
