// Chiamate solo voce (Fase 2, issue #4, spec v1, v1.1 e v1.2 del CPO; D31 B, D32 A, D58 A).
// Questo file gira SOLO sul server: nessuna chiamata a database, a Cloudflare Realtime o ad altri servizi, solo regole
// su dati già letti, così si prova tutto con dati inventati. Le chiamate non si registrano e non si analizzano: qui non
// entra mai audio, e il registro tiene solo chi, quando, durata e come è finita (spec v1.1).
// Il diario, il profilo e il questionario non entrano mai nelle carte (spec v1.2, «Cosa NON fa»).

import { FUSO } from "./stanze.js";

export const CHIAMATA = Object.freeze({
  durataMassima: 900, // 15 minuti
  conStessaPersona: 3, // nella settimana della stanza
  alGiorno: 5, // fatte o ricevute, giorno di Roma
  minimoPerContare: 60, // sotto: caduta o rifiuto, non conta
  squillo: 30,
  riconnessione: 30,
  ultimoMinuto: 60,
});

export const CARTE = Object.freeze({ versione: "v1", dopo: 10, attesa: 20, suggerimentoA: 30, suggerimentoPer: 8 });

export const ESITI = Object.freeze(["tempo_scaduto", "chiusa", "chiudi_e_segnala", "caduta"]);

const TESTI = Object.freeze({
  occupato: "È in un'altra chiamata",
  tre_con_lei: "Avete già parlato 3 volte. Ora tocca alle chiavi",
  cinque_oggi: "Per oggi hai fatto 5 chiamate. A domani",
  serve_permesso: "Chiedi di parlare",
});

export const contaNeiLimiti = (durata) => Number.isFinite(durata) && durata >= CHIAMATA.minimoPerContare;

const formatoGiorno = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });
const formatoOra = new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const giornoDiRoma = (istante) => formatoGiorno.format(istante);
const minutiDiRoma = (istante) => { const [h, m] = formatoOra.format(istante).split(":").map(Number); return h * 60 + m; };
const minuti = (hhmm) => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// Fascia di disponibilità di chi riceve (D31 B), ore di Roma «HH:MM». Senza fascia: sempre disponibile.
// «da» > «a» vuol dire che passa la mezzanotte (22:00–01:00). «a» è escluso.
export function dentroFascia(fascia, adesso) {
  if (!fascia) return true;
  const da = minuti(fascia.da), a = minuti(fascia.a);
  if (da === null || a === null || da === a) return true;
  const ora = minutiDiRoma(adesso);
  return da < a ? ora >= da && ora < a : ora >= da || ora < a;
}

const no = (motivo, testo) => (testo ? { ok: false, motivo, testo } : { ok: false, motivo });
const partecipa = (c, id) => c.chi === id || c.con === id;

// Può «chi» chiamare «verso» adesso? Tutti i controlli del passo 2 del flusso (docs/architettura.md), nell'ordine.
// stanza: { apre, chiude, membri: [id] } · chiamate: righe del registro { chi, con, inizio, durata } (durata in secondi,
// null se in corso) · blocchi: [{ chi, bloccato }] · inChiamata: Set degli id in una chiamata aperta ·
// fascia: fascia di «verso» · soloConPermesso + permessi (Set di chi ha il permesso di «verso», D32).
export function puoChiamare({ chi, verso, adesso, stanza, chiamate = [], blocchi = [], inChiamata = new Set(), fascia = null,
  soloConPermesso = false, permessi = new Set() }) {
  const membri = new Set(stanza?.membri || []);
  if (!chi || !verso || chi === verso || !membri.has(chi) || !membri.has(verso)) return no("non_in_stanza");
  const t = adesso.getTime();
  if (t < stanza.apre.getTime() || t >= stanza.chiude.getTime()) return no("stanza_chiusa");
  if (t >= stanza.chiude.getTime() - CHIAMATA.ultimoMinuto * 1000) return no("stanza_chiude");
  if (blocchi.some((b) => (b.chi === chi && b.bloccato === verso) || (b.chi === verso && b.bloccato === chi))) return no("bloccati");
  if (inChiamata.has(chi)) return no("gia_in_chiamata");
  if (inChiamata.has(verso)) return no("occupato", TESTI.occupato);

  const valide = chiamate.filter((c) => contaNeiLimiti(c.durata));
  const inSettimana = (c) => { const i = new Date(c.inizio).getTime(); return i >= stanza.apre.getTime() && i < stanza.chiude.getTime(); };
  const tra = valide.filter((c) => inSettimana(c) && partecipa(c, chi) && partecipa(c, verso)).length;
  if (tra >= CHIAMATA.conStessaPersona) return no("tre_con_lei", TESTI.tre_con_lei);

  const oggi = giornoDiRoma(adesso);
  const diOggi = (id) => valide.filter((c) => partecipa(c, id) && giornoDiRoma(new Date(c.inizio)) === oggi).length;
  if (diOggi(chi) >= CHIAMATA.alGiorno) return no("cinque_oggi", TESTI.cinque_oggi);
  if (diOggi(verso) >= CHIAMATA.alGiorno) return no("cinque_oggi_lei");

  if (!dentroFascia(fascia, adesso)) return no("fuori_fascia", `Disponibile da ${fascia.da}`);
  if (soloConPermesso && !permessi.has(chi)) return no("serve_permesso", TESTI.serve_permesso);
  return { ok: true };
}

// Fine decisa dal server: 15 minuti dall'inizio, o la chiusura della stanza (domenica 21:00) se arriva prima.
export function fineChiamata(inizio, chiusuraStanza) {
  return new Date(Math.min(inizio.getTime() + CHIAMATA.durataMassima * 1000, chiusuraStanza.getTime()));
}

export function timer(inizio, fine, adesso) {
  const restanti = Math.max(0, Math.ceil((fine.getTime() - adesso.getTime()) / 1000));
  return { restanti, ultimoMinuto: restanti <= CHIAMATA.ultimoMinuto, finita: restanti === 0 };
}

// Secondi interi da salvare nel registro, mai oltre la fine decisa dal server.
export function durataFinale(inizio, fine, chiusa) {
  const fino = Math.min(chiusa.getTime(), fine.getTime());
  return Math.max(0, Math.floor((fino - inizio.getTime()) / 1000));
}

// Riga del registro chiamate: SOLO questi campi (criterio v1.1 «il registro contiene solo i 4 campi»).
export function rigaRegistro({ chi, con, inizio, durata, esito }) {
  if (!ESITI.includes(esito)) throw new Error("esito non valido");
  return { chi, con, inizio, durata, esito };
}

// ── Carte della conversazione (spec v1.2) ──
export const carteAttive = (righe) => (righe || []).filter((c) => c.versione === CARTE.versione && c.attiva === true);

// secondi: dall'inizio della chiamata · durata: secondi tra inizio e fine decisa dal server · carte: quante attive ·
// ultimaPescata: secondo della pescata precedente della chiamata (se c'è).
export function pulsanteCarte({ secondi, durata, carte, ultimaPescata = null }) {
  const visibile = carte > 0 && secondi >= CARTE.dopo && secondi < durata - CHIAMATA.ultimoMinuto;
  const attesa = ultimaPescata === null ? 0 : Math.max(0, CARTE.attesa - (secondi - ultimaPescata));
  return { visibile, attesa: visibile ? attesa : 0 };
}

export const mostraSuggerimento = ({ secondi, pescate }) =>
  pescate === 0 && secondi >= CARTE.suggerimentoA && secondi < CARTE.suggerimentoA + CARTE.suggerimentoPer;

export function puoPescare(stato) {
  if (!(stato.carte > 0)) return no("nessuna_carta");
  const p = pulsanteCarte(stato);
  if (!p.visibile) return no("fuori_tempo");
  if (p.attesa > 0) return no("troppo_presto");
  return { ok: true };
}

// Carta nuova per la coppia: casuale tra quelle non ancora viste nella settimana; finito il mazzo si ricomincia.
// casuale: funzione che dà un numero in [0, 1) (sul server crypto.getRandomValues, nei test un seme fisso).
export function pescaCarta(carte, viste, casuale) {
  if (!carte?.length) return null;
  const nuove = carte.filter((c) => !viste.has(c.id));
  const ricomincia = nuove.length === 0;
  const mazzo = ricomincia ? carte : nuove;
  return { id: mazzo[Math.min(mazzo.length - 1, Math.floor(casuale() * mazzo.length))].id, ricomincia };
}
