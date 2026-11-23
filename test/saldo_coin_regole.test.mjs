// Coin e saldo del design v4 (issue #349, spec #331 v1.1 del CPO punto 5), passo 4 della linea «sviluppatore-b»:
// quando può comparire il foglio «Coin quasi finiti» (schermata 21). Saldo sotto 80 letto dal server, una volta per
// sessione, solo nella home o all'ingresso nella stanza, mai in chiamata, nello svelamento o nella sera delle porte,
// mai a chi non ha ancora usato la prima stanza in regalo. Dati finti, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { avvisoPermesso, collegaSaldo, quasiFiniti, TESTI_SALDO } from "../landing/app/moduli/saldo_coin.js";

const base = { primaStanzaUsata: true, momento: "home" };

test("saldo 79, 1 e 0: permesso; saldo 80: no", () => {
  assert.equal(avvisoPermesso({ ...base, saldo: 79 }), true);
  assert.equal(avvisoPermesso({ ...base, saldo: 1 }), true);
  assert.equal(avvisoPermesso({ ...base, saldo: 0 }), true);
  assert.equal(avvisoPermesso({ ...base, saldo: 80 }), false);
});

test("saldo mancante o non valido: mai un avviso", () => {
  for (const saldo of [undefined, null, -1, 1.5, "10"]) assert.equal(avvisoPermesso({ ...base, saldo }), false);
});

test("solo nella home o nella stanza; mai in chiamata, svelamento o sera delle porte", () => {
  assert.equal(avvisoPermesso({ ...base, saldo: 15, momento: "stanza" }), true);
  for (const momento of ["chiamata", "svelamento", "porte", undefined, "altro"]) {
    assert.equal(avvisoPermesso({ ...base, saldo: 15, momento }), false, String(momento));
  }
});

test("chi non ha ancora usato la prima stanza in regalo non lo vede (anche se il dato manca)", () => {
  assert.equal(avvisoPermesso({ ...base, saldo: 15, primaStanzaUsata: false }), false);
  assert.equal(avvisoPermesso({ ...base, saldo: 15, primaStanzaUsata: undefined }), false);
});

test("testi approvati del CPO per 15, 1 e 0 Coin; nessuna frase sulla caparra (non basta mai sotto 80)", () => {
  assert.equal(quasiFiniti(15).testo, "Bastano per qualche regalo, non per la prossima stanza (80 crediti\).");
  assert.deepEqual(quasiFiniti(1).titolo, ["Ti resta", "1 credito."]);
  assert.deepEqual(quasiFiniti(0).titolo, ["Hai finito", "i crediti."]);
  assert.equal(quasiFiniti(0).testo, "Non bastano per la prossima stanza (80 crediti\) né per un regalo.");
  assert.equal(Object.hasOwn(TESTI_SALDO, "bastanoCaparra"), false);
});

function paginaFinta() {
  const ascolti = {};
  return { visibilityState: "visible", addEventListener(n, f) { (ascolti[n] ||= []).push(f); }, lancia(n) { (ascolti[n] || []).forEach((f) => f()); } };
}
const attesa = () => new Promise((r) => setImmediate(r));
const saldoFinto = (primaStanzaUsata = true) => ({ async aggiorna() { return { ok: true, saldo: 15, quasiFiniti: true, primaStanzaUsata }; } });

test("in chiamata non compare e non si consuma: compare al primo ritorno nella home", async () => {
  const visti = [];
  let momento = "chiamata";
  const pagina = paginaFinta();
  await collegaSaldo({ saldo: saldoFinto(), pagina, avviso: (n) => visti.push(n), momento: () => momento });
  assert.deepEqual(visti, []);
  momento = "home";
  pagina.lancia("visibilitychange");
  await attesa();
  pagina.lancia("visibilitychange");
  await attesa();
  assert.deepEqual(visti, [15]);
});

test("senza la prima stanza usata non compare", async () => {
  const visti = [];
  await collegaSaldo({ saldo: saldoFinto(false), pagina: paginaFinta(), avviso: (n) => visti.push(n) });
  assert.deepEqual(visti, []);
});

test("un errore nel leggere il momento vale come «non adesso»", async () => {
  const visti = [];
  await collegaSaldo({ saldo: saldoFinto(), pagina: paginaFinta(), avviso: (n) => visti.push(n), momento: () => { throw new Error("x"); } });
  assert.deepEqual(visti, []);
});
