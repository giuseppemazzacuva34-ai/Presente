// «Manda un regalo» nella scheda di una persona della stanza aperta e «Ti ha mandato: …» per chi riceve
// (issue #331, spec v1 del CPO parte C; design v4 schermata 26). Linea «sviluppatore-c», passo 8b.
//
// Il modulo non decide niente: chi può ricevere, saldo e limiti li ricontrolla il server (manda_regalo). Qui solo
// una lettura per persona dei regali ricevuti (testo del server, lo vede solo chi riceve), e l'apertura del foglio
// (regali.js) fuori da <main id="app">, che la home ridisegna. La vista (flusso.js) chiama vistaRegaliScheda(h, …).
// Niente salvataggi locali, niente log.
import { apriFoglioRegali } from "./regali.js";

export const TESTO_PULSANTE = "Manda un regalo";

export function creaRegaliStanza({ regali, contenitore, aggiorna = () => {}, alSaldo = () => {}, apri = apriFoglioRegali }) {
  let chiave = null;
  let letto = null;
  let testi = {};
  let aperto = false;

  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare i regali */ } };

  async function leggi(ids) {
    const nuovi = {};
    await Promise.all(ids.map(async (id) => {
      const r = await regali.ricevutiDa(id).catch(() => null);
      if (r && r.ok && r.testo) nuovi[id] = r.testo;
    }));
    testi = nuovi;
    avvisa();
  }

  return {
    // Per la home, che si ridisegna spesso: una lettura sola per le stesse persone.
    prepara(ids) {
      const elenco = [...new Set((Array.isArray(ids) ? ids : []).map(String))].sort();
      const k = elenco.join(",");
      if (k !== chiave) { chiave = k; letto = leggi(elenco); }
      return letto;
    },
    testoDi: (persona) => testi[persona] ?? null,
    // In chiamata (#349, linea B): inChiamata true e il fuoco torna sul tasto «Regalo» dello schermo di chiamata.
    async apriFoglio(persona, nome, { inChiamata = false, ritorno = `regalo-${persona}` } = {}) {
      if (aperto) return; // secondo tocco: il foglio è già aperto
      aperto = true;
      const s = await regali.avvisi().catch(() => null);
      const saldo = s && s.ok && Number.isInteger(s.saldo) ? s.saldo : null;
      apri(contenitore, {
        a: persona, nome, saldo, inChiamata: inChiamata === true, regali,
        alRegalo: (nuovo) => { try { alSaldo(nuovo); } catch { /* il saldo in testata non ferma il foglio */ } },
        alChiudi: () => {
          aperto = false;
          contenitore.ownerDocument?.getElementById(ritorno)?.focus();
        },
      });
    },
  };
}

// Sotto la scheda della persona (stanza aperta): il pulsante sempre, il conteggio solo se ci sono regali ricevuti.
export function vistaRegaliScheda(h, rs, persona, nome) {
  const n = typeof nome === "string" && nome.trim() ? nome.trim() : "questa persona";
  const ricevuti = rs.testoDi(persona);
  return h("div", { classe: "regali-scheda" },
    ricevuti ? h("p", { classe: "nota" }, ricevuti) : null,
    h("button", { classe: "link", type: "button", id: `regalo-${persona}`, "aria-label": `${TESTO_PULSANTE} a ${n}`,
      "aria-haspopup": "dialog", onclick: () => rs.apriFoglio(persona, n) }, TESTO_PULSANTE));
}
