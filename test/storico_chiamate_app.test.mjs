// «Le tue chiamate» nella web app (issue #7, spec v1.1, caso limite «Persona già bloccata»: si segnala dallo storico
// delle chiamate per 30 giorni; passo 9b della linea «sviluppatore-b»). Legge solo la funzione mie_chiamate_recenti()
// con il token di chi chiede. Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_STORICO, voceStorico, segnalaDaStorico, creaStorico } from "../landing/app/moduli/storico_chiamate.js";

const LEI = "11111111-2222-4333-8444-555555555555";
const LUI = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const BASE = "https://abcdefghijklmnopqrst.supabase.co";

test("testi: il titolo della spec e la riga vuota", () => {
  assert.equal(TESTI_STORICO.titolo, "Le tue chiamate");
  assert.equal(TESTI_STORICO.segnala, "Segnala");
  assert.equal(typeof TESTI_STORICO.vuoto, "string");
});

test("voce: nome, giorno e ora di Roma, durata in minuti; mai altri campi", () => {
  const v = voceStorico({ con: LEI, nome: " Giulia ", inizio: "2026-11-13T17:00:00+00:00", durata: 300, eta: 30, esito: "chiusa" });
  assert.deepEqual(v, { con: LEI, nome: "Giulia", chiamataIl: "2026-11-13T17:00:00+00:00", quando: "13 novembre, 18:00", durata: "5 min" });
  assert.equal(voceStorico({ con: LEI, nome: "Giulia", inizio: "2026-11-13T17:00:00Z", durata: 20 }).durata, "1 min");
});

test("voce: righe senza id valido o senza data si scartano; senza nome «Una persona»", () => {
  assert.equal(voceStorico({ con: "x", nome: "Giulia", inizio: "2026-11-13T17:00:00Z", durata: 60 }), null);
  assert.equal(voceStorico({ con: LEI, nome: "Giulia", inizio: "ieri", durata: 60 }), null);
  assert.equal(voceStorico(null), null);
  assert.equal(voceStorico({ con: LEI, nome: null, inizio: "2026-11-13T17:00:00Z", durata: 60 }).nome, "Una persona");
});

test("segnala dallo storico: persona, origine «storico_chiamate» e inizio della chiamata", () => {
  const v = voceStorico({ con: LEI, nome: "Giulia", inizio: "2026-11-13T17:00:00Z", durata: 300 });
  assert.deepEqual(segnalaDaStorico(v), { contro: LEI, origine: "storico_chiamate", chiamataIl: "2026-11-13T17:00:00Z", nome: "Giulia" });
  assert.equal(segnalaDaStorico(null), null);
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
const crea = (f, token = async () => "tok-di-prova-abcdefghijk") => creaStorico({ supabaseUrl: BASE, supabaseAnonKey: "anon", token, fetch: f });

test("leggi: una sola richiesta alla funzione, col token; il corpo non dice chi chiede", async () => {
  const { f, viste } = rete(200, [
    { con: LEI, nome: "Giulia", inizio: "2026-11-14T17:00:00Z", durata: 300 },
    { con: LUI, nome: "Marco", inizio: "2026-11-13T17:00:00Z", durata: 61 },
    { con: "rotto", nome: "X", inizio: "2026-11-13T17:00:00Z", durata: 61 },
  ]);
  const r = await crea(f).leggi();
  assert.equal(r.ok, true);
  assert.deepEqual(r.chiamate.map((c) => c.nome), ["Giulia", "Marco"]);
  assert.equal(viste.length, 1);
  assert.equal(viste[0].url, `${BASE}/rest/v1/rpc/mie_chiamate_recenti`);
  assert.equal(viste[0].init.method, "POST");
  assert.equal(viste[0].init.body, "{}");
  assert.equal(viste[0].init.headers.authorization, "Bearer tok-di-prova-abcdefghijk");
});

test("leggi: senza token nessuna richiesta; errori come motivi", async () => {
  const { f, viste } = rete(200, []);
  assert.deepEqual(await crea(f, async () => null).leggi(), { ok: false, motivo: "accesso" });
  assert.equal(viste.length, 0);
  assert.deepEqual(await crea(rete(401).f).leggi(), { ok: false, motivo: "accesso" });
  assert.deepEqual(await crea(rete(500).f).leggi(), { ok: false, motivo: "lettura" });
  assert.deepEqual(await crea(rete("giu").f).leggi(), { ok: false, motivo: "rete" });
  assert.deepEqual(await crea(rete(200, { non: "lista" }).f).leggi(), { ok: true, chiamate: [] });
});

test("indirizzo Supabase non valido: errore subito", () => {
  assert.throws(() => creaStorico({ supabaseUrl: "https://evil.example.com", supabaseAnonKey: "a", token: async () => "t" }));
});
