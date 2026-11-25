// Pannello del Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 13a della linea «sviluppatore-c»:
// il modulo della pagina con cui il Filo vede le sue stanze (solo nomi di battesimo, regole, dalle 21:00 di domenica
// solo il numero delle porte) e carica i suoi due vocali. Parla SOLO con GET /app/api/filo e POST /app/api/filo/vocale
// col token di chi guarda: chi è Filo e cosa può fare lo decidono il Worker e il database (orari e durate compresi).
// Qui solo testi, orari mostrati e forma dei dati, niente pagina (così si prova con node --test). Niente salvataggi
// sul telefono, niente log: nomi e testi restano sullo schermo. Pagina interna per il Filo: nessun testo pubblico nuovo.

const PERCORSO = "/app/api/filo";
const PERCORSO_VOCALE = "/app/api/filo/vocale";
const ATTESA_MS = 10000;
const ATTESA_CARICA_MS = 30000;
const MASSIMO = Object.freeze({ lunedi: 90, domenica: 60 });
const MINIMO = 10;
const MAX_TESTO = 900;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const GIORNO = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "Europe/Rome" });
const ORA = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
const PARTI = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Rome", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const GIORNI = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });

const data = (iso) => {
  const d = new Date(typeof iso === "string" ? iso : "");
  return Number.isNaN(d.getTime()) ? null : d;
};
// Giorno della settimana, giorno di calendario e minuti dalla mezzanotte in ora di Roma (cambio d'ora compreso).
function roma(d) {
  const p = Object.fromEntries(PARTI.formatToParts(d).map((x) => [x.type, x.value]));
  return { giorno: GIORNI[p.weekday], data: `${p.year}-${p.month}-${p.day}`, minuti: Number(p.hour) * 60 + Number(p.minute) };
}
const momento = (d) => `${GIORNO.format(d)} alle ${ORA.format(d)}`;

const NOTE = Object.freeze({
  lunedi: "Vocale del lunedì: puoi rifarlo fino alle 8:45.",
  lunedi_tardi: "Dopo le 8:45 il vocale del lunedì non si cambia. Se manca, puoi caricarlo fino alle 13:00.",
  domenica: "Vocale della domenica: puoi rifarlo fino alle 20:00 di domenica. Non dire il numero delle porte: lo mostra l'app alle 21:00.",
  nessuno: "Il vocale della domenica si registra da sabato alle 9:00 a domenica alle 20:00.",
});
const NESSUNA = Object.freeze({ tipo: null, massimo: 0, nota: NOTE.nessuno });

// Quale vocale si può registrare adesso per questa stanza (D151 A, ora di Roma). Solo un aiuto per la pagina:
// l'ultima parola sugli orari ce l'ha il database (salva_vocale_filo).
export function finestraVocale(stanza, adesso = new Date()) {
  const apre = data(stanza && stanza.apreIl), chiude = data(stanza && stanza.chiudeIl);
  if (!apre || !chiude || !(adesso instanceof Date) || Number.isNaN(adesso.getTime())) return NESSUNA;
  const r = roma(adesso);
  // Lunedì dell'apertura, dalle 00:30 (stanze composte) alle 13:00 (ultimo vocale in ritardo).
  if (r.giorno === 1 && r.data === roma(apre).data && r.minuti >= 30 && r.minuti < 13 * 60) {
    return { tipo: "lunedi", massimo: MASSIMO.lunedi, nota: r.minuti < 8 * 60 + 45 ? NOTE.lunedi : NOTE.lunedi_tardi };
  }
  // Da sabato 9:00 a domenica 20:00, a stanza aperta.
  const fineSettimana = (r.giorno === 6 && r.minuti >= 9 * 60) || (r.giorno === 0 && r.minuti < 20 * 60);
  if (fineSettimana && adesso > apre && adesso < chiude) {
    return { tipo: "domenica", massimo: MASSIMO.domenica, nota: NOTE.domenica };
  }
  return NESSUNA;
}

// Elenco leggibile delle stanze del Filo: { id, titolo, periodo, nomi, persone, porte, finestra }.
// Passano solo i campi che servono: se il server mandasse altro, qui si ferma.
export function vociPannelloFilo(risposta, adesso = new Date()) {
  const stanze = risposta && Array.isArray(risposta.stanze) ? risposta.stanze : [];
  return stanze
    .filter((s) => s && typeof s === "object" && UUID.test(String(s.id || "")))
    .map((s) => {
      const nomi = (Array.isArray(s.nomi) ? s.nomi : []).filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim());
      const apre = data(s.apreIl), chiude = data(s.chiudeIl);
      const porte = Number.isInteger(s.porte) && s.porte >= 0 ? `Porte aperte nella stanza: ${s.porte}` : "";
      return {
        id: s.id,
        titolo: typeof s.nome === "string" && s.nome.trim() ? s.nome.trim() : "Stanza",
        periodo: apre && chiude ? `dal ${momento(apre)} al ${momento(chiude)}` : "",
        nomi,
        persone: `${nomi.length} ${nomi.length === 1 ? "persona" : "persone"}`,
        porte,
        finestra: finestraVocale(s, adesso),
      };
    });
}

const lunghezza = (s) => [...s].length; // come char_length() di Postgres

// Controllo prima di caricare (lo rifà comunque il server): null se va bene, altrimenti il motivo.
export function controllaVocale({ tipo, secondi, testo } = {}) {
  if (!Object.hasOwn(MASSIMO, tipo)) return "dati";
  const durata = Math.round(Number(secondi));
  if (!Number.isFinite(durata) || durata < MINIMO) return "breve";
  if (durata > MASSIMO[tipo]) return "durata";
  const t = typeof testo === "string" ? testo.trim() : "";
  if (!t) return "testo";
  if (lunghezza(t) > MAX_TESTO) return "testo_lungo";
  return null;
}

const ERRORI = Object.freeze({
  accesso: "Entra prima nell'app con il tuo account, poi torna su questa pagina.",
  spento: "La pagina non è ancora attiva.",
  rete: "Connessione assente. Riprova tra poco.",
  troppe: "Troppi tentativi. Aspetta un minuto.",
  breve: "Il vocale deve durare almeno 10 secondi.",
  durata: "Il vocale è troppo lungo: massimo 90 secondi il lunedì, 60 la domenica.",
  testo: "Scrivi il testo del vocale: serve a chi non può ascoltare.",
  testo_lungo: "Il testo del vocale può avere al massimo 900 caratteri.",
  fuori_orario: "Ora questo vocale non si può caricare: controlla gli orari sotto il nome della stanza.",
  non_filo: "Non segui più questa stanza.",
  troppo_grande: "Il file del vocale è troppo grande: registralo di nuovo, più breve.",
  tipo: "Questo formato audio non è accettato: prova con un altro browser.",
  file: "Questo formato audio non è accettato: prova con un altro browser.",
  dati: "Controlla i dati e riprova.",
});
export const testoErrorePannelloFilo = (motivo) =>
  (Object.hasOwn(ERRORI, motivo) ? ERRORI[motivo] : "Qualcosa non ha funzionato. Riprova tra poco.");

export function creaPannelloFilo({ token, fetch: f = globalThis.fetch, attesa = ATTESA_MS, attesaCarica = ATTESA_CARICA_MS }) {
  async function chiedi(percorso, init, ms) {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return { errore: "accesso" };
    const ferma = new AbortController();
    const timer = setTimeout(() => ferma.abort(), ms);
    try {
      let r;
      try {
        r = await f(percorso, { ...init, signal: ferma.signal, headers: { authorization: `Bearer ${t}` } });
      } catch {
        return { errore: "rete" };
      }
      if (r.status === 401) return { errore: "accesso" };
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
    async stanze() {
      const { dati, errore } = await chiedi(PERCORSO, { method: "GET" }, attesa);
      if (errore) return { ok: false, motivo: errore };
      if (dati.ok !== true || !Array.isArray(dati.stanze)) return { ok: false, motivo: "riprova" };
      return { ok: true, regole: typeof dati.regole === "string" ? dati.regole : "", stanze: dati.stanze };
    },
    // audio: il Blob registrato; secondi: la durata misurata dal registratore.
    async carica({ stanza, tipo, secondi, testo, audio } = {}) {
      if (!UUID.test(String(stanza || "")) || !(audio instanceof Blob) || audio.size < 1) return { ok: false, motivo: "dati" };
      const motivo = controllaVocale({ tipo, secondi, testo });
      if (motivo) return { ok: false, motivo };
      const modulo = new FormData();
      modulo.append("stanza", stanza);
      modulo.append("tipo", tipo);
      modulo.append("durata", String(Math.round(Number(secondi))));
      modulo.append("testo", testo.trim());
      modulo.append("audio", audio, "vocale");
      const { dati, errore } = await chiedi(PERCORSO_VOCALE, { method: "POST", body: modulo }, attesaCarica);
      if (errore) return { ok: false, motivo: errore };
      if (dati.ok === true) return { ok: true, tipo: dati.tipo, durata: dati.durata };
      return { ok: false, motivo: typeof dati.motivo === "string" && Object.hasOwn(ERRORI, dati.motivo) ? dati.motivo : "riprova" };
    },
  };
}
