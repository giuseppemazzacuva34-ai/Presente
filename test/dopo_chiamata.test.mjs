// Dopo la chiamata (issue #4 spec v1.3 § 3, passo 3c-4a): cosa si mostra e cosa si salva. Solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { schermataDopo, TESTI_DOPO, RISPOSTE, leggiRisposta, notaSegreta } from "../api/dopo_chiamata.js";

test("chiamata ≥ 60 s chiusa per tempo o con «Chiudi»: La richiameresti?, poi diario, poi la fine", () => {
  for (const esito of ["tempo_scaduto", "chiusa"]) {
    for (const durata of [60, 61, 899, 900]) {
      const s = schermataDopo({ esito, durata });
      assert.equal(s.tipo, "richiameresti");
      assert.deepEqual(s.passi, ["richiameresti", "diario", "fine"]);
      assert.equal(s.segnala, true);
      assert.equal(s.testo, null);
    }
  }
});

test("chiamata < 60 s: niente domanda né diario, solo il testo breve con Segnala e Torna alla stanza", () => {
  for (const esito of ["tempo_scaduto", "chiusa", "caduta"]) {
    for (const durata of [0, 1, 59]) {
      const s = schermataDopo({ esito, durata });
      assert.equal(s.tipo, "breve");
      assert.deepEqual(s.passi, ["fine"]);
      assert.equal(s.testo, "La chiamata è durata poco e non conta nei limiti.");
      assert.equal(s.segnala, true);
    }
  }
});

test("caduta senza rientro ≥ 60 s: niente domanda né diario; il testo «durata poco» non si usa perché sarebbe falso", () => {
  const s = schermataDopo({ esito: "caduta", durata: 300 });
  assert.equal(s.tipo, "breve");
  assert.deepEqual(s.passi, ["fine"]);
  assert.equal(s.testo, null);
  assert.equal(s.segnala, true);
});

test("«Chiudi e segnala»: si apre subito il modulo #7 con la persona collegata, a qualunque durata", () => {
  for (const durata of [0, 30, 60, 900]) {
    const s = schermataDopo({ esito: "chiudi_e_segnala", durata });
    assert.equal(s.tipo, "segnala");
    assert.deepEqual(s.passi, ["segnala"]);
    assert.equal(s.origine, "chiudi_e_segnala");
  }
});

test("dati strani o mancanti: mai la domanda (nel dubbio solo Segnala e Torna alla stanza)", () => {
  for (const x of [{}, { esito: "registrata", durata: 600 }, { esito: "chiusa" }, { esito: "chiusa", durata: "600" },
    { esito: "chiusa", durata: 901 }, { esito: "chiusa", durata: -1 }, null, undefined]) {
    const s = schermataDopo(x);
    assert.notEqual(s.tipo, "richiameresti");
    assert.ok(s.segnala);
  }
});

test("testi della spec v1.3, esattamente", () => {
  assert.equal(TESTI_DOPO.domanda, "La richiameresti?");
  assert.deepEqual(TESTI_DOPO.risposte, { si: "Sì", no: "No", salta: "Salta" });
  assert.equal(TESTI_DOPO.segnala, "Segnala un problema");
  assert.equal(TESTI_DOPO.torna, "Torna alla stanza");
  assert.equal(notaSegreta("Leo"), "Resta tra te e Presente. Leo non lo saprà mai.");
  assert.equal(notaSegreta(""), "Resta tra te e Presente. L'altra persona non lo saprà mai.");
});

test("risposta: solo sì, no o salta, con chi ha chiamato e l'inizio della chiamata", () => {
  assert.deepEqual(RISPOSTE, ["si", "no", "salta"]);
  const chi = "3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a";
  const ok = leggiRisposta({ chi, inizio: "2026-11-13T19:00:00.000Z", risposta: "si" });
  assert.deepEqual(ok, { chi, inizio: "2026-11-13T19:00:00.000Z", risposta: "si" });
  assert.equal(leggiRisposta({ chi, inizio: "2026-11-13T19:00:00Z", risposta: "salta" }).inizio, "2026-11-13T19:00:00.000Z");
  for (const sbagliata of [null, "si", {}, { chi, inizio: "2026-11-13T19:00:00Z", risposta: "forse" },
    { chi: "non-un-id", inizio: "2026-11-13T19:00:00Z", risposta: "no" },
    { chi, inizio: "ieri", risposta: "no" },
    { chi, inizio: "2026-11-13T19:00:00Z", risposta: "no", nome: "Leo" }]) {
    assert.equal(leggiRisposta(sbagliata), null);
  }
});
