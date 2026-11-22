// Schermata «I tuoi Coin» nella web app (issue #331, spec v1 del CPO, parte B; D145 A). Passo 6 della linea
// «sviluppatore-c». Testi della spec, offerte sempre disattivate in beta, saldo letto dal Worker con il token di chi
// guarda (GET /app/api/regali), nessuna chiamata a servizi di pagamento. Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schermataCoin, creaCoin, mostraSchermataCoin, TESTI_SCHERMATA_COIN, OFFERTE } from "../landing/app/moduli/coin.js";
import { COIN } from "../api/coin.js";

function rete(risposte) {
  const chiamate = [];
  const f = async (url, init = {}) => {
    chiamate.push({ url, ...init });
    const r = risposte.shift() ?? { status: 200, body: {} };
    if (r.errore) throw new Error("rete");
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  return { f, chiamate };
}

test("schermata: titolo, saldo grande e testi della spec (B.1-B.5)", () => {
  const s = schermataCoin(200);
  assert.equal(s.titolo, "I tuoi Coin");
  assert.equal(s.saldo, "200 Coin");
  assert.equal(s.notaBeta, "Nella beta i Coin sono di prova: li trovi già nel tuo saldo. Non paghi niente.");
  assert.equal(s.riga, "1 € = 10 Coin. La stanza Al buio costa 80 Coin, la prima è in regalo.");
  assert.equal(s.continua, "Continua");
  assert.equal(TESTI_SCHERMATA_COIN.titolo, "I tuoi Coin");
});

test("offerte: «200 Coin · 20 €» e «500 Coin · 45 €» con «50 Coin in più», tutte disattivate in beta", () => {
  const s = schermataCoin(200);
  assert.deepEqual(s.offerte.map((o) => [o.testo, o.etichetta, o.attiva]), [
    ["200 Coin · 20 €", null, false],
    ["500 Coin · 45 €", "50 Coin in più", false],
  ]);
  // Ogni pulsante spento dice perché (non solo il grigio), per chi usa un lettore di schermo.
  for (const o of s.offerte) assert.equal(o.descrizione, TESTI_SCHERMATA_COIN.notaBeta);
  assert.ok(Object.isFrozen(OFFERTE));
});

test("offerte: i conti tornano con 1 € = 10 Coin (il «in più» è la differenza vera)", () => {
  for (const o of OFFERTE) {
    const pieno = o.euro * COIN.perEuro;
    assert.equal(o.coin - pieno, o.inPiu);
  }
  assert.ok(TESTI_SCHERMATA_COIN.riga.includes(`1 € = ${COIN.perEuro} Coin`));
  assert.ok(TESTI_SCHERMATA_COIN.riga.includes(`costa ${COIN.stanzaAlBuio} Coin`));
});

test("saldo: «1 Coin» al singolare; saldo mancante o non valido non mostra un numero inventato", () => {
  assert.equal(schermataCoin(1).saldo, "1 Coin");
  assert.equal(schermataCoin(0).saldo, "0 Coin");
  for (const x of [null, undefined, -5, 2.5, "200", NaN]) assert.equal(schermataCoin(x).saldo, null);
});

test("quando mostrarla: solo al primo ingresso dopo il profilo completo, o se la apre la persona", () => {
  assert.equal(mostraSchermataCoin({ profiloCompleto: true, giaVista: false }), true);
  assert.equal(mostraSchermataCoin({ profiloCompleto: true, giaVista: true }), false);
  assert.equal(mostraSchermataCoin({ profiloCompleto: false, giaVista: false }), false);
  assert.equal(mostraSchermataCoin({ profiloCompleto: true, giaVista: true, dalProfilo: true }), true);
  assert.equal(mostraSchermataCoin({ profiloCompleto: false, giaVista: false, dalProfilo: true }), true);
  assert.equal(mostraSchermataCoin({}), false);
  assert.equal(mostraSchermataCoin(), false);
});

test("saldo dal Worker: GET /app/api/regali con il token, nessun altro indirizzo", async () => {
  const { f, chiamate } = rete([{ status: 200, body: { ok: true, saldo: 200, avvisi: [] } }]);
  const c = creaCoin({ token: async () => "tok", fetch: f });
  assert.deepEqual(await c.saldo(), { ok: true, saldo: 200 });
  assert.equal(chiamate.length, 1);
  assert.equal(chiamate[0].url, "/app/api/regali");
  assert.equal(chiamate[0].method, "GET");
  assert.equal(chiamate[0].headers.authorization, "Bearer tok");
});

test("saldo dal Worker: senza token, rete giù, 401, 503 o risposta strana → motivo, mai un saldo inventato", async () => {
  assert.deepEqual(await creaCoin({ token: async () => null, fetch: rete([]).f }).saldo(), { ok: false, motivo: "accesso" });
  assert.deepEqual(await creaCoin({ token: async () => "t", fetch: rete([{ errore: true }]).f }).saldo(), { ok: false, motivo: "rete" });
  assert.deepEqual(await creaCoin({ token: async () => "t", fetch: rete([{ status: 401, body: {} }]).f }).saldo(), { ok: false, motivo: "accesso" });
  assert.deepEqual(await creaCoin({ token: async () => "t", fetch: rete([{ status: 503, body: { ok: false } }]).f }).saldo(), { ok: false, motivo: "riprova" });
  assert.deepEqual(await creaCoin({ token: async () => "t", fetch: rete([{ status: 200, body: { ok: true, saldo: "200" } }]).f }).saldo(), { ok: false, motivo: "riprova" });
  assert.deepEqual(await creaCoin({ token: async () => { throw new Error("x"); }, fetch: rete([]).f }).saldo(), { ok: false, motivo: "accesso" });
});

test("nessun pagamento in beta: il modulo non nomina servizi di pagamento né indirizzi esterni", () => {
  const codice = readFileSync(new URL("../landing/app/moduli/coin.js", import.meta.url), "utf8");
  assert.doesNotMatch(codice, /stripe|gomry|checkout|paypal|https?:\/\//i);
  assert.doesNotMatch(codice, /localStorage|sessionStorage|indexedDB/);
  // Criterio A: nessuna parola «crediti» nei testi mostrati (i nomi interni delle funzioni sono ammessi).
  const s = schermataCoin(200);
  assert.doesNotMatch(JSON.stringify(s), /crediti/i);
});
