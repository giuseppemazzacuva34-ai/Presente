// «La tua stanza» nella web app (issue #4 passo 3c-3a, con #3): le persone della stanza dalla funzione
// compagni_di_stanza() di Supabase (solo nome, età, città; regole nel database) e il collegamento con la chiamata.
// Supabase è finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaCompagni, nomeInChiamata, schedaCompagno } from "../landing/app/moduli/compagni.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

function finto(rispondi = () => [200, []]) {
  const chiamate = [];
  const f = async (url, o = {}) => {
    const u = new URL(url);
    chiamate.push({ percorso: u.pathname, metodo: o.method || "GET", headers: o.headers || {}, corpo: o.body });
    if (u.origin !== BASE) throw new Error("rete assente");
    const [stato, dati] = rispondi();
    return new Response(JSON.stringify(dati), { status: stato });
  };
  return { f, chiamate };
}
const crea = (f, token = "tok-utente") => creaCompagni({ supabaseUrl: BASE, supabaseAnonKey: "anon", token: async () => token, fetch: f });

test("leggi: chiama compagni_di_stanza con il token dell'utente e un corpo vuoto", async () => {
  const s = finto(() => [200, [{ utente_id: ID1, nome: "Giulia", eta: 34, citta: "Torino" }]]);
  const r = await crea(s.f).leggi();
  assert.deepEqual(r, { ok: true, persone: [{ id: ID1, nome: "Giulia", eta: 34, citta: "Torino" }] });
  const c = s.chiamate[0];
  assert.equal(c.percorso, "/rest/v1/rpc/compagni_di_stanza");
  assert.equal(c.metodo, "POST");
  assert.equal(c.corpo, "{}");
  assert.equal(c.headers.authorization, "Bearer tok-utente");
  assert.equal(c.headers.apikey, "anon");
});

test("leggi: righe strane scartate, campi in più ignorati, ordine per nome", async () => {
  const s = finto(() => [200, [
    { utente_id: ID2, nome: "Marco", eta: 41, citta: null, email: "x@y.z" },
    { utente_id: "non-un-id", nome: "X", eta: 30, citta: "Roma" },
    { utente_id: ID1, nome: "Anna", eta: 29, citta: "Bari" },
    { utente_id: ID1, nome: "Anna", eta: 29, citta: "Bari" },
    null,
  ]]);
  const r = await crea(s.f).leggi();
  assert.deepEqual(r.persone, [
    { id: ID1, nome: "Anna", eta: 29, citta: "Bari" },
    { id: ID2, nome: "Marco", eta: 41, citta: "" },
  ]);
  assert.ok(!JSON.stringify(r).includes("email"));
});

test("leggi: senza token nessuna richiesta; 401 → accesso; errori → rete/lettura", async () => {
  const s = finto();
  assert.deepEqual(await crea(s.f, null).leggi(), { ok: false, motivo: "accesso" });
  assert.equal(s.chiamate.length, 0);
  assert.deepEqual(await crea(finto(() => [401, {}]).f).leggi(), { ok: false, motivo: "accesso" });
  assert.deepEqual(await crea(finto(() => [500, {}]).f).leggi(), { ok: false, motivo: "lettura" });
  const giu = async () => { throw new Error("giù"); };
  assert.deepEqual(await crea(giu).leggi(), { ok: false, motivo: "rete" });
});

test("indirizzo di Supabase non valido: errore subito", () => {
  assert.throws(() => creaCompagni({ supabaseUrl: "https://altro.example.com", supabaseAnonKey: "a", token: () => "t" }));
});

test("scheda: nome, età e città; «Chiama» solo se non c'è già una chiamata", () => {
  const p = { id: ID1, nome: "Giulia", eta: 34, citta: "Torino" };
  assert.deepEqual(schedaCompagno(p, { inChiamata: false }), { titolo: "Giulia, 34", sottotitolo: "Torino", chiama: true });
  assert.equal(schedaCompagno(p, { inChiamata: true }).chiama, false);
  assert.equal(schedaCompagno({ ...p, citta: "" }).sottotitolo, "");
});

test("nome in chiamata: dalla vista (id dell'altra persona) al nome mostrato nella stanza", () => {
  const persone = [{ id: ID1, nome: "Giulia", eta: 34, citta: "Torino" }];
  assert.equal(nomeInChiamata({ fase: "squilla", altra: ID1 }, persone), "Giulia");
  assert.equal(nomeInChiamata({ fase: "squilla", altra: ID2 }, persone), "");
  assert.equal(nomeInChiamata(null, persone), "");
  assert.equal(nomeInChiamata({ fase: "squilla" }, null), "");
});
