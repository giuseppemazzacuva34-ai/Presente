// Prova finta dell'app (D141 A, linea «sviluppatore-c»), passo 2: stanza di 12 persone finte e chiamate simulate.
// Si usa il «telefono» vero (telefono.js) con il centralino finto di prova.js: niente rete, niente microfono, niente audio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaProva, PERSONE_PROVA } from "../landing/app/moduli/prova.js";

const INIZIO = Date.parse("2026-11-19T18:00:00Z");
function prova() {
  let ora = INIZIO;
  const p = creaProva({ adesso: () => ora, attesaMs: 0 });
  const avanti = (s) => { ora += s * 1000; };
  const leggi = async () => p.telefono.aggiorna(await p.chiamata.stato());
  return { p, avanti, leggi, t: p.telefono };
}
const vuota = () => new Promise((r) => setTimeout(r, 0));

function senzaRete(fn) {
  return async () => {
    const vera = globalThis.fetch;
    globalThis.fetch = () => { throw new Error("la prova non deve mai chiamare la rete"); };
    try { await fn(); } finally { globalThis.fetch = vera; }
  };
}

test("stanza finta: 11 persone oltre a te, nomi inventati e dichiarati finti", senzaRete(async () => {
  assert.equal(PERSONE_PROVA.length, 11);
  const { t } = prova();
  await t.caricaPersone();
  const st = t.modello().stanza;
  assert.equal(st.stato, "pronta");
  assert.equal(st.chiusa, false);
  assert.equal(st.persone.length, 11);
  for (const p of st.persone) assert.match(p.sottotitolo, /finta/);
}));

test("chiamata in uscita: squilla, risponde dopo pochi secondi, timer di 15 minuti, carte dopo 10 secondi", senzaRete(async () => {
  const { t, avanti, leggi } = prova();
  await t.caricaPersone();
  const id = PERSONE_PROVA[0].id;
  await t.chiama(id);
  assert.equal(t.modello().schermo.tipo, "squillo_in_uscita");
  avanti(5); await leggi();
  let sc = t.modello().schermo;
  assert.equal(sc.tipo, "in_corso");
  assert.equal(sc.timer, "14:59");
  assert.equal(sc.carte, null, "le carte arrivano dopo 10 secondi");
  avanti(10); await leggi();
  sc = t.modello().schermo;
  assert.equal(sc.carte.attiva, true);
  await t.carta();
  sc = t.modello().schermo;
  assert.equal(sc.carta.da, "Pescata da te");
  assert.ok(sc.carta.testo.length > 5);
  assert.match(sc.carte.etichetta, /Carte · 20 s/);
}));

test("dopo una chiamata vera: «La richiameresti?», diario solo in memoria della prova, poi fine", senzaRete(async () => {
  const { p, t, avanti, leggi } = prova();
  await t.caricaPersone();
  await t.chiama(PERSONE_PROVA[1].id);
  avanti(5); await leggi();
  p.regista.ultimoMinuto(); await leggi();
  assert.equal(t.modello().schermo.avviso, "Ancora un minuto");
  await t.chiudi(false);
  await vuota();
  assert.equal(t.modello().schermo.tipo, "richiameresti");
  await t.richiameresti("si");
  assert.equal(t.modello().schermo.tipo, "diario");
  await t.salvaDiario("Bella risata.");
  assert.equal(t.modello().schermo.tipo, "dopo_fine");
  assert.deepEqual(p.regista.diario().map((n) => [n.con, n.testo]), [[PERSONE_PROVA[1].id, "Bella risata."]]);
  t.torna();
  assert.equal(t.modello().schermo.tipo, "nessuna");
}));

test("chiamata corta (meno di 60 s): niente domanda, solo il testo della spec", senzaRete(async () => {
  const { t, avanti, leggi } = prova();
  await t.caricaPersone();
  await t.chiama(PERSONE_PROVA[2].id);
  avanti(5); await leggi();
  avanti(20); await leggi();
  await t.chiudi(false);
  await vuota();
  const sc = t.modello().schermo;
  assert.equal(sc.tipo, "dopo_fine");
  assert.equal(sc.testo, "La chiamata è durata poco e non conta nei limiti.");
}));

test("finiti i 15 minuti la chiamata si chiude da sola", senzaRete(async () => {
  const { t, avanti, leggi } = prova();
  await t.caricaPersone();
  await t.chiama(PERSONE_PROVA[3].id);
  avanti(5); await leggi();
  avanti(901); await leggi();
  await vuota();
  assert.equal(t.modello().schermo.tipo, "richiameresti");
}));

test("chiamata in arrivo dal comando della prova: squilla, rispondi, in corso; «Chiudi e segnala» apre il modulo", senzaRete(async () => {
  const { p, t, leggi } = prova();
  await t.caricaPersone();
  p.regista.chiamaMe(); await leggi();
  assert.equal(t.modello().schermo.tipo, "squillo_in_arrivo");
  await t.rispondi();
  assert.equal(t.modello().schermo.tipo, "in_corso");
  await t.chiudi(true);
  assert.equal(t.modello().schermo.tipo, "segnala");
}));

test("rifiuta: lo squillo sparisce", senzaRete(async () => {
  const { p, t, leggi } = prova();
  await t.caricaPersone();
  p.regista.chiamaMe(); await leggi();
  await t.rifiuta();
  assert.equal(t.modello().schermo.tipo, "nessuna");
}));

test("tre chiamate vere con la stessa persona: il pulsante dice che tocca alle chiavi", senzaRete(async () => {
  const { t, avanti, leggi } = prova();
  await t.caricaPersone();
  const id = PERSONE_PROVA[4].id;
  for (let i = 0; i < 3; i += 1) {
    await t.chiama(id);
    avanti(5); await leggi();
    avanti(90); await leggi();
    await t.chiudi(false); await vuota();
    t.torna(); await vuota();
  }
  const scheda = t.modello().stanza.persone.find((x) => x.id === id);
  assert.equal(scheda.etichetta, "Avete già parlato 3 volte. Ora tocca alle chiavi");
  assert.equal(scheda.chiama, false);
}));
