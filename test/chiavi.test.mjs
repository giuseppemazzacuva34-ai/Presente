// Chiavi e sera delle porte (issue #5, spec v1.1 del CPO, D14 A e D51 A), passo 1: solo calcoli. Dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chiaviChiuse, controllaFrase, puoDareChiave, puoRiprendere, seraDellePorte, annullaPerBlocco, TESTI_CHIAVI }
  from "../api/chiavi.js";
import { oraDiRoma } from "../api/stanze.js";

// Stanza del 9/11/2026: chiude domenica 15/11 alle 21:00 di Roma.
const CHIUDE = oraDiRoma(2026, 11, 15, 21);
const MERCOLEDI = oraDiRoma(2026, 11, 11, 18);
const stanza = { chiude: CHIUDE, membri: new Set(["a", "b", "c", "d"]) };
const durate = { "a|b": [300], "a|c": [900], "a|d": [45] }; // con d solo una chiamata caduta (< 60 s)
const durateTra = (x, y) => durate[[x, y].sort().join("|")] ?? [];

test("le chiavi si chiudono alle 20:59:00 di domenica, anche con il cambio d'ora", () => {
  assert.equal(chiaviChiuse(CHIUDE, oraDiRoma(2026, 11, 15, 20, 58)), false);
  assert.equal(chiaviChiuse(CHIUDE, oraDiRoma(2026, 11, 15, 20, 59)), true);
  assert.equal(chiaviChiuse(CHIUDE, CHIUDE), true);
  const ottobre = oraDiRoma(2026, 10, 25, 21); // domenica del ritorno all'ora solare
  assert.equal(ottobre.toISOString(), "2026-10-25T20:00:00.000Z");
  assert.equal(chiaviChiuse(ottobre, new Date("2026-10-25T19:58:59Z")), false);
  assert.equal(chiaviChiuse(ottobre, new Date("2026-10-25T19:59:00Z")), true);
});

test("frase facoltativa, massimo 140 caratteri, niente contatti", () => {
  assert.deepEqual(controllaFrase(""), { ok: true, frase: null });
  assert.deepEqual(controllaFrase("  Mi hai fatto ridere con la storia del gatto  "),
    { ok: true, frase: "Mi hai fatto ridere con la storia del gatto" });
  assert.equal(controllaFrase("x".repeat(141)).ok, false);
  for (const f of ["chiamami 333123456", "scrivimi a nome@posta.it", "http://sito", "vai su www.sito", "sono su sito.com",
    "cercami su Instagram", "il mio telegram è pippo", "ig: pippo", "3 3 3 1 2 3 4 5 6", "sito.it/pippo", "TikTok pippo"]) {
    const esito = controllaFrase(f);
    assert.equal(esito.ok, false, f);
    assert.equal(esito.testo, TESTI_CHIAVI.contatti, f);
  }
  assert.equal(controllaFrase("Ci vediamo alle 9 di sera?").ok, true); // un numero corto va bene
});

test("dare una chiave: solo a chi hai chiamato almeno 60 s, una per persona, al massimo 2", () => {
  const base = { chi: "a", adesso: MERCOLEDI, stanza, durateTra };
  assert.deepEqual(puoDareChiave({ ...base, a: "b", chiavi: [] }), { ok: true });
  assert.equal(puoDareChiave({ ...base, a: "d", chiavi: [] }).motivo, "non_chiamato");
  assert.equal(puoDareChiave({ ...base, a: "a", chiavi: [] }).motivo, "non_valida");
  assert.equal(puoDareChiave({ ...base, a: "z", chiavi: [] }).motivo, "non_nella_stanza");
  assert.equal(puoDareChiave({ ...base, a: "b", chiavi: [{ da: "a", a: "b" }] }).motivo, "gia_data");
  const due = [{ da: "a", a: "b" }, { da: "a", a: "c" }];
  durate["a|e"] = [120];
  stanza.membri.add("e");
  assert.equal(puoDareChiave({ ...base, a: "e", chiavi: due }).motivo, "finite");
  // Le chiavi date dagli altri non contano nelle mie.
  assert.deepEqual(puoDareChiave({ ...base, a: "e", chiavi: [{ da: "b", a: "a" }, { da: "c", a: "a" }] }), { ok: true });
});

test("dopo le 20:59 di domenica il server rifiuta dare e riprendere", () => {
  const tardi = oraDiRoma(2026, 11, 15, 20, 59);
  const esito = puoDareChiave({ chi: "a", a: "b", adesso: tardi, stanza, durateTra, chiavi: [] });
  assert.equal(esito.motivo, "chiuse");
  assert.equal(esito.testo, TESTI_CHIAVI.chiuse);
  assert.equal(puoRiprendere({ chi: "a", a: "b", adesso: tardi, stanza, chiavi: [{ da: "a", a: "b" }] }).motivo, "chiuse");
  assert.deepEqual(puoRiprendere({ chi: "a", a: "b", adesso: MERCOLEDI, stanza, chiavi: [{ da: "a", a: "b" }] }), { ok: true });
  assert.equal(puoRiprendere({ chi: "a", a: "c", adesso: MERCOLEDI, stanza, chiavi: [{ da: "a", a: "b" }] }).motivo, "non_data");
});

test("con un blocco non si dà la chiave e quelle tra i due spariscono in silenzio", () => {
  const blocchi = [["b", "a"]];
  assert.equal(puoDareChiave({ chi: "a", a: "b", adesso: MERCOLEDI, stanza, durateTra, chiavi: [], blocchi }).motivo, "non_nella_stanza");
  const chiavi = [{ da: "a", a: "b" }, { da: "b", a: "a" }, { da: "a", a: "c" }];
  assert.deepEqual(annullaPerBlocco(chiavi, "b", "a"), [{ da: "a", a: "c" }]);
});

test("domenica alle 21: 12 profili con chiavi incrociate, si aprono solo le porte reciproche", () => {
  const chiavi = [
    { da: "p1", a: "p2", frase: "ciao" }, { da: "p2", a: "p1", frase: null }, // porta
    { da: "p3", a: "p4" }, { da: "p4", a: "p5" }, // nessuna porta
    { da: "p5", a: "p6" }, { da: "p6", a: "p5" }, { da: "p6", a: "p7" }, { da: "p7", a: "p6" }, // p6: due porte
    { da: "p8", a: "p9" }, { da: "p10", a: "p11" }, { da: "p12", a: "p1" },
  ];
  const sera = seraDellePorte(chiavi, CHIUDE);
  assert.deepEqual(sera.porte.map((p) => [p.a, p.b]), [["p1", "p2"], ["p5", "p6"], ["p6", "p7"]]);
  assert.ok(sera.porte.every((p) => p.aperta.getTime() === CHIUDE.getTime()));
  assert.deepEqual(sera.porte[0].frasi, { p1: "ciao", p2: null });
  // Le chiavi non ricambiate e le loro frasi spariscono; resta solo il conteggio.
  assert.equal(sera.daCancellare.length, 5);
  assert.deepEqual(sera.conteggi, { chiaviDate: 11, porteAperte: 3 });
  assert.ok(!JSON.stringify(sera.porte).includes("p12"));
});

test("chi non ha porte vede lo stesso testo sia se ha dato chiavi sia se no", () => {
  const sera = seraDellePorte([{ da: "p3", a: "p4" }], CHIUDE);
  assert.equal(sera.testoPer("p3"), TESTI_CHIAVI.nessunaPorta);
  assert.equal(sera.testoPer("p9"), TESTI_CHIAVI.nessunaPorta);
  const conPorta = seraDellePorte([{ da: "p1", a: "p2" }, { da: "p2", a: "p1" }], CHIUDE);
  assert.equal(conPorta.testoPer("p1"), null); // testo con il nome: lo compone l'app
});
