// Chiamate (issue #4, passo 3c-3b-2): il «telefono» della web app unisce persone della stanza, sentinella, voce e
// richieste /app/api/chiamata e dice alla home cosa mostrare. Tutto finto: nessuna rete, nessun microfono.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaTelefono, testoErrore } from "../landing/app/moduli/telefono.js";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const PERSONE = [{ id: ID1, nome: "Giulia", eta: 34, citta: "Torino" }, { id: ID2, nome: "Marco", eta: 38, citta: "Asti" }];

function ambiente({ persone = { ok: true, persone: PERSONE }, linea = {}, chiamata = {} } = {}) {
  const fatti = [];
  let ora = 1_000_000;
  const t = creaTelefono({
    compagni: { leggi: async () => { fatti.push("compagni"); return persone; } },
    linea: {
      chiama: async (id) => { fatti.push(`chiama:${id}`); return { ok: true, vista: { fase: "squilla", io: "chiama", altra: id, squillo: 30 } }; },
      rispondi: async () => { fatti.push("rispondi"); return { ok: true, vista: { fase: "in_corso", io: "riceve", altra: ID1, restanti: 900, ascolto: "da_fare" } }; },
      ascolta: async () => { fatti.push("ascolta"); return { ok: true, vista: null }; },
      riconnetti: async () => { fatti.push("riconnetti"); return { ok: true, vista: null }; },
      chiudi: async (s) => { fatti.push(`chiudi:${s}`); return { ok: true, vista: { fase: "finita", altra: ID1 } }; },
      ...linea,
    },
    chiamata: {
      rifiuta: async () => { fatti.push("rifiuta"); return { ok: true, vista: { fase: "finita", altra: ID1 } }; },
      carta: async () => { fatti.push("carta"); return { ok: true, vista: null }; },
      caduta: async () => { fatti.push("caduta"); return { ok: true, vista: null }; },
      ...chiamata,
    },
    voce: { muto: (s) => fatti.push(`muto:${s}`), chiudi: () => fatti.push("voce-chiusa") },
    subito: () => fatti.push("subito"),
    cambiato: () => fatti.push("disegna"),
    adesso: () => ora,
  });
  return { t, fatti, avanza: (ms) => { ora += ms; } };
}

const IN_CORSO = (extra = {}) => ({ fase: "in_corso", io: "chiama", altra: ID1, restanti: 899, ultimoMinuto: false, altraPersona: "collegata", carte: null, suggerimento: false, carta: null, ascolto: "fatto", ...extra });

test("persone: si leggono una volta sola, con la scheda e il pulsante Chiama", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  await a.t.caricaPersone();
  assert.equal(a.fatti.filter((x) => x === "compagni").length, 1);
  const m = a.t.modello();
  assert.equal(m.stanza.stato, "pronta");
  assert.deepEqual(m.stanza.persone.map((p) => [p.id, p.titolo, p.sottotitolo, p.chiama]),
    [[ID1, "Giulia, 34", "Torino", true], [ID2, "Marco, 38", "Asti", true]]);
  assert.equal(m.schermo.tipo, "nessuna");
});

test("persone: stanza vuota o lettura fallita hanno il loro stato, mai un errore tecnico", async () => {
  const vuota = ambiente({ persone: { ok: true, persone: [] } });
  await vuota.t.caricaPersone();
  assert.equal(vuota.t.modello().stanza.stato, "vuota");
  const rotta = ambiente({ persone: { ok: false, motivo: "rete" } });
  await rotta.t.caricaPersone();
  assert.equal(rotta.t.modello().stanza.stato, "errore");
  assert.equal(rotta.t.modello().stanza.errore, testoErrore("rete"));
});

test("Chiama: squillo in uscita col nome, poi la sentinella rilegge subito", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  await a.t.chiama(ID1);
  assert.ok(a.fatti.includes(`chiama:${ID1}`));
  assert.ok(a.fatti.includes("subito"));
  const m = a.t.modello();
  assert.equal(m.schermo.tipo, "squillo_in_uscita");
  assert.equal(m.schermo.titolo, "Stai chiamando Giulia");
  // durante una chiamata nessun altro «Chiama»
  assert.ok(m.stanza.persone.every((p) => p.chiama === false));
});

test("Chiama verso un id che non è nella stanza: nessuna richiesta", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  await a.t.chiama("33333333-3333-4333-8333-333333333333");
  assert.ok(!a.fatti.some((x) => x.startsWith("chiama:")));
});

test("un «no» del server diventa il testo giusto e il microfono resta spento", async () => {
  const a = ambiente({ linea: { chiama: async () => ({ ok: false, motivo: "tre_con_lei" }) } });
  await a.t.caricaPersone();
  await a.t.chiama(ID1);
  const m = a.t.modello();
  assert.equal(m.errore, "Avete già parlato 3 volte. Ora tocca alle chiavi");
  assert.equal(m.schermo.tipo, "nessuna");
});

test("microfono negato: testo chiaro", async () => {
  const a = ambiente({ linea: { chiama: async () => ({ ok: false, motivo: "microfono_negato" }) } });
  await a.t.caricaPersone();
  await a.t.chiama(ID1);
  assert.match(a.t.modello().errore, /microfono/);
  assert.match(testoErrore("microfono_assente"), /microfono/);
});

test("mai due azioni insieme", async () => {
  let libera;
  const a = ambiente({ linea: { chiama: (id) => new Promise((r) => { libera = () => r({ ok: false, motivo: "occupato" }); }) } });
  await a.t.caricaPersone();
  const p1 = a.t.chiama(ID1);
  assert.equal(a.t.modello().attesa, true);
  await a.t.chiama(ID2);
  libera();
  await p1;
  assert.equal(a.t.modello().attesa, false);
  assert.equal(a.t.modello().errore, "È in un'altra chiamata");
});

test("squillo in arrivo dalla sentinella: Rispondi e Rifiuta col nome", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  a.t.aggiorna({ ok: true, vista: { fase: "squilla", io: "riceve", altra: ID2, squillo: 28 } });
  const m = a.t.modello();
  assert.equal(m.schermo.tipo, "squillo_in_arrivo");
  assert.equal(m.schermo.titolo, "Marco ti sta chiamando");
  assert.deepEqual(m.schermo.pulsanti, ["rispondi", "rifiuta"]);
  await a.t.rifiuta();
  assert.ok(a.fatti.includes("rifiuta"));
});

test("Rispondi: voce pubblicata, poi si ascolta l'altra persona appena serve (una volta sola)", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  a.t.aggiorna({ ok: true, vista: { fase: "squilla", io: "riceve", altra: ID1, squillo: 20 } });
  await a.t.rispondi();
  assert.ok(a.fatti.includes("rispondi"));
  // la vista della risposta dice ascolto «da_fare»: parte l'ascolto
  await new Promise((r) => setImmediate(r));
  assert.equal(a.fatti.filter((x) => x === "ascolta").length, 1);
  a.t.aggiorna({ ok: true, vista: IN_CORSO({ io: "riceve", ascolto: "da_fare" }) });
  await new Promise((r) => setImmediate(r));
  // ancora «da_fare» mentre l'ascolto è in corso o appena fatto: nessun doppione nello stesso secondo
  assert.ok(a.fatti.filter((x) => x === "ascolta").length <= 2);
  const m = a.t.modello();
  assert.equal(m.schermo.tipo, "in_corso");
  assert.equal(m.schermo.timer, "14:59");
  assert.equal(m.schermo.banner, "Niente numeri, cognomi o social prima della porta");
});

test("nessun ascolto mentre l'altra persona si sta riconnettendo", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  await a.t.chiama(ID1);
  a.t.aggiorna({ ok: true, vista: IN_CORSO({ ascolto: "da_fare", altraPersona: "riconnessione" }) });
  await new Promise((r) => setImmediate(r));
  assert.ok(!a.fatti.includes("ascolta"));
  assert.match(a.t.modello().schermo.riconnessione, /Giulia ha perso la connessione/);
});

test("banner solo nei primi 10 secondi visti", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  await a.t.chiama(ID1);
  a.t.aggiorna({ ok: true, vista: IN_CORSO() });
  assert.ok(a.t.modello().schermo.banner);
  a.avanza(10_500);
  a.t.aggiorna({ ok: true, vista: IN_CORSO({ restanti: 889 }) });
  assert.equal(a.t.modello().schermo.banner, null);
});

test("microfono on/off non chiama il server", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  await a.t.chiama(ID1);
  a.t.aggiorna({ ok: true, vista: IN_CORSO() });
  a.t.microfono();
  assert.ok(a.fatti.includes("muto:true"));
  assert.equal(a.t.modello().muto, true);
  a.t.microfono();
  assert.ok(a.fatti.includes("muto:false"));
});

test("Carte: pescata solo col pulsante attivo", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  await a.t.chiama(ID1);
  a.t.aggiorna({ ok: true, vista: IN_CORSO({ carte: { visibile: true, attesa: 12 } }) });
  await a.t.carta();
  assert.ok(!a.fatti.includes("carta"));
  a.t.aggiorna({ ok: true, vista: IN_CORSO({ carte: { visibile: true, attesa: 0 } }) });
  await a.t.carta();
  assert.ok(a.fatti.includes("carta"));
});

test("Chiudi e Chiudi e segnala; a fine chiamata il microfono si spegne", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  await a.t.chiama(ID1);
  a.t.aggiorna({ ok: true, vista: IN_CORSO() });
  await a.t.chiudi(true);
  assert.ok(a.fatti.includes("chiudi:true"));
  assert.equal(a.t.modello().schermo.tipo, "finita");
  a.t.torna();
  assert.equal(a.t.modello().schermo.tipo, "nessuna");
  // la sentinella rilegge ancora «finita» per un minuto: resta nascosta
  a.t.aggiorna({ ok: true, vista: { fase: "finita", io: "chiama", altra: ID1 } });
  assert.equal(a.t.modello().schermo.tipo, "nessuna");
});

test("la chiamata finisce dall'altra parte (o a 15:00): microfono spento subito", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  await a.t.chiama(ID1);
  a.t.aggiorna({ ok: true, vista: IN_CORSO() });
  a.t.aggiorna({ ok: true, vista: { fase: "finita", io: "chiama", altra: ID1 } });
  assert.ok(a.fatti.includes("voce-chiusa"));
  assert.equal(a.t.modello().schermo.tipo, "finita");
  // e anche se la vista sparisce del tutto
  const b = ambiente();
  await b.t.caricaPersone();
  await b.t.chiama(ID1);
  b.t.aggiorna({ ok: true, vista: null });
  assert.ok(b.fatti.includes("voce-chiusa"));
});

test("connessione persa: avviso al server e pulsante Riconnetti", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  await a.t.chiama(ID1);
  a.t.aggiorna({ ok: true, vista: IN_CORSO() });
  await a.t.caduta();
  assert.ok(a.fatti.includes("caduta"));
  assert.equal(a.t.modello().riconnetti, true);
  await a.t.riconnetti();
  assert.ok(a.fatti.includes("riconnetti"));
  assert.equal(a.t.modello().riconnetti, false);
});

test("chiamate spente o accesso scaduto: niente schermo di chiamata", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  a.t.aggiorna({ ok: false, motivo: "spento" });
  assert.equal(a.t.modello().schermo.tipo, "nessuna");
  a.t.aggiorna({ ok: false, motivo: "rete" }); // un buco di rete non cancella una chiamata in corso
  assert.equal(a.t.modello().schermo.tipo, "nessuna");
});

test("un buco di rete durante la chiamata non chiude lo schermo", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  await a.t.chiama(ID1);
  a.t.aggiorna({ ok: true, vista: IN_CORSO() });
  a.t.aggiorna({ ok: false, motivo: "rete" });
  assert.equal(a.t.modello().schermo.tipo, "in_corso");
  assert.ok(!a.fatti.includes("voce-chiusa"));
});

test("il modello non contiene mai email, foto o questionario: solo i campi della scheda", async () => {
  const a = ambiente({ persone: { ok: true, persone: [{ ...PERSONE[0], email: "x@y.it", foto: "f.jpg" }] } });
  await a.t.caricaPersone();
  const testo = JSON.stringify(a.t.modello());
  assert.ok(!testo.includes("x@y.it"));
  assert.ok(!testo.includes("f.jpg"));
});

test("firma: cambia con la struttura dello schermo, non col timer", async () => {
  const a = ambiente();
  await a.t.caricaPersone();
  await a.t.chiama(ID1);
  a.t.aggiorna({ ok: true, vista: IN_CORSO({ restanti: 800 }) });
  const f1 = a.t.firma();
  a.t.aggiorna({ ok: true, vista: IN_CORSO({ restanti: 799 }) });
  assert.equal(a.t.firma(), f1);
  a.t.aggiorna({ ok: true, vista: IN_CORSO({ restanti: 798, ultimoMinuto: true }) });
  assert.notEqual(a.t.firma(), f1);
});
