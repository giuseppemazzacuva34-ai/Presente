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

const TESTI_EXTRA = Object.freeze({
  microfono_negato: "Per chiamare serve il microfono. Consentilo nelle impostazioni del telefono e riprova",
  microfono_assente: "Non troviamo un microfono su questo telefono. Prova da un altro dispositivo",
  solo_voce: "Non riusciamo ad avviare la voce. Riprova tra poco",
  lettura: "Non riusciamo a vedere la tua stanza. Riprova tra poco",
});
export const testoErrore = (motivo) => (Object.hasOwn(TESTI_EXTRA, motivo) ? TESTI_EXTRA[motivo] : testoMotivo(motivo));

const ATTIVE = new Set(["squilla", "in_corso"]);
const PAUSA_ASCOLTO_MS = 3000;

export function creaTelefono({ compagni, linea, chiamata, voce, subito = () => {}, cambiato = () => {}, adesso = () => Date.now() }) {
  const s = {
    persone: [], statoStanza: "attesa", erroreStanza: "",
    vista: null, nascondiFinita: false,
    voceAttiva: false, muto: false, riconnetti: false,
    visibileDal: null, ascoltoInCorso: false, ultimoAscolto: 0,
    attesa: false, errore: "",
    // Dopo la chiamata (3c-4b-2): risposta del server a /dopo, domanda già risposta, modulo di segnalazione da aprire.
    dopo: null, dopoChiesto: false, rientroChiesto: false, risposto: false, segnala: null,
  };

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
    if (v && ATTIVE.has(v.fase)) { s.dopo = null; s.dopoChiesto = false; s.risposto = false; s.segnala = null; }
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
      s.errore = testoErrore(r && r.motivo);
    }
    avvisa();
    try { subito(); } catch { /* la sentinella riprova da sola */ }
    return r;
  }

  const inChiamata = () => !!s.vista && ATTIVE.has(s.vista.fase);

  const rifAltra = () => s.vista || (s.dopo ? { altra: s.dopo.altra } : null);

  function schermo() {
    if (s.segnala) return { tipo: "segnala", titolo: "Segnala un problema" };
    if (s.dopo && !s.nascondiFinita && !inChiamata()) {
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
      let r;
      try { r = await compagni.leggi(); } catch { r = { ok: false, motivo: "rete" }; }
      if (r && r.ok) {
        s.persone = (Array.isArray(r.persone) ? r.persone : []).map((p) => ({ id: p.id, nome: p.nome, eta: p.eta ?? null, citta: p.citta || "" }));
        s.statoStanza = s.persone.length ? "pronta" : "vuota";
        s.erroreStanza = "";
      } else {
        s.statoStanza = "errore";
        s.erroreStanza = testoErrore(r && r.motivo);
      }
      avvisa();
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
      if (inChiamata() || !s.persone.some((p) => p.id === id)) return Promise.resolve();
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
    },

    modello() {
      const occupato = inChiamata();
      return {
        stanza: {
          stato: s.statoStanza,
          errore: s.erroreStanza,
          persone: s.persone.map((p) => ({ id: p.id, ...schedaCompagno(p, { inChiamata: occupato }) })),
        },
        schermo: schermo(),
        nome: rifAltra() ? nomeInChiamata(rifAltra(), s.persone) : "",
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
