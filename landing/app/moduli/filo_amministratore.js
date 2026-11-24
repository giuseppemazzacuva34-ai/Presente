// Pannello dell'amministratore per il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 12c della
// linea «sviluppatore-c». Parla SOLO con /app/api/filo-amministratore/{stanze, assegna, togli-filo, ascolta,
// togli-vocale} (worker/filo_amministratore_api.js) col token di chi guarda: se è amministratore lo decide il database
// (tabella moderatori). Qui solo testi e forma dei dati, niente pagina (così si prova con node --test). Niente
// salvataggi sul telefono, niente log: email e testi restano sullo schermo. Pagina interna (in beta la usa solo
// Giuseppe): nessun testo pubblico nuovo.

const BASE = "/app/api/filo-amministratore";
const ATTESA_MS = 10000;
const TIPI = new Set(["lunedi", "domenica"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9_-]{1,80}\.(webm|ogg|m4a|mp4|mp3|aac)$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const LINK = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/storage\/v1\/object\/sign\/vocali_filo\//;

const GIORNO = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "Europe/Rome" });
const ORA = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
const AVVISI = Object.freeze({
  manca_lunedi: "Alle 8:45 manca il vocale del lunedì: il Filo può ancora caricarlo fino alle 13:00.",
  senza_lunedi: "Dopo le 13:00: questa settimana la stanza è senza vocale del lunedì.",
});

function momento(iso) {
  const d = new Date(typeof iso === "string" ? iso : "");
  return Number.isNaN(d.getTime()) ? "" : `${GIORNO.format(d)} alle ${ORA.format(d)}`;
}

// Elenco leggibile: { stanza, titolo, periodo, filo, conFilo, membri, vocali, lunedi, domenica, avviso, rossa }.
// Prima le stanze con un avviso (rosse), poi le altre nell'ordine del server.
export function vociStanzeFilo(stanze, adesso = new Date()) {
  void adesso;
  if (!Array.isArray(stanze)) return [];
  return stanze
    .filter((s) => s && typeof s === "object" && UUID.test(String(s.stanza || "")))
    .map((s, i) => {
      const nome = typeof s.nome === "string" && s.nome.trim() ? s.nome.trim() : "Stanza";
      const citta = typeof s.citta === "string" && s.citta.trim() ? s.citta.trim() : "";
      const conFilo = typeof s.filo_nome === "string";
      const membri = Number.isInteger(s.membri) && s.membri >= 0 ? s.membri : 0;
      const lunedi = s.vocale_lunedi === true;
      const domenica = s.vocale_domenica === true;
      const avviso = Object.hasOwn(AVVISI, s.avviso) ? AVVISI[s.avviso] : "";
      const da = momento(s.apre_il), a = momento(s.chiude_il);
      return {
        stanza: s.stanza,
        titolo: citta ? `${nome} · ${citta}` : nome,
        periodo: da && a ? `dal ${da} al ${a}` : "",
        filo: !conFilo ? "Senza Filo" : `Filo: ${s.filo_nome.trim() || "(nome non inserito)"}`,
        conFilo,
        membri: `${membri} ${membri === 1 ? "persona" : "persone"}`,
        vocali: `Vocale del lunedì: ${lunedi ? "c'è" : "non ancora"} · vocale della domenica: ${domenica ? "c'è" : "non ancora"}`,
        lunedi,
        domenica,
        avviso,
        rossa: avviso !== "",
        _ordine: [avviso ? 0 : 1, i],
      };
    })
    .sort((x, y) => x._ordine[0] - y._ordine[0] || x._ordine[1] - y._ordine[1])
    .map(({ _ordine, ...v }) => v);
}

export function durataVocale(secondi) {
  const n = Number(secondi);
  if (!Number.isFinite(n) || n < 0) return "";
  const s = Math.round(n);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const ERRORI = Object.freeze({
  accesso: "Entra prima nell'app con il tuo account, poi torna su questa pagina.",
  non_amministratore: "Questo account non può usare il pannello del Filo.",
  spento: "La pagina non è ancora attiva.",
  rete: "Connessione assente. Riprova tra poco.",
  troppe: "Troppi tentativi. Aspetta un minuto.",
  persona: "Nessun account con questa email: controlla l'indirizzo.",
  stanza: "Questa stanza è già chiusa.",
  filo_membro: "Questa persona è nella stanza: il Filo non può esserne membro.",
  email: "Scrivi un'email valida.",
  dati: "Controlla i dati e riprova.",
});
export const testoErroreFilo = (motivo) => (Object.hasOwn(ERRORI, motivo) ? ERRORI[motivo] : "Qualcosa non ha funzionato. Riprova tra poco.");

export function creaFiloAmministratore({ token, fetch: f = globalThis.fetch, attesa = ATTESA_MS }) {
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
        r = await f(`${BASE}${percorso}`, { method: metodo, signal: ferma.signal, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
      } catch {
        return { errore: "rete" };
      }
      if (r.status === 401) return { errore: "accesso" };
      if (r.status === 403) return { errore: "non_amministratore" };
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
  const motivoDi = (dati) => (typeof dati.motivo === "string" && Object.hasOwn(ERRORI, dati.motivo) ? dati.motivo : "riprova");
  // Per assegna, togli-filo e togli-vocale: { ok: true, ...extra } | { ok: false, motivo }
  async function scrivi(percorso, corpo, conTolto) {
    const { dati, errore } = await chiedi(percorso, "POST", corpo);
    if (errore) return { ok: false, motivo: errore };
    if (dati.ok !== true) return { ok: false, motivo: motivoDi(dati) };
    if (!conTolto) return { ok: true };
    return typeof dati.tolto === "boolean" ? { ok: true, tolto: dati.tolto } : { ok: false, motivo: "riprova" };
  }
  const stanzaValida = (stanza) => UUID.test(String(stanza || ""));

  return {
    async stanze() {
      const { dati, errore } = await chiedi("/stanze", "GET");
      if (errore) return { ok: false, motivo: errore };
      if (dati.ok !== true || !Array.isArray(dati.stanze)) return { ok: false, motivo: "riprova" };
      return { ok: true, stanze: dati.stanze };
    },
    async assegna(stanza, email) {
      if (!stanzaValida(stanza)) return { ok: false, motivo: "dati" };
      const pulita = typeof email === "string" ? email.trim() : "";
      if (pulita.length > 254 || !EMAIL.test(pulita)) return { ok: false, motivo: "email" };
      return scrivi("/assegna", { stanza, email: pulita }, false);
    },
    async togliFilo(stanza) {
      if (!stanzaValida(stanza)) return { ok: false, motivo: "dati" };
      return scrivi("/togli-filo", { stanza }, true);
    },
    async ascolta(stanza, tipo) {
      if (!stanzaValida(stanza) || !TIPI.has(tipo)) return { ok: false, motivo: "dati" };
      const { dati, errore } = await chiedi(`/ascolta?stanza=${stanza}&tipo=${tipo}`, "GET");
      if (errore) return { ok: false, motivo: errore };
      if (dati.ok !== true) return { ok: false, motivo: motivoDi(dati) };
      if (dati.vocale === null) return { ok: true, vocale: null };
      const v = dati.vocale;
      if (!v || typeof v !== "object" || typeof v.url !== "string" || !LINK.test(v.url) || typeof v.file !== "string" || !FILE.test(v.file)) {
        return { ok: false, motivo: "riprova" };
      }
      return { ok: true, vocale: v };
    },
    async togliVocale(stanza, tipo, file) {
      if (!stanzaValida(stanza) || !TIPI.has(tipo) || typeof file !== "string" || !FILE.test(file)) return { ok: false, motivo: "dati" };
      return scrivi("/togli-vocale", { stanza, tipo, file }, true);
    },
  };
}
