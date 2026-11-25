// Il «telefono» della web app (issue #4, passo 3c-3b-2): unisce le persone della stanza (compagni.js), la sentinella
// (sentinella.js), la voce (voce.js) e le richieste /app/api/chiamata (chiamata.js) e dice alla home cosa mostrare.
//
// - Nessun dato personale oltre a quelli della scheda (nome, età, città) e nessun salvataggio locale.
// - Tempi, limiti e fasi li decide sempre il server: qui solo lo stato dello schermo.
// - Il microfono si spegne appena la chiamata finisce, in qualunque modo finisca.
// - Mai due azioni insieme (un tocco doppio non apre due chiamate).
// Le dipendenze si passano da fuori, così si prova con node --test senza pagina, rete o microfono.

import { schermata, schermataDopo, testoMotivo } from "./chiamata.js";
import { schedaCompagno, nomeInChiamata } from "./compagni.js";
import { schermataDiario, controllaTesto } from "./diario.js";

const TESTI_EXTRA = Object.freeze({
  microfono_negato: "Per chiamare serve il microfono. Consentilo nelle impostazioni del telefono e riprova",
  microfono_assente: "Non troviamo un microfono su questo telefono. Prova da un altro dispositivo",
  solo_voce: "Non riusciamo ad avviare la voce. Riprova tra poco",
  lettura: "Non riusciamo a vedere la tua stanza. Riprova tra poco",
  // Diario (#5 passo 2): la nota non è salvata, il testo resta sullo schermo.
  vuoto: "Scrivi qualcosa, oppure tocca «Salta»",
  lungo: "Al massimo 1000 caratteri",
  rifiutato: "Non riusciamo a salvare la nota. Riprova tra poco",
  non_valida: "Non riusciamo a salvare la nota. Riprova tra poco",
});
// Fuori fascia il server manda l'orario («Disponibile da 19:00»): si usa solo se ha esattamente quella forma.
const TESTO_FASCIA = /^Disponibile (da|domani dalle) ([01]?[0-9]|2[0-4]):[0-5][0-9]$/;
export const testoErrore = (motivo, testo) => {
  if (motivo === "fuori_fascia" && TESTO_FASCIA.test(String(testo || ""))) return testo;
  return Object.hasOwn(TESTI_EXTRA, motivo) ? TESTI_EXTRA[motivo] : testoMotivo(motivo);
};

const ATTIVE = new Set(["squilla", "in_corso"]);
const PAUSA_ASCOLTO_MS = 3000;

// diario: facoltativo, il modulo di diario.js (creaDiario) per il passo «diario» dopo «La richiameresti?».
export function creaTelefono({ compagni, linea, chiamata, voce, diario = null, subito = () => {}, cambiato = () => {}, adesso = () => Date.now() }) {
  const s = {
    persone: [], statoStanza: "attesa", erroreStanza: "",
    chiusa: false, // stanza appena chiusa (#5 passo 9): da domenica 21:00 a lunedì 9:00 schede in sola lettura
    ricarica: null, // rilettura in corso (ricaricaPersone), una alla volta
    testi: new Map(), // id → testo sul pulsante «Chiama» disattivato (spec v1.3 § 2, 3c-5b-2b)
    conteggi: new Map(), // id → chiamate fatte insieme nella settimana, da 1 a 3 («chiamate N di 3», #380)
    vista: null, nascondiFinita: false,
    voceAttiva: false, muto: false, riconnetti: false,
    visibileDal: null, ascoltoInCorso: false, ultimoAscolto: 0,
    attesa: false, errore: "",
    // Dopo la chiamata (3c-4b-2): risposta del server a /dopo, domanda già risposta, modulo di segnalazione da aprire.
    dopo: null, dopoChiesto: false, rientroChiesto: false, risposto: false, segnala: null,
    diarioFatto: false, // passo «diario» salvato o saltato
  };

  // Testi dei pulsanti dal server; se non arrivano i pulsanti restano «Chiama» e decide il server al tocco.
  let pulsantiInCorso = false;
  function leggiPulsanti() {
    if (typeof chiamata.pulsanti !== "function" || pulsantiInCorso) return Promise.resolve();
    pulsantiInCorso = true;
    return Promise.resolve().then(() => chiamata.pulsanti()).then((r) => {
      if (r && r.ok && Array.isArray(r.pulsanti)) {
        s.testi = new Map(r.pulsanti.map((x) => [x.id, x.testo]));
        s.conteggi = new Map((Array.isArray(r.chiamate) ? r.chiamate : []).map((x) => [x.id, x.n]));
        avvisa();
      }
    }, () => { /* nessun testo: restano «Chiama» */ }).finally(() => { pulsantiInCorso = false; });
  }

  const avvisa = () => { try { cambiato(); } catch { /* lo schermo non deve fermare il telefono */ } };

  function spegniVoce() {
    if (!s.voceAttiva) return;
    try { voce.chiudi(); } catch { /* già spenta */ }
    s.voceAttiva = false;
    s.muto = false;
    s.riconnetti = false;
  }

  function applica(vista) {
    const v = vista && typeof vista === "object" ? vista : null;
    if (!v || !ATTIVE.has(v.fase)) spegniVoce();
    if (v && v.fase !== "finita") s.nascondiFinita = false;
    if (v && ATTIVE.has(v.fase)) { s.dopo = null; s.dopoChiesto = false; s.risposto = false; s.segnala = null; s.diarioFatto = false; }
    if (v && v.fase === "finita" && !s.dopoChiesto && !s.segnala && !s.nascondiFinita) { s.dopoChiesto = true; chiediDopo(true); }
    if (v && v.fase === "in_corso") { if (s.visibileDal === null) s.visibileDal = adesso(); }
    else s.visibileDal = null;
    s.vista = v;
    if (v && ATTIVE.has(v.fase)) s.errore = "";
    ascoltaSeServe();
  }

  // Cosa mostrare dopo la chiamata lo dice il server (una richiesta per chiamata; al rientro una sola, per la domanda
  // rimasta in sospeso). Se non risponde resta «Chiamata finita» con «Torna alla stanza».
  function chiediDopo(appena) {
    Promise.resolve().then(() => chiamata.dopo(appena)).then((r) => {
      if (!r || !r.ok || !r.dopo || typeof r.dopo !== "object" || s.segnala) return;
      if (s.vista && ATTIVE.has(s.vista.fase)) return;
      s.dopo = r.dopo;
      s.risposto = false;
      s.diarioFatto = false;
      s.nascondiFinita = false;
      avvisa();
    }, () => { /* niente schermata «dopo»: resta la fine semplice */ });
  }

  // Appena l'altra persona è in linea si riceve la sua voce (una volta; nuovo tentativo dopo 3 s se non va).
  function ascoltaSeServe() {
    const v = s.vista;
    if (!v || v.fase !== "in_corso" || v.ascolto !== "da_fare" || v.altraPersona === "riconnessione") return;
    if (!s.voceAttiva || s.riconnetti || s.ascoltoInCorso || adesso() - s.ultimoAscolto < PAUSA_ASCOLTO_MS) return;
    s.ascoltoInCorso = true;
    s.ultimoAscolto = adesso();
    Promise.resolve().then(() => linea.ascolta()).then((r) => {
      s.ascoltoInCorso = false;
      if (r && r.ok && r.vista) applica(r.vista);
      avvisa();
    }, () => { s.ascoltoInCorso = false; });
  }

  // Un'azione alla volta; il risultato del server aggiorna lo schermo, poi la sentinella rilegge subito.
  async function azione(fai, { voceDopo = false } = {}) {
    if (s.attesa) return;
    s.attesa = true;
    s.errore = "";
    avvisa();
    let r;
    try { r = await fai(); } catch { r = { ok: false, motivo: "riprova" }; }
    s.attesa = false;
    if (r && r.ok) {
      if (voceDopo) s.voceAttiva = true;
      if (r.vista !== undefined) applica(r.vista);
    } else {
      s.errore = testoErrore(r && r.motivo, r && r.testo);
    }
    avvisa();
    try { subito(); } catch { /* la sentinella riprova da sola */ }
    return r;
  }

  const inChiamata = () => !!s.vista && ATTIVE.has(s.vista.fase);

  const rifAltra = () => s.vista || (s.dopo ? { altra: s.dopo.altra } : null);

  // Il passo «diario» c'è solo dopo la domanda, se il server ha dato i dati della chiamata e il modulo esiste.
  const passoDiario = () => !!diario && !!s.dopo && s.dopo.tipo === "richiameresti" && s.risposto && !s.diarioFatto
    && !!s.dopo.diario && typeof s.dopo.diario === "object";

  async function leggiPersone() {
    try { return await compagni.leggi(); } catch { return { ok: false, motivo: "rete" }; }
  }
  function applicaPersone(r) {
    s.persone = (Array.isArray(r.persone) ? r.persone : []).map((p) => ({ id: p.id, nome: p.nome, eta: p.eta ?? null, citta: p.citta || "" }));
    s.chiusa = r.chiusa === true && s.persone.length > 0;
    s.statoStanza = s.persone.length ? "pronta" : "vuota";
    s.erroreStanza = "";
    if (s.chiusa) s.testi = new Map();
  }

  function schermo() {
    if (s.segnala) return { tipo: "segnala", titolo: "Segnala un problema" };
    if (s.dopo && !s.nascondiFinita && !inChiamata()) {
      if (passoDiario()) return { tipo: "diario", ...schermataDiario(nomeInChiamata({ altra: s.dopo.altra }, s.persone)) };
      return schermataDopo(s.dopo, { nomeAltra: nomeInChiamata({ altra: s.dopo.altra }, s.persone), risposto: s.risposto });
    }
    if (!s.vista || (s.vista.fase === "finita" && s.nascondiFinita)) return { tipo: "nessuna" };
    const secondiVisti = s.visibileDal === null ? undefined : (adesso() - s.visibileDal) / 1000;
    return schermata(s.vista, { nomeAltra: nomeInChiamata(s.vista, s.persone), secondiVisti });
  }

  return {
    async caricaPersone() {
      if (s.statoStanza === "pronta" || s.statoStanza === "vuota" || s.statoStanza === "lettura") return;
      s.statoStanza = "lettura";
      const r = await leggiPersone();
      if (r && r.ok) applicaPersone(r);
      else {
        s.statoStanza = "errore";
        s.erroreStanza = testoErrore(r && r.motivo);
      }
      if (s.statoStanza === "pronta" && !s.chiusa) await leggiPulsanti();
      avvisa();
    },

    // Rilegge la stanza anche se era già pronta: dopo un blocco (richiesta di «sviluppatore-b»), alle 21:00 della
    // domenica (stanza chiusa) e lunedì alle 9:00. Se la rilettura non riesce restano le persone di prima.
    ricaricaPersone() {
      if (s.statoStanza === "lettura") return Promise.resolve();
      if (s.ricarica) return s.ricarica;
      if (s.statoStanza !== "pronta" && s.statoStanza !== "vuota") return this.caricaPersone();
      s.ricarica = (async () => {
        const r = await leggiPersone();
        if (r && r.ok) {
          applicaPersone(r);
          if (s.statoStanza === "pronta" && !s.chiusa) await leggiPulsanti();
          avvisa();
        }
      })().finally(() => { s.ricarica = null; });
      return s.ricarica;
    },

    // Risposta della sentinella (GET /app/api/chiamata).
    aggiorna(r) {
      if (!r || typeof r !== "object") return;
      if (r.ok === true) {
        applica(r.vista);
        if (!s.rientroChiesto) { s.rientroChiesto = true; if (!r.vista) chiediDopo(false); }
      }
      else if (r.motivo === "spento" || r.motivo === "accesso") applica(null);
      else return; // un buco di rete non chiude una chiamata: si rilegge tra poco
      avvisa();
    },

    chiama(id) {
      if (s.chiusa || inChiamata() || !s.persone.some((p) => p.id === id) || !schedaCompagno(s.persone.find((p) => p.id === id), { testo: s.testi.get(id) }).chiama) return Promise.resolve();
      return azione(() => linea.chiama(id), { voceDopo: true });
    },
    rispondi() {
      if (!s.vista || s.vista.fase !== "squilla" || s.vista.io !== "riceve") return Promise.resolve();
      return azione(() => linea.rispondi(), { voceDopo: true });
    },
    rifiuta() {
      if (!s.vista || s.vista.fase !== "squilla" || s.vista.io !== "riceve") return Promise.resolve();
      return azione(() => chiamata.rifiuta());
    },
    chiudi(segnala = false) {
      if (!inChiamata()) return Promise.resolve();
      const altra = s.vista.altra;
      // «Chiudi e segnala»: niente domanda né diario, si apre subito il modulo #7 con la persona collegata.
      if (segnala === true) s.segnala = { contro: altra, origine: "chiudi_e_segnala", chiamataIl: null };
      return azione(async () => {
        const r = await linea.chiudi(segnala === true);
        s.voceAttiva = false; // linea.chiudi spegne già il microfono
        s.muto = false;
        s.riconnetti = false;
        // Anche se il server risponde «già finita», per questo telefono la chiamata è chiusa.
        return { ok: true, vista: r && r.ok && r.vista ? r.vista : { fase: "finita", altra } };
      });
    },
    carta() {
      const sc = schermo();
      if (sc.tipo !== "in_corso" || !sc.carte || !sc.carte.attiva) return Promise.resolve();
      return azione(() => chiamata.carta());
    },
    microfono() {
      if (!s.voceAttiva) return;
      s.muto = !s.muto;
      try { voce.muto(s.muto); } catch { /* niente */ }
      avvisa();
    },
    // Dalla voce: la connessione è caduta. Il server fa partire i 30 secondi; qui appare «Riconnetti».
    async caduta() {
      if (!s.voceAttiva || !s.vista || s.vista.fase !== "in_corso") return;
      s.riconnetti = true;
      avvisa();
      try { const r = await chiamata.caduta(); if (r && r.ok && r.vista) applica(r.vista); } catch { /* si riprova con Riconnetti */ }
      avvisa();
    },
    riconnetti() {
      if (!s.riconnetti) return Promise.resolve();
      return azione(async () => {
        const r = await linea.riconnetti();
        if (r && r.ok) { s.riconnetti = false; s.ultimoAscolto = 0; }
        return r;
      });
    },
    // «La richiameresti?»: sì, no o salta. Se il salvataggio non va resta la domanda con l'errore.
    richiameresti(risposta) {
      if (!s.dopo || s.dopo.tipo !== "richiameresti" || s.risposto || !s.dopo.chiamata) return Promise.resolve();
      const quale = s.dopo.chiamata;
      return azione(async () => {
        const r = await chiamata.richiameresti(quale, risposta);
        if (r && r.ok) s.risposto = true;
        return r;
      });
    },
    // Diario: la nota va dritta su Supabase dal telefono, con persona, inizio e durata come li ha dati il server.
    // «gia_scritta» (doppio tocco o nota già salvata): si va avanti lo stesso.
    salvaDiario(testo) {
      if (!passoDiario()) return Promise.resolve();
      const { con, chiamataIl, durata } = s.dopo.diario;
      const c = controllaTesto(testo);
      if (!c.ok) { s.errore = testoErrore(c.motivo); avvisa(); return Promise.resolve(); }
      return azione(async () => {
        const r = await diario.salva({ con, chiamataIl, durata, testo });
        if ((r && r.ok) || (r && r.motivo === "gia_scritta")) { s.diarioFatto = true; return { ok: true }; }
        return r;
      });
    },
    saltaDiario() {
      if (!passoDiario()) return;
      s.diarioFatto = true;
      s.errore = "";
      avvisa();
    },
    // «Segnala un problema» in fondo alla schermata dopo la chiamata: il modulo #7 con persona e chiamata collegate.
    segnalaProblema() {
      const altra = s.dopo ? s.dopo.altra : s.vista && s.vista.fase === "finita" ? s.vista.altra : null;
      if (!altra) return;
      s.segnala = { contro: altra, origine: "dopo_chiamata", chiamataIl: s.dopo && s.dopo.chiamata ? s.dopo.chiamata.inizio : null };
      avvisa();
    },
    // «Torna alla stanza» dalla schermata «Chiamata finita», dal dopo chiamata o dal modulo di segnalazione.
    torna() {
      s.dopo = null;
      s.segnala = null;
      s.nascondiFinita = true;
      s.errore = "";
      avvisa();
      if (s.statoStanza === "pronta" && !s.chiusa) leggiPulsanti(); // dopo una chiamata i testi (3 volte, 5 al giorno) cambiano
    },

    modello() {
      const occupato = inChiamata();
      return {
        stanza: {
          stato: s.statoStanza,
          errore: s.erroreStanza,
          chiusa: s.chiusa,
          // Stanza chiusa: schede in sola lettura, nessun pulsante Chiama (né etichetta).
          persone: s.persone.map((p) => {
            const sc = schedaCompagno(p, { inChiamata: occupato, testo: s.testi.get(p.id) });
            const chiamate = s.conteggi.get(p.id) || 0;
            return s.chiusa ? { id: p.id, ...sc, chiama: false, etichetta: "", descrizione: sc.titolo, chiamate } : { id: p.id, ...sc, chiamate };
          }),
        },
        schermo: schermo(),
        nome: rifAltra() ? nomeInChiamata(rifAltra(), s.persone) : "",
        inCorsoCon: s.vista && s.vista.fase === "in_corso" && s.vista.altra ? s.vista.altra : null, // tasto «Regalo» (#349, linea B)
        segnala: s.segnala ? { ...s.segnala } : null,
        errore: s.errore,
        attesa: s.attesa,
        muto: s.muto,
        riconnetti: s.riconnetti,
      };
    },
    // Cambia solo quando cambia la struttura dello schermo (non a ogni secondo del timer): la home ridisegna solo
    // allora e aggiorna timer e conti in place, così il fuoco della tastiera non salta.
    firma() {
      const m = this.modello();
      const sc = { ...m.schermo };
      delete sc.timer;
      if (sc.tipo === "squillo_in_uscita") delete sc.testo;
      if (sc.carte) sc.carte = { attiva: sc.carte.attiva };
      return JSON.stringify({ ...m, schermo: sc });
    },
  };
}
