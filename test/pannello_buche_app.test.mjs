// «Ero lì» / «Non riesco» nella pagina del pannello di chi decide (issue #6 spec v1.4 del CPO del 27/11; D51 A;
// D156 A) · linea «sviluppatore-b». Il modulo parla solo con /app/api/pannello/buche e /buca col token di chi decide.
// Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vociBuche, esitiBuca, creaPannello } from "../landing/app/moduli/pannello.js";

const C = "bbbbbbbb-2222-4333-8444-555555555555";
const RIGA = { id: C, nome: "Ciro", fase: "prima_della_buca", testo: "Non riesco: niente rete.",
  inviata_il: "2026-11-27T18:40:00Z", orario: "2026-11-27T19:00:00Z", decidibile: true, tua: false };

test("esiti: gli stessi del server, con l'effetto sui crediti scritto per ogni fase (spec v1.4, D156 A)", () => {
  assert.deepEqual(esitiBuca("prima_della_buca"), [
    ["accolta", "Accogli: caparre restituite a entrambi (100 + 100)"],
    ["respinta", "Respingi: buca normale (70 a chi ha aspettato, 30 a Presente)"],
  ]);
  assert.deepEqual(esitiBuca("dopo_buca"), [
    ["accolta", "Accogli: tornano 100 a chi contesta, chi ha aspettato tiene i 70"],
    ["respinta", "Respingi: nulla cambia"],
  ]);
  assert.deepEqual(esitiBuca("boh"), []);
});

test("voci leggibili: chi, cosa dice, quando; la propria e quella con la finestra aperta non si decidono", () => {
  const [v, w, z] = vociBuche([
    RIGA,
    { ...RIGA, nome: null, fase: "dopo_buca", testo: "Ero lì al bancone.", tua: true },
    { ...RIGA, decidibile: false },
    { ...RIGA, fase: "altro" },
    { id: "x" },
    null,
  ]);
  assert.equal(v.id, C);
  assert.equal(v.fase, "prima_della_buca");
  assert.equal(v.titolo, "Ciro dice «Non riesco a fare il check-in»");
  assert.equal(v.incontro, "Incontro del 27 novembre alle 20:00");
  assert.equal(v.inviata, "27 novembre alle 19:40");
  assert.equal(v.perche, "Non riesco: niente rete.");
  assert.equal(v.puoiDecidere, true);
  assert.equal(v.nota, "");
  assert.equal(w.titolo, "Senza nome dice «Ero lì»");
  assert.equal(w.puoiDecidere, false);
  assert.equal(w.nota, "La contestazione è tua: la decide un'altra persona.");
  assert.equal(z.puoiDecidere, false);
  assert.equal(z.nota, "Si decide quando è finita la finestra del check-in.");
  assert.equal(vociBuche("x").length, 0);
  assert.equal(vociBuche([RIGA, {}, RIGA]).length, 2);
});

test("client: elenco e decisione al Worker col token; mai campi in più", async () => {
  const chieste = [];
  const f = async (url, init = {}) => {
    chieste.push([url, init.method, init.headers.authorization, init.body ? JSON.parse(init.body) : null]);
    if (url.endsWith("/buche")) return Response.json({ ok: true, buche: [{ id: C }] });
    return Response.json({ ok: true, esito: "accolta" });
  };
  const p = creaPannello({ token: () => "tok", fetch: f });
  assert.deepEqual(await p.buche(), { ok: true, buche: [{ id: C }] });
  assert.deepEqual(await p.decidiBuca({ id: C, esito: "accolta", extra: 1 }), { ok: true });
  assert.deepEqual(chieste, [
    ["/app/api/pannello/buche", "GET", "Bearer tok", null],
    ["/app/api/pannello/buca", "POST", "Bearer tok", { id: C, esito: "accolta" }],
  ]);
});

test("client: decisione controllata prima di partire; rifiuto del server passato alla pagina", async () => {
  let chiamate = 0;
  const f = async () => { chiamate++; return Response.json({ ok: false, motivo: "non_ancora" }); };
  const p = creaPannello({ token: () => "tok", fetch: f });
  assert.deepEqual(await p.decidiBuca({ id: "x", esito: "accolta" }), { ok: false, motivo: "id" });
  assert.deepEqual(await p.decidiBuca({ id: C, esito: "accolto" }), { ok: false, motivo: "esito" });
  assert.equal(chiamate, 0);
  assert.deepEqual(await p.decidiBuca({ id: C, esito: "respinta" }), { ok: false, motivo: "non_ancora" });
});

test("pagina: tasto «Ero lì e Non riesco» nella coda, elenco con decisione e messaggi chiari", () => {
  const js = readFileSync(new URL("../landing/app/pannello_avvio.js", import.meta.url), "utf8");
  assert.match(js, /testo: "«Ero lì» e «Non riesco»"/);
  assert.match(js, /async function mostraBuche\(p\)/);
  assert.match(js, /h\("h1", \{ testo: "«Ero lì» e «Non riesco»" \}\)/);
  assert.match(js, /Nessuna contestazione di buca da decidere\./);
  assert.match(js, /non_ancora: "Decisione non salvata: la finestra del check-in non è ancora finita\."/);
  assert.match(js, /in_attesa_d156: /);
  assert.match(js, /esitiBuca\(v\.fase\)/);
  assert.doesNotMatch(js, /innerHTML/);
});
