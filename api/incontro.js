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
});

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
