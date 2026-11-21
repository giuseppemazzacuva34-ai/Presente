// Regole della valutazione dopo l'incontro (issue #6, spec v1 del CPO del 3/11, D20 A). Dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { VALUTAZIONE, controllaRisposte } from "../api/valutazione.js";

test("tre domande sui fatti, nell'ordine della spec, più una privata", () => {
  assert.deepEqual(VALUTAZIONE.domande.map((d) => d.id), ["presentato", "foto_sue", "come_in_chiamata"]);
  assert.deepEqual(VALUTAZIONE.domande[0].risposte, ["si", "in_ritardo", "no"]);
  assert.deepEqual(VALUTAZIONE.domande[1].risposte, ["si", "non_sicuro", "no"]);
  assert.deepEqual(VALUTAZIONE.domande[2].risposte, ["si", "piu_o_meno", "no"]);
  assert.equal(VALUTAZIONE.bolliniDopo, 3);
});

test("risposte valide passano, con la sicurezza come vero/falso", () => {
  assert.deepEqual(controllaRisposte({ presentato: "si", foto_sue: "no", come_in_chiamata: "piu_o_meno", sicuro: false }),
    { ok: true, risposte: { presentato: "si", foto_sue: "no", come_in_chiamata: "piu_o_meno", sicuro: false } });
});

test("manca una risposta o è fuori lista → rifiutate", () => {
  assert.equal(controllaRisposte({ presentato: "si", foto_sue: "si", sicuro: true }).ok, false);
  assert.equal(controllaRisposte({ presentato: "forse", foto_sue: "si", come_in_chiamata: "si", sicuro: true }).ok, false);
  assert.equal(controllaRisposte({ presentato: "si", foto_sue: "si", come_in_chiamata: "si", sicuro: "si" }).ok, false);
  assert.equal(controllaRisposte(null).ok, false);
});

test("campi in più (es. un voto) non passano mai al database", () => {
  const r = controllaRisposte({ presentato: "si", foto_sue: "si", come_in_chiamata: "si", sicuro: true, voto: 5 });
  assert.equal(r.ok, true);
  assert.equal("voto" in r.risposte, false);
});
