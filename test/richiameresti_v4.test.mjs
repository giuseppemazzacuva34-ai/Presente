// Design v4 (#349, D149), schermata 31 «Dopo la chiamata»: occhiello «Chiamata N di 3 con <nome> · finita», titolo
// «La» + «richiameresti?» in rosso corsivo, nota segreta, «No» e «Sì» sulla stessa riga in 3D, «Segnala» in fondo.
// N = la chiamata appena finita: si fissa quando la chiamata parte (già fatte + 1, dal server); se l'app riparte
// durante la domanda, il conteggio del server la comprende già (la domanda c'è solo per chiamate che contano).
// Tutto finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schermataDopo } from "../landing/app/moduli/chiamata.js";
import { creaTelefono } from "../landing/app/moduli/telefono.js";

const leggi = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const DOPO = { tipo: "richiameresti", passi: ["richiameresti", "diario", "fine"], testo: null, altra: ID2, chiamata: { chi: ID1, inizio: "2026-11-27T20:00:00.000Z" } };

test("schermataDopo: occhiello con numero e nome, «· finita»", () => {
  assert.equal(schermataDopo(DOPO, { nomeAltra: "Marco", numero: 2 }).occhiello, "Chiamata 2 di 3 con Marco · finita");
  assert.equal(schermataDopo(DOPO, { numero: 3 }).occhiello, "Chiamata 3 di 3 · finita");
});

test("schermataDopo: numero sconosciuto o fuori misura → nessun numero inventato", () => {
  assert.equal(schermataDopo(DOPO, { nomeAltra: "Marco" }).occhiello, "Chiamata con Marco · finita");
  assert.equal(schermataDopo(DOPO, { nomeAltra: "Marco", numero: 0 }).occhiello, "Chiamata con Marco · finita");
  assert.equal(schermataDopo(DOPO, { nomeAltra: "Marco", numero: 4 }).occhiello, "Chiamata con Marco · finita");
  assert.equal(schermataDopo(DOPO, {}).occhiello, "Chiamata finita");
});

const PERSONE = [{ id: ID1, nome: "Giulia", eta: 34, citta: "Torino" }, { id: ID2, nome: "Marco", eta: 38, citta: "Asti" }];
function telefono({ conteggi }) {
  let n = 0;
  const t = creaTelefono({
    compagni: { leggi: async () => ({ ok: true, persone: PERSONE }) },
    linea: {
      chiama: async (id) => ({ ok: true, vista: { fase: "squilla", io: "chiama", altra: id, squillo: 30 } }),
      chiudi: async () => ({ ok: true, vista: { fase: "finita", altra: ID2 } }),
    },
    chiamata: {
      pulsanti: async () => ({ ok: true, pulsanti: [], chiamate: conteggi[Math.min(n++, conteggi.length - 1)] }),
      dopo: async () => ({ ok: true, dopo: DOPO }),
    },
    voce: { muto: () => {}, chiudi: () => {} },
    subito: () => {},
  });
  return t;
}
const pausa = () => new Promise((r) => setTimeout(r, 0));

test("telefono: il numero si fissa quando la chiamata parte e resta anche se i conteggi si rileggono", async () => {
  const t = telefono({ conteggi: [[{ id: ID2, n: 1 }], [{ id: ID2, n: 2 }]] });
  await t.caricaPersone();
  await t.chiama(ID2);
  await t.ricaricaPersone(); // il server ora conta anche questa chiamata: il numero non deve diventare 3
  await t.chiudi(false);
  await pausa();
  const sc = t.modello().schermo;
  assert.equal(sc.tipo, "richiameresti");
  assert.equal(sc.occhiello, "Chiamata 2 di 3 con Marco · finita");
});

test("telefono: se l'app riparte durante la domanda, il numero è quello del server (già comprende la chiamata)", async () => {
  const t = telefono({ conteggi: [[{ id: ID2, n: 2 }]] });
  await t.caricaPersone();
  t.aggiorna({ ok: true, vista: { fase: "finita", altra: ID2 } }); // rientro: la sentinella vede la chiamata finita
  await pausa();
  const sc = t.modello().schermo;
  assert.equal(sc.tipo, "richiameresti");
  assert.equal(sc.occhiello, "Chiamata 2 di 3 con Marco · finita");
});

test("schermo: «La» + <em>richiameresti?</em>, No prima di Sì nella stessa riga, Salta e Segnala sotto", () => {
  const f = leggi("../landing/app/moduli/flusso.js");
  const blocco = f.slice(f.indexOf('sc.tipo === "richiameresti") {'), f.indexOf('sc.tipo === "diario") {'));
  assert.match(blocco, /h\("p", \{ classe: "passo" \}, sc\.occhiello\)/);
  assert.match(blocco, /"La ", h\("em", \{\}, "richiameresti\?"\)/);
  assert.ok(blocco.indexOf('"no"') < blocco.indexOf('"si"'), "No a sinistra, Sì a destra");
  assert.match(leggi("../landing/app/app.css"), /\.chiamata\.richiameresti-v4 h1 em \{/);
  assert.doesNotMatch(leggi("../landing/app/sw.js"), /const VERSIONE = "presente-app-74";/);
});
