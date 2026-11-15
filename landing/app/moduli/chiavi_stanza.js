// Chiavi nella stanza (issue #5 spec v1.1, passi 4, 5, 6 e 7; D14 A, D51 A). Linea «sviluppatore-c», passo 8a.
// Tiene lo stato delle chiavi che arriva dal server (/app/api/chiavi, tramite creaChiavi di chiavi.js), apre le
// finestre «Dai una chiave», «Modifica la frase» e «Riprendi la chiave» e manda una richiesta alla volta.
// Le regole (2 chiavi, solo a chi hai chiamato, frase senza contatti, chiuse dalle 20:59) le decide il server: un suo
// rifiuto lascia la finestra aperta con il suo testo. Nessuno scopre un no: qui ci sono solo le chiavi date da te.
// Niente salvataggi locali. Il modulo non tocca la pagina: la vista (flusso.js) legge modello() e scheda(persona).
import { contatoreChiavi, schedaChiave, finestraDai, confermaRiprendi, contoAllaRovescia, schermataSera } from "./chiavi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// In attesa del calcolo delle 21:00 si rilegge la sera dopo 20 secondi, finché non è pronta.
const RILEGGI_SERA_MS = 20000;

export function creaChiaviStanza({ chiavi, aggiorna = () => {}, adesso = () => new Date(), dopo = (fn, ms) => setTimeout(fn, ms) }) {
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

  let letto = null;
  async function caricaSera() {
    if (typeof chiavi.sera !== "function") return;
    sera = schermataSera(await chiavi.sera());
    if (sera && sera.tipo === "attesa") dopo(caricaSera, RILEGGI_SERA_MS);
    avvisa();
  }
  async function carica() {
    const r = await chiavi.leggi();
    stato = r && r.ok ? r.stato : null;
    avvisa();
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
      errore,
      inCorso,
    }),
    scheda: (persona) => schedaChiave(stato, persona),
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
  if (s.tipo === "nessuna_porta") return h("div", { classe: "chiavi-sera" }, h("p", {}, s.testo));
  // Solo i testi della spec: nessun titolo nuovo. Con due porte, due schede una sotto l'altra.
  return h("div", { classe: "chiavi-sera" },
    s.schede.map((p) => h("div", { classe: "porta-aperta" },
      h("p", {}, h("strong", {}, p.testo)),
      p.frase ? [h("p", { classe: "nota" }, p.scritto), h("blockquote", {}, p.frase)] : null,
      typeof svelamento === "function" ? h("button", { classe: "bottone", type: "button", "aria-label": p.etichetta, onclick: () => svelamento(p.porta) }, p.bottone) : null)));
}
