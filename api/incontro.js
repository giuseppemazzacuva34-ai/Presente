// Dopo il doppio sì: proposta d'incontro, check-in e segnale, buca, valutazione (Fase 2, issue #6, spec v1 del CPO
// del 3/11; D17 A per i tempi, D12 A e D18 A per i crediti, D20 A per la valutazione, D32 A per la sicurezza).
// Questo file gira SOLO sul server: nessuna chiamata a database o ad altri servizi, solo regole su dati già letti,
// così si prova tutto con dati inventati. Nessuna posizione GPS: qui non entra mai.
// Tutti gli orari sono in ora di Roma, anche con il cambio d'ora (spec, «Casi limite»).
// In beta i crediti sono un contatore interno, senza soldi veri (Stripe in Fase 4).
import { FUSO, oraDiRoma } from "./stanze.js";

export const INCONTRO = Object.freeze({
  giorniStessaArea: 10, // dal doppio sì (D17 A, #3 v1.2)
  giorniAreeDiverse: 30,
  primaOra: 10, // primo orario proponibile, 10:00
  ultimaOra: 23, // ultimo orario proponibile, 23:00 compreso
  passoMinuti: 30,
  controproposte: 3, // in tutto, poi solo «Accetto» o «Annulla» (da confermare con Giuseppe, valore in configurazione)
  propostaOre: 48, // una proposta senza risposta scade dopo 48 ore (o alla scadenza dell'incontro, se prima)
  disdettaGratisOre: 6, // fino a 6 ore prima la disdetta non costa nulla (torna «da fissare»); dopo è una buca (salvo «Sono in difficoltà»)
  checkinPrimaMinuti: 30, // «Sono qui» da 30 minuti prima…
  checkinDopoMinuti: 30, // …a 30 minuti dopo l'ora (da confermare con Giuseppe, valore in configurazione)
  ritardi: Object.freeze([15, 30]), // «Arrivo in ritardo», una volta sola
  avvisoQuiMinuti: 15, // «Avvisa <nome> che sei qui»: dopo 15 minuti di attesa (dal più tardi tra «Sono qui» e l'ora), una volta sola
  cambioLuogoPrimaMinuti: 60, // «Cambia luogo» (e la conferma dell'altra persona) fino a 1 ora prima; senza conferma resta il luogo vecchio
  caparra: 100, // Coin: la stessa caparra bloccata per lo svelamento (#65; #331)
  bucaAChiAspetta: 70, // D12 A, in Coin (#331)
  bucaAPresente: 30,
});

const MINUTO = 60000;
const no = (motivo) => ({ ok: false, motivo });

// Giorno, ora e minuti di Roma di un istante.
function campiRoma(istante) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: FUSO, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(istante).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
  return { anno: p.year, mese: p.month, giorno: p.day, ora: p.hour, minuti: p.minute, secondi: p.second };
}

// Lo stesso orario di Roma «giorni» giorni dopo (non 24 ore × giorni: a cavallo del cambio d'ora resta la stessa ora).
function giorniDopo(istante, giorni) {
  const c = campiRoma(istante);
  const giorno = new Date(Date.UTC(c.anno, c.mese - 1, c.giorno + giorni));
  const base = oraDiRoma(giorno.getUTCFullYear(), giorno.getUTCMonth() + 1, giorno.getUTCDate(), c.ora, c.minuti);
  return new Date(base.getTime() + c.secondi * 1000 + (istante.getTime() % 1000));
}

// Scadenza per vedersi: doppio sì + 10 giorni (stessa provincia) o + 30 (province diverse). La calcola il server.
export const scadenzaIncontro = (doppioSi, stessaArea) =>
  giorniDopo(new Date(doppioSi), stessaArea ? INCONTRO.giorniStessaArea : INCONTRO.giorniAreeDiverse);

// Orario di una proposta: da domani alle 10:00 fino alla scadenza, ogni 30 minuti, solo tra 10:00 e 23:00.
// Si controlla anche via API, non solo nel selettore della schermata.
export function controllaOrario({ orario, adesso, scadenza }) {
  const quando = new Date(orario);
  if (Number.isNaN(quando.getTime())) return no("orario_non_valido");
  const oggi = campiRoma(new Date(adesso));
  const domaniDieci = oraDiRoma(oggi.anno, oggi.mese, oggi.giorno + 1, INCONTRO.primaOra);
  if (quando < domaniDieci) return no("prima_di_domani");
  const c = campiRoma(quando);
  const minutiDelGiorno = c.ora * 60 + c.minuti;
  if (minutiDelGiorno < INCONTRO.primaOra * 60 || minutiDelGiorno > INCONTRO.ultimaOra * 60) return no("fuori_orario");
  if (c.minuti % INCONTRO.passoMinuti !== 0 || c.secondi !== 0 || quando.getTime() % 1000 !== 0) return no("non_sul_passo");
  if (quando > new Date(scadenza)) return no("dopo_la_scadenza");
  return { ok: true };
}

// Pulsanti per chi riceve una proposta: dopo 3 controproposte in tutto restano solo «Accetto» e «Annulla».
export const risposteProposta = (controproposteFatte) =>
  controproposteFatte >= INCONTRO.controproposte ? ["accetto", "annulla"] : ["accetto", "altra_data", "annulla"];

// ── Disdetta, check-in e buca. ──

// Movimenti di crediti della buca di «assente»: a chi ha aspettato tornano i suoi 100 più 70; a Presente 30 (Coin, #331).
// A chi manca non torna nulla. La somma (100 + 70 + 30) è uguale alle due caparre bloccate: nessun credito si crea o si perde.
function buca(assente, a, b) {
  const presente = assente === a ? b : a;
  return {
    esito: assente === a ? "buca_a" : "buca_b",
    movimenti: [
      { persona: presente, tipo: "caparra_restituita", crediti: INCONTRO.caparra },
      { persona: presente, tipo: "buca_ricevuta", crediti: INCONTRO.bucaAChiAspetta },
    ],
    presente: INCONTRO.bucaAPresente,
  };
}
const restituzione = (a, b) => [a, b].map((persona) => ({ persona, tipo: "caparra_restituita", crediti: INCONTRO.caparra }));

// «Disdici». Fino a 6 ore prima (spec v1.1): l'incontro torna «da fissare», le caparre restano bloccate e i crediti
// tornano a entrambi solo alla scadenza senza nuovo appuntamento o con «Annulla l'incontro» (public.disdici_incontro).
// Dopo: buca di chi disdice, tranne con «Sono in difficoltà» (#7), che non toglie crediti e passa alla revisione (D51 A).
export function disdetta({ orario, adesso, chi, a, b, difficolta = false }) {
  const mancano = new Date(orario).getTime() - new Date(adesso).getTime();
  if (mancano >= INCONTRO.disdettaGratisOre * 60 * MINUTO) {
    return { esito: "disdetto", stato: "da_fissare", restituisci: [], movimenti: [], presente: 0, penale: 0 };
  }
  if (difficolta) return { esito: "in_revisione", restituisci: [], movimenti: [], presente: 0, penale: 0 };
  return { ...buca(chi, a, b), penale: INCONTRO.caparra };
}

// «Arrivo in ritardo»: +15 o +30 minuti, una volta sola per incontro.
export function ritardo({ minuti, giaUsato }) {
  if (giaUsato) return no("ritardo_gia_usato");
  if (!INCONTRO.ritardi.includes(minuti)) return no("ritardo_non_valido");
  return { ok: true, minuti };
}

// Finestra del check-in: da 30 minuti prima a 30 minuti dopo l'ora (più l'eventuale ritardo dichiarato), fine esclusa.
export function finestraCheckin({ orario, ritardoMinuti = 0 }) {
  const ora = new Date(orario).getTime();
  return {
    da: new Date(ora - INCONTRO.checkinPrimaMinuti * MINUTO),
    a: new Date(ora + (INCONTRO.checkinDopoMinuti + ritardoMinuti) * MINUTO),
  };
}

// «Sono qui» funziona solo dentro la finestra, anche via API.
export function puoCheckin({ orario, ritardoMinuti = 0, adesso }) {
  const f = finestraCheckin({ orario, ritardoMinuti });
  const ora = new Date(adesso);
  if (ora < f.da) return no("troppo_presto");
  if (ora >= f.a) return no("troppo_tardi");
  return { ok: true };
}

// Esito dell'incontro confermato. checkin = { a: Date|null, b: Date|null }.
// Entrambi → avvenuto subito, caparre sbloccate, valutazione aperta. Alla fine della finestra: uno solo → buca dell'altro;
// nessuno → crediti a entrambi, niente valutazione (solo il messaggio di controllo).
// nonRiesco = { a?, b? }: «Non riesco a fare il check-in» mandato nella finestra (spec #6 v1.4 punto 1) → per chi manca
// nessuna penale finché non decide una persona: esito «contestato», caparre ancora bloccate.
export function esitoIncontro({ orario, ritardoMinuti = 0, checkin, nonRiesco = {}, adesso, a, b }) {
  if (checkin?.a && checkin?.b) return { esito: "avvenuto", movimenti: restituzione(a, b), presente: 0, valutazione: true };
  if (new Date(adesso) < finestraCheckin({ orario, ritardoMinuti }).a) return { esito: "in_corso", movimenti: [], presente: 0, valutazione: false };
  if ((checkin?.a && nonRiesco.b) || (checkin?.b && nonRiesco.a)) return { esito: "contestato", movimenti: [], presente: 0, valutazione: false };
  if (checkin?.a) return { ...buca(b, a, b), valutazione: false };
  if (checkin?.b) return { ...buca(a, a, b), valutazione: false };
  return { esito: "nessun_checkin", movimenti: restituzione(a, b), presente: 0, valutazione: false };
}
