// Messaggio a chi riceve una sanzione e «Contesta» nella web app (issue #7, spec v1.1 definitiva, punti 7-8; D51 A).
// Passo 12c della linea «sviluppatore-b». Legge solo mie_sanzioni() e scrive solo con nuovo_ricorso(), col token
// di chi chiede. Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_SANZIONE, voceSanzione, creaSanzioni } from "../landing/app/moduli/sanzioni.js";

const ID = "11111111-2222-4333-8444-555555555555";
const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ADESSO = new Date("2026-11-16T10:00:00Z");

test("voce: livello, regola, fine in italiano e «Contesta» solo se si può", () => {
  const v = voceSanzione({ id: ID, livello: "sospensione_7", regola: "Rispetto", decisa_il: "2026-11-16T09:00:00Z",
    fine_il: "2026-11-23T09:00:00Z", ricorso_entro: "2026-11-30T09:00:00Z", contestabile: true, ricorso_stato: null, risposta_entro: null });
  assert.equal(v.id, ID);
  assert.equal(v.titolo, "Sospensione di 7 giorni");
  assert.equal(v.regola, "Regola violata: Rispetto");
  assert.equal(v.fine, "Fino al 23 novembre 2026");
  assert.equal(v.contesta, true);
  assert.equal(v.stato, "");
});

test("voce: avviso ed esclusione senza data di fine; ricorso in attesa con la data della risposta", () => {
  assert.equal(voceSanzione({ id: ID, livello: "avviso", regola: "Rispetto", fine_il: null, contestabile: true }).fine, "");
  const e = voceSanzione({ id: ID, livello: "esclusione", regola: "Identità", fine_il: null, contestabile: false,
    ricorso_stato: "in_attesa", risposta_entro: "2026-11-30T09:00:00Z" });
  assert.equal(e.titolo, "Esclusione definitiva");
  assert.equal(e.contesta, false);
  assert.equal(e.stato, "Ricorso inviato: risposta entro il 30 novembre 2026.");
});

test("voce: righe non valide si scartano; mai campi in più (chi ha segnalato, racconto)", () => {
  assert.equal(voceSanzione({ id: "x", livello: "avviso" }), null);
  assert.equal(voceSanzione({ id: ID, livello: "radiazione" }), null);
  assert.equal(voceSanzione(null), null);
  const v = voceSanzione({ id: ID, livello: "avviso", regola: "R", da: "qualcuno", testo: "racconto" });
  assert.deepEqual(Object.keys(v).sort(), ["contesta", "fine", "id", "regola", "stato", "titolo"]);
});

test("testi della spec: «Perché pensi che sia sbagliata?» e la conferma con i tempi", () => {
  assert.equal(TESTI_SANZIONE.domanda, "Perché pensi che sia sbagliata?");
  assert.equal(TESTI_SANZIONE.conferma, "Risposta entro 7 giorni (14 per l'esclusione definitiva).");
  assert.equal(TESTI_SANZIONE.contesta, "Contesta");
  assert.equal(TESTI_SANZIONE.massimo, 2000);
});

function rete(stato, corpo) {
  const viste = [];
  const f = async (url, init) => {
    viste.push({ url, init });
    if (stato === "giu") throw new Error("rete");
    return new Response(corpo === undefined ? null : JSON.stringify(corpo), { status: stato });
  };
  return { f, viste };
}
const crea = (f, token = async () => "tok-di-prova-abcdefghijk") => creaSanzioni({ supabaseUrl: BASE, supabaseAnonKey: "anon", token, fetch: f, adesso: () => ADESSO });

test("leggi: una richiesta a mie_sanzioni col token; il corpo non dice chi chiede", async () => {
  const { f, viste } = rete(200, [{ id: ID, livello: "avviso", regola: "Rispetto", contestabile: true }, { id: "no", livello: "avviso" }]);
  const r = await crea(f).leggi();
  assert.equal(r.ok, true);
  assert.equal(r.sanzioni.length, 1);
  assert.equal(viste[0].url, `${BASE}/rest/v1/rpc/mie_sanzioni`);
  assert.equal(viste[0].init.headers.authorization, "Bearer tok-di-prova-abcdefghijk");
  assert.equal(viste[0].init.body, "{}");
});

test("leggi: senza token, rete giù o errore del server", async () => {
  assert.deepEqual(await crea(rete(200, []).f, async () => null).leggi(), { ok: false, motivo: "accesso" });
  assert.deepEqual(await crea(rete("giu").f).leggi(), { ok: false, motivo: "rete" });
  assert.deepEqual(await crea(rete(500).f).leggi(), { ok: false, motivo: "lettura" });
});

test("contesta: testo ripulito, max 2000, una richiesta a nuovo_ricorso con id e testo", async () => {
  const { f, viste } = rete(204);
  const s = crea(f);
  assert.deepEqual(await s.contesta(ID, "   "), { ok: false, motivo: "testo" });
  assert.deepEqual(await s.contesta(ID, "a".repeat(2001)), { ok: false, motivo: "testo" });
  assert.deepEqual(await s.contesta("x", "perché"), { ok: false, motivo: "id" });
  assert.equal(viste.length, 0);
  assert.deepEqual(await s.contesta(ID, "  Ho solo chiesto un caffè.  "), { ok: true });
  assert.equal(viste[0].url, `${BASE}/rest/v1/rpc/nuovo_ricorso`);
  assert.deepEqual(JSON.parse(viste[0].init.body), { p_sanzione: ID, p_testo: "Ho solo chiesto un caffè." });
});

test("contesta: già fatto o scaduto dal database diventano motivi chiari", async () => {
  assert.deepEqual(await crea(rete(400, { message: "gia_fatto" }).f).contesta(ID, "x"), { ok: false, motivo: "gia_fatto" });
  assert.deepEqual(await crea(rete(400, { message: "scaduto" }).f).contesta(ID, "x"), { ok: false, motivo: "scaduto" });
  assert.deepEqual(await crea(rete(400, { message: "altro" }).f).contesta(ID, "x"), { ok: false, motivo: "lettura" });
});

test("indirizzo Supabase non valido: errore subito", () => {
  assert.throws(() => creaSanzioni({ supabaseUrl: "https://evil.example.com", supabaseAnonKey: "a", token: async () => "t" }));
});
