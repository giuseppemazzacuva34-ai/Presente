// Chiamate solo voce (issue #4, passo 3b-1): lo stato di UNA chiamata, deciso dal server.
// Solo calcoli su un oggetto semplice, così si prova tutto con dati inventati: chi lo conserva (un Durable Object per
// chiamata, passo 3b-2) chiama queste funzioni una alla volta, quindi «vale il primo tocco» viene da sé.
// Fasi: squilla (30 s) → in_corso (15:00 o chiusura della stanza) → finita.
// Il registro (tabella `chiamate`, PR #146) riceve UNA riga solo per le chiamate risposte, con solo
// chi / con / inizio / durata / esito (spec v1.1). Uno squillo senza risposta, rifiutato o annullato non si registra.
// Le sessioni Cloudflare Realtime restano qui dentro: il telefono non le vede mai (vistaPer).
// Nessun audio, nessun testo della conversazione: qui entrano solo tempi, id e numeri di carta.

import {
  CHIAMATA, fineChiamata, timer, durataFinale, rigaRegistro, pulsanteCarte, mostraSuggerimento, puoPescare, pescaCarta,
} from "./chiamate.js";

const no = (motivo) => ({ ok: false, motivo });
const ms = (d) => d.getTime();
const partecipa = (c, id) => id === c.chi || id === c.con;
const ESITI_DAL_TELEFONO = new Set(["chiusa", "chiudi_e_segnala"]);

export function nuovaChiamata({ chi, con, adesso, chiusuraStanza, sessioneChi, midChi }) {
  return {
    fase: "squilla", chi, con,
    chiusuraStanza: ms(chiusuraStanza),
    scadeSquillo: ms(adesso) + CHIAMATA.squillo * 1000,
    sessioni: { [chi]: { sessione: sessioneChi, mid: midChi } },
    inizio: null, fine: null, cadutoDal: null, caduto: null,
    pescate: 0, ultimaPescata: null, carta: null,
  };
}

function finisci(c, quando, esito) {
  const fino = c.cadutoDal !== null && esito === "caduta" ? c.cadutoDal : quando;
  const riga = c.fase === "in_corso"
    ? rigaRegistro({ chi: c.chi, con: c.con, inizio: new Date(c.inizio).toISOString(),
      durata: durataFinale(new Date(c.inizio), new Date(c.fine), new Date(fino)), esito })
    : null;
  const daChiudere = Object.values(c.sessioni).map((x) => x.sessione);
  return { ok: true, stato: { ...c, fase: "finita", carta: null }, riga, daChiudere, segnala: esito === "chiudi_e_segnala" };
}

export function rispondi(c, { da, adesso, sessione, mid }) {
  if (c.fase !== "squilla") return no("gia_finita");
  if (da !== c.con) return no("non_tocca_a_te");
  if (ms(adesso) >= c.scadeSquillo) return no("squillo_finito");
  const inizio = ms(adesso);
  const fine = ms(fineChiamata(adesso, new Date(c.chiusuraStanza)));
  return { ok: true, stato: { ...c, fase: "in_corso", inizio, fine, sessioni: { ...c.sessioni, [da]: { sessione, mid } } } };
}

export function rifiuta(c, { da, adesso }) {
  if (c.fase !== "squilla") return no("gia_finita");
  if (da !== c.con) return no("non_tocca_a_te");
  return finisci(c, ms(adesso), "chiusa");
}

// «Chiudi» o «Chiudi e segnala» da uno dei due. Durante lo squillo chi chiama annulla (nessuna riga).
export function chiudi(c, { da, adesso, esito }) {
  if (c.fase === "finita") return no("gia_finita");
  if (!partecipa(c, da)) return no("non_tocca_a_te");
  if (!ESITI_DAL_TELEFONO.has(esito)) return no("esito");
  return finisci(c, ms(adesso), esito);
}

// Il server si accorge che il telefono di «da» non è più collegato: parte il conto dei 30 secondi.
export function caduta(c, { da, adesso }) {
  if (c.fase !== "in_corso") return no("non_in_corso");
  if (!partecipa(c, da)) return no("non_tocca_a_te");
  if (c.cadutoDal !== null) return { ok: true, stato: c };
  return { ok: true, stato: { ...c, cadutoDal: ms(adesso), caduto: da } };
}

// Rientro entro 30 secondi con una sessione nuova; la vecchia va chiusa. Il timer non si ferma.
export function rientro(c, { da, adesso, sessione, mid }) {
  if (c.fase !== "in_corso") return no("non_in_corso");
  if (c.caduto !== da) return no("non_tocca_a_te");
  if (ms(adesso) >= c.cadutoDal + CHIAMATA.riconnessione * 1000) return no("troppo_tardi");
  const vecchia = c.sessioni[da]?.sessione;
  return { ok: true, stato: { ...c, cadutoDal: null, caduto: null, sessioni: { ...c.sessioni, [da]: { sessione, mid } } },
    daChiudere: vecchia ? [vecchia] : [] };
}

// --- Passo 3b-2b-2c-2a: ricevere la voce dell'altra persona -------------------------------------------------------
// Ognuno, a chiamata in corso, «ascolta» la traccia «voce» dell'altra persona sulla PROPRIA sessione Realtime.
// Le sessioni le usa solo il server (api/apri_chiamata.js): al telefono la vista dice solo «da_fare» / «fatto».
const MID = /^[A-Za-z0-9_-]{1,32}$/;
const altraDi = (c, per) => (per === c.chi ? c.con : c.chi);

// Le due sessioni per ascoltare: la mia e quella dell'altra persona. Durante un rientro non c'è niente da ascoltare.
export function sessioniPer(c, per) {
  if (c.fase !== "in_corso") return no("non_in_corso");
  if (!partecipa(c, per)) return no("non_tocca_a_te");
  if (c.caduto !== null) return no("riconnessione");
  const mia = c.sessioni[per]?.sessione, altra = c.sessioni[altraDi(c, per)]?.sessione;
  return mia && altra ? { ok: true, mia, altra } : no("non_in_corso");
}

// Salva il mid della traccia ricevuta (di = sessione dell'altra persona da cui arriva). Se nel frattempo l'altra
// persona è rientrata con una sessione nuova: «cambiata». Un ascolto precedente si chiude (chiudiTracce).
export function ascolto(c, { da, mid, di }) {
  const s = sessioniPer(c, da);
  if (!s.ok) return s;
  if (typeof mid !== "string" || !MID.test(mid)) return no("mid");
  if (s.altra !== di) return no("cambiata");
  const io = c.sessioni[da];
  const vecchio = io.ascolto && io.ascolto.mid !== mid ? [{ sessione: s.mia, mids: [io.ascolto.mid] }] : [];
  return { ok: true, stato: { ...c, sessioni: { ...c.sessioni, [da]: { ...io, ascolto: { mid, di } } } }, chiudiTracce: vecchio };
}

// Il prossimo istante in cui il server deve guardare la chiamata (allarme del Durable Object), null se è finita.
export function prossimoAllarme(c) {
  if (c.fase === "squilla") return c.scadeSquillo;
  if (c.fase !== "in_corso") return null;
  return c.cadutoDal === null ? c.fine : Math.min(c.fine, c.cadutoDal + CHIAMATA.riconnessione * 1000);
}

// Controllo all'allarme: squillo scaduto, 15 minuti finiti, rientro mancato. Se nulla è scaduto lo stato non cambia.
export function scadenze(c, adesso) {
  const t = ms(adesso);
  if (c.fase === "squilla" && t >= c.scadeSquillo) return { ...finisci(c, t, "chiusa"), riga: null };
  if (c.fase === "in_corso") {
    if (c.cadutoDal !== null && t >= c.cadutoDal + CHIAMATA.riconnessione * 1000 && c.cadutoDal < c.fine) {
      return finisci(c, t, "caduta");
    }
    if (t >= c.fine) return finisci(c, t, "tempo_scaduto");
  }
  return { ok: true, stato: c, riga: null, daChiudere: [] };
}

const secondiDa = (c, adesso) => Math.floor((ms(adesso) - c.inizio) / 1000);
const durata = (c) => Math.round((c.fine - c.inizio) / 1000);

// Pescata di una carta (spec v1.2). carte: righe attive · viste: Set degli id già visti dalla coppia nella stanza.
// ricomincia = true vuol dire che il mazzo è finito: chi conserva le carte viste della coppia le azzera.
export function pesca(c, { da, adesso, carte, viste, casuale }) {
  if (c.fase !== "in_corso") return no("non_in_corso");
  if (!partecipa(c, da)) return no("non_tocca_a_te");
  const secondi = secondiDa(c, adesso);
  const ok = puoPescare({ secondi, durata: durata(c), carte: carte?.length || 0, ultimaPescata: c.ultimaPescata });
  if (!ok.ok) return no(ok.motivo);
  const scelta = pescaCarta(carte, viste, casuale);
  return { ok: true, carta: scelta.id, ricomincia: scelta.ricomincia,
    stato: { ...c, pescate: c.pescate + 1, ultimaPescata: secondi, carta: { id: scelta.id, da } } };
}

// Quello che vede il telefono di «per». Mai le sessioni, mai gli id Realtime. carte: quante carte attive (0 = niente pulsante).
export function vistaPer(c, per, adesso, carte = 0) {
  if (!partecipa(c, per)) return null;
  const io = per === c.chi ? "chiama" : "riceve";
  if (c.fase === "squilla") {
    return { fase: "squilla", io, squillo: Math.max(0, Math.ceil((c.scadeSquillo - ms(adesso)) / 1000)) };
  }
  if (c.fase === "finita") return { fase: "finita", io };
  const t = timer(new Date(c.inizio), new Date(c.fine), adesso);
  const secondi = secondiDa(c, adesso);
  const altra = per === c.chi ? c.con : c.chi;
  return {
    fase: "in_corso", io,
    restanti: t.restanti, ultimoMinuto: t.ultimoMinuto,
    altraPersona: c.caduto === altra ? "riconnessione" : "collegata",
    carte: pulsanteCarte({ secondi, durata: durata(c), carte, ultimaPescata: c.ultimaPescata }),
    suggerimento: mostraSuggerimento({ secondi, pescate: c.pescate }),
    carta: c.carta ? { id: c.carta.id, daMe: c.carta.da === per } : null,
    ascolto: c.sessioni[per]?.ascolto && c.sessioni[per].ascolto.di === c.sessioni[altra]?.sessione ? "fatto" : "da_fare",
  };
}
