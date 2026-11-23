// Stanza viva e «Fissa una chiamata» (#380, spec v1 del CPO del 23/11): regole del server, passo 1. Solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPUNTAMENTI, TESTI_APPUNTAMENTI, statoPresenza, testoNonInLinea, mostraFissa, oreProponibili, controllaMessaggio,
  controllaProposta, puoControproporre, faseAppuntamento,
} from "../api/appuntamenti.js";
import { oraDiRoma } from "../api/stanze.js";

const APRE = oraDiRoma(2026, 11, 9, 9);
const CHIUDE = oraDiRoma(2026, 11, 15, 21);
const STANZA = { apre: APRE, chiude: CHIUDE };
const s = (n) => n * 1000;
const min = (n) => n * 60000;
const ore = (n) => n * 3600000;
const MARTEDI_20 = oraDiRoma(2026, 11, 10, 20);

// ── 1. Stati ──
test("online fino a 60 s dall'ultimo segnale (il telefono lo manda ogni 30 s), poi non in linea", () => {
  assert.equal(APPUNTAMENTI.segnaleOgni, 30);
  assert.equal(APPUNTAMENTI.nonInLineaDopo, 60);
  const ultimo = MARTEDI_20;
  assert.equal(statoPresenza({ ultimoSegnale: ultimo, adesso: new Date(ultimo.getTime() + s(30)) }).stato, "online");
  assert.equal(statoPresenza({ ultimoSegnale: ultimo, adesso: new Date(ultimo.getTime() + s(60)) }).stato, "online");
  assert.equal(statoPresenza({ ultimoSegnale: ultimo, adesso: new Date(ultimo.getTime() + s(61)) }).stato, "non_in_linea");
  assert.equal(statoPresenza({ ultimoSegnale: null, adesso: ultimo }).stato, "non_in_linea");
});

test("in chiamata vale più di online e non in linea", () => {
  const st = statoPresenza({ ultimoSegnale: null, inChiamata: true, adesso: MARTEDI_20 });
  assert.equal(st.stato, "in_chiamata");
});

test("non in linea: mai l'ora esatta, solo «da poco», «da N h», «da ieri», «da N giorni»", () => {
  const t = (ms) => testoNonInLinea(new Date(MARTEDI_20.getTime() - ms), MARTEDI_20);
  assert.equal(t(min(5)), "non in linea · da poco");
  assert.equal(t(min(59)), "non in linea · da poco");
  assert.equal(t(ore(1)), "non in linea · da 1 h");
  assert.equal(t(ore(23) + min(59)), "non in linea · da 23 h");
  assert.equal(t(ore(24)), "non in linea · da ieri");
  assert.equal(t(ore(47)), "non in linea · da ieri");
  assert.equal(t(ore(48)), "non in linea · da 2 giorni");
  assert.equal(testoNonInLinea(null, MARTEDI_20), "non in linea");
  assert.ok(!/\d{1,2}:\d{2}/.test(t(ore(5))));
});

test("lo stato non dice mai della pausa: chi è in pausa è online o non in linea come gli altri", () => {
  const st = statoPresenza({ ultimoSegnale: MARTEDI_20, adesso: MARTEDI_20, pausa: "2026-11-10" });
  assert.deepEqual(Object.keys(st), ["stato"]);
  assert.equal(st.stato, "online");
});

// ── 3. «FISSA» al posto di «CHIAMA» ──
test("FISSA compare se è in chiamata, non in linea, fuori fascia o in pausa (stesso motivo «fuori_fascia»)", () => {
  const base = { adesso: MARTEDI_20, stanza: STANZA };
  assert.equal(mostraFissa({ ...base, chiama: { ok: false, motivo: "occupato" }, stato: "in_chiamata" }), true);
  assert.equal(mostraFissa({ ...base, chiama: { ok: false, motivo: "fuori_fascia" }, stato: "online" }), true);
  assert.equal(mostraFissa({ ...base, chiama: { ok: true }, stato: "non_in_linea" }), true);
  assert.equal(mostraFissa({ ...base, chiama: { ok: true }, stato: "online" }), false); // c'è «CHIAMA»
});

test("FISSA non compare: 3 chiamate, blocco o segnalazione, sospensione, ultimi 30 minuti di domenica", () => {
  const base = { adesso: MARTEDI_20, stanza: STANZA, stato: "non_in_linea" };
  assert.equal(mostraFissa({ ...base, chiama: { ok: false, motivo: "tre_con_lei" } }), false);
  assert.equal(mostraFissa({ ...base, chiama: { ok: false, motivo: "bloccati" } }), false);
  assert.equal(mostraFissa({ ...base, chiama: { ok: false, motivo: "non_in_stanza" } }), false); // sospesi o fuori
  assert.equal(mostraFissa({ ...base, chiama: { ok: true }, segnalati: true }), false);
  assert.equal(mostraFissa({ ...base, chiama: { ok: true }, adesso: oraDiRoma(2026, 11, 15, 20, 30) }), false);
  assert.equal(mostraFissa({ ...base, chiama: { ok: true }, adesso: oraDiRoma(2026, 11, 15, 20, 29) }), true);
});

// ── 4. Ore proponibili ──
test("ore a passi di 30 minuti, solo dentro le due fasce e almeno 30 minuti dopo adesso", () => {
  const adesso = oraDiRoma(2026, 11, 10, 18, 10);
  const slot = oreProponibili({ adesso, stanza: STANZA, fasciaMia: { da: "18:00", a: "22:00" }, fasciaSua: { da: "19:00", a: "23:00" } });
  const oggi = slot.filter((d) => d < oraDiRoma(2026, 11, 11, 0));
  assert.deepEqual(oggi.map((d) => d.getTime()), [
    oraDiRoma(2026, 11, 10, 19), oraDiRoma(2026, 11, 10, 19, 30), oraDiRoma(2026, 11, 10, 20),
    oraDiRoma(2026, 11, 10, 20, 30), oraDiRoma(2026, 11, 10, 21), oraDiRoma(2026, 11, 10, 21, 30),
  ].map((d) => d.getTime())); // 22:00 escluso: la fascia finisce lì
});

test("primo orario ≥ 30 minuti da adesso; fasce mancanti valgono 9:00–23:00", () => {
  const adesso = oraDiRoma(2026, 11, 10, 20, 1);
  const slot = oreProponibili({ adesso, stanza: STANZA, fasciaMia: null, fasciaSua: null });
  assert.equal(slot[0].getTime(), oraDiRoma(2026, 11, 10, 21).getTime());
  const esatto = oreProponibili({ adesso: oraDiRoma(2026, 11, 10, 20), stanza: STANZA });
  assert.equal(esatto[0].getTime(), oraDiRoma(2026, 11, 10, 20, 30).getTime());
});

test("solo dentro la settimana della stanza; domenica l'ultima ora è 20:30", () => {
  const slot = oreProponibili({ adesso: oraDiRoma(2026, 11, 14, 22, 1), stanza: STANZA }); // sabato: 22:30 è a meno di 30 minuti
  const ultimo = slot[slot.length - 1];
  assert.equal(ultimo.getTime(), oraDiRoma(2026, 11, 15, 20, 30).getTime());
  assert.equal(slot[0].getTime(), oraDiRoma(2026, 11, 15, 9).getTime());
  assert.equal(oreProponibili({ adesso: oraDiRoma(2026, 11, 15, 20, 1), stanza: STANZA }).length, 0);
});

test("fasce che non si toccano: nessun orario", () => {
  const slot = oreProponibili({ adesso: MARTEDI_20, stanza: STANZA, fasciaMia: { da: "09:00", a: "12:00" }, fasciaSua: { da: "18:00", a: "23:00" } });
  assert.equal(slot.length, 0);
});

test("la notte del cambio d'ora (25/10/2026) gli orari restano a :00 e :30 di Roma", () => {
  const stanza = { apre: oraDiRoma(2026, 10, 19, 9), chiude: oraDiRoma(2026, 10, 25, 21) };
  const slot = oreProponibili({ adesso: oraDiRoma(2026, 10, 24, 22), stanza });
  const domenica = slot.filter((d) => d >= oraDiRoma(2026, 10, 25, 0));
  assert.equal(domenica[0].getTime(), oraDiRoma(2026, 10, 25, 9).getTime());
  assert.equal(domenica.length, 24); // 9:00 … 20:30
  for (const d of slot) assert.equal(d.getUTCMinutes() % 30, 0);
});

// ── Messaggio ──
test("messaggio facoltativo: al massimo 120 caratteri e niente contatti, con il testo della spec", () => {
  assert.deepEqual(controllaMessaggio(""), { ok: true, messaggio: null });
  assert.deepEqual(controllaMessaggio("  Ti va di sentirci   stasera? "), { ok: true, messaggio: "Ti va di sentirci stasera?" });
  assert.equal(controllaMessaggio("a".repeat(120)).ok, true);
  const lungo = controllaMessaggio("a".repeat(121));
  assert.equal(lungo.ok, false);
  assert.equal(lungo.testo, TESTI_APPUNTAMENTI.troppoLungo);
  for (const m of ["chiamami al 333 123 4567", "scrivimi a x@y.it", "vai su www.sito.com", "su insta mi trovi", "https://x"]) {
    const r = controllaMessaggio(m);
    assert.equal(r.ok, false, m);
    assert.equal(r.testo, "Niente numeri, link o social prima della porta.");
  }
});

// ── Proposta: limiti e controllo lato server ──
const proposta = (extra = {}) => ({
  chi: "a", con: "b", adesso: MARTEDI_20, stanza: STANZA, quando: oraDiRoma(2026, 11, 10, 21),
  fasciaMia: null, fasciaSua: null, messaggio: "", aperti: [], fissa: true, ...extra,
});

test("una proposta valida passa e restituisce l'orario e il messaggio puliti", () => {
  const r = controllaProposta(proposta({ messaggio: "Ti va?" }));
  assert.equal(r.ok, true);
  assert.equal(r.quando.getTime(), oraDiRoma(2026, 11, 10, 21).getTime());
  assert.equal(r.messaggio, "Ti va?");
});

test("il server rifiuta orari fuori fascia, fuori passo, troppo vicini o fuori settimana", () => {
  for (const quando of [oraDiRoma(2026, 11, 10, 20, 15), oraDiRoma(2026, 11, 10, 20, 0), oraDiRoma(2026, 11, 10, 23),
    oraDiRoma(2026, 11, 15, 20, 45), oraDiRoma(2026, 11, 16, 10), "non è una data"]) {
    assert.equal(controllaProposta(proposta({ quando })).motivo, "orario", String(quando));
  }
  assert.equal(controllaProposta(proposta({ quando: oraDiRoma(2026, 11, 10, 21), fasciaSua: { da: "09:00", a: "21:00" } })).motivo, "orario");
});

test("niente proposta se FISSA non è disponibile", () => {
  assert.equal(controllaProposta(proposta({ fissa: false })).motivo, "non_disponibile");
});

test("al massimo 3 appuntamenti aperti per persona e 1 con la stessa persona", () => {
  const ap = (x, y) => ({ chi: x, con: y, stato: "proposto" });
  const tre = controllaProposta(proposta({ aperti: [ap("a", "c"), ap("d", "a"), ap("a", "e")] }));
  assert.equal(tre.ok, false);
  assert.equal(tre.testo, "Hai già 3 appuntamenti aperti.");
  assert.equal(controllaProposta(proposta({ aperti: [ap("b", "a")] })).motivo, "gia_con_lei");
  // contano solo proposti e confermati
  assert.equal(controllaProposta(proposta({ aperti: [{ chi: "a", con: "b", stato: "annullato" }] })).ok, true);
  // i 3 dell'altra persona: non si dice nulla di lei
  const suoi = controllaProposta(proposta({ aperti: [ap("b", "c"), ap("b", "d"), ap("e", "b")] }));
  assert.equal(suoi.ok, false);
  assert.equal(suoi.testo, TESTI_APPUNTAMENTI.nonDisponibile);
});

test("al massimo due controproposte in tutto per appuntamento", () => {
  assert.equal(APPUNTAMENTI.controproposte, 2);
  assert.equal(puoControproporre({ controproposte: 0 }), true);
  assert.equal(puoControproporre({ controproposte: 1 }), true);
  assert.equal(puoControproporre({ controproposte: 2 }), false);
});

// ── 5–6. Tempi dell'appuntamento ──
test("proposta senza risposta: scade all'ora proposta", () => {
  const quando = oraDiRoma(2026, 11, 10, 21);
  assert.equal(faseAppuntamento({ stato: "proposto", quando }, new Date(quando.getTime() - 1)).fase, "in_attesa");
  const f = faseAppuntamento({ stato: "proposto", quando }, quando);
  assert.equal(f.fase, "scaduto");
  assert.equal(f.testo, "Nessuna risposta: la proposta è scaduta.");
});

test("confermato: promemoria a −10 min, CHIAMA per 15 minuti dall'ora fissata, poi sparisce senza penalità", () => {
  const quando = oraDiRoma(2026, 11, 10, 21);
  const f = (ms) => faseAppuntamento({ stato: "confermato", quando }, new Date(quando.getTime() + ms)).fase;
  assert.equal(f(-min(11)), "fissato");
  assert.equal(f(-min(10)), "promemoria");
  assert.equal(f(-1), "promemoria");
  assert.equal(f(0), "chiama");
  assert.equal(f(min(15) - 1), "chiama");
  assert.equal(f(min(15)), "finito");
});

test("anche la notte del cambio d'ora i 10 e i 15 minuti sono minuti veri", () => {
  const quando = new Date(Date.UTC(2026, 9, 25, 1, 0)); // 25/10/2026 alle 2:00 di Roma (ora solare)
  assert.equal(faseAppuntamento({ stato: "confermato", quando }, new Date(quando.getTime() - min(10))).fase, "promemoria");
  assert.equal(faseAppuntamento({ stato: "confermato", quando }, new Date(quando.getTime() + min(14))).fase, "chiama");
});

test("i testi della spec non nominano mai la pausa", () => {
  for (const t of Object.values(TESTI_APPUNTAMENTI)) assert.ok(!/pausa|non ricev/i.test(t), t);
});
