// Chiavi nella stanza (issue #5 spec v1.1, passi 4, 5, 6 e 7; D14 A, D51 A). Linea «sviluppatore-c», passo 8a.
// Tiene lo stato delle chiavi che arriva dal server (/app/api/chiavi, tramite creaChiavi di chiavi.js), apre le
// finestre «Dai una chiave», «Modifica la frase» e «Riprendi la chiave» e manda una richiesta alla volta.
// Le regole (2 chiavi, solo a chi hai chiamato, frase senza contatti, chiuse dalle 20:59) le decide il server: un suo
// rifiuto lascia la finestra aperta con il suo testo. Nessuno scopre un no: qui ci sono solo le chiavi date da te.
// Niente salvataggi locali. Il modulo non tocca la pagina: la vista (flusso.js) legge modello() e scheda(persona).
import { contatoreChiavi, schedaChiave, finestraDai, confermaRiprendi, contoAllaRovescia, schermataSera, TESTI } from "./chiavi.js";

const TESTO_CHIUSE = TESTI.chiuse;
// Timer del browser; in node (test) non tiene acceso il processo.
const dopoPredefinito = (fn, ms) => {
  const t = setTimeout(fn, ms);
  if (t && typeof t.unref === "function") t.unref();
  return t;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// In attesa del calcolo delle 21:00 si rilegge la sera dopo 20 secondi, finché non è pronta.
const RILEGGI_SERA_MS = 20000;
// Conto alla rovescia (passo 10): si ricontrolla al cambio di minuto (+50 ms), al massimo ogni 10 minuti.
const MINUTO_MS = 60000;
const ORA_MS = 60 * MINUTO_MS;
const MASSIMA_ATTESA_MS = 10 * MINUTO_MS;
const MARGINE_MS = 50;

export function creaChiaviStanza({ chiavi, aggiorna = () => {}, adesso = () => new Date(), dopo = dopoPredefinito, conto = () => {},
  animazioneMs = 0 }) {
  let stato = null;
  let sera = null;
  let finestra = null;
  let errore = null;
  let inCorso = false;

  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare le chiavi */ } };
  const data = (a) => (Array.isArray(stato?.date) ? stato.date.find((k) => k && k.a === a) : null);
  const apri = (tipo, a, campi) => {
    if (!UUID.test(String(a || ""))) return;
    finestra = { tipo, a, ...campi };
    errore = null;
    avvisa();
  };

  // Il conto scorre da solo: il testo cambia sul posto (conto), senza ridisegnare la pagina; si ridisegna solo
  // quando compare o sparisce. Alle 20:59 si rilegge lo stato (chiavi chiuse dal server), alle 21:00 la sera.
  let timerConto = false;
  let ultimoConto = null;
  const manca = () => {
    const chiude = stato && stato.stanza === true ? new Date(stato.chiude_il).getTime() : NaN;
    return Number.isFinite(chiude) ? chiude - adesso().getTime() : NaN;
  };
  function programmaConto() {
    const m = manca();
    if (timerConto || !Number.isFinite(m) || m <= 0) return;
    const attesa = m > ORA_MS ? m - ORA_MS : (m % MINUTO_MS || MINUTO_MS);
    timerConto = true;
    dopo(scattaConto, Math.min(attesa, MASSIMA_ATTESA_MS) + MARGINE_MS);
  }
  async function scattaConto() {
    timerConto = false;
    if (!stato || stato.stanza !== true) return;
    const m = manca();
    const nuovo = contoAllaRovescia(stato.chiude_il, adesso());
    const prima = ultimoConto;
    ultimoConto = nuovo;
    if (m <= 0) { await Promise.all([carica(), caricaSera()]); return; }
    if (nuovo === TESTO_CHIUSE && prima !== TESTO_CHIUSE) { await carica(); return; }
    if ((prima === null) !== (nuovo === null)) avvisa();
    else if (nuovo !== prima) { try { conto(nuovo); } catch { /* la vista non deve fermare il conto */ } }
    programmaConto();
  }

  // Passo 11: alle 21:00 le porte che si aprono (3 secondi, saltabile) prima dell'esito. Una volta sola per apertura
  // dell'app, uguale per chi ha porte e per chi no; con animazioneMs 0 (meno movimento) l'esito si vede subito.
  let animazione = false;
  let animata = false;
  const fermaAnimazione = () => { if (!animazione) return; animazione = false; avvisa(); };
  let letto = null;
  async function caricaSera() {
    if (typeof chiavi.sera !== "function") return;
    sera = schermataSera(await chiavi.sera());
    if (sera && sera.tipo === "attesa") dopo(caricaSera, RILEGGI_SERA_MS);
    else if (sera && !animata && animazioneMs > 0) {
      animata = true;
      animazione = true;
      dopo(fermaAnimazione, animazioneMs);
    }
    avvisa();
  }
  async function carica() {
    const r = await chiavi.leggi();
    stato = r && r.ok ? r.stato : null;
    ultimoConto = stato && stato.stanza === true ? contoAllaRovescia(stato.chiude_il, adesso()) : null;
    avvisa();
    programmaConto();
  }

  return {
    carica,
    // Per la home, che si ridisegna spesso: la prima lettura parte una volta sola.
    prepara: () => (letto ??= Promise.all([carica(), caricaSera()])),
    modello: () => ({
      contatore: contatoreChiavi(stato),
      conto: stato && stato.stanza === true ? contoAllaRovescia(stato.chiude_il, adesso()) : null,
      finestra: finestra ? { ...finestra } : null,
      sera,
      animazione,
      errore,
      inCorso,
    }),
    scheda: (persona) => schedaChiave(stato, persona),
    saltaAnimazione: fermaAnimazione,
    apriDai: (a, nome) => apri("dai", a, { ...finestraDai(nome), frase: "" }),
    apriFrase: (a, nome) => {
      const d = data(a);
      apri("frase", a, { ...finestraDai(nome), titolo: "Modifica la frase", bottone: "Salva", frase: typeof d?.frase === "string" ? d.frase : "" });
    },
    apriRiprendi: (a, nome) => apri("riprendi", a, { testo: confermaRiprendi(nome), bottone: "Riprendi la chiave" }),
    scrivi(frase) {
      if (finestra && finestra.tipo !== "riprendi") finestra.frase = typeof frase === "string" ? frase : "";
    },
    chiudi() {
      finestra = null;
      errore = null;
      avvisa();
    },
    async conferma() {
      if (!finestra || inCorso) return;
      const f = finestra;
      inCorso = true;
      errore = null;
      avvisa();
      try {
        const r = f.tipo === "dai" ? await chiavi.dai(f.a, f.frase)
          : f.tipo === "frase" ? await chiavi.cambiaFrase(f.a, f.frase)
          : await chiavi.riprendi(f.a);
        if (!r || !r.ok) {
          errore = typeof r?.testo === "string" && r.testo ? r.testo : "Non è andata. Riprova tra poco.";
          return;
        }
        finestra = null;
        if (r.stato && typeof r.stato === "object") stato = r.stato;
        else await carica();
      } finally {
        inCorso = false;
        avvisa();
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Viste (passo 8b). Ricevono h() da flusso.js, così si provano con node --test senza pagina.

// In alto in «La tua stanza»: «Le tue chiavi: N» con due icone (piene quelle da dare) e, dalle 20:00, il conto.
export function vistaChiavi(h, ks) {
  const m = ks.modello();
  if (!m.contatore) return null;
  return h("div", { classe: "chiavi-stanza" },
    h("p", { classe: "chiavi-contatore" }, m.contatore.icone.map((piena) =>
      h("span", { classe: piena ? "chiave-icona" : "chiave-icona chiave-usata", "aria-hidden": "true" }, "🔑")), " ", m.contatore.testo),
    m.conto ? h("p", { classe: "nota", id: "chiavi-conto", role: "status" }, m.conto) : null);
}

// Sulla scheda di una persona: «Dai una chiave», oppure il segno con «Riprendi» e «Modifica la frase», oppure il
// testo delle chiavi chiuse. La finestra aperta per questa persona prende il posto dei pulsanti, vicino a dove si è
// toccato (tastiera e lettore di schermo restano lì).
export function vistaSchedaChiave(h, ks, persona, nome) {
  const s = ks.scheda(persona);
  if (!s) return null;
  const m = ks.modello();
  const f = m.finestra && m.finestra.a === persona ? m.finestra : null;
  const n = typeof nome === "string" && nome.trim() ? nome.trim() : "questa persona";
  const segno = s.segno ? [h("p", { classe: "chiave-segno" }, s.segno),
    s.frase ? h("p", { classe: "nota chiave-frase-data" }, `«${s.frase}»`) : null] : [];
  if (s.chiuse) return h("div", { classe: "chiave-scheda" }, segno, h("p", { classe: "nota" }, s.chiuse));
  if (f) return h("div", { classe: "chiave-scheda" }, segno, finestra(h, ks, m, f));
  const link = (testo, onclick, etichetta) => h("button", { classe: "link", type: "button", "aria-label": etichetta, onclick }, testo);
  return h("div", { classe: "chiave-scheda" }, segno,
    s.dai ? h("button", { classe: "bottone-secondario", type: "button", "aria-label": `${s.dai} a ${n}`, onclick: () => ks.apriDai(persona, nome) }, s.dai) : null,
    s.modifica ? link(s.modifica, () => ks.apriFrase(persona, nome), `${s.modifica} per ${n}`) : null,
    s.riprendi ? link(s.riprendi, () => ks.apriRiprendi(persona, nome), `${s.riprendi} a ${n}`) : null);
}

function finestra(h, ks, m, f) {
  const titolo = `chiave-titolo-${f.a}`;
  const corpo = f.tipo === "riprendi"
    ? [h("p", { id: titolo }, h("strong", {}, f.testo))]
    : [h("p", { id: titolo }, h("strong", {}, f.titolo)),
      h("label", { for: "chiave-frase" }, f.etichetta),
      h("textarea", { id: "chiave-frase", classe: "racconto-segnala", maxlength: String(f.massimo), rows: "3", disabled: m.inCorso,
        "aria-describedby": "chiave-nota", oninput: (e) => ks.scrivi(e.target.value) }, f.frase || ""),
      h("p", { classe: "nota", id: "chiave-nota" }, f.nota)];
  return h("div", { classe: "chiave-finestra", role: "dialog", "aria-labelledby": titolo },
    corpo,
    m.errore ? h("p", { classe: "errore", role: "alert" }, m.errore) : null,
    h("button", { classe: "bottone", type: "button", disabled: m.inCorso, onclick: () => ks.conferma() }, m.inCorso ? "Un attimo…" : f.bottone),
    h("button", { classe: "link", type: "button", disabled: m.inCorso, onclick: () => ks.chiudi() }, "Annulla"));
}

// La sera delle chiavi (passo 8), in cima a «La tua stanza» dalle 21:00 a lunedì 9:00. «Vai allo svelamento» solo se
// chi costruisce lo svelamento (#65) passa la funzione che lo apre: niente pulsanti che non fanno niente.
export function vistaSera(h, ks, { svelamento = null } = {}) {
  const s = ks.modello().sera;
  if (!s) return null;
  if (s.tipo === "attesa") return h("div", { classe: "chiavi-sera", role: "status" }, s.testo);
  // Le ante sono solo decorazione: il lettore di schermo trova «Salta» e poi l'esito.
  if (ks.modello().animazione) return h("div", { classe: "chiavi-sera porte-animazione" },
    h("div", { classe: "porte-ante", "aria-hidden": "true" }, h("span", { classe: "porta-anta" }), h("span", { classe: "porta-anta" })),
    h("button", { classe: "link", type: "button", "aria-label": "Salta l'animazione delle porte", onclick: () => ks.saltaAnimazione() }, "Salta"));
  if (s.tipo === "nessuna_porta") return h("div", { classe: "chiavi-sera" }, h("p", {}, s.testo));
  // Design v4 (#349), schermate 37-38 «La porta»: dietro le ante che scorrono la sagoma di chi c'è (immagine fissa
  // dell'app, decorativa), poi occhiello, titolo, nome, frase e «Vai allo svelamento». Con due porte, due schede.
  return h("div", { classe: "chiavi-sera" },
    s.schede.map((p) => h("div", { classe: "porta-aperta porta-v4" },
      h("div", { classe: "porta-v4-scena", "aria-hidden": "true" },
        h("img", { classe: "porta-v4-foto", src: p.immagine, alt: "" }),
        h("div", { classe: "porta-v4-luce" }),
        h("div", { classe: "porta-v4-ante" }, h("span", { classe: "porta-v4-anta sx" }), h("span", { classe: "porta-v4-anta dx" }))),
      h("div", { classe: "porta-v4-testa" },
        h("p", { classe: "passo" }, TESTI.portaOcchiello),
        h("h2", {}, TESTI.portaTitolo[0], h("br", {}), h("em", {}, TESTI.portaTitolo[1]))),
      h("div", { classe: "porta-v4-piede" },
        h("p", { classe: "porta-v4-chi" }, h("strong", {}, p.nome)),
        p.frase ? [h("p", { classe: "nascosto" }, p.scritto), h("blockquote", { classe: "frase" }, p.frase)] : null,
        typeof svelamento === "function" ? h("button", { classe: "bottone", type: "button", "aria-label": p.etichetta, onclick: () => svelamento(p.porta) }, p.bottone) : null))));
}
