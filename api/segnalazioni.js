// Segnalazioni, blocco, sanzioni e ricorsi (Fase 2, issue #7, spec v1.1 definitiva del CPO; D32 A, D51 A, D9).
// Questo file gira SOLO sul server e fa solo calcoli su dati già letti: nessun database, nessun servizio esterno,
// così si prova tutto con dati inventati. Nessuna registrazione delle chiamate esiste o si usa (D32 A).
// Qui non entrano mai il diario, il questionario o le risposte «la richiameresti?» (spec #7, «Cosa NON fa»).
// Ogni sanzione oltre la sospensione cautelare o automatica la decide una persona: qui ci sono solo le regole.

import { MOTIVI_SOSPENSIONE_IMMEDIATA } from "./regole.js";

// Motivo → ore entro cui una persona deve leggere la segnalazione (Regole della community).
export const MOTIVI = Object.freeze({
  contatti_prima_porta: 72, // «Ha chiesto numero, cognome o social prima della porta»
  insulti: 24,
  contenuti_sessuali: 24,
  minacce_pericolo: 1,
  sembra_minorenne: 1,
  profilo_falso: 72,
  soldi: 24,
  diffusione_immagini: 24,
  altro: 72,
  sono_in_difficolta: 1, // pulsante «Sono in difficoltà»
  non_al_sicuro: 1, // «Non mi sono sentita/o al sicuro» nella valutazione (#6)
});

// I punti da cui si arriva al modulo (spec #7, passo 1, più i casi limite).
export const ORIGINI = Object.freeze(["chiudi_e_segnala", "dopo_chiamata", "scheda", "valutazione", "sono_in_difficolta", "storico_chiamate"]);

export const LIVELLI = Object.freeze({
  avviso: Object.freeze({ giorni: 0 }),
  sospensione_7: Object.freeze({ giorni: 7 }),
  sospensione_30: Object.freeze({ giorni: 30 }),
  esclusione: Object.freeze({ giorni: null }), // definitiva
});

export const LIMITI = Object.freeze({
  testoSegnalazione: 1000,
  testoRicorso: 2000,
  ricorsoAllegati: 3,
  ricorsoByteAllegato: 5 * 1024 * 1024,
  ricorsoEntroGiorni: 14,
  ricorsiPerSanzione: 1,
  rispostaRicorsoGiorni: 7,
  rispostaRicorsoEsclusioneGiorni: 14,
  finestraAutomaticaGiorni: 30, // D32: 2 gravi da persone diverse in 30 giorni
  graviPerSospensioneAutomatica: 2,
  storicoGiorni: 30, // si segnala dallo storico delle chiamate entro 30 giorni
  nuovoAvvisoDopoMinuti: 30, // responsabile che non apre una segnalazione da 1 ora
  recidivaContattiMesi: 6,
});

const GIORNO = 24 * 3600 * 1000;
const ms = (t) => new Date(t).getTime();

export const priorita = (motivo) => (Object.hasOwn(MOTIVI, motivo) ? MOTIVI[motivo] : null);

export function scadenzaRevisione(motivo, creataIl) {
  const ore = priorita(motivo);
  return ore === null ? null : new Date(ms(creataIl) + ore * 3600 * 1000);
}

// Gravi = priorità 1 ora o 24 ore (contano per la sospensione automatica di D32).
export const grave = (motivo) => { const o = priorita(motivo); return o !== null && o <= 24; };

// Una sola segnalazione basta per la sospensione cautelare (D51 A, valori in regole.js).
export const cautelare = (motivo) => MOTIVI_SOSPENSIONE_IMMEDIATA.includes(motivo);

// «Chiudi e segnala» blocca sempre; altrove decide la casella «Blocca anche <nome>», che parte spuntata.
export const bloccaDopo = (origine, casella = true) => origine === "chiudi_e_segnala" || casella === true;

export function validaSegnalazione(r, adesso = new Date()) {
  if (!r || priorita(r.motivo) === null) return { ok: false, errore: "motivo" };
  if (!ORIGINI.includes(r.origine)) return { ok: false, errore: "origine" };
  const testo = r.testo ?? "";
  if (typeof testo !== "string" || testo.length > LIMITI.testoSegnalazione) return { ok: false, errore: "testo" };
  // Solo «Sono in difficoltà» può non riguardare una persona di Presente (casi limite).
  const senzaPersona = r.origine === "sono_in_difficolta" || r.motivo === "sono_in_difficolta";
  if (!senzaPersona && (typeof r.contro !== "string" || !r.contro)) return { ok: false, errore: "persona" };
  if (r.contro && r.da && r.contro === r.da) return { ok: false, errore: "persona" };
  if (r.origine === "storico_chiamate") {
    if (!r.chiamataIl || ms(adesso) - ms(r.chiamataIl) > LIMITI.storicoGiorni * GIORNO) return { ok: false, errore: "scaduta" };
  }
  return { ok: true };
}

// D32: due segnalazioni gravi da persone DIVERSE negli ultimi 30 giorni → sospensione in attesa di una persona.
// Ripetute dalla stessa persona contano una volta; quelle archiviate (infondate) non contano.
export function sospensioneAutomatica(segnalazioni, contro, adesso = new Date()) {
  const da = ms(adesso) - LIMITI.finestraAutomaticaGiorni * GIORNO;
  const chi = new Set();
  for (const x of segnalazioni || []) {
    if (x.contro !== contro || x.esito === "archiviata" || !grave(x.motivo)) continue;
    const t = ms(x.quando);
    if (t >= da && t <= ms(adesso)) chi.add(x.da);
  }
  return chi.size >= LIMITI.graviPerSospensioneAutomatica;
}

// Per le priorità da 1 ora: se nessuno l'ha aperta dopo 30 minuti, si avvisa di nuovo il responsabile.
export function nuovoAvvisoResponsabile(seg, adesso = new Date()) {
  if (priorita(seg.motivo) !== 1 || seg.apertaIl) return false;
  return ms(adesso) - ms(seg.quando) >= LIMITI.nuovoAvvisoDopoMinuti * 60 * 1000;
}

// Contatti chiesti prima della porta, confermati da una persona: avviso + uscita dalla stanza senza rimborso;
// se ce n'è già stata un'altra confermata negli ultimi 6 mesi, sospensione di 7 giorni.
export function sanzioneContatti(precedentiConfermate, adesso = new Date()) {
  const limite = new Date(adesso);
  limite.setUTCMonth(limite.getUTCMonth() - LIMITI.recidivaContattiMesi);
  const recidiva = (precedentiConfermate || []).some((q) => ms(q) >= limite.getTime() && ms(q) <= ms(adesso));
  return { livello: recidiva ? "sospensione_7" : "avviso", esceDallaStanza: true, rimborso: 0 };
}

export function ricorsoPermesso(sanzione, ricorsiFatti, adesso = new Date()) {
  if (!sanzione || !Object.hasOwn(LIVELLI, sanzione.livello)) return false;
  if ((ricorsiFatti || 0) >= LIMITI.ricorsiPerSanzione) return false;
  return ms(adesso) - ms(sanzione.quando) <= LIMITI.ricorsoEntroGiorni * GIORNO;
}

export function rispostaRicorsoEntro(livello, ricorsoIl) {
  const giorni = livello === "esclusione" ? LIMITI.rispostaRicorsoEsclusioneGiorni : LIMITI.rispostaRicorsoGiorni;
  return new Date(ms(ricorsoIl) + giorni * GIORNO);
}

const TIPI_IMMAGINE = Object.freeze(["image/jpeg", "image/png", "image/webp", "image/heic"]);

export function validaRicorso(r) {
  const testo = r?.testo;
  if (typeof testo !== "string" || !testo.trim() || testo.length > LIMITI.testoRicorso) return { ok: false, errore: "testo" };
  const allegati = r.allegati ?? [];
  if (!Array.isArray(allegati) || allegati.length > LIMITI.ricorsoAllegati) return { ok: false, errore: "allegati" };
  for (const a of allegati) {
    if (!TIPI_IMMAGINE.includes(a?.tipo) || !Number.isFinite(a?.byte) || a.byte > LIMITI.ricorsoByteAllegato) return { ok: false, errore: "allegati" };
  }
  return { ok: true };
}

// Chi segnala riceve solo uno di due testi: mai il dettaglio della sanzione.
export function esitoPerChiSegnala(esito) {
  return esito === "archiviata"
    ? "Abbiamo esaminato la tua segnalazione: non abbiamo trovato violazioni delle regole."
    : "Abbiamo esaminato la tua segnalazione e preso i provvedimenti necessari.";
}

// Cosa vede chi riceve una sanzione: livello, regola, fine e se può contestare. Mai chi ha segnalato né il suo racconto.
export function vistaSanzione(sanzione, ricorsiFatti, adesso = new Date()) {
  const giorni = LIVELLI[sanzione.livello]?.giorni;
  const fine = giorni ? new Date(ms(sanzione.quando) + giorni * GIORNO).toISOString() : null;
  return { livello: sanzione.livello, regola: sanzione.regola, fine, puoContestare: ricorsoPermesso(sanzione, ricorsiFatti, adesso) };
}
