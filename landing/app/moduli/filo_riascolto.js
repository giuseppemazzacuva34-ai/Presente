// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A): voce «Il vocale del Filo» nella stanza. Passo 10c
// della linea «sviluppatore-c».
// Tutta la settimana, dalla stanza, si riascolta il vocale di benvenuto del Filo. Se è arrivato dopo la schermata 18
// (entro le 13:00 di lunedì) la voce ha un pallino rosso fino al primo ascolto; nessuna notifica push. Se c'è la voce e
// se ha il pallino lo dice il Worker (GET /app/api/filo/riascolto); il vocale arriva con un link firmato a scadenza
// breve (GET /app/api/filo/ascolta?tipo=lunedi) solo quando si apre la voce; il primo «play» spegne il pallino
// (POST /app/api/filo/riascolto). Nessuna voce: stanza senza Filo, vocale non ancora arrivato, errore.
// Il vocale non parte mai da solo. Niente salvataggi nel telefono e niente log.
import { durataTesto } from "./filo_domenica.js";

export const TESTI_FILO_RIASCOLTO = Object.freeze({
  voce: "Il vocale del Filo",
  nuovo: "Il vocale del Filo, nuovo",
  ascolta: "Ascolta il vocale del Filo",
  leggi: "Leggi il testo",
  riprova: "Riprova",
});

const PERCORSO_RIASCOLTO = "/app/api/filo/riascolto";
const PERCORSO_ASCOLTA = "/app/api/filo/ascolta?tipo=lunedi";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const pulito = (x) => (typeof x === "string" ? x.trim() : "");

function voceValida(v) {
  if (!v || typeof v !== "object" || !UUID.test(String(v.stanza || "")) || typeof v.nuovo !== "boolean") return null;
  return { stanza: v.stanza, nuovo: v.nuovo };
}

function vocaleValido(v) {
  if (!v || typeof v !== "object") return null;
  const durata = durataTesto(v.durata);
  const testo = pulito(v.testo);
  if (typeof v.url !== "string" || !v.url.startsWith("https://") || !testo || !durata) return null;
  return { url: v.url, durata, testo };
}

// Una richiesta al Worker col token di chi guarda: corpo JSON con ok true, oppure null (accesso, rete, errore).
async function chiedi(f, percorso, t, { metodo = "GET", corpo } = {}) {
  let r;
  try {
    const headers = { authorization: `Bearer ${t}` };
    if (corpo !== undefined) headers["content-type"] = "application/json";
    r = await f(percorso, { method: metodo, headers, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
  } catch {
    return null;
  }
  if (!r || !r.ok) return null;
  try {
    const c = await r.json();
    return c && c.ok === true ? c : null;
  } catch {
    return null;
  }
}

export function creaFiloRiascolto({ token, fetch: f = globalThis.fetch, aggiorna = () => {} } = {}) {
  let voce = null;
  let letto = false;
  let lettura = null;
  let aperta = false;
  let vocale = null;
  let stato = null; // null | "attesa" | "errore": la lettura del link del vocale
  let segnato = false;
  let lettore = null; // { url, nodo }: lo stesso elemento audio tra un ridisegno e l'altro
  let rinnovi = 0;
  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare il modulo */ } };
  const gettone = () => Promise.resolve().then(token).catch(() => null);

  async function carica() {
    try {
      const t = await gettone();
      if (!t) return;
      const c = await chiedi(f, PERCORSO_RIASCOLTO, t);
      voce = c ? voceValida(c.riascolto) : null;
    } finally {
      letto = true;
      avvisa();
    }
  }

  async function caricaVocale() {
    stato = "attesa";
    avvisa();
    const t = await gettone();
    const a = t ? await chiedi(f, PERCORSO_ASCOLTA, t) : null;
    vocale = vocaleValido(a ? a.vocale : null);
    stato = vocale ? null : "errore";
    avvisa();
  }

  return {
    // Per la home, che si ridisegna spesso: la lettura parte una volta sola per apertura dell'app.
    prepara: () => (lettura ??= carica()),
    modello: () => ({ voce, letto, aperta, vocale, stato }),
    // Apre o chiude la voce; il link del vocale si chiede alla prima apertura.
    async apri() {
      if (!voce) return;
      aperta = !aperta;
      avvisa();
      if (aperta && !vocale && stato !== "attesa") await caricaVocale();
    },
    riprova: () => (voce && aperta && stato !== "attesa" ? caricaVocale() : Promise.resolve()),
    // Primo «play»: il pallino si spegne subito; il server lo segna una volta sola. Se la richiesta non riesce, al
    // massimo il pallino ricompare alla prossima apertura dell'app.
    async ascoltato() {
      if (!voce || !voce.nuovo) return;
      voce = { ...voce, nuovo: false };
      avvisa();
      if (segnato) return;
      segnato = true;
      const t = await gettone();
      if (t) await chiedi(f, PERCORSO_RIASCOLTO, t, { metodo: "POST", corpo: { stanza: voce.stanza } });
    },
    // Il lettore si crea una volta per link: un ridisegno della home non interrompe la voce.
    lettore(url, crea) {
      if (!lettore || lettore.url !== url) lettore = { url, nodo: crea() };
      return lettore.nodo;
    },
    // Link firmato scaduto (5 minuti) o rete caduta: si chiede un link nuovo, al massimo due volte.
    async rinnova(nodo) {
      if (rinnovi >= 2 || !voce || !vocale) return;
      rinnovi++;
      const t = await gettone();
      if (!t) return;
      const a = await chiedi(f, PERCORSO_ASCOLTA, t);
      const nuovo = vocaleValido(a ? a.vocale : null);
      if (!nuovo || !vocale) return;
      vocale = { ...vocale, url: nuovo.url };
      if (lettore) lettore.url = nuovo.url;
      if (nodo) nodo.src = nuovo.url;
    },
  };
}

// Vista (design v4): una voce della stanza che si apre sul posto. Pulsante con aria-expanded; il pallino rosso è solo
// decorativo e il nome del pulsante dice «nuovo». Lettore nativo senza partenza automatica, usabile da tastiera, con
// il nome «Ascolta il vocale del Filo»; «Leggi il testo» è l'alternativa per l'audio (WCAG 1.2.1).
export function vistaFiloRiascolto(h, fr) {
  if (!fr) return null;
  fr.prepara();
  const m = fr.modello();
  if (!m.voce) return null;
  let corpo = null;
  if (m.aperta && m.vocale) {
    corpo = [
      fr.lettore(m.vocale.url, () => {
        let nodo = null;
        nodo = h("audio", { classe: "filo-lettore", src: m.vocale.url, controls: true, preload: "none",
          "aria-label": TESTI_FILO_RIASCOLTO.ascolta, onplay: () => fr.ascoltato(), onerror: () => fr.rinnova(nodo) });
        return nodo;
      }),
      h("details", { classe: "filo-testo" }, h("summary", {}, TESTI_FILO_RIASCOLTO.leggi), h("p", {}, m.vocale.testo)),
    ];
  } else if (m.aperta && m.stato === "errore") {
    corpo = h("button", { classe: "link", type: "button", onclick: () => fr.riprova() }, TESTI_FILO_RIASCOLTO.riprova);
  } else if (m.aperta) {
    corpo = h("p", { classe: "nota", role: "status" }, "Un attimo…");
  }
  return h("div", { classe: "filo-riascolto" },
    h("button", { classe: "filo-voce", type: "button", "aria-expanded": m.aperta ? "true" : "false",
      "aria-controls": "filo-riascolto-corpo", "aria-label": m.voce.nuovo ? TESTI_FILO_RIASCOLTO.nuovo : undefined,
      onclick: () => fr.apri() },
    TESTI_FILO_RIASCOLTO.voce,
    m.voce.nuovo ? h("span", { classe: "filo-pallino", "aria-hidden": "true" }) : null),
    h("div", { id: "filo-riascolto-corpo" }, corpo));
}
