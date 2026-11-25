// Coin e saldo del design v4 (issue #349, schermate 13 «I tuoi Coin» e 21 «Coin quasi finiti»), passo 1 della linea
// «sviluppatore-b»: solo logica e testi. In beta i Coin sono un contatore interno: il pulsante di pagamento resta
// sempre spento e nessuna richiesta va a Gomry (pagamenti veri solo con l'ok di Giuseppe). Il saldo lo dà il server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TESTI_SALDO as T, schermataTuoiCoin, quasiFiniti, creaSaldo } from "../landing/app/moduli/saldo_coin.js";
import { COIN, REGALI } from "../api/coin.js";
import { SVELAMENTO } from "../api/svelamento.js";
import { OFFERTE } from "../landing/app/moduli/coin.js";
import { SOGLIA_SALDO_BASSO } from "../landing/app/moduli/testata.js";

test("13: saldo dal server, tre pacchetti (Base 100 + i due di coin.js), il 500 «il più scelto»", () => {
  const s = schermataTuoiCoin(0);
  assert.equal(s.passo, "Passo 10 di 10 · I tuoi crediti");
  assert.deepEqual(s.titolo, ["I tuoi crediti", "per la stanza e i regali."]);
  assert.equal(s.saldo, "Hai 0 crediti. La tua prima stanza è in regalo.");
  assert.deepEqual(s.pacchetti, [
    { id: "coin100", coin: 100, euro: "10 €", sotto: "crediti", descrizione: "1 stanza e regali", piuScelto: false },
    { id: "coin200", coin: 200, euro: "20 €", sotto: "crediti", descrizione: "2 stanze, o 1 stanza e regali", piuScelto: false },
    { id: "coin500", coin: 500, euro: "45 €", sotto: "+50 in regalo", descrizione: null, piuScelto: true },
  ]);
  assert.deepEqual(OFFERTE.map((o) => [o.coin, o.euro, o.inPiu]), [[200, 20, 0], [500, 45, 50]]);
  assert.equal(s.scelto, "coin500");
});

test("13: i costi vengono dalle regole del server (stanza, caparra, regali)", () => {
  const s = schermataTuoiCoin(120);
  assert.equal(s.saldo, "Hai 120 crediti. La tua prima stanza è in regalo.");
  assert.deepEqual(s.costi, [
    { voce: "Una stanza al buio, 7 giorni", costo: `${COIN.stanzaAlBuio} crediti` },
    { voce: "Caparra dello svelamento", costo: `${SVELAMENTO.caparra} crediti` },
    { voce: "Regali in chiamata", costo: REGALI.map((r) => r.coin).join(" · ") },
  ]);
});

test("13: in beta «Paga» è sempre spento e c'è la nota di prova; «Più tardi» resta attivo", () => {
  const s = schermataTuoiCoin(0);
  assert.equal(s.paga.testo, "Paga 45 €");
  assert.equal(s.paga.attivo, false);
  assert.equal(s.piuTardi, "Più tardi");
  assert.equal(s.notaBeta, "Nella beta i crediti sono di prova: li trovi già nel tuo saldo. Non paghi niente.");
  assert.equal(schermataTuoiCoin(0, { scelto: "coin200" }).paga.testo, "Paga 20 €");
  assert.equal(schermataTuoiCoin(0, { scelto: "boh" }).scelto, "coin500");
});

test("13: saldo mancante o strano → nessun numero inventato", () => {
  for (const x of [null, undefined, -1, 1.5, "10"]) assert.equal(schermataTuoiCoin(x).saldo, T.primaStanza);
});

test("21: solo sotto il costo di una stanza, con cosa si può ancora fare", () => {
  assert.equal(SOGLIA_SALDO_BASSO, COIN.stanzaAlBuio);
  assert.equal(quasiFiniti(80), null);
  assert.equal(quasiFiniti(null), null);
  assert.equal(quasiFiniti(-3), null);
  assert.deepEqual(quasiFiniti(15), {
    etichetta: "I tuoi crediti", titolo: ["Ti restano", "15 crediti."],
    testo: "Bastano per qualche regalo, non per la prossima stanza (80 crediti\).",
    pacchetto: { id: "coin500", coin: 500, euro: "45 €", sotto: "+50 in regalo" },
    dopo: "Dopo", ricarica: "Ricarica", attivo: false,
  });
  // Caparra a 100 Coin (api/svelamento.js) sopra il costo della stanza: «Bastano per una caparra» non può comparire
  // (il design mostra 10 Coin: chiesto al CPO).
  assert.ok(SVELAMENTO.caparra >= COIN.stanzaAlBuio);
  assert.equal(quasiFiniti(4).testo, "Non bastano per la prossima stanza (80 crediti\) né per un regalo.");
  assert.deepEqual(quasiFiniti(1).titolo, ["Ti resta", "1 credito."]);
  assert.deepEqual(quasiFiniti(0).titolo, ["Hai finito", "i crediti."]);
});

test("saldo nella testata: legge dal server e aggiorna la pillola; errore → pillola invariata", async () => {
  const viste = [];
  const s = creaSaldo({ coin: { saldo: async () => ({ ok: true, saldo: 15 }) }, testata: (d) => viste.push(d) });
  assert.deepEqual(await s.aggiorna(), { ok: true, saldo: 15, quasiFiniti: true, primaStanzaUsata: false });
  const p = creaSaldo({ coin: { saldo: async () => ({ ok: true, saldo: 15, primaStanzaUsata: true }) }, testata: () => {} });
  assert.equal((await p.aggiorna()).primaStanzaUsata, true);
  assert.deepEqual(viste, [{ saldo: 15 }]);
  const e = creaSaldo({ coin: { saldo: async () => ({ ok: false, motivo: "rete" }) }, testata: (d) => viste.push(d) });
  assert.deepEqual(await e.aggiorna(), { ok: false, motivo: "rete" });
  const g = creaSaldo({ coin: { saldo: async () => { throw new Error("x"); } }, testata: (d) => viste.push(d) });
  assert.deepEqual(await g.aggiorna(), { ok: false, motivo: "rete" });
  assert.equal(viste.length, 1);
});

test("sicurezza: niente pagamenti, salvataggi locali o log nel modulo", () => {
  const src = readFileSync(new URL("../landing/app/moduli/saldo_coin.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /gomry\.|stripe|localStorage|sessionStorage|indexedDB|console\.|fetch\(/i);
});

// Commento di Giuseppe del 25/11 sulla pagina di confronto (regola_confronto_design_25_11): pacchetto base 10 € = 100
// crediti, cioè una stanza al buio (80) e 20 crediti per i regali. Stesso cambio di 1 € = 10 crediti degli altri.
test("13: pacchetto Base 100 crediti a 10 €: basta per una stanza e lascia 20 crediti di regali", () => {
  const s = schermataTuoiCoin(0, { scelto: "coin100" });
  const base = s.pacchetti[0];
  assert.equal(base.coin, 100);
  assert.equal(base.euro, "10 €");
  assert.ok(base.coin >= COIN.stanzaAlBuio);
  assert.equal(base.coin - COIN.stanzaAlBuio, 20);
  assert.equal(s.scelto, "coin100");
  assert.equal(s.paga.testo, "Paga 10 €");
  assert.equal(s.paga.attivo, false);
});
