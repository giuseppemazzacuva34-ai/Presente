// Prova finta (D141 A, linea C) e design v4 (#349, schermate 37-38 «La porta»): nella sera della prova ogni porta ha
// la sagoma e la provincia come la funzione vera del database (20261122195850_sera_sagoma.sql,
// 20261123075638_sera_eta_provincia.sql), così la prova mostra la sagoma femminile o maschile giusta e
// «Nome, età · provincia». Il genere finto segue i gruppi di prova_api.js (indici pari donne, dispari uomini).
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaProva, PERSONE_PROVA } from "../landing/app/moduli/prova.js";

const INIZIO = Date.parse("2026-11-19T18:00:00Z");

test("sera della prova: sagoma «donna» per Aurora, «uomo» per Bruno, provincia senza «Persona finta»", async () => {
  let ora = INIZIO;
  const p = creaProva({ adesso: () => ora, attesaMs: 0 });
  const leggi = async () => p.telefono.aggiorna(await p.chiamata.stato());
  const parla = async (i) => {
    await p.telefono.chiama(PERSONE_PROVA[i].id);
    ora += 5000; await leggi(); ora += 90000; await leggi();
    await p.telefono.chiudi(false); await new Promise((r) => setTimeout(r, 0)); p.telefono.torna();
  };
  await p.telefono.caricaPersone();
  p.regista.profiloPronto();
  await parla(0); await parla(1);
  await p.chiaviServer.dai(PERSONE_PROVA[0].id, ""); // Aurora ricambia
  await p.chiaviServer.dai(PERSONE_PROVA[1].id, ""); // Bruno ricambia
  p.regista.apriPorte();
  const sera = await p.chiaviServer.sera();
  const per = Object.fromEntries(sera.porte.map((x) => [x.nome, x]));
  assert.deepEqual([per.Aurora.sagoma, per.Aurora.provincia], ["donna", "Milano"]);
  assert.deepEqual([per.Bruno.sagoma, per.Bruno.provincia], ["uomo", "Monza"]);
  await p.chiavi.prepara(); await new Promise((r) => setTimeout(r, 0));
  const scheda = p.chiavi.modello().sera.schede.find((s) => s.nome.startsWith("Aurora"));
  assert.equal(scheda.immagine, "/app/img/porta-donna-rosa.jpg");
});
