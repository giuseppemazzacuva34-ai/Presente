// Pagina di chi risponde a «Scrivici» (issue #10, spec v1 del CPO, parte A; passo 5a della linea «sviluppatore-c»).
// Parla SOLO con /app/api/supporto/coda, /risposta, /bozze e /scarta (worker/supporto_operatore_api.js) col token di
// chi risponde: il ruolo «supporto» lo decide il database (operatori_supporto). Qui solo testi e forma dei dati,
// niente pagina (così si prova con node --test). Niente salvataggi sul telefono, niente log: email e testi restano
// sullo schermo. La pagina è interna (in beta la usa solo Giuseppe): nessun testo pubblico nuovo.

import { CATEGORIE_SCRIVICI } from "./aiuto.js";

const CODA = "/app/api/supporto/coda";
const RISPOSTA = "/app/api/supporto/risposta";
const BOZZE = "/app/api/supporto/bozze";
const SCARTA = "/app/api/supporto/scarta";
const FERMA_MS = 36 * 3600 * 1000; // parte B v1: bozza non toccata dopo 36 ore → nuovo avviso nel pannello
const ATTESA_MS = 10000;
const PROMESSA_MS = 48 * 3600 * 1000; // «Ti rispondiamo per email entro 48 ore»
const ROSSA_MS = 12 * 3600 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MASSIMO_RISPOSTA = 4000; // uguale a MAX_RISPOSTA del server (api/supporto_operatore.js)

const CATEGORIE = Object.freeze(Object.fromEntries(CATEGORIE_SCRIVICI));
const QUANDO = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
const lunghezza = (s) => [...String(s ?? "")].length;

function resta(scade, adesso) {
  const minuti = Math.round(Math.abs(scade - adesso) / 60000);
  const g = Math.floor(minuti / 1440), h = Math.floor((minuti % 1440) / 60), m = minuti % 60;
  const durata = g ? `${g} g${h ? ` ${h} h` : ""}` : h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
  return scade >= adesso ? `Restano ${durata}` : `Scaduta da ${durata}`;
}

// Coda leggibile: { id, categoria, email, testo, quando, stato, risposto, resta, rossa, avviso }.
// Prima i messaggi senza risposta (bandiera «sicurezza» in cima, poi i più vecchi), in fondo quelli già risposti.
export function vociSupporto(messaggi, adesso = new Date()) {
  if (!Array.isArray(messaggi)) return [];
  const ora = adesso.getTime();
  return messaggi
    .filter((m) => m && typeof m === "object" && UUID.test(String(m.id || "")))
    .map((m) => {
      const creato = new Date(m.creatoIl || "").getTime();
      const risposto = m.stato === "risposto";
      const sicurezza = m.sicurezza === true;
      const scade = Number.isNaN(creato) ? NaN : creato + PROMESSA_MS;
      return {
        id: m.id,
        categoria: CATEGORIE[m.categoria] || CATEGORIE.altro,
        email: typeof m.email === "string" ? m.email : "",
        testo: typeof m.testo === "string" ? m.testo : "",
        quando: Number.isNaN(creato) ? "" : QUANDO.format(new Date(creato)),
        stato: risposto ? "Risposto" : "Inviato",
        risposto,
        resta: risposto || Number.isNaN(scade) ? "" : resta(scade, ora),
        rossa: !risposto && (sicurezza || (!Number.isNaN(scade) && scade - ora < ROSSA_MS)),
        avviso: !risposto && sicurezza ? "Parole di pericolo: proponi «Sono in difficoltà» e valuta una segnalazione (#7)." : "",
        _ordine: [risposto ? 1 : 0, !risposto && sicurezza ? 0 : 1, Number.isNaN(creato) ? Infinity : creato],
      };
    })
    .sort((a, b) => a._ordine[0] - b._ordine[0] || a._ordine[1] - b._ordine[1] || a._ordine[2] - b._ordine[2])
    .map(({ _ordine, ...v }) => v);
}

// Parte B (D122 B): accanto a ogni messaggio senza risposta la bozza dell'agente, se c'è.
// bozza = { testo, fonte, istruzioni, daGestire, ferma } | null. «Da gestire da Giuseppe» è una nota interna, mai
// da inviare così; «ferma» = bozza non toccata da più di 36 ore.
export function unisciBozze(voci, bozze, adesso = new Date()) {
  const perId = new Map();
  for (const b of Array.isArray(bozze) ? bozze : []) {
    if (b && typeof b === "object" && UUID.test(String(b.id || "")) && typeof b.testo === "string" && b.testo.trim()) perId.set(b.id, b);
  }
  const ora = adesso.getTime();
  return (Array.isArray(voci) ? voci : []).map((v) => {
    const b = v.risposto ? null : perId.get(v.id);
    if (!b) return { ...v, bozza: null };
    const creata = new Date(b.creataIl || "").getTime();
    return {
      ...v,
      bozza: {
        testo: b.testo,
        fonte: typeof b.fonte === "string" ? b.fonte : "nessuna",
        istruzioni: b.conIstruzioni === true,
        daGestire: /^Da gestire da Giuseppe/.test(b.testo),
        ferma: !Number.isNaN(creata) && ora - creata > FERMA_MS,
      },
    };
  });
}

// Prima di inviare: id valido, testo non vuoto, entro il tetto del server.
export function corpoRisposta(id, risposta) {
  if (!UUID.test(String(id || ""))) return { ok: false, motivo: "dati" };
  const testo = typeof risposta === "string" ? risposta : "";
  if (testo.trim() === "") return { ok: false, motivo: "vuoto" };
  if (lunghezza(testo) > MASSIMO_RISPOSTA) return { ok: false, motivo: "lunga" };
  return { ok: true, corpo: { id, risposta: testo } };
}

const ERRORI = Object.freeze({
  accesso: "Entra prima nell'app con il tuo account, poi torna su questa pagina.",
  non_autorizzato: "Questo account non può leggere i messaggi di «Scrivici».",
  spento: "La pagina non è ancora attiva.",
  rete: "Connessione assente. Riprova tra poco.",
  troppe: "Troppi tentativi. Aspetta un minuto.",
  gia_risposto: "Questo messaggio ha già una risposta.",
  gia_tolta: "La bozza non c'è più: scrivi tu la risposta.",
  vuoto: "Scrivi la risposta prima di inviarla.",
  lunga: `La risposta può avere al massimo ${MASSIMO_RISPOSTA} caratteri.`,
  dati: "Controlla la risposta e riprova.",
  copia: "Il telefono non ha copiato il testo. Copia a mano dal riquadro.",
});
export const testoErroreOperatore = (motivo) => (Object.hasOwn(ERRORI, motivo) ? ERRORI[motivo] : "Qualcosa non ha funzionato. Riprova tra poco.");

export function creaSupportoOperatore({ token, fetch: f = globalThis.fetch, attesa = ATTESA_MS }) {
  async function chiedi(percorso, metodo, corpo) {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return { errore: "accesso" };
    const ferma = new AbortController();
    const timer = setTimeout(() => ferma.abort(), attesa);
    try {
      let r;
      try {
        const headers = { authorization: `Bearer ${t}` };
        if (corpo !== undefined) headers["content-type"] = "application/json";
        r = await f(percorso, { method: metodo, signal: ferma.signal, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
      } catch {
        return { errore: "rete" };
      }
      if (r.status === 401) return { errore: "accesso" };
      if (r.status === 403) return { errore: "non_autorizzato" };
      if (r.status === 404) return { errore: "spento" };
      if (r.status === 429) return { errore: "troppe" };
      try {
        const dati = await r.json();
        return dati && typeof dati === "object" ? { dati } : { errore: "riprova" };
      } catch {
        return { errore: "riprova" };
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async coda() {
      const { dati, errore } = await chiedi(CODA, "GET");
      if (errore) return { ok: false, motivo: errore };
      if (dati.ok !== true || !Array.isArray(dati.messaggi)) return { ok: false, motivo: "riprova" };
      return { ok: true, messaggi: dati.messaggi };
    },
    async bozze() {
      const { dati, errore } = await chiedi(BOZZE, "GET");
      if (errore) return { ok: false, motivo: errore };
      if (dati.ok !== true || !Array.isArray(dati.bozze)) return { ok: false, motivo: "riprova" };
      return { ok: true, bozze: dati.bozze };
    },
    async scarta(id) {
      if (!UUID.test(String(id || ""))) return { ok: false, motivo: "dati" };
      const { dati, errore } = await chiedi(SCARTA, "POST", { id });
      if (errore) return { ok: false, motivo: errore };
      if (dati.ok === true) return { ok: true };
      const motivo = typeof dati.motivo === "string" && Object.hasOwn(ERRORI, dati.motivo) ? dati.motivo : "riprova";
      return { ok: false, motivo };
    },
    async rispondi(id, risposta) {
      const c = corpoRisposta(id, risposta);
      if (!c.ok) return c;
      const { dati, errore } = await chiedi(RISPOSTA, "POST", c.corpo);
      if (errore) return { ok: false, motivo: errore };
      if (dati.ok === true) return { ok: true };
      const motivo = typeof dati.motivo === "string" && Object.hasOwn(ERRORI, dati.motivo) ? dati.motivo : "riprova";
      return { ok: false, motivo };
    },
  };
}

// D140 A (beta): la risposta salvata si copia negli appunti e si incolla in un'email dalla casella di Presente.
// Niente invii dal Worker, niente servizi esterni: il testo passa solo dagli appunti del telefono.
export async function copiaTesto(appunti, testo) {
  if (typeof testo !== "string" || testo.trim() === "") return { ok: false, motivo: "vuoto" };
  if (!appunti || typeof appunti.writeText !== "function") return { ok: false, motivo: "copia" };
  try {
    await appunti.writeText(testo);
    return { ok: true };
  } catch {
    return { ok: false, motivo: "copia" };
  }
}
