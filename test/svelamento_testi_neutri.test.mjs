// Testi dello svelamento senza genere (segnalazione della prova finta D141, 21/11): chi usa l'app può essere uomo o
// donna, e anche l'altra persona. Nessun testo dello svelamento deve dare per scontato il maschile o il femminile
// («pronto/pronta», «arrivato/arrivata», «tutti e due»).
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_SVELAMENTO } from "../api/svelamento.js";
import { TESTI } from "../landing/app/moduli/svelamento.js";
import { TESTI_AVVISI } from "../landing/app/moduli/avvisi_porte.js";

const CON_GENERE = /\b(pront[oaie]|arrivat[oaie]|entrat[oaie]|tutti|tutte|sicur[oa]|stanc[oa])\b/i;

for (const [nome, testi] of Object.entries({ TESTI_SVELAMENTO, TESTI, TESTI_AVVISI })) {
  test(`${nome}: nessun testo al maschile o al femminile`, () => {
    for (const [chiave, valore] of Object.entries(testi)) {
      if (typeof valore !== "string") continue;
      assert.doesNotMatch(valore, CON_GENERE, `${nome}.${chiave} = «${valore}»`);
    }
  });
}

test("il pulsante «Quando?» è lo stesso nel server e nel telefono", () => {
  assert.equal(TESTI.prontoOra, TESTI_SVELAMENTO.prontoOra);
  assert.equal(TESTI.nonArrivato, TESTI_SVELAMENTO.nonArrivato);
});
