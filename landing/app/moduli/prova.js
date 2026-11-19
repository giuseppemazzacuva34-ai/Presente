// Prova finta dell'app (D141 A di Giuseppe, linea «sviluppatore-c»): un «server finto» che risponde al posto di
// Supabase e del Worker, così si clicca tutta l'app con persone e dati finti. Le schermate sono quelle vere
// (flusso.js e i moduli delle tre linee); qui si fingono solo i pezzi che parlano con la rete, con la stessa forma
// delle risposte vere. REGOLE: niente rete, niente salvataggi sul telefono (tutto sparisce chiudendo la pagina),
// nomi chiaramente inventati. La pagina che la usa è /app/prova.html (non linkata, noindex).
//
// Passo 1: accesso con email, iscrizione salvata in memoria, provincia della lista, contatore della zona,
// «Entra nella stanza». I passi successivi aggiungono stanza di 12, chiamate, chiavi, porta, svelamento, Aiuto.

export const UTENTE_PROVA = "00000000-0000-4000-8000-000000000001";
const EMAIL_VALIDA = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FILE_AMMESSI = /^(presentazione|risposta-[1-3]|foto-[1-3])$/;
const CAMPI_PROFILO = ["data_nascita", "regole_accettate_il", "nome", "provincia", "provincia_origine", "paese",
  "mi_presento_come", "mi_descrivo", "domande_voce", "passo", "fascia_da", "fascia_a", "pausa_il"];
const CAMPI_FILTRI = ["cerco", "eta_min", "eta_max", "raggio", "cosa_cerco", "figli", "fumo"];

function tieni(campi, ammessi) {
  const fuori = {};
  for (const k of ammessi) if (campi && campi[k] !== undefined) fuori[k] = campi[k];
  return fuori;
}

// Ore e minuti di Roma per un istante (serve per il lunedì delle 9:00 con l'ora legale giusta).
function ora(ms) {
  const parti = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short" })
    .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { anno: Number(parti.year), mese: Number(parti.month), giorno: Number(parti.day), ora: Number(parti.hour) % 24, dow: parti.weekday };
}

// Il prossimo lunedì alle 9:00 di Roma dopo «adesso», in ISO.
export function prossimoLunedi(adesso) {
  const oggi = ora(adesso);
  for (let g = 0; g <= 7; g += 1) {
    for (const scarto of [1, 2]) {
      const ms = Date.UTC(oggi.anno, oggi.mese - 1, oggi.giorno + g, 9 - scarto);
      const r = ora(ms);
      if (r.dow === "Mon" && r.ora === 9 && ms > adesso) return new Date(ms).toISOString();
    }
  }
  return null;
}

export function creaProva({ adesso = () => Date.now(), attesaMs = 250 } = {}) {
  // Tutto il «database» della prova: vive solo in questa pagina.
  const mondo = { sessione: false, profilo: null, filtri: null, questionario: null, file: new Map(), conferma: null };
  // Un attimo di attesa come una rete vera, così si vedono «Invio…» e «Un attimo…».
  const pausa = () => new Promise((fatto) => setTimeout(fatto, attesaMs));
  const ok = async (extra = {}) => { await pausa(); return { ok: true, ...extra }; };

  const accesso = {
    async mandaLink(email) {
      if (!EMAIL_VALIDA.test(String(email || "").trim())) return { ok: false, motivo: "email" };
      return ok();
    },
    // Nella prova va bene qualunque codice di 6 cifre: nessuna email parte davvero.
    async verificaCodice(email, codice) {
      if (!/^\d{6}$/.test(String(codice || "").replace(/\s+/g, ""))) return { ok: false, motivo: "codice" };
      await pausa();
      mondo.sessione = true;
      return { ok: true, sessione: { utenteId: UTENTE_PROVA } };
    },
    daLink() { return null; },
    async token() { return mondo.sessione ? "token-della-prova" : null; },
    connesso() { return mondo.sessione; },
    utenteId() { return mondo.sessione ? UTENTE_PROVA : null; },
    async esci() { mondo.sessione = false; },
  };

  const archivio = {
    async salvaProfilo(campi) { mondo.profilo = { ...(mondo.profilo || {}), ...tieni(campi, CAMPI_PROFILO) }; return ok(); },
    async salvaDisponibilita(campi) {
      mondo.profilo = { ...(mondo.profilo || {}), ...tieni(campi, ["fascia_da", "fascia_a", "pausa_il"]) };
      return ok();
    },
    async salvaFiltri(campi) { mondo.filtri = { ...(mondo.filtri || {}), ...tieni(campi, CAMPI_FILTRI) }; return ok(); },
    async salvaQuestionario(risposte, importanza) { mondo.questionario = { risposte: { ...risposte }, importanza: { ...importanza } }; return ok(); },
    async caricaFile(cartella, nome, blob) {
      if (!["voci", "foto"].includes(cartella) || !FILE_AMMESSI.test(nome)) return { ok: false, motivo: "salvataggio" };
      mondo.file.set(`${cartella}/${nome}`, blob);
      return ok();
    },
    async scaricaFile(cartella, nome) { return mondo.file.get(`${cartella}/${nome}`) || null; },
    async leggi() {
      await pausa();
      const nomi = (cartella) => [...mondo.file.keys()].filter((k) => k.startsWith(`${cartella}/`)).map((k) => k.slice(cartella.length + 1));
      return { ok: true, profilo: mondo.profilo && { ...mondo.profilo }, filtri: mondo.filtri && { ...mondo.filtri },
        questionario: mondo.questionario && { ...mondo.questionario }, voci: nomi("voci"), foto: nomi("foto") };
    },
  };

  // Nessuna lista d'attesa nella prova; la zona della prova è già accesa, quindi niente contatore.
  const lista = { async leggi() { return null; }, async conferma() { return false; } };
  const zona = { async leggi() { return null; } };

  const stanza = {
    async leggi() { await pausa(); return { ok: true, apreIl: mondo.conferma }; },
    async entra() { mondo.conferma = prossimoLunedi(adesso()); return ok({ apreIl: mondo.conferma }); },
    async ritira() { mondo.conferma = null; return ok(); },
  };

  return { accesso, archivio, lista, zona, stanza };
}
