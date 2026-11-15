// Esito per chi segnala nella web app (issue #7, spec v1.1, passo 4; passo 10b della linea «sviluppatore-b»).
// Legge solo miei_esiti_segnalazioni() e segna con esito_segnalazione_letto(), col token di chi chiede.
// Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_ESITO, voceEsito, creaEsiti } from "../landing/app/moduli/esiti_segnalazioni.js";
import { esitoPerChiSegnala } from "../api/segnalazioni.js";

const ID = "11111111-2222-4333-8444-555555555555";
const ID2 = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const BASE = "https://abcdefghijklmnopqrst.supabase.co";

test("testi: gli stessi due della spec usati dal server, mai il dettaglio della sanzione", () => {
  assert.equal(TESTI_ESITO.archiviata, esitoPerChiSegnala("archiviata"));
  assert.equal(TESTI_ESITO.provvedimenti, esitoPerChiSegnala("provvedimenti"));
  assert.equal(typeof TESTI_ESITO.ok, "string");
});

test("voce: id e uno dei due testi; esiti sconosciuti o id non validi si scartano", () => {
  assert.deepEqual(voceEsito({ id: ID, esito: "archiviata", chiusa_il: "2026-11-15T10:00:00Z", contro: "x" }), { id: ID, testo: TESTI_ESITO.archiviata });
  assert.deepEqual(voceEsito({ id: ID, esito: "provvedimenti" }), { id: ID, testo: TESTI_ESITO.provvedimenti });
  assert.equal(voceEsito({ id: ID, esito: "sospensione_30" }), null);
  assert.equal(voceEsito({ id: "x", esito: "archiviata" }), null);
  assert.equal(voceEsito(null), null);
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
const crea = (f, token = async () => "tok-di-prova-abcdefghijk") => creaEsiti({ supabaseUrl: BASE, supabaseAnonKey: "anon", token, fetch: f });

test("leggi: una richiesta alla funzione col token; il corpo non dice chi chiede", async () => {
  const { f, viste } = rete(200, [
    { id: ID, esito: "archiviata", chiusa_il: "2026-11-14T10:00:00Z" },
    { id: ID2, esito: "provvedimenti", chiusa_il: "2026-11-15T10:00:00Z" },
    { id: "rotto", esito: "archiviata" },
  ]);
  const r = await crea(f).leggi();
  assert.deepEqual(r, { ok: true, esiti: [{ id: ID, testo: TESTI_ESITO.archiviata }, { id: ID2, testo: TESTI_ESITO.provvedimenti }] });
  assert.equal(viste.length, 1);
  assert.equal(viste[0].url, `${BASE}/rest/v1/rpc/miei_esiti_segnalazioni`);
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
  assert.deepEqual(await crea(rete(200, { non: "lista" }).f).leggi(), { ok: true, esiti: [] });
});

test("letto: manda solo l'id della segnalazione alla funzione", async () => {
  const { f, viste } = rete(204);
  assert.deepEqual(await crea(f).letto(ID), { ok: true });
  assert.equal(viste[0].url, `${BASE}/rest/v1/rpc/esito_segnalazione_letto`);
  assert.deepEqual(JSON.parse(viste[0].init.body), { p_id: ID });
});

test("letto: id non valido o senza token nessuna richiesta; errori come motivi", async () => {
  const { f, viste } = rete(204);
  assert.deepEqual(await crea(f).letto("x"), { ok: false, motivo: "id" });
  assert.deepEqual(await crea(f, async () => null).letto(ID), { ok: false, motivo: "accesso" });
  assert.equal(viste.length, 0);
  assert.deepEqual(await crea(rete(500).f).letto(ID), { ok: false, motivo: "lettura" });
  assert.deepEqual(await crea(rete("giu").f).letto(ID), { ok: false, motivo: "rete" });
});

test("indirizzo Supabase non valido: errore subito", () => {
  assert.throws(() => creaEsiti({ supabaseUrl: "https://evil.example.com", supabaseAnonKey: "a", token: async () => "t" }));
});
