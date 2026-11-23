// Coin e regali nelle stanze (issue #331, spec v1 del CPO del 21/11; D145 A). Passo 1 della linea «sviluppatore-c»:
// solo regole, nessuna lettura o scrittura. Dati finti.
import { test } from "node:test";
import assert from "node:assert/strict";
import { COIN, REGALI, coin, regaloPermesso, conferma, fatto, avvisoRegalo, foglioRegali, TESTI_COIN } from "../api/coin.js";

const CHIUSURA = new Date("2026-11-22T20:00:00.000Z"); // domenica 22 novembre, 21:00 di Roma
const PRIMA = new Date("2026-11-22T19:30:00.000Z");
const base = () => ({
  regalo: "rosa",
  saldo: 200,
  chiusuraStanza: CHIUSURA,
  adesso: PRIMA,
  stessaStanza: true,
  compatibili: true,
  bloccati: false,
  segnalati: false,
  sospeso: false,
  oggiAllaPersona: 0,
  oggiInTutto: 0,
});

test("valori decisi: 1 € = 10 crediti, Al buio 80, rosa 5, spumante 10, fiori 20 (D145 A)", () => {
  assert.equal(COIN.perEuro, 10);
  assert.equal(COIN.stanzaAlBuio, 80);
  assert.deepEqual(REGALI.map((r) => [r.id, r.coin]), [["rosa", 5], ["spumante", 10], ["fiori", 20]]);
  assert.deepEqual(REGALI.map((r) => r.nome), ["Rosa", "Bicchiere di spumante", "Mazzo di fiori"]);
  assert.equal(COIN.regaliAllaPersonaAlGiorno, 3);
  assert.equal(COIN.regaliAlGiorno, 10);
  assert.ok(Object.isFrozen(REGALI) && REGALI.every(Object.isFrozen));
});

test("singolare e plurale: «1 credito», «80 crediti»", () => {
  assert.equal(coin(1), "1 credito");
  assert.equal(coin(80), "80 crediti");
  assert.equal(coin(0), "0 crediti");
});

test("regalo permesso: costo scalato a chi manda, 0 crediti a chi riceve", () => {
  for (const [id, costo] of [["rosa", 5], ["spumante", 10], ["fiori", 20]]) {
    assert.deepEqual(regaloPermesso({ ...base(), regalo: id }), { ok: true, costo, aChiRiceve: 0 });
  }
});

test("rifiuti con il testo della spec e Coin non scalati", () => {
  const nonPuoi = "Non puoi mandare regali a questa persona.";
  const casi = [
    [{ adesso: CHIUSURA }, "stanza_chiusa", "La stanza è chiusa."],
    [{ adesso: new Date(CHIUSURA.getTime() + 3600e3) }, "stanza_chiusa", "La stanza è chiusa."],
    [{ stessaStanza: false }, "non_nella_stanza", nonPuoi],
    [{ compatibili: false }, "non_compatibile", nonPuoi],
    [{ bloccati: true }, "blocco", nonPuoi],
    [{ segnalati: true }, "segnalazione", nonPuoi],
    [{ sospeso: true }, "sospensione", nonPuoi],
    [{ saldo: 4 }, "saldo", "Ti manca 1 credito"],
    [{ saldo: 0, regalo: "fiori" }, "saldo", "Ti mancano 20 crediti"],
  ];
  for (const [cambio, motivo, testo] of casi) {
    const r = regaloPermesso({ ...base(), ...cambio });
    assert.equal(r.ok, false, motivo);
    assert.equal(r.motivo, motivo);
    assert.equal(r.testo, testo);
    assert.equal(r.costo, undefined);
  }
});

test("limiti: al massimo 3 al giorno alla stessa persona e 10 in tutto", () => {
  assert.equal(regaloPermesso({ ...base(), oggiAllaPersona: 2 }).ok, true);
  assert.equal(regaloPermesso({ ...base(), oggiAllaPersona: 3 }).motivo, "limite_persona");
  assert.equal(regaloPermesso({ ...base(), oggiInTutto: 9 }).ok, true);
  assert.equal(regaloPermesso({ ...base(), oggiInTutto: 10 }).motivo, "limite_giorno");
});

test("dati mancanti o regalo sconosciuto: sempre rifiuto, mai un regalo per sbaglio", () => {
  assert.equal(regaloPermesso({ ...base(), regalo: "diamante" }).motivo, "regalo_sconosciuto");
  assert.equal(regaloPermesso({}).ok, false);
  assert.equal(regaloPermesso({ ...base(), saldo: "200" }).ok, false);
  assert.equal(regaloPermesso({ ...base(), bloccati: undefined }).ok, false);
  assert.equal(regaloPermesso({ ...base(), adesso: undefined }).ok, false);
  assert.equal(regaloPermesso({ ...base(), oggiInTutto: -1 }).ok, false);
});

test("testi della spec: conferma, fatto, avviso a chi riceve", () => {
  assert.equal(conferma("rosa", "Giulia"), "Mandi una rosa a Giulia? Costa 5 crediti.");
  assert.equal(conferma("spumante", "Marco"), "Mandi un bicchiere di spumante a Marco? Costa 10 crediti.");
  assert.equal(conferma("fiori", "Sara"), "Mandi un mazzo di fiori a Sara? Costa 20 crediti.");
  assert.equal(fatto("rosa", "Giulia"), "Rosa mandata a Giulia.");
  assert.equal(fatto("spumante", "Marco"), "Bicchiere di spumante mandato a Marco.");
  assert.equal(fatto("fiori", "Sara"), "Mazzo di fiori mandato a Sara.");
  assert.equal(avvisoRegalo("rosa", "Luca"), "Luca ti ha mandato una rosa.");
  assert.equal(avvisoRegalo("fiori", "Luca"), "Luca ti ha mandato un mazzo di fiori.");
  assert.equal(TESTI_COIN.manda, "Manda un regalo");
  assert.equal(TESTI_COIN.conferma, "Manda");
  assert.equal(TESTI_COIN.annulla, "Annulla");
});

test("foglio dei regali: nome e prezzo come testo, saldo sotto, «Ti mancano» se non basta", () => {
  assert.deepEqual(foglioRegali(12), {
    regali: [
      { id: "rosa", etichetta: "Rosa · 5 crediti", attivo: true, mancano: null },
      { id: "spumante", etichetta: "Bicchiere di spumante · 10 crediti", attivo: true, mancano: null },
      { id: "fiori", etichetta: "Mazzo di fiori · 20 crediti", attivo: false, mancano: "Ti mancano 8 crediti" },
    ],
    saldo: "Hai 12 crediti",
  });
  assert.equal(foglioRegali(-3).saldo, "Hai 0 crediti");
});
