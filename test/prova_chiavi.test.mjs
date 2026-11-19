// Prova finta dell'app (D141 A, linea «sviluppatore-c»), passo 3: chiavi e sera delle porte con il modulo vero
// (chiavi_stanza.js) e le regole del server (api/chiavi.js) rifatte nel «server finto» di prova.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaProva, PERSONE_PROVA } from "../landing/app/moduli/prova.js";
import { TESTI_CHIAVI } from "../api/chiavi.js";

const INIZIO = Date.parse("2026-11-19T18:00:00Z");
function prova() {
  let ora = INIZIO;
  const p = creaProva({ adesso: () => ora, attesaMs: 0 });
  const avanti = (s) => { ora += s * 1000; };
  const leggi = async () => p.telefono.aggiorna(await p.chiamata.stato());
  // Una chiamata di 90 secondi con la persona i (conta per le chiavi).
  const parla = async (i) => {
    await p.telefono.chiama(PERSONE_PROVA[i].id);
    avanti(5); await leggi(); avanti(90); await leggi();
    await p.telefono.chiudi(false); await new Promise((r) => setTimeout(r, 0)); p.telefono.torna();
  };
  return { p, parla };
}
const vuota = () => new Promise((r) => setTimeout(r, 0));

test("chiavi: solo a chi hai chiamato almeno 60 secondi, frase senza contatti, al massimo 2, si possono riprendere", async () => {
  const { p, parla } = prova();
  await p.telefono.caricaPersone();
  const [a, b, c] = [0, 1, 2].map((i) => PERSONE_PROVA[i].id);
  let r = await p.chiaviServer.dai(a, "");
  assert.deepEqual([r.ok, r.testo], [false, TESTI_CHIAVI.nonChiamato]);
  await parla(0); await parla(1); await parla(2);
  r = await p.chiaviServer.dai(a, "scrivimi a nome@esempio.it");
  assert.deepEqual([r.ok, r.testo], [false, TESTI_CHIAVI.contatti]);
  r = await p.chiaviServer.dai(a, "Mi hai fatto ridere.");
  assert.equal(r.ok, true);
  assert.equal(r.stato.restanti, 1);
  assert.deepEqual(r.stato.date, [{ a, frase: "Mi hai fatto ridere." }]);
  assert.equal((await p.chiaviServer.dai(b, "")).ok, true);
  r = await p.chiaviServer.dai(c, "");
  assert.deepEqual([r.ok, r.testo], [false, TESTI_CHIAVI.finite]);
  r = await p.chiaviServer.riprendi(b);
  assert.equal(r.stato.restanti, 1);
  r = await p.chiaviServer.cambiaFrase(a, "Una frase nuova.");
  assert.equal(r.stato.date[0].frase, "Una frase nuova.");
  const letto = await p.chiaviServer.leggi();
  assert.equal(letto.stato.stanza, true);
  assert.equal(letto.stato.chiuse, false);
  assert.equal(letto.stato.chiude_il, "2026-11-22T20:00:00.000Z"); // domenica 21:00 di Roma, chiusura della stanza
});

test("sera delle porte dal comando: chiavi chiuse, stanza chiusa, porta solo dove la chiave è reciproca", async () => {
  const { p, parla } = prova();
  await p.telefono.caricaPersone();
  p.regista.profiloPronto();
  await parla(0); await parla(3);
  await p.chiaviServer.dai(PERSONE_PROVA[0].id, ""); // Aurora ricambia nella prova
  await p.chiaviServer.dai(PERSONE_PROVA[3].id, ""); // Dario no
  assert.equal((await p.chiaviServer.sera()).stato, "prima");
  const prima = p.chiavi;
  assert.equal(p.regista.apriPorte(), true);
  assert.notEqual(p.chiavi, prima, "un modulo delle chiavi nuovo, che rilegge la sera");
  const sera = await p.chiaviServer.sera();
  assert.equal(sera.stato, "pronta");
  assert.equal(sera.porte.length, 1);
  assert.equal(sera.porte[0].con, PERSONE_PROVA[0].id);
  assert.equal(sera.porte[0].nome, PERSONE_PROVA[0].nome);
  assert.equal(typeof sera.porte[0].frase_per_te, "string");
  assert.equal((await p.chiaviServer.leggi()).stato.chiuse, true);
  assert.deepEqual([(await p.chiaviServer.dai(PERSONE_PROVA[0].id, "")).testo], [TESTI_CHIAVI.chiuse]);
  await p.chiavi.prepara(); await vuota();
  assert.equal(p.chiavi.modello().sera.tipo, "porte");
  await p.telefono.ricaricaPersone();
  assert.equal(p.telefono.modello().stanza.chiusa, true);
});

test("sera senza chiavi reciproche: «Stasera nessuna porta si è aperta»", async () => {
  const { p } = prova();
  assert.equal(p.regista.apriPorte(), false, "prima serve essere dentro l'app");
  p.regista.profiloPronto();
  p.regista.apriPorte();
  await p.chiavi.prepara(); await vuota();
  assert.equal(p.chiavi.modello().sera.tipo, "nessuna_porta");
});
