// Coin e saldo del design v4 (issue #349, schermate 13 «I tuoi Coin» e 21 «Coin quasi finiti»; decisione di Giuseppe
// del 22/11 sul design v4). Passo 1 della linea «sviluppatore-b»: logica e testi, gli stili arrivano dopo la base
// grafica del CTO.
// In beta i Coin sono un CONTATORE INTERNO: «Paga» e «Ricarica» restano sempre spenti e nessuna richiesta va a Gomry
// (pagamenti veri solo con l'ok di Giuseppe). Il saldo lo dà sempre il server (coin.js → GET /app/api/regali): qui non
// si calcola né si inventa nessun numero. Niente salvataggi locali, niente log.
// I numeri restano uguali a api/coin.js, api/svelamento.js e moduli/coin.js: lo controlla test/saldo_coin_app.test.mjs.

import { OFFERTE } from "./coin.js";

const STANZA = 80; // COIN.stanzaAlBuio
const CAPARRA = 100; // SVELAMENTO.caparra
const REGALI_COIN = [5, 10, 20]; // REGALI di api/coin.js
const SCELTO = "coin500"; // «Il più scelto»
// Pacchetto Base (commento di Giuseppe del 25/11 sulla pagina di confronto, regola_confronto_design_25_11): 10 € = 100
// crediti, una stanza al buio e 20 crediti di regali. Solo nella schermata 13; i due di coin.js (linea C) restano invariati.
const BASE = Object.freeze({ id: "coin100", coin: 100, euro: 10, inPiu: 0 });
const PACCHETTI = Object.freeze([BASE, ...OFFERTE]);

export const TESTI_SALDO = Object.freeze({
  // Schermata 13 (testi del design v4).
  passo: "Passo 10 di 10 · I tuoi crediti",
  titolo: Object.freeze(["I tuoi crediti", "per la stanza e i regali."]),
  hai: "Hai <n> crediti. La tua prima stanza è in regalo.",
  primaStanza: "La tua prima stanza è in regalo.",
  descrizione100: "1 stanza e regali",
  descrizione200: "2 stanze, o 1 stanza e regali",
  inRegalo: "+<n> in regalo",
  piuScelto: "Il più scelto",
  stanza: "Una stanza al buio, 7 giorni",
  caparra: "Caparra dello svelamento",
  regali: "Regali in chiamata",
  gomry: "Paghi con Gomry: carta, Apple Pay, Google Pay.",
  piuTardi: "Più tardi",
  paga: "Paga <euro>",
  // Come moduli/coin.js (spec #331 B.3): in beta i Coin sono di prova.
  notaBeta: "Nella beta i crediti sono di prova: li trovi già nel tuo saldo. Non paghi niente.",
  // Schermata 21. La frase con 15 Coin è del design; le altre due sono provvisorie, da rivedere con «contenuti».
  etichetta: "I tuoi crediti",
  restano: "Ti restano",
  resta: "Ti resta",
  finiti: Object.freeze(["Hai finito", "i crediti."]),
  bastanoRegali: "Bastano per qualche regalo, non per la prossima stanza (<stanza> crediti).",
  nonBastano: "Non bastano per la prossima stanza (<stanza> crediti) né per un regalo.",
  dopo: "Dopo",
  // Decisione di Giuseppe del 23/11 (decisioni_giuseppe_23_11_crediti): nei testi visibili «crediti», non «Coin».
  unita: "crediti",
  unitaUno: "credito",
  ricarica: "Ricarica",
});
const T = TESTI_SALDO;

const valido = (n) => Number.isInteger(n) && n >= 0;
const euro = (n) => `${n} €`;
function pacchetto(o) {
  return { id: o.id, coin: o.coin, euro: euro(o.euro), sotto: o.inPiu > 0 ? T.inRegalo.replace("<n>", String(o.inPiu)) : T.unita };
}

const descrizione = (o) => (o.inPiu > 0 ? null : o.id === BASE.id ? T.descrizione100 : T.descrizione200);

// Schermata 13. saldo: il numero del server; se manca, nessun numero. scelto: il pacchetto toccato (di base il 500).
// primaStanzaUsata: true per chi ha già usato la stanza in regalo (es. dalla schermata 21): niente frase del regalo.
export function schermataTuoiCoin(saldo, { scelto = SCELTO, primaStanzaUsata = false } = {}) {
  const id = PACCHETTI.some((o) => o.id === scelto) ? scelto : SCELTO;
  const prezzo = PACCHETTI.find((o) => o.id === id).euro;
  return {
    passo: T.passo,
    titolo: [...T.titolo],
    saldo: primaStanzaUsata === true
      ? (valido(saldo) ? `Hai ${saldo} ${saldo === 1 ? T.unitaUno : T.unita}.` : null)
      : (valido(saldo) ? T.hai.replace("<n>", String(saldo)) : T.primaStanza),
    pacchetti: PACCHETTI.map((o) => ({ ...pacchetto(o), descrizione: descrizione(o), piuScelto: o.id === SCELTO })),
    scelto: id,
    costi: [
      { voce: T.stanza, costo: `${STANZA} ${T.unita}` },
      { voce: T.caparra, costo: `${CAPARRA} ${T.unita}` },
      { voce: T.regali, costo: REGALI_COIN.join(" · ") },
    ],
    gomry: T.gomry,
    notaBeta: T.notaBeta,
    piuTardi: T.piuTardi,
    paga: { testo: T.paga.replace("<euro>", euro(prezzo)), attivo: false }, // in beta sempre spento
  };
}

// Schermata 21: solo quando il saldo non basta per la prossima stanza. Dice cosa si può ancora fare.
export function quasiFiniti(saldo) {
  if (!valido(saldo) || saldo >= STANZA) return null;
  const testo = saldo >= Math.min(...REGALI_COIN) ? T.bastanoRegali : T.nonBastano;
  const titolo = saldo === 0 ? [...T.finiti] : [saldo === 1 ? T.resta : T.restano, `${saldo} ${saldo === 1 ? T.unitaUno : T.unita}.`];
  return {
    etichetta: T.etichetta,
    titolo,
    testo: testo.replace("<stanza>", String(STANZA)),
    pacchetto: pacchetto(OFFERTE.find((o) => o.id === SCELTO)),
    dopo: T.dopo,
    ricarica: T.ricarica,
    attivo: false, // «Ricarica» in beta sempre spento
  };
}

// Spec #331 v1.1, punto 5: il foglio della schermata 21 può comparire solo con saldo del server sotto 80, nella home
// o all'ingresso nella stanza (mai in chiamata, nello svelamento o nella sera delle porte) e solo a chi ha già usato
// la prima stanza in regalo. Se un dato manca, niente avviso.
const MOMENTI_AVVISO = new Set(["home", "stanza"]);
export function avvisoPermesso({ saldo, primaStanzaUsata, momento } = {}) {
  return valido(saldo) && saldo < STANZA && primaStanzaUsata === true && MOMENTI_AVVISO.has(momento);
}

// Passo 5c: lettura dal nuovo indirizzo GET /app/api/coin (worker/coin_api.js), che oltre al saldo dice se la prima
// stanza in regalo è già stata usata e se l'interruttore dei pagamenti è acceso (in beta spento: solo true esatto).
// Risposta: { ok: true, saldo, primaStanzaUsata, pagamenti } oppure { ok: false, motivo: "accesso" | "rete" | "riprova" }.
const PERCORSO_COIN = "/app/api/coin";
export function creaCoinServer({ token, fetch: f = globalThis.fetch } = {}) {
  return {
    async saldo() {
      const t = await Promise.resolve().then(token).catch(() => null);
      if (!t) return { ok: false, motivo: "accesso" };
      let r;
      try {
        r = await f(PERCORSO_COIN, { method: "GET", headers: { authorization: `Bearer ${t}` } });
      } catch {
        return { ok: false, motivo: "rete" };
      }
      if (r.status === 401) return { ok: false, motivo: "accesso" };
      if (!r.ok) return { ok: false, motivo: "riprova" };
      let c;
      try { c = await r.json(); } catch { return { ok: false, motivo: "riprova" }; }
      if (!c || c.ok !== true || !valido(c.saldo) || typeof c.primaStanzaUsata !== "boolean") return { ok: false, motivo: "riprova" };
      return { ok: true, saldo: c.saldo, primaStanzaUsata: c.primaStanzaUsata, pagamenti: c.pagamenti === true };
    },
  };
}

// Dove si trova la persona, per la regola della schermata 21: qualunque schermata della chiamata (anche «dopo» e
// «segnala») → «chiamata»; porta dello svelamento aperta → «svelamento»; sera delle chiavi (domenica 21:00 → lunedì
// 9:00) → «porte»; altrimenti «home». Legge solo i modelli pubblici di telefono.js, svelamento.js e chiavi_stanza.js;
// se uno si rompe il momento è «sconosciuto» e l'avviso non parte.
export function momentoApp({ telefono = null, porta = null, chiavi = null } = {}) {
  try {
    const sc = telefono ? telefono.modello().schermo : null;
    if (sc && sc.tipo !== "nessuna") return "chiamata";
    if (porta && porta.modello().aperta === true) return "svelamento";
    if (chiavi && chiavi.modello().sera) return "porte";
    return "home";
  } catch {
    return "sconosciuto";
  }
}

// Saldo nella testata: coin = creaCoin() di moduli/coin.js; testata(dati) = aggiornaTestata(document, dati).
export function creaSaldo({ coin, testata }) {
  return {
    async aggiorna() {
      let r;
      try { r = await coin.saldo(); } catch { return { ok: false, motivo: "rete" }; }
      if (!r || r.ok !== true || !valido(r.saldo)) return { ok: false, motivo: (r && r.motivo) || "riprova" };
      try { testata({ saldo: r.saldo }); } catch { /* la testata non deve fermare la lettura */ }
      return { ok: true, saldo: r.saldo, quasiFiniti: r.saldo < STANZA, primaStanzaUsata: r.primaStanzaUsata === true };
    },
  };
}

// Passo 2: il saldo nella testata si legge all'avvio e di nuovo quando si torna sull'app (visibilitychange). Nessun
// timer: il numero cambia solo con una stanza o un regalo, e chi torna sull'app vede quello aggiornato.
// Passo 3: avviso(n) apre la schermata 21 quando i Coin non bastano per la prossima stanza, una sola volta per visita
// (in memoria, niente salvataggi locali): chi chiude con «Dopo» non lo rivede a ogni ritorno sull'app.
// Passo 4 (spec #331 v1.1): momento() dice dove si è («home», «stanza», «chiamata», «svelamento», «porte»); se adesso
// l'avviso non è permesso non si consuma e può comparire a una lettura successiva della stessa sessione.
export async function collegaSaldo({ saldo, pagina, avviso, momento = () => "home" } = {}) {
  if (!saldo || typeof saldo.aggiorna !== "function" || !pagina) return { ok: false, motivo: "manca" };
  let avvisato = false;
  const avvisa = (r) => {
    if (avvisato || typeof avviso !== "function" || !r || r.ok !== true || r.quasiFiniti !== true) return;
    let dove;
    try { dove = momento(); } catch { return; }
    if (!avvisoPermesso({ saldo: r.saldo, primaStanzaUsata: r.primaStanzaUsata, momento: dove })) return;
    avvisato = true;
    try { avviso(r.saldo); } catch { /* la vista non deve fermare il saldo */ }
  };
  const leggi = () => Promise.resolve().then(() => saldo.aggiorna()).catch(() => ({ ok: false, motivo: "rete" }))
    .then((r) => { avvisa(r); return r; });
  pagina.addEventListener("visibilitychange", () => { if (pagina.visibilityState === "visible") leggi(); });
  return leggi();
}

function el(doc, tag, classe, testo) {
  const e = doc.createElement(tag);
  if (classe) e.className = classe;
  if (testo != null) e.textContent = testo;
  return e;
}

// Schermata 21 come foglio dal basso, fuori da <main id="app"> (la home si ridisegna). dati = quasiFiniti(saldo).
// Pulsanti veri, Esc chiude, l'attenzione parte da «Dopo». Spec #331 v1.1 punto 5: con alRicarica «Ricarica» chiude il
// foglio e apre la schermata 13 (dove in beta «Paga» resta spento); senza, «Ricarica» resta spento.
export function apriFoglioQuasiFiniti(contenitore, dati, { alChiudi, alRicarica } = {}) {
  if (!contenitore || !dati) return null;
  const doc = contenitore.ownerDocument;
  const foglio = el(doc, "section", "foglio-regali foglio-coin");
  foglio.setAttribute("role", "dialog");
  foglio.setAttribute("aria-modal", "true");
  foglio.setAttribute("aria-labelledby", "foglio-coin-titolo");
  let aperto = true;
  const chiudi = () => {
    if (!aperto) return;
    aperto = false;
    foglio.remove();
    if (typeof alChiudi === "function") alChiudi();
  };
  const titolo = el(doc, "h2", null, dati.titolo[0]);
  titolo.setAttribute("id", "foglio-coin-titolo");
  titolo.append(el(doc, "br"), el(doc, "em", null, dati.titolo[1]));
  const pacco = el(doc, "div", "pacco");
  const q = el(doc, "div", "q", String(dati.pacchetto.coin));
  q.append(el(doc, "small", null, dati.pacchetto.sotto));
  pacco.append(q, el(doc, "div"), el(doc, "div", "e", dati.pacchetto.euro));
  const azioni = el(doc, "div", "azioni");
  const dopo = el(doc, "button", "bottone-secondario", dati.dopo);
  dopo.setAttribute("type", "button");
  dopo.addEventListener("click", chiudi);
  const ricarica = el(doc, "button", "bottone", dati.ricarica);
  ricarica.setAttribute("type", "button");
  const conRicarica = typeof alRicarica === "function";
  ricarica.disabled = dati.attivo !== true && !conRicarica;
  if (conRicarica) ricarica.addEventListener("click", () => { if (!aperto) return; chiudi(); alRicarica(); });
  azioni.append(dopo, ricarica);
  foglio.append(el(doc, "p", "foglio-regali-titolo", dati.etichetta), titolo, el(doc, "p", "sub", dati.testo), pacco,
    el(doc, "p", "foglio-regali-nota", T.notaBeta), azioni);
  foglio.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); chiudi(); } });
  contenitore.append(foglio);
  dopo.focus();
  return { chiudi };
}
