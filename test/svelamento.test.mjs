// Svelamento (issue #65, spec v1 del CPO, D48 A): regole calcolate dal server. Solo dati inventati, nessun dato vero.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SVELAMENTO, scadenzaPorta, bloccaCaparra, puoAvviare, tipoSvelamento, primaFasciaComune, timerSvelamento,
  dopoCaduta, esitoRisposte, portaScaduta, chiusuraForzata, registroFinale, giorniAppuntamento, TESTI_SVELAMENTO,
} from "../api/svelamento.js";
import { oraDiRoma } from "../api/stanze.js";

const APERTA = oraDiRoma(2026, 11, 15, 21); // domenica 21:00
const s = (n) => n * 1000;
const min = (n) => n * 60000;
const ore = (n) => n * 3600000;
const dopo = (ms) => new Date(APERTA.getTime() + ms);

const porta = (extra = {}) => ({ a: "a", b: "b", aperta: APERTA, caparre: { a: false, b: false }, svelata: null, chiusa: false, ...extra });

test("costanti della spec: 10 crediti, 48 + 48 ore, 10 secondi di cui 3 sfocati, 3 fasce da 30 minuti", () => {
  assert.equal(SVELAMENTO.caparra, 10);
  assert.equal(SVELAMENTO.finestraOre, 48);
  assert.equal(SVELAMENTO.rispostaOre, 48);
  assert.equal(SVELAMENTO.durata, 10);
  assert.equal(SVELAMENTO.sfocato, 3);
  assert.equal(SVELAMENTO.maxFasce, 3);
  assert.equal(SVELAMENTO.fasciaMinuti, 30);
  assert.equal(SVELAMENTO.tentativi, 3);
});

test("la porta di domenica 21:00 scade martedì 21:00 di Roma", () => {
  assert.equal(scadenzaPorta(APERTA).getTime(), oraDiRoma(2026, 11, 17, 21).getTime());
});

test("caparra: con meno di 10 crediti «Ti mancano N crediti» e non si blocca nulla", () => {
  const r = bloccaCaparra({ porta: porta(), chi: "a", crediti: 7, adesso: dopo(min(5)) });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "crediti_insufficienti");
  assert.equal(r.mancano, 3);
  assert.equal(r.testo, "Ti mancano 3 crediti");
  assert.equal(r.blocca, undefined);
});

test("caparra: con 10 crediti si bloccano 10; non due volte, non fuori tempo, non da chi non è nella porta", () => {
  assert.deepEqual(bloccaCaparra({ porta: porta(), chi: "a", crediti: 10, adesso: dopo(min(5)) }), { ok: true, blocca: 10 });
  assert.equal(bloccaCaparra({ porta: porta({ caparre: { a: true, b: false } }), chi: "a", crediti: 30, adesso: dopo(min(5)) }).motivo, "gia_bloccata");
  assert.equal(bloccaCaparra({ porta: porta(), chi: "a", crediti: 30, adesso: dopo(ore(48)) }).motivo, "porta_scaduta");
  assert.equal(bloccaCaparra({ porta: porta(), chi: "z", crediti: 30, adesso: dopo(min(5)) }).motivo, "non_nella_porta");
  assert.equal(bloccaCaparra({ porta: porta({ chiusa: true }), chi: "a", crediti: 30, adesso: dopo(min(5)) }).motivo, "porta_chiusa");
});

test("senza caparra di entrambi lo svelamento non si avvia (anche via API)", () => {
  assert.equal(puoAvviare({ porta: porta(), chi: "a", adesso: dopo(ore(1)) }).motivo, "manca_caparra");
  const una = puoAvviare({ porta: porta({ caparre: { a: true, b: false } }), chi: "a", adesso: dopo(ore(1)) });
  assert.equal(una.motivo, "manca_caparra");
  assert.equal(una.attesa, "b");
  assert.deepEqual(puoAvviare({ porta: porta({ caparre: { a: true, b: true } }), chi: "a", adesso: dopo(ore(1)) }), { ok: true });
});

test("svelamento una sola volta per porta ed entro le 48 ore", () => {
  const pronte = { caparre: { a: true, b: true } };
  assert.equal(puoAvviare({ porta: porta({ ...pronte, svelata: dopo(ore(2)) }), chi: "a", adesso: dopo(ore(3)) }).motivo, "gia_svelata");
  assert.equal(puoAvviare({ porta: porta(pronte), chi: "a", adesso: dopo(ore(48)) }).motivo, "porta_scaduta");
  assert.equal(puoAvviare({ porta: porta(pronte), chi: "x", adesso: dopo(ore(1)) }).motivo, "non_nella_porta");
});

test("tipo: basta una scelta «foto» e nessuno dei due accende la fotocamera", () => {
  assert.equal(tipoSvelamento("video", "video"), "video");
  assert.equal(tipoSvelamento(undefined, undefined), "video"); // predefinita
  assert.equal(tipoSvelamento("video", "foto"), "foto");
  assert.equal(tipoSvelamento("foto", "video"), "foto");
});

test("fasce: l'app fissa la prima fascia comune dentro le 48 ore", () => {
  const f1 = dopo(ore(20)), f2 = dopo(ore(22)), f3 = dopo(ore(30));
  const r = primaFasciaComune({ fasceA: [f3, f1], fasceB: [f2, f3, f1], aperta: APERTA, adesso: dopo(ore(1)) });
  assert.equal(r.getTime(), f1.getTime());
});

test("fasce: nessuna comune, già passate, fuori dalle 48 ore o più di 3 → nessuna fascia valida", () => {
  assert.equal(primaFasciaComune({ fasceA: [dopo(ore(20))], fasceB: [dopo(ore(21))], aperta: APERTA, adesso: dopo(ore(1)) }), null);
  assert.equal(primaFasciaComune({ fasceA: [dopo(ore(2))], fasceB: [dopo(ore(2))], aperta: APERTA, adesso: dopo(ore(3)) }), null);
  // la fascia deve finire entro la scadenza: 47:45 + 30 minuti va oltre
  assert.equal(primaFasciaComune({ fasceA: [dopo(min(47 * 60 + 45))], fasceB: [dopo(min(47 * 60 + 45))], aperta: APERTA, adesso: dopo(ore(1)) }), null);
  const quattro = [dopo(ore(10)), dopo(ore(11)), dopo(ore(12)), dopo(ore(13))];
  assert.throws(() => primaFasciaComune({ fasceA: quattro, fasceB: quattro, aperta: APERTA, adesso: dopo(ore(1)) }), /fasce/);
});

test("timer: parte solo quando arrivano entrambi i video (B entra 30 s dopo A)", () => {
  const arrivoA = dopo(ore(5));
  const arrivoB = new Date(arrivoA.getTime() + s(30));
  const prima = timerSvelamento({ arrivoA, arrivoB: null, adesso: new Date(arrivoA.getTime() + s(20)) });
  assert.equal(prima.stato, "attesa");
  assert.equal(prima.testo, "Aspettiamo <nome>…");
  const inizio = timerSvelamento({ arrivoA, arrivoB, adesso: arrivoB });
  assert.equal(inizio.stato, "sfocato");
  assert.equal(inizio.restano, 10);
  assert.equal(inizio.sfocatura, 1);
});

test("timer: sfocato nei primi 3 secondi, poi nitido, a 10 secondi si chiude da solo", () => {
  const arrivoA = dopo(ore(5)), arrivoB = dopo(ore(5));
  const a = (sec) => timerSvelamento({ arrivoA, arrivoB, adesso: new Date(arrivoA.getTime() + s(sec)) });
  assert.equal(a(1.5).stato, "sfocato");
  assert.ok(a(1.5).sfocatura > 0 && a(1.5).sfocatura < 1);
  assert.equal(a(3).stato, "nitido");
  assert.equal(a(3).sfocatura, 0);
  assert.equal(a(9.9).stato, "nitido");
  assert.equal(a(10).stato, "finito");
  assert.equal(a(10).testo, "Ecco <nome>.");
  assert.equal(a(25).restano, 0);
});

test("timer: dopo 10 minuti di attesa l'altro non è arrivato", () => {
  const arrivoA = dopo(ore(5));
  const r = timerSvelamento({ arrivoA, arrivoB: null, adesso: new Date(arrivoA.getTime() + min(10)) });
  assert.equal(r.stato, "non_arrivato");
  assert.equal(r.testo, "<nome> non è arrivata. Proponi un altro momento.");
});

test("caduta a 4 s → «Riprova» per 2 minuti e il timer riparte da 10; dopo 3 tentativi si torna a scegliere quando", () => {
  const r = dopoCaduta({ secondiFatti: 4, tentativi: 1 });
  assert.equal(r.esito, "riprova");
  assert.equal(r.finestraSecondi, 120);
  assert.equal(r.ripartDa, 10);
  assert.equal(r.testo, "La connessione è caduta.");
  assert.equal(dopoCaduta({ secondiFatti: 4, tentativi: 3 }).esito, "scegli_quando");
});

test("caduta dopo i 10 secondi pieni: lo svelamento è valido", () => {
  assert.equal(dopoCaduta({ secondiFatti: 10, tentativi: 1 }).esito, "valido");
});

test("doppio sì: «Vi incontrate!», caparre ancora bloccate, si apre la proposta d'incontro", () => {
  const fine = dopo(ore(6));
  const r = esitoRisposte({ rispostaA: "si", rispostaB: "si", fineSvelamento: fine, adesso: dopo(ore(7)), stessaArea: true });
  assert.equal(r.esito, "doppio_si");
  assert.equal(r.caparre, "bloccate");
  assert.equal(r.giorni, 10);
  assert.equal(r.testo, "Vi incontrate! Avete 10 giorni per vedervi");
  assert.equal(esitoRisposte({ rispostaA: "si", rispostaB: "si", fineSvelamento: fine, adesso: dopo(ore(7)), stessaArea: false }).giorni, 30);
});

test("un no o il silenzio: crediti restituiti a entrambi, stesso testo, nessuna indicazione di chi", () => {
  const fine = dopo(ore(6));
  const conNo = esitoRisposte({ rispostaA: "si", rispostaB: "no", fineSvelamento: fine, adesso: dopo(ore(8)) });
  const silenzio = esitoRisposte({ rispostaA: "si", rispostaB: null, fineSvelamento: fine, adesso: new Date(fine.getTime() + ore(48)) });
  for (const r of [conNo, silenzio]) {
    assert.equal(r.esito, "chiusa");
    assert.deepEqual(r.restituisci, ["a", "b"]);
    assert.equal(r.testo, "Questa volta non vi incontrerete. I tuoi 10 crediti sono di nuovo disponibili.");
  }
  assert.deepEqual(conNo, silenzio);
});

test("in attesa: chi ha risposto non vede la risposta dell'altro", () => {
  const fine = dopo(ore(6));
  const r = esitoRisposte({ rispostaA: "no", rispostaB: null, fineSvelamento: fine, adesso: dopo(ore(7)) });
  assert.equal(r.esito, "in_attesa");
  assert.equal(r.testo, "Hai risposto. Ti avvisiamo quando sapremo.");
  assert.equal("rispostaA" in r || "rispostaB" in r, false);
});

test("porta scaduta senza svelamento: crediti restituiti a chi li aveva bloccati, nessuna penale", () => {
  const r = portaScaduta({ porta: porta({ caparre: { a: true, b: false } }), adesso: dopo(ore(48)) });
  assert.equal(r.scaduta, true);
  assert.deepEqual(r.restituisci, ["a"]);
  assert.equal(r.penale, 0);
  assert.equal(r.testo, TESTI_SVELAMENTO.scaduta);
  assert.equal(portaScaduta({ porta: porta(), adesso: dopo(ore(47)) }).scaduta, false);
  assert.equal(portaScaduta({ porta: porta({ svelata: dopo(ore(5)) }), adesso: dopo(ore(49)) }).scaduta, false);
});

test("«Chiudi e segnala», blocco e sospensione: porta chiusa senza penale", () => {
  const p = porta({ caparre: { a: true, b: true } });
  const seg = chiusuraForzata({ porta: p, motivo: "chiudi_e_segnala", da: "a" });
  assert.deepEqual(seg.restituisci, ["a", "b"]);
  assert.equal(seg.blocca, true);
  assert.equal(seg.segnalazione, true);
  assert.equal(seg.penale, 0);
  const blocco = chiusuraForzata({ porta: p, motivo: "blocco", da: "b" });
  assert.deepEqual(blocco.restituisci, ["a", "b"]);
  assert.equal(blocco.segnalazione, false);
  const sosp = chiusuraForzata({ porta: p, motivo: "sospensione", da: "b" });
  assert.deepEqual(sosp.restituisci, ["a"]);
  assert.throws(() => chiusuraForzata({ porta: p, motivo: "altro", da: "a" }), /motivo/);
});

test("registro finale: restano solo orari, tipo, durata, fine ed esito; mai le singole risposte", () => {
  const riga = registroFinale({
    porta: "p1", aperta: APERTA, caparraA: dopo(ore(1)), caparraB: dopo(ore(2)), svelata: dopo(ore(5)), tipo: "video",
    durata: 10, fine: "completato", rispostaA: "si", rispostaB: "no", rispostaAQuando: dopo(ore(6)), esito: "chiusa",
    volto: "x", immagine: "y", audio: "z",
  });
  assert.deepEqual(Object.keys(riga).sort(),
    ["aperta", "caparraA", "caparraB", "durata", "esito", "fine", "porta", "rispostaAQuando", "rispostaBQuando", "svelata", "tipo"].sort());
  assert.equal(riga.rispostaBQuando, null);
  assert.equal(riga.esito, "chiusa");
});

test("giorni per l'appuntamento: 10 nella stessa area, 30 tra aree diverse", () => {
  assert.equal(giorniAppuntamento(true), 10);
  assert.equal(giorniAppuntamento(false), 30);
});
