// Chiamate solo voce (issue #4, spec v1, v1.1 e v1.2 del CPO): regole calcolate dal server. Solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHIAMATA, contaNeiLimiti, giornoDiRoma, dentroFascia, puoChiamare, fineChiamata, timer, durataFinale,
  rigaRegistro, ESITI, carteAttive, pulsanteCarte, mostraSuggerimento, puoPescare, pescaCarta,
} from "../api/chiamate.js";
import { oraDiRoma } from "../api/stanze.js";

const APRE = oraDiRoma(2026, 11, 9, 9);
const CHIUDE = oraDiRoma(2026, 11, 15, 21);
const STANZA = { apre: APRE, chiude: CHIUDE, membri: ["a", "b", "c", "d"] };
const MARTEDI_20 = oraDiRoma(2026, 11, 10, 20);
const min = (n) => n * 60000;
const chiamata = (a, b, inizio, durata) => ({ chi: a, con: b, inizio, durata });

function base(extra = {}) {
  return { chi: "a", verso: "b", adesso: MARTEDI_20, stanza: STANZA, chiamate: [], blocchi: [], inChiamata: new Set(),
    fascia: null, ...extra };
}

test("costanti della spec: 15 minuti, 3 con la stessa persona, 5 al giorno, 60 s per contare", () => {
  assert.equal(CHIAMATA.durataMassima, 900);
  assert.equal(CHIAMATA.conStessaPersona, 3);
  assert.equal(CHIAMATA.alGiorno, 5);
  assert.equal(CHIAMATA.minimoPerContare, 60);
  assert.equal(CHIAMATA.squillo, 30);
});

test("una chiamata sotto i 60 secondi non conta nei limiti", () => {
  assert.equal(contaNeiLimiti(59), false);
  assert.equal(contaNeiLimiti(60), true);
  assert.equal(contaNeiLimiti(null), false);
});

test("il giorno si conta all'ora di Roma", () => {
  assert.equal(giornoDiRoma(new Date("2026-11-10T23:30:00Z")), "2026-11-11");
  assert.equal(giornoDiRoma(new Date("2026-11-10T22:30:00Z")), "2026-11-10");
});

test("chiamata possibile tra due persone della stessa stanza aperta", () => {
  assert.deepEqual(puoChiamare(base()), { ok: true });
});

test("chi non è nella stessa stanza non può chiamare (neanche via API)", () => {
  assert.equal(puoChiamare(base({ verso: "z" })).motivo, "non_in_stanza");
  assert.equal(puoChiamare(base({ chi: "z" })).motivo, "non_in_stanza");
  assert.equal(puoChiamare(base({ verso: "a" })).motivo, "non_in_stanza");
});

test("#7 spec v1.1: chi è sospeso non chiama e non riceve, come se non fosse più nella stanza", () => {
  assert.equal(puoChiamare(base({ sospesi: new Set(["b"]) })).motivo, "non_in_stanza");
  assert.equal(puoChiamare(base({ sospesi: new Set(["a"]) })).motivo, "non_in_stanza");
  // Nessun testo che dica «è sospesa»: stessa risposta di chi non è nella stanza.
  assert.equal(puoChiamare(base({ sospesi: new Set(["b"]) })).testo, undefined);
  assert.deepEqual(puoChiamare(base({ sospesi: new Set(["z"]) })), { ok: true });
});

test("fuori dalla settimana della stanza non si chiama", () => {
  assert.equal(puoChiamare(base({ adesso: new Date(CHIUDE.getTime() + 1000) })).motivo, "stanza_chiusa");
  assert.equal(puoChiamare(base({ adesso: new Date(APRE.getTime() - 1000) })).motivo, "stanza_chiusa");
});

test("chi è bloccato (in un verso o nell'altro) non chiama", () => {
  assert.equal(puoChiamare(base({ blocchi: [{ chi: "b", bloccato: "a" }] })).motivo, "bloccati");
  assert.equal(puoChiamare(base({ blocchi: [{ chi: "a", bloccato: "b" }] })).motivo, "bloccati");
});

test("una sola chiamata alla volta: B occupato → «È in un'altra chiamata»", () => {
  const r = puoChiamare(base({ inChiamata: new Set(["b"]) }));
  assert.equal(r.motivo, "occupato");
  assert.equal(r.testo, "È in un'altra chiamata");
  assert.equal(puoChiamare(base({ inChiamata: new Set(["a"]) })).motivo, "gia_in_chiamata");
});

test("alla quarta chiamata con la stessa persona il pulsante è disattivato con il testo giusto", () => {
  const giorni = [9, 10, 11].map((g) => oraDiRoma(2026, 11, g, 19));
  const tre = giorni.map((g, i) => chiamata(i % 2 ? "b" : "a", i % 2 ? "a" : "b", g, 300));
  const r = puoChiamare(base({ chiamate: tre, adesso: oraDiRoma(2026, 11, 12, 20) }));
  assert.equal(r.motivo, "tre_con_lei");
  assert.equal(r.testo, "Avete già parlato 3 volte. Ora tocca alle chiavi");
});

test("le chiamate sotto i 60 s non contano per le 3 con la stessa persona", () => {
  const giorni = [9, 10, 11].map((g) => oraDiRoma(2026, 11, g, 19));
  const tre = [chiamata("a", "b", giorni[0], 300), chiamata("a", "b", giorni[1], 300), chiamata("a", "b", giorni[2], 40)];
  assert.deepEqual(puoChiamare(base({ chiamate: tre, adesso: oraDiRoma(2026, 11, 12, 20) })), { ok: true });
});

test("le chiamate della settimana prima non contano per la coppia", () => {
  const prima = [1, 2, 3].map((g) => chiamata("a", "b", oraDiRoma(2026, 11, g, 19), 300));
  assert.deepEqual(puoChiamare(base({ chiamate: prima })), { ok: true });
});

test("alla sesta chiamata del giorno il pulsante è disattivato con il testo giusto", () => {
  const oggi = ["c", "d", "c", "d", "c"].map((x, i) => chiamata("a", x, new Date(MARTEDI_20.getTime() - min(100 - i * 16)), 120));
  const r = puoChiamare(base({ chiamate: oggi }));
  assert.equal(r.motivo, "cinque_oggi");
  assert.equal(r.testo, "Per oggi hai fatto 5 chiamate. A domani");
});

test("anche le chiamate ricevute contano nelle 5 del giorno; quelle di ieri no", () => {
  const ricevute = ["c", "d", "c", "d", "c"].map((x, i) => chiamata(x, "a", new Date(MARTEDI_20.getTime() - min(100 - i * 16)), 120));
  assert.equal(puoChiamare(base({ chiamate: ricevute })).motivo, "cinque_oggi");
  const ieri = ricevute.map((c) => ({ ...c, inizio: new Date(c.inizio.getTime() - 86400000) }));
  assert.deepEqual(puoChiamare(base({ chiamate: ieri })), { ok: true });
});

test("se B ha già fatto 5 chiamate oggi non riceve", () => {
  const diB = ["c", "d", "c", "d", "c"].map((x, i) => chiamata("b", x, new Date(MARTEDI_20.getTime() - min(100 - i * 16)), 120));
  assert.equal(puoChiamare(base({ chiamate: diB })).motivo, "cinque_oggi_lei");
});

test("fuori dalla fascia di B nessuno squillo: «Disponibile da 19:00»", () => {
  const r = puoChiamare(base({ fascia: { da: "21:00", a: "23:30" } }));
  assert.equal(r.motivo, "fuori_fascia");
  assert.equal(r.testo, "Disponibile da 21:00");
  assert.deepEqual(puoChiamare(base({ fascia: { da: "19:00", a: "23:00" } })), { ok: true });
});

test("spec v1.3: niente fasce a cavallo della mezzanotte; una fascia non valida vale come 9:00–23:00", () => {
  const f = { da: "22:00", a: "01:00" };
  assert.equal(dentroFascia(f, oraDiRoma(2026, 11, 10, 22, 30)), true);
  assert.equal(dentroFascia(f, oraDiRoma(2026, 11, 11, 0, 30)), false);
  assert.equal(dentroFascia(null, MARTEDI_20), true);
});

test("con «mi chiamano solo persone a cui do il permesso» serve il permesso (D32)", () => {
  const r = puoChiamare(base({ soloConPermesso: true, permessi: new Set() }));
  assert.equal(r.motivo, "serve_permesso");
  assert.equal(r.testo, "Chiedi di parlare");
  assert.deepEqual(puoChiamare(base({ soloConPermesso: true, permessi: new Set(["a"]) })), { ok: true });
});

test("negli ultimi 60 secondi della stanza non parte una chiamata nuova", () => {
  assert.equal(puoChiamare(base({ adesso: new Date(CHIUDE.getTime() - 30000) })).motivo, "stanza_chiude");
});

test("la chiamata finisce a 15:00 o alla chiusura della stanza, se prima", () => {
  assert.equal(fineChiamata(MARTEDI_20, CHIUDE).getTime(), MARTEDI_20.getTime() + 900000);
  const tardi = new Date(CHIUDE.getTime() - min(5));
  assert.equal(fineChiamata(tardi, CHIUDE).getTime(), CHIUDE.getTime());
});

test("il timer è deciso dal server: restanti, ultimo minuto, finita", () => {
  const fine = fineChiamata(MARTEDI_20, CHIUDE);
  assert.deepEqual(timer(MARTEDI_20, fine, new Date(MARTEDI_20.getTime() + 1000)), { restanti: 899, ultimoMinuto: false, finita: false });
  assert.deepEqual(timer(MARTEDI_20, fine, new Date(MARTEDI_20.getTime() + min(14))), { restanti: 60, ultimoMinuto: true, finita: false });
  assert.deepEqual(timer(MARTEDI_20, fine, new Date(MARTEDI_20.getTime() + min(16))), { restanti: 0, ultimoMinuto: true, finita: true });
});

test("la durata salvata non supera mai la fine decisa dal server", () => {
  const fine = fineChiamata(MARTEDI_20, CHIUDE);
  assert.equal(durataFinale(MARTEDI_20, fine, new Date(MARTEDI_20.getTime() + min(20))), 900);
  assert.equal(durataFinale(MARTEDI_20, fine, new Date(MARTEDI_20.getTime() + 45500)), 45);
});

test("il registro contiene solo chi, quando, durata, come è finita (spec v1.1)", () => {
  const r = rigaRegistro({ chi: "a", con: "b", inizio: MARTEDI_20, durata: 300, esito: "tempo_scaduto", audio: "x", note: "y" });
  assert.deepEqual(Object.keys(r).sort(), ["chi", "con", "durata", "esito", "inizio"]);
  assert.deepEqual(ESITI, ["tempo_scaduto", "chiusa", "chiudi_e_segnala", "caduta"]);
  assert.throws(() => rigaRegistro({ chi: "a", con: "b", inizio: MARTEDI_20, durata: 3, esito: "boh" }));
});

// ── Carte della conversazione (spec v1.2) ──
const CARTE = Array.from({ length: 30 }, (_, i) => ({ id: `c${i + 1}`, testo: `Carta ${i + 1}`, versione: "v1", attiva: true }));

test("solo le carte attive della versione v1; tabella vuota → nessun pulsante", () => {
  const righe = [...CARTE, { id: "x", testo: "vecchia", versione: "v0", attiva: true }, { id: "y", testo: "spenta", versione: "v1", attiva: false }];
  assert.equal(carteAttive(righe).length, 30);
  assert.equal(pulsanteCarte({ secondi: 60, durata: 900, carte: 0 }).visibile, false);
});

test("pulsante Carte: non prima di 0:10, non dall'ultimo minuto; conto di 20 s tra due pescate", () => {
  assert.equal(pulsanteCarte({ secondi: 9, durata: 900, carte: 30 }).visibile, false);
  assert.deepEqual(pulsanteCarte({ secondi: 10, durata: 900, carte: 30 }), { visibile: true, attesa: 0 });
  assert.equal(pulsanteCarte({ secondi: 840, durata: 900, carte: 30 }).visibile, false);
  assert.deepEqual(pulsanteCarte({ secondi: 100, durata: 900, carte: 30, ultimaPescata: 92 }), { visibile: true, attesa: 12 });
  // chiamata accorciata dalla chiusura della stanza: l'ultimo minuto è quello prima della fine vera
  assert.equal(pulsanteCarte({ secondi: 250, durata: 300, carte: 30 }).visibile, false);
});

test("il suggerimento compare una sola volta, a 0:30, per 8 secondi, solo se nessuno ha pescato", () => {
  assert.equal(mostraSuggerimento({ secondi: 29, pescate: 0 }), false);
  assert.equal(mostraSuggerimento({ secondi: 30, pescate: 0 }), true);
  assert.equal(mostraSuggerimento({ secondi: 37, pescate: 0 }), true);
  assert.equal(mostraSuggerimento({ secondi: 38, pescate: 0 }), false);
  assert.equal(mostraSuggerimento({ secondi: 31, pescate: 1 }), false);
});

test("il server rifiuta una pescata troppo presto o fuori tempo (anche via API)", () => {
  assert.equal(puoPescare({ secondi: 5, durata: 900, carte: 30 }).motivo, "fuori_tempo");
  assert.equal(puoPescare({ secondi: 850, durata: 900, carte: 30 }).motivo, "fuori_tempo");
  assert.equal(puoPescare({ secondi: 100, durata: 900, carte: 30, ultimaPescata: 85 }).motivo, "troppo_presto");
  assert.deepEqual(puoPescare({ secondi: 100, durata: 900, carte: 30, ultimaPescata: 80 }), { ok: true });
  assert.equal(puoPescare({ secondi: 100, durata: 900, carte: 0 }).motivo, "nessuna_carta");
});

test("30 pescate della stessa coppia nella settimana: nessuna carta si ripete; poi si ricomincia", () => {
  let seme = 7;
  const casuale = () => ((seme = (seme * 1103515245 + 12345) % 2147483648) / 2147483648);
  const viste = new Set();
  for (let i = 0; i < 30; i++) {
    const { id, ricomincia } = pescaCarta(CARTE, viste, casuale);
    assert.equal(ricomincia, false);
    assert.equal(viste.has(id), false);
    viste.add(id);
  }
  assert.equal(viste.size, 30);
  const dopo = pescaCarta(CARTE, viste, casuale);
  assert.equal(dopo.ricomincia, true);
  assert.ok(CARTE.some((c) => c.id === dopo.id));
  assert.equal(pescaCarta([], new Set(), casuale), null);
});
