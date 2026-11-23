// Prova finta dell'app (D141 A, linea «sviluppatore-c»), passo 4: porta aperta e svelamento (caparra, scelta, quando,
// sala d'attesa) con i moduli veri del CTO (svelamento.js, avvisi_porte.js) e il «server finto» di prova.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaProva, PERSONE_PROVA } from "../landing/app/moduli/prova.js";
import { schermataPorta } from "../landing/app/moduli/svelamento.js";

const INIZIO = Date.parse("2026-11-19T18:00:00Z");
async function conPorta() {
  let ora = INIZIO;
  const p = creaProva({ adesso: () => ora, attesaMs: 0 });
  const leggi = async () => p.telefono.aggiorna(await p.chiamata.stato());
  p.regista.profiloPronto();
  await p.telefono.caricaPersone();
  await p.telefono.chiama(PERSONE_PROVA[0].id); // Aurora ricambia la chiave nella prova
  ora += 5000; await leggi(); ora += 90000; await leggi();
  await p.telefono.chiudi(false); await new Promise((r) => setTimeout(r, 0)); p.telefono.torna();
  await p.chiaviServer.dai(PERSONE_PROVA[0].id, "");
  p.regista.apriPorte();
  const sera = await p.chiaviServer.sera();
  return { p, porta: sera.porte[0].id, adesso: () => new Date(ora), avanti: (s) => { ora += s * 1000; } };
}

test("prima della sera nessuna porta, Coin di prova 200 (spec #331 A.4)", async () => {
  const p = creaProva({ attesaMs: 0 });
  const r = await p.svelamentoServer.leggi();
  assert.deepEqual(r, { ok: true, stato: { saldo: 200, porte: [] } });
});

test("porta aperta: 48 ore, caparra di 100 Coin, la persona finta blocca anche lei", async () => {
  const { p, porta, adesso } = await conPorta();
  let s = schermataPorta((await p.svelamentoServer.leggi()).stato, porta, adesso());
  assert.equal(s.tipo, "porta");
  assert.equal(s.chi, "Aurora, 31");
  assert.equal(s.conto, "Mancano 48 ore e 0 minuti per lo svelamento.");
  assert.equal(s.caparra.tipo, "blocca");
  const r = await p.svelamentoServer.blocca(porta);
  assert.equal(r.ok, true);
  s = schermataPorta(r.stato, porta, adesso());
  assert.equal(s.saldo, "I tuoi crediti: 100");
  assert.equal(s.caparra.tipo, "entrambe");
  assert.equal(s.scelta.attuale, "video");
  assert.ok(s.quando.opzioni.length > 0);
  assert.equal((await p.svelamentoServer.blocca(porta)).stato.saldo, 100, "una caparra sola per porta");
});

test("scelta, «Ci sono adesso» e orari: il momento arriva subito, con il tipo scelto", async () => {
  const { p, porta, adesso } = await conPorta();
  await p.svelamentoServer.blocca(porta);
  let r = await p.svelamentoServer.scegli(porta, "foto");
  assert.equal(schermataPorta(r.stato, porta, adesso()).scelta.attuale, "foto");
  const opzioni = schermataPorta(r.stato, porta, adesso()).quando.opzioni;
  r = await p.svelamentoServer.fasce(porta, [opzioni[2].valore, opzioni[3].valore]);
  assert.match(schermataPorta(r.stato, porta, adesso()).quando.fissata, /^Lo svelamento è fissato: /);
  r = await p.svelamentoServer.pronto(porta);
  const s = schermataPorta(r.stato, porta, adesso());
  assert.equal(s.quando.entrambi, "Potete entrare adesso.");
  assert.equal(s.momento, true);
  assert.equal(s.tipoSvelamento, "foto");
});

test("porta senza caparra dopo 48 ore: scaduta", async () => {
  const { p, porta, adesso, avanti } = await conPorta();
  avanti(48 * 3600 + 1);
  assert.equal(schermataPorta((await p.svelamentoServer.leggi()).stato, porta, adesso()).tipo, "scaduta");
});

test("i moduli veri: la schermata della porta si apre e gli avvisi leggono lo stesso server finto", async () => {
  const { p, porta } = await conPorta();
  await p.porta.apri(porta);
  assert.equal(p.porta.modello().aperta, true);
  assert.equal(p.porta.modello().schermata.tipo, "porta");
  assert.equal(typeof p.avvisiPorte.avvia, "function");
});
