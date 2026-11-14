// Chiavi nella stanza (issue #5 spec v1.1, passi 4, 5 e 7; linea «sviluppatore-c», passo 8a): il controllo che tiene
// lo stato delle chiavi, apre le finestre «Dai una chiave», «Modifica la frase», «Riprendi la chiave» e manda le
// richieste. Il server decide: qui si mostrano le sue risposte. Chiavi finte, nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaChiaviStanza } from "../landing/app/moduli/chiavi_stanza.js";

const LEI = "11111111-2222-4333-8444-555555555555";
const LUI = "66666666-7777-4888-9999-000000000000";
const CHIUDE = "2026-11-15T20:00:00Z";
const stato = (date = [], extra = {}) => ({ stanza: true, chiude_il: CHIUDE, chiuse: false, restanti: 2 - date.length, date, ...extra });

function chiaviFinte(iniziale = stato()) {
  const chiamate = [];
  let attuale = iniziale;
  const risposte = {};
  return {
    chiamate, risposte,
    imposta: (s) => { attuale = s; },
    async leggi() { chiamate.push(["leggi"]); return risposte.leggi ?? { ok: true, stato: attuale }; },
    async dai(a, frase) { chiamate.push(["dai", a, frase]); return risposte.dai ?? { ok: true, stato: stato([{ a, frase: frase || null }]) }; },
    async riprendi(a) { chiamate.push(["riprendi", a]); return risposte.riprendi ?? { ok: true, stato: stato() }; },
    async cambiaFrase(a, frase) { chiamate.push(["frase", a, frase]); return risposte.frase ?? { ok: true, stato: stato([{ a, frase: frase || null }]) }; },
  };
}

test("carica: contatore in alto e scheda di ogni persona dallo stato del server", async () => {
  const chiavi = chiaviFinte();
  let aggiornata = 0;
  const c = creaChiaviStanza({ chiavi, aggiorna: () => { aggiornata += 1; }, adesso: () => new Date("2026-11-12T10:00:00Z") });
  assert.equal(c.modello().contatore, null, "prima di leggere niente contatore");
  await c.carica();
  const m = c.modello();
  assert.deepEqual(m.contatore, { testo: "Le tue chiavi: 2", icone: [true, true] });
  assert.equal(m.conto, null, "nessun conto alla rovescia il giovedì");
  assert.deepEqual(c.scheda(LEI), { dai: "Dai una chiave" });
  assert.ok(aggiornata >= 1);
});

test("senza stanza aperta o con errore di lettura: niente contatore e niente pulsanti", async () => {
  const chiavi = chiaviFinte({ stanza: false });
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  assert.equal(c.modello().contatore, null);
  assert.equal(c.scheda(LEI), null);
  chiavi.risposte.leggi = { ok: false, motivo: "rete", testo: "Sei senza connessione. Riprova tra poco." };
  await c.carica();
  assert.equal(c.scheda(LEI), null);
});

test("dalle 20:00 il conto alla rovescia sull'orologio di chi guarda", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte(), adesso: () => new Date("2026-11-15T19:01:00Z") });
  await c.carica();
  assert.equal(c.modello().conto, "Le porte si aprono tra 59 minuti");
});

test("Dai una chiave: finestra con i testi della spec, frase mandata al server, poi la scheda cambia", async () => {
  const chiavi = chiaviFinte();
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  const f = c.modello().finestra;
  assert.equal(f.tipo, "dai");
  assert.equal(f.titolo, "Dai una chiave a Giulia?");
  assert.equal(f.nota, "La leggerà solo se anche Giulia ti dà una chiave.");
  assert.equal(f.bottone, "Dai la chiave");
  assert.equal(f.massimo, 140);
  c.scrivi("Il treno delle 8");
  await c.conferma();
  assert.deepEqual(chiavi.chiamate.at(-1), ["dai", LEI, "Il treno delle 8"]);
  assert.equal(c.modello().finestra, null, "finestra chiusa");
  assert.equal(c.scheda(LEI).segno, "Hai dato una chiave");
  assert.deepEqual(c.modello().contatore.icone, [true, false]);
});

test("rifiuto del server: la finestra resta aperta con il suo testo (contatti, chiuse, non chiamato)", async () => {
  const chiavi = chiaviFinte();
  chiavi.risposte.dai = { ok: false, motivo: "contatti", testo: "La frase non può contenere contatti. Ve li scambierete dopo esservi visti." };
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  c.scrivi("scrivimi su instagram");
  await c.conferma();
  const m = c.modello();
  assert.equal(m.finestra?.tipo, "dai");
  assert.equal(m.finestra.frase, "scrivimi su instagram", "la frase scritta non si perde");
  assert.equal(m.errore, "La frase non può contenere contatti. Ve li scambierete dopo esservi visti.");
  c.chiudi();
  assert.equal(c.modello().finestra, null);
  assert.equal(c.modello().errore, null);
});

test("Riprendi la chiave: conferma «Non lo saprà», poi la chiave torna disponibile", async () => {
  const chiavi = chiaviFinte(stato([{ a: LEI, frase: "Ciao" }]));
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  c.apriRiprendi(LEI, "Giulia");
  assert.equal(c.modello().finestra.testo, "Riprendi la chiave a Giulia? Non lo saprà.");
  await c.conferma();
  assert.deepEqual(chiavi.chiamate.at(-1), ["riprendi", LEI]);
  assert.deepEqual(c.scheda(LEI), { dai: "Dai una chiave" });
});

test("Modifica la frase: parte dalla frase già data, vuota = nessuna frase", async () => {
  const chiavi = chiaviFinte(stato([{ a: LEI, frase: "Ciao" }]));
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  c.apriFrase(LEI, "Giulia");
  assert.equal(c.modello().finestra.tipo, "frase");
  assert.equal(c.modello().finestra.frase, "Ciao");
  assert.equal(c.modello().finestra.titolo, "Modifica la frase", "non «Dai una chiave»: la chiave è già data");
  c.scrivi("");
  await c.conferma();
  assert.deepEqual(chiavi.chiamate.at(-1), ["frase", LEI, ""]);
});

test("una richiesta alla volta: due tocchi su «Dai la chiave» mandano una sola richiesta", async () => {
  const chiavi = chiaviFinte();
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  await Promise.all([c.conferma(), c.conferma()]);
  assert.equal(chiavi.chiamate.filter((x) => x[0] === "dai").length, 1);
});

test("risposta ok senza stato: si rilegge dal server", async () => {
  const chiavi = chiaviFinte();
  chiavi.risposte.riprendi = { ok: true, stato: null };
  const c = creaChiaviStanza({ chiavi });
  chiavi.imposta(stato([{ a: LEI, frase: null }]));
  await c.carica();
  c.apriRiprendi(LEI, "Giulia");
  chiavi.imposta(stato());
  await c.conferma();
  assert.deepEqual(chiavi.chiamate.at(-1), ["leggi"]);
  assert.deepEqual(c.scheda(LEI), { dai: "Dai una chiave" });
});

test("id non valido o nessuna finestra: nessuna richiesta", async () => {
  const chiavi = chiaviFinte();
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  c.apriDai("non-un-id", "X");
  assert.equal(c.modello().finestra, null);
  await c.conferma();
  assert.equal(chiavi.chiamate.filter((x) => x[0] !== "leggi").length, 0);
  assert.equal(c.scheda(LUI).dai, "Dai una chiave");
});
