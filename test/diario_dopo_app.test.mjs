// Passo «diario» del dopo chiamata (#4 spec v1.3 § 3 + #5 spec v1.1 passo 2): dopo «La richiameresti?» e prima
// della fine, la nota privata. I dati della chiamata (persona, inizio esatto, durata) arrivano dal server e passano
// al diario così come sono; la nota va dritta su Supabase dal telefono (diario.js). Tutto finto: niente rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaTelefono } from "../landing/app/moduli/telefono.js";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const INIZIO = "2026-11-13T20:00:00.000Z";
const ESATTO = "2026-11-13T20:00:00.123456+00:00";
const PERSONE = [{ id: ID1, nome: "Giulia", eta: 34, citta: "Torino" }];
const DIARIO = { con: ID1, chiamataIl: ESATTO, durata: 845 };
const DOPO = { tipo: "richiameresti", passi: ["richiameresti", "diario", "fine"], testo: null, altra: ID1, chiamata: { chi: ID2, inizio: INIZIO }, diario: DIARIO };
const IN_CORSO = { fase: "in_corso", io: "chiama", altra: ID1, restanti: 500, ascolto: "fatto", altraPersona: "collegata" };
const aspetta = () => new Promise((r) => setTimeout(r, 0));

async function ambiente({ dopo = DOPO, salva = async () => ({ ok: true }), conDiario = true } = {}) {
  const salvate = [];
  const t = creaTelefono({
    compagni: { leggi: async () => ({ ok: true, persone: PERSONE }) },
    linea: { chiudi: async () => ({ ok: true, vista: { fase: "finita", altra: ID1 } }) },
    chiamata: {
      dopo: async () => ({ ok: true, dopo }),
      richiameresti: async () => ({ ok: true, salvata: true }),
      rifiuta: async () => ({ ok: true, vista: null }), carta: async () => ({ ok: true, vista: null }), caduta: async () => ({ ok: true, vista: null }),
    },
    voce: { muto: () => {}, chiudi: () => {} },
    diario: conDiario ? { salva: async (x) => { salvate.push(x); return salva(x); } } : undefined,
  });
  await t.caricaPersone();
  t.aggiorna({ ok: true, vista: IN_CORSO });
  t.aggiorna({ ok: true, vista: { fase: "finita", altra: ID1 } });
  await aspetta();
  return { t, salvate };
}

test("dopo «La richiameresti?» arriva il diario: titolo col nome, suggerimento, nota, Salva e Salta", async () => {
  const { t } = await ambiente();
  assert.equal(t.modello().schermo.tipo, "richiameresti");
  await t.richiameresti("si");
  const sc = t.modello().schermo;
  assert.equal(sc.tipo, "diario");
  assert.equal(sc.titolo, "Il tuo diario su Giulia");
  assert.equal(sc.suggerimento, "Cosa ti è rimasto di questa chiamata?");
  assert.equal(sc.nota, "Lo leggi solo tu. Non lo usiamo per niente.");
  assert.equal(sc.massimo, 1000);
});

test("Salva: passa persona, inizio ESATTO e durata del server, più il testo; poi la fine", async () => {
  const { t, salvate } = await ambiente();
  await t.richiameresti("salta");
  await t.salvaDiario("Ride come mia nonna.");
  assert.deepEqual(salvate, [{ con: ID1, chiamataIl: ESATTO, durata: 845, testo: "Ride come mia nonna." }]);
  assert.equal(t.modello().schermo.tipo, "dopo_fine");
  assert.equal(t.modello().errore, "");
});

test("Salta: nessun salvataggio, si passa alla fine", async () => {
  const { t, salvate } = await ambiente();
  await t.richiameresti("no");
  t.saltaDiario();
  assert.equal(salvate.length, 0);
  assert.equal(t.modello().schermo.tipo, "dopo_fine");
});

test("se il salvataggio non va resta il diario con un errore in italiano; testo vuoto non parte", async () => {
  let esito = { ok: false, motivo: "rete" };
  const { t, salvate } = await ambiente({ salva: async () => esito });
  await t.richiameresti("si");
  await t.salvaDiario("Qualcosa");
  assert.equal(t.modello().schermo.tipo, "diario");
  assert.ok(t.modello().errore.length > 10);
  await t.salvaDiario("   ");
  assert.equal(salvate.length, 1);
  assert.match(t.modello().errore, /Scrivi qualcosa/);
  esito = { ok: false, motivo: "gia_scritta" }; // nota già salvata (es. doppio tocco): si va avanti
  await t.salvaDiario("Qualcosa");
  assert.equal(t.modello().schermo.tipo, "dopo_fine");
});

test("niente diario se il server non dà i dati, se la chiamata è breve o se il modulo non c'è", async () => {
  const senza = await ambiente({ dopo: { ...DOPO, diario: null } });
  await senza.t.richiameresti("si");
  assert.equal(senza.t.modello().schermo.tipo, "dopo_fine");
  const modulo = await ambiente({ conDiario: false });
  await modulo.t.richiameresti("si");
  assert.equal(modulo.t.modello().schermo.tipo, "dopo_fine");
  const breve = await ambiente({ dopo: { tipo: "breve", passi: ["fine"], testo: "x", altra: ID1, chiamata: null, diario: DIARIO } });
  assert.equal(breve.t.modello().schermo.tipo, "dopo_fine");
});
