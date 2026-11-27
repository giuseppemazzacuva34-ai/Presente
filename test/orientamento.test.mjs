// Issue #471 (spec v1 del CPO, parte A): orientamento facoltativo nella schermata 05 «Chi sei».
// D155 = A: l'etichetta non si salva mai: serve solo a precompilare «Cerco» nella 06.
import test from "node:test";
import assert from "node:assert/strict";
import { ORIENTAMENTI, TESTI_ORIENTAMENTO, toccaOrientamento, cercoDaOrientamento, toccaCerco, VOGLIO_INCONTRARE } from "../landing/app/moduli/orientamento.js";
import { readFileSync } from "node:fs";

test("le scelte della spec, nell'ordine", () => {
  assert.deepEqual(ORIENTAMENTI.map(([, t]) => t),
    ["Eterosessuale", "Gay", "Lesbica", "Bisessuale", "Pansessuale", "Queer", "Preferisco descrivermi", "Preferisco non dirlo"]);
  assert.equal(TESTI_ORIENTAMENTO.etichetta, "Il mio orientamento · facoltativo");
  assert.equal(TESTI_ORIENTAMENTO.nota, "Nessuno lo vede. Ci aiuta a proporti la stanza giusta.");
});

test("più scelte insieme; un secondo tocco toglie la scelta", () => {
  let s = toccaOrientamento([], "gay");
  s = toccaOrientamento(s, "queer");
  assert.deepEqual(s, ["gay", "queer"]);
  assert.deepEqual(toccaOrientamento(s, "gay"), ["queer"]);
});

test("«Preferisco non dirlo» toglie le altre e viceversa", () => {
  assert.deepEqual(toccaOrientamento(["gay", "queer"], "non_dirlo"), ["non_dirlo"]);
  assert.deepEqual(toccaOrientamento(["non_dirlo"], "bisessuale"), ["bisessuale"]);
  assert.deepEqual(toccaOrientamento(["gay"], "inventato"), ["gay"]);
});

test("precompilazione di «Cerco» (tabella della spec, con i valori di oggi)", () => {
  assert.deepEqual(cercoDaOrientamento("uomo", ["etero"]), ["donne"]);
  assert.deepEqual(cercoDaOrientamento("donna", ["etero"]), ["uomini"]);
  assert.deepEqual(cercoDaOrientamento("uomo", ["gay"]), ["uomini"]);
  assert.deepEqual(cercoDaOrientamento("donna", ["lesbica"]), ["donne"]);
  for (const o of ["bisessuale", "pansessuale", "queer"]) {
    for (const p of ["uomo", "donna", "non_binario", "mi_descrivo"]) assert.deepEqual(cercoDaOrientamento(p, [o]), ["donne", "uomini", "non_binari"]);
  }
  assert.deepEqual(cercoDaOrientamento("uomo", ["gay", "bisessuale"]), ["donne", "uomini", "non_binari"]);
  assert.deepEqual(cercoDaOrientamento("uomo", ["lesbica"]), []);
  assert.deepEqual(cercoDaOrientamento("non_binario", ["etero"]), []);
  assert.deepEqual(cercoDaOrientamento("uomo", ["non_dirlo"]), []);
  assert.deepEqual(cercoDaOrientamento("uomo", ["descrivo"]), []);
  assert.deepEqual(cercoDaOrientamento("uomo", []), []);
  assert.deepEqual(cercoDaOrientamento("uomo", ["etero", "gay"]), []);
});

test("D155 = A: l'orientamento non si salva: mai nel profilo mandato al database", () => {
  const salvataggio = readFileSync(new URL("../landing/app/moduli/salvataggio.js", import.meta.url), "utf8");
  assert.doesNotMatch(salvataggio, /orientamento/i); // né profiloDaStato né filtriDaStato lo leggono
});

test("parte B: «Voglio incontrare» a più scelte nella 06, «Tutti» sparisce, errore se vuoto", () => {
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.match(flusso, /"Voglio incontrare"/);
  assert.match(flusso, /scelte\("cerco", VOGLIO_INCONTRARE/);
  assert.deepEqual(VOGLIO_INCONTRARE.map(([, t]) => t), ["Donne", "Uomini", "Persone non binarie"]);
  assert.doesNotMatch(flusso, /\["tutti", "Tutti"\]/);
  assert.match(flusso, /Scegli almeno un'opzione\./);
  assert.match(flusso, /scelte\("cerco",[^\n]*multipla: true/);
});

test("parte B: tocco su «Voglio incontrare» aggiunge o toglie la scelta", () => {
  assert.deepEqual(toccaCerco([], "donne"), ["donne"]);
  assert.deepEqual(toccaCerco(["donne"], "uomini"), ["donne", "uomini"]);
  assert.deepEqual(toccaCerco(["donne", "uomini"], "donne"), ["uomini"]);
  assert.deepEqual(toccaCerco(["donne"], "tutti"), ["donne"], "valori sconosciuti ignorati");
});

test("parte B: il nuovo modulo è nella copia offline della web app", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /"\/app\/moduli\/voglio_incontrare\.js"/);
});
