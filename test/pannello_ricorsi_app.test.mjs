// Ricorsi nella pagina del pannello di chi decide (issue #7, spec «Ricorso», D51 A) · linea «sviluppatore-b», passo 13f.
// Il modulo parla solo con /app/api/pannello/ricorsi e /ricorso col token di chi decide. Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { vociRicorsi, ESITI_RICORSO_PANNELLO, creaPannello } from "../landing/app/moduli/pannello.js";
import { ESITI_RICORSO } from "../worker/pannello_api.js";

const RIC = "66666666-7777-4888-9999-000000000000";
const ADESSO = new Date("2026-11-16T15:00:00Z");

test("esiti del ricorso: stessi del server, con etichette", () => {
  assert.deepEqual(ESITI_RICORSO_PANNELLO.map(([e]) => e), [...ESITI_RICORSO]);
  assert.equal(ESITI_RICORSO_PANNELLO[0][1], "Accolto: la sanzione si annulla subito");
});

test("ricorsi: voci leggibili; chi ha sanzionato non può decidere; scaduti in rosso", () => {
  const [v, w] = vociRicorsi([
    { id: RIC, livello: "sospensione_7", regola: "rispetto", motivo_sanzione: "insulti in chiamata", nome: "Bruno",
      testo: "non ero io", inviato_il: "2026-11-15T10:00:00Z", risposta_entro: "2026-11-18T10:00:00Z", decisa_da_te: false },
    { id: RIC, livello: "esclusione", regola: null, motivo_sanzione: "", nome: "  ", testo: "",
      inviato_il: "2026-11-10T10:00:00Z", risposta_entro: "2026-11-16T14:00:00Z", decisa_da_te: true },
    { id: "non-valido" },
    null,
  ], ADESSO);
  assert.equal(v.id, RIC);
  assert.equal(v.titolo, "Bruno contesta «Sospensione 7 giorni» (Rispetto, sempre)");
  assert.equal(v.motivoSanzione, "insulti in chiamata");
  assert.equal(v.perche, "non ero io");
  assert.equal(v.resta, "Restano 1 g 19 h");
  assert.equal(v.rossa, false);
  assert.equal(v.puoiDecidere, true);
  assert.equal(w.titolo, "Senza nome contesta «Esclusione definitiva» (regola non indicata)");
  assert.equal(w.perche, "Nessun motivo scritto.");
  assert.equal(w.rossa, true);
  assert.equal(w.puoiDecidere, false);
  assert.equal(vociRicorsi("x", ADESSO).length, 0);
});

test("client: ricorsi e decisione al Worker col token; mai campi in più", async () => {
  const chieste = [];
  const f = async (url, init = {}) => {
    chieste.push([url, init.method, init.headers.authorization, init.body ? JSON.parse(init.body) : null]);
    if (url.endsWith("/ricorsi")) return Response.json({ ok: true, ricorsi: [{ id: RIC }] });
    return Response.json({ ok: true });
  };
  const p = creaPannello({ token: () => "tok", fetch: f });
  assert.deepEqual(await p.ricorsi(), { ok: true, ricorsi: [{ id: RIC }] });
  assert.deepEqual(await p.decidiRicorso({ id: RIC, esito: "respinto", testo: "  confermata  ", extra: 1 }), { ok: true });
  assert.deepEqual(chieste, [
    ["/app/api/pannello/ricorsi", "GET", "Bearer tok", null],
    ["/app/api/pannello/ricorso", "POST", "Bearer tok", { id: RIC, esito: "respinto", testo: "confermata" }],
  ]);
});

test("client: decisione sul ricorso controllata prima di partire; rifiuto del server passato alla pagina", async () => {
  let chiamate = 0;
  const f = async () => { chiamate++; return Response.json({ ok: false, motivo: "rifiutata" }); };
  const p = creaPannello({ token: () => "tok", fetch: f });
  assert.deepEqual(await p.decidiRicorso({ id: "x", esito: "accolto", testo: "ok" }), { ok: false, motivo: "id" });
  assert.deepEqual(await p.decidiRicorso({ id: RIC, esito: "annulla", testo: "ok" }), { ok: false, motivo: "esito" });
  assert.deepEqual(await p.decidiRicorso({ id: RIC, esito: "accolto", testo: "  " }), { ok: false, motivo: "testo" });
  assert.equal(chiamate, 0);
  assert.deepEqual(await p.decidiRicorso({ id: RIC, esito: "accolto", testo: "ok" }), { ok: false, motivo: "rifiutata" });
  const no = creaPannello({ token: () => "tok", fetch: async () => new Response("{}", { status: 403 }) });
  assert.deepEqual(await no.ricorsi(), { ok: false, motivo: "non_moderatore" });
});
