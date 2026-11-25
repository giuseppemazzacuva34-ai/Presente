// Contestazioni dei «No» nella pagina del pannello di chi decide (issue #6, spec v1.3 del CPO del 22/11, punto 2;
// D51 A) · linea «sviluppatore-b», passo 4c. Il modulo parla solo con /app/api/pannello/contestazioni e /contestazione
// col token di chi decide. Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vociContestazioni, ESITI_CONTESTAZIONE_PANNELLO, creaPannello } from "../landing/app/moduli/pannello.js";

const C = "aaaaaaaa-2222-4333-8444-555555555555";

test("esiti della contestazione: gli stessi del server, con etichette chiare", () => {
  assert.deepEqual(ESITI_CONTESTAZIONE_PANNELLO.map(([e]) => e), ["accolta", "respinta"]);
  assert.equal(ESITI_CONTESTAZIONE_PANNELLO[0][1], "Accogli: quel no non conta più");
  assert.equal(ESITI_CONTESTAZIONE_PANNELLO[1][1], "Respingi: il no resta");
});

test("contestazioni: voci leggibili con la domanda della valutazione; la propria non si decide", () => {
  const [v, w] = vociContestazioni([
    { id: C, nome: "Anna", domanda: "foto_sue", testo: "Sono proprio io.", quanti_no: 2, inviata_il: "2026-11-25T18:00:00Z", tua: false },
    { id: C, nome: null, domanda: "presentato", testo: "Ero lì.", quanti_no: 1, inviata_il: "2026-11-25T08:05:00Z", tua: true },
    { id: C, nome: "X", domanda: "sicuro", testo: "no", quanti_no: 1, inviata_il: "2026-11-25T08:05:00Z", tua: false },
    { id: "non-valido" },
    null,
  ]);
  assert.equal(v.id, C);
  assert.equal(v.titolo, "Anna contesta 2 «No» a: «Le foto erano davvero sue?»");
  assert.equal(v.perche, "Sono proprio io.");
  assert.equal(v.inviata, "25 novembre alle 19:00");
  assert.equal(v.puoiDecidere, true);
  assert.equal(w.titolo, "Senza nome contesta 1 «No» a: «Si è presentata/o?»");
  assert.equal(w.puoiDecidere, false);
  assert.equal(vociContestazioni("x").length, 0);
});

test("client: contestazioni e decisione al Worker col token; mai campi in più", async () => {
  const chieste = [];
  const f = async (url, init = {}) => {
    chieste.push([url, init.method, init.headers.authorization, init.body ? JSON.parse(init.body) : null]);
    if (url.endsWith("/contestazioni")) return Response.json({ ok: true, contestazioni: [{ id: C }] });
    return Response.json({ ok: true, esito: "respinta" });
  };
  const p = creaPannello({ token: () => "tok", fetch: f });
  assert.deepEqual(await p.contestazioni(), { ok: true, contestazioni: [{ id: C }] });
  assert.deepEqual(await p.decidiContestazione({ id: C, esito: "respinta", extra: 1 }), { ok: true });
  assert.deepEqual(chieste, [
    ["/app/api/pannello/contestazioni", "GET", "Bearer tok", null],
    ["/app/api/pannello/contestazione", "POST", "Bearer tok", { id: C, esito: "respinta" }],
  ]);
});

test("client: decisione controllata prima di partire; rifiuto del server passato alla pagina", async () => {
  let chiamate = 0;
  const f = async () => { chiamate++; return Response.json({ ok: false, motivo: "gia_decisa" }); };
  const p = creaPannello({ token: () => "tok", fetch: f });
  assert.deepEqual(await p.decidiContestazione({ id: "x", esito: "accolta" }), { ok: false, motivo: "id" });
  assert.deepEqual(await p.decidiContestazione({ id: C, esito: "accolto" }), { ok: false, motivo: "esito" });
  assert.equal(chiamate, 0);
  assert.deepEqual(await p.decidiContestazione({ id: C, esito: "accolta" }), { ok: false, motivo: "gia_decisa" });
});

test("pagina: tasto «Contestazioni dei no» nella coda, elenco con decisione e messaggi chiari", () => {
  const js = readFileSync(new URL("../landing/app/pannello_avvio.js", import.meta.url), "utf8");
  assert.match(js, /testo: "Contestazioni dei no"/);
  assert.match(js, /async function mostraContestazioni\(p\)/);
  assert.match(js, /h\("h1", \{ testo: "Contestazioni dei no" \}\)/);
  assert.match(js, /Nessuna contestazione da decidere\./);
  assert.match(js, /La contestazione è tua: la decide un'altra persona\./);
  assert.match(js, /gia_decisa: "Decisione non salvata: la contestazione è già decisa\."/);
  assert.match(js, /propria: /);
  // Ogni testo entra con textContent: niente innerHTML nella pagina.
  assert.doesNotMatch(js, /innerHTML/);
});
