// Invio di una segnalazione dal telefono (issue #7, passo 3, linea «sviluppatore-b»): regole del server.
// Database finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { segnala, MOTIVI_DAL_TELEFONO, ORIGINI_DAL_TELEFONO } from "../api/segnala.js";

const IO = "11111111-2222-4333-8444-555555555555";
const LEI = "66666666-7777-4888-9999-000000000000";
const ADESSO = new Date("2026-11-30T20:00:00Z");

function finto({ conosce = true, salva = "aaaaaaaa-0000-4000-8000-000000000000" } = {}) {
  const viste = [];
  return {
    viste,
    conosce: async (q) => { viste.push(["conosce", q]); return conosce; },
    salva: async (q) => { viste.push(["salva", q]); return salva; },
  };
}
const corpo = (x = {}) => ({ contro: LEI, motivo: "insulti", origine: "scheda", testo: "", blocca: true, ...x });

test("dal telefono solo i 9 motivi del modulo più «Sono in difficoltà»; «valutazione» la manda il server (#6)", () => {
  assert.equal(MOTIVI_DAL_TELEFONO.length, 10);
  assert.ok(!MOTIVI_DAL_TELEFONO.includes("non_al_sicuro"));
  assert.ok(!ORIGINI_DAL_TELEFONO.includes("valutazione"));
});

test("segnalazione valida: si salva con chi segnala preso dal token e risponde con le ore di revisione", async () => {
  const d = finto();
  const r = await segnala({ da: IO, corpo: corpo({ testo: " Mi ha offeso. " }), adesso: ADESSO }, d);
  assert.deepEqual(r, { ok: true, ore: 24, pericolo: false });
  const [, q] = d.viste.find(([n]) => n === "salva");
  assert.deepEqual(q, { da: IO, contro: LEI, motivo: "insulti", origine: "scheda", testo: " Mi ha offeso. ", blocca: true });
});

test("minacce: priorità 1 ora e testo del 112", async () => {
  const r = await segnala({ da: IO, corpo: corpo({ motivo: "minacce_pericolo" }), adesso: ADESSO }, finto());
  assert.deepEqual(r, { ok: true, ore: 1, pericolo: true });
});

test("«Chiudi e segnala» blocca anche se la casella arriva tolta; altrove decide la casella", async () => {
  let d = finto();
  await segnala({ da: IO, corpo: corpo({ origine: "chiudi_e_segnala", blocca: false }), adesso: ADESSO }, d);
  assert.equal(d.viste.find(([n]) => n === "salva")[1].blocca, true);
  d = finto();
  await segnala({ da: IO, corpo: corpo({ blocca: false }), adesso: ADESSO }, d);
  assert.equal(d.viste.find(([n]) => n === "salva")[1].blocca, false);
});

test("non si segnala una persona mai incontrata nell'app (stanza o chiamate degli ultimi 30 giorni)", async () => {
  const d = finto({ conosce: false });
  const r = await segnala({ da: IO, corpo: corpo(), adesso: ADESSO }, d);
  assert.deepEqual(r, { ok: false, motivo: "persona" });
  assert.ok(!d.viste.some(([n]) => n === "salva"));
});

test("richieste sbagliate: motivo o origine fuori elenco, testo troppo lungo, se stessi, id non valido", async () => {
  for (const c of [corpo({ motivo: "non_al_sicuro" }), corpo({ origine: "valutazione" }), corpo({ testo: "x".repeat(1001) }),
    corpo({ contro: IO }), corpo({ contro: "non-un-id" }), corpo({ blocca: "si" })]) {
    const d = finto();
    const r = await segnala({ da: IO, corpo: c, adesso: ADESSO }, d);
    assert.equal(r.ok, false, JSON.stringify(c).slice(0, 60));
    assert.equal(r.motivo, "dati");
    assert.equal(d.viste.length, 0);
  }
});

test("«Sono in difficoltà» senza persona: si salva subito, senza controllare chi si conosce", async () => {
  const d = finto();
  const r = await segnala({ da: IO, corpo: { motivo: "sono_in_difficolta", origine: "sono_in_difficolta" }, adesso: ADESSO }, d);
  assert.deepEqual(r, { ok: true, ore: 1, pericolo: true });
  assert.deepEqual(d.viste.map(([n]) => n), ["salva"]);
  assert.equal(d.viste[0][1].contro, null);
});

test("dallo storico delle chiamate solo entro 30 giorni", async () => {
  const vecchia = new Date(ADESSO.getTime() - 31 * 864e5).toISOString();
  const r = await segnala({ da: IO, corpo: corpo({ origine: "storico_chiamate", chiamataIl: vecchia }), adesso: ADESSO }, finto());
  assert.deepEqual(r, { ok: false, motivo: "scaduta" });
});

test("database che non risponde: «riprova», mai una segnalazione a metà", async () => {
  assert.deepEqual(await segnala({ da: IO, corpo: corpo(), adesso: ADESSO }, finto({ conosce: null })), { ok: false, motivo: "riprova" });
  assert.deepEqual(await segnala({ da: IO, corpo: corpo(), adesso: ADESSO }, finto({ salva: null })), { ok: false, motivo: "riprova" });
});

// ---- Database vero, con un fetch finto ----
import { conosceDb, salvaDb } from "../api/segnala.js";
const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ENV = { SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const S1 = "aaaaaaaa-1111-4111-8111-111111111111", S2 = "bbbbbbbb-2222-4222-8222-222222222222";
function rete({ chiamate = [], membri = [], stato = 200, idSalvato = "cccccccc-3333-4333-8333-333333333333" } = {}) {
  const viste = [];
  const f = async (url, o = {}) => {
    const u = new URL(url);
    viste.push({ path: u.pathname, query: decodeURIComponent(u.search), o });
    if (u.origin !== BASE) throw new Error("rete assente");
    if (stato !== 200) return new Response("{}", { status: stato });
    if (u.pathname === "/rest/v1/chiamate") return Response.json(chiamate);
    if (u.pathname === "/rest/v1/membri_stanza") return Response.json(membri);
    if (u.pathname === "/rest/v1/rpc/nuova_segnalazione") return Response.json(idSalvato);
    return new Response("{}", { status: 404 });
  };
  return { f, viste };
}

test("conosceDb: sì con una chiamata negli ultimi 30 giorni (in tutte e due le direzioni)", async () => {
  const { f, viste } = rete({ chiamate: [{ inizio: "2026-11-29T20:00:00Z" }] });
  assert.equal(await conosceDb(ENV, { da: IO, contro: LEI, adesso: ADESSO }, f), true);
  const q = viste.find((v) => v.path === "/rest/v1/chiamate").query;
  assert.match(q, new RegExp(`and\\(chi.eq.${IO},con.eq.${LEI}\\),and\\(chi.eq.${LEI},con.eq.${IO}\\)`));
  assert.match(q, /inizio=gte.2026-10-31T20:00:00.000Z/);
  assert.equal(viste[0].o.headers.authorization, "Bearer chiave-server-finta");
});

test("conosceDb: sì nella stessa stanza aperta, no in stanze diverse, null se il database non risponde", async () => {
  assert.equal(await conosceDb(ENV, { da: IO, contro: LEI, adesso: ADESSO },
    rete({ membri: [{ utente_id: IO, stanze: { id: S1 } }, { utente_id: LEI, stanze: { id: S1 } }] }).f), true);
  assert.equal(await conosceDb(ENV, { da: IO, contro: LEI, adesso: ADESSO },
    rete({ membri: [{ utente_id: IO, stanze: { id: S1 } }, { utente_id: LEI, stanze: { id: S2 } }] }).f), false);
  assert.equal(await conosceDb(ENV, { da: IO, contro: LEI, adesso: ADESSO }, rete().f), false);
  assert.equal(await conosceDb(ENV, { da: IO, contro: LEI, adesso: ADESSO }, rete({ stato: 500 }).f), null);
  assert.equal(await conosceDb({}, { da: IO, contro: LEI, adesso: ADESSO }, rete().f), null);
});

test("salvaDb: chiama nuova_segnalazione con la chiave del server e restituisce l'id", async () => {
  const { f, viste } = rete();
  const id = await salvaDb(ENV, { da: IO, contro: LEI, motivo: "insulti", origine: "scheda", testo: "", blocca: true }, f);
  assert.equal(id, "cccccccc-3333-4333-8333-333333333333");
  const v = viste[0];
  assert.equal(v.o.method, "POST");
  assert.deepEqual(JSON.parse(v.o.body), { p_da: IO, p_contro: LEI, p_motivo: "insulti", p_origine: "scheda", p_testo: "", p_blocca: true });
  assert.equal(await salvaDb(ENV, { da: IO }, rete({ stato: 400 }).f), null);
  assert.equal(await salvaDb(ENV, { da: IO }, rete({ idSalvato: "x" }).f), null);
});
