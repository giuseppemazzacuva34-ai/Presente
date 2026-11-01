// Riceve il modulo della lista d'attesa e salva l'iscrizione nel database D1 (binding "DB").
// Gratis sul piano Free di Cloudflare Workers: 100.000 richieste al giorno, 100.000 righe scritte al giorno su D1.
// Le iscrizioni restano chiuse finché la variabile ISCRIZIONI_APERTE non vale "si" (dopo l'approvazione dell'informativa, D5).
import { pagina } from "./pagina.js";
import { canaleValido, contaIscrizione } from "./canale.js";
import { ZONE, normalizzaCitta } from "./citta.js";
import { generaCodice, codiciConfigurati } from "./invito.js";

// Il campo si chiama ancora "zona" ma dal 26 ottobre contiene la città; dal 31/10 (D64) è scritta a mano
// e il Worker la riporta a una zona (worker/citta.js). Per le «altre città italiane» la città semplificata va in «citta».
export { ZONE };
export const VERSIONE_INFORMATIVA = "1.3-2026-11-01";
export const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

const SCHEMA = `CREATE TABLE IF NOT EXISTS iscrizioni (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  zona TEXT NOT NULL,
  invito TEXT,
  consenso_il TEXT NOT NULL,
  versione_informativa TEXT NOT NULL,
  sorgente TEXT NOT NULL DEFAULT 'landing',
  citta TEXT,
  presento TEXT,
  cerchi TEXT,
  fascia TEXT,
  consenso_cerchi_il TEXT,
  codice TEXT
)`;
// citta (dal 31/10, D64): solo per zona «altra-citta-italia», la città scritta e semplificata (es. «reggio emilia»).
// Nel database vero la colonna si aggiunge da sola alla prima iscrizione (ALTER TABLE qui sotto) se non c'è ancora.
// Domande facoltative (dal 31/10, D33 A con i testi approvati in D65 A): presento, cerchi, fascia e, solo se si
// risponde a «chi cerchi», la data del consenso a parte (art. 9 GDPR). Le colonne si aggiungono da sole come «citta».
const AGGIUNGI_COLONNE = [
  "ALTER TABLE iscrizioni ADD COLUMN citta TEXT",
  "ALTER TABLE iscrizioni ADD COLUMN presento TEXT",
  "ALTER TABLE iscrizioni ADD COLUMN cerchi TEXT",
  "ALTER TABLE iscrizioni ADD COLUMN fascia TEXT",
  "ALTER TABLE iscrizioni ADD COLUMN consenso_cerchi_il TEXT",
  // Codice invito personale (dal 31/10, spec referral parte 2, D69 A): casuale, unico, mai derivato dall'email.
  "ALTER TABLE iscrizioni ADD COLUMN codice TEXT",
  // Gettone del passo 2 (D79 A, dal 1/11): impronta SHA-256 di un valore casuale monouso, scade in 24 ore.
  "ALTER TABLE iscrizioni ADD COLUMN gettone TEXT",
  "ALTER TABLE iscrizioni ADD COLUMN gettone_scade TEXT",
];
// L'indice impedisce due codici uguali: in caso di collisione il Worker ne genera un altro (al massimo 5 tentativi).
const INDICE_CODICE = "CREATE UNIQUE INDEX IF NOT EXISTS iscrizioni_codice ON iscrizioni(codice)";
const INDICE_GETTONE = "CREATE INDEX IF NOT EXISTS iscrizioni_gettone ON iscrizioni(gettone)";
const TENTATIVI_CODICE = 5;
const INSERISCI = "INSERT INTO iscrizioni (email, zona, invito, consenso_il, versione_informativa, sorgente, citta, presento, cerchi, fascia, consenso_cerchi_il, codice, gettone, gettone_scade) VALUES (?, ?, ?, ?, ?, 'landing', ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING";

// MODULO IN DUE PASSI (D79 A, punto 3, dal 1/11). Passo 1 (home): solo email e caselle; la zona resta «non-indicata»
// (esclusa da contatori e classifiche) e il Worker crea un gettone casuale monouso che scade in 24 ore: NON è il codice
// invito che si condivide. Nel database va solo la sua impronta SHA-256, nell'indirizzo il valore. Passo 2 (/grazie?t=):
// città e domande facoltative, inviate a /completa, che aggiorna solo la riga con quel gettone e zona «non-indicata»
// e poi cancella il gettone. Il modulo vecchio con la città (pagine rimaste in cache) continua a funzionare come prima.
export const ZONA_NON_INDICATA = "non-indicata";
export const GETTONE = /^[0-9a-f]{32}$/;
const DURATA_GETTONE = 24 * 60 * 60 * 1000;

export function nuovoGettone() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function impronta(gettone) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(gettone));
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

function codiceDoppio(errore) {
  return /UNIQUE constraint failed: iscrizioni\.codice/i.test(String(errore && errore.message));
}

function mancaColonna(errore) {
  return /no column named|has no column|no such column/i.test(String(errore && errore.message));
}

// Aggiunge le colonne che mancano nel database vero; quelle già presenti danno «duplicate column» e si saltano.
async function aggiungiColonne(env) {
  for (const sql of AGGIUNGI_COLONNE) {
    try {
      await env.DB.prepare(sql).run();
    } catch (errore) {
      if (!/duplicate column/i.test(String(errore && errore.message))) throw errore;
    }
  }
}

// Solo valori dell'elenco: qualunque altra cosa vale «nessuna risposta».
export const RISPOSTE = {
  presento: ["donna", "uomo", "non_binario", "altro"],
  cerchi: ["donne", "uomini", "tutti"],
  fascia: ["18-24", "25-34", "35-44", "45+"],
};
export function risposteFacoltative(modulo) {
  const scelta = (campo) => {
    const v = String(modulo.get(campo) || "");
    return RISPOSTE[campo].includes(v) ? v : null;
  };
  const presento = scelta("presento");
  const fascia = scelta("fascia");
  // «Chi cerchi» si salva SOLO con la casella a parte spuntata; senza spunta la risposta si scarta.
  const cerchi = modulo.get("consenso-cerchi") === "si" ? scelta("cerchi") : null;
  return { presento, cerchi, fascia };
}
// sorgente (dal 30/10, D53 = A): "landing" per il modulo del sito, "meta_modulo" per i contatti del modulo
// dentro Facebook e Instagram importati con scripts/importa_meta.mjs. Nel database vero la colonna è stata
// aggiunta il 30/10 con ALTER TABLE (le righe già presenti valgono "landing").

// Dopo l'iscrizione si va a /grazie; se l'iscritto arriva da un canale (D26) l'indirizzo porta ?da=<canale>,
// così il contatore delle visite (D43) conta /grazie per giorno e per sorgente. Solo il nome del canale, nessun dato personale.
// Dal 31/10 (D64) porta anche ?citta=<città> per la frase «mancano N persone»: la pagina non la salva.
// Solo per le iscrizioni NUOVE porta ?c=<codice personale>: chi riscrive un'email già in lista non vede il codice di nessuno.
// Con il gettone (?t=) la pagina mostra il passo 2; ?citta= allora è solo un suggerimento per il campo città.
function grazie(request, canale = "", citta = "", codice = "", gettone = "") {
  const url = new URL("/grazie", request.url);
  if (gettone) url.searchParams.set("t", gettone);
  if (canale) url.searchParams.set("da", canale);
  if (citta) url.searchParams.set("citta", citta);
  if (codice) url.searchParams.set("c", codice);
  return Response.redirect(url.toString(), 303);
}

// Accetta il modulo solo se arriva dal nostro sito: un altro sito non può iscrivere qualcuno a sua insaputa.
// I browser mandano sempre l'intestazione Origin con i moduli; se manca (programmi, vecchi browser) decide il limite di frequenza.
function stessoSito(request) {
  const origine = request.headers.get("origin");
  if (!origine) return true;
  try {
    return new URL(origine).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

// Limite di frequenza: al massimo 5 invii al minuto dalla stessa connessione (binding LIMITE_ISCRIZIONI in wrangler.jsonc).
// L'indirizzo IP serve solo a contare i tentativi in memoria: non viene salvato né scritto nei log.
async function troppiTentativi(request, env, prefisso = "iscrizione:") {
  if (!env.LIMITE_ISCRIZIONI) return false;
  const chiave = prefisso + (request.headers.get("cf-connecting-ip") || "sconosciuto");
  try {
    const { success } = await env.LIMITE_ISCRIZIONI.limit({ key: chiave });
    return !success;
  } catch {
    return false;
  }
}

// Esiti dei tentativi d'iscrizione per giorno (dal 30/10): solo il nome dell'esito e un numero, mai email, IP o user agent.
// Serve a capire se le persone provano a iscriversi e vengono respinte (es. 0 iscrizioni con molte visite).
const SCHEMA_ESITI = `CREATE TABLE IF NOT EXISTS esiti_iscrizione (
  giorno TEXT NOT NULL,
  esito TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (giorno, esito)
)`;
export const ESITI = ["nuova", "gia_in_lista", "chiuse", "altro_sito", "troppi_tentativi", "modulo_rotto", "trappola", "dati_mancanti", "errore_database",
  // passo 2 (D79 A): completato, gettone scaduto/già usato, dati mancanti
  "passo2_completato", "passo2_scaduto", "passo2_dati_mancanti"];

async function contaEsito(env, esito) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(SCHEMA_ESITI).run();
    await env.DB.prepare(
      "INSERT INTO esiti_iscrizione (giorno, esito, n) VALUES (?, ?, 1) ON CONFLICT(giorno, esito) DO UPDATE SET n = n + 1"
    ).bind(new Date().toISOString().slice(0, 10), esito).run();
  } catch (errore) {
    console.error("iscrizione: esito non contato", errore && errore.name);
  }
}

// Numeri per /conteggio: { "AAAA-MM-GG": { esito: n } }. Solo totali.
export async function perEsiti(env) {
  const esiti = {};
  if (!env.DB) return esiti;
  try {
    const righe = await env.DB.prepare("SELECT giorno, esito, n FROM esiti_iscrizione").all();
    for (const r of righe.results || []) (esiti[r.giorno] ||= {})[r.esito] = r.n || 0;
  } catch {
    // La tabella nasce con il primo tentativo.
  }
  return esiti;
}

// Totali per /conteggio delle domande facoltative: { presento: {donna: n, …}, cerchi: {…} | "meno di 10", fascia: {…} }.
// Una domanda alla volta, mai incrociata con città o altre risposte: solo conteggi totali, come promesso nel consenso.
export const MINIMO_CERCHI = 10;
const TOTALI_RISPOSTE = {
  presento: "SELECT presento AS valore, COUNT(*) AS n FROM iscrizioni WHERE presento IS NOT NULL GROUP BY presento",
  cerchi: "SELECT cerchi AS valore, COUNT(*) AS n FROM iscrizioni WHERE cerchi IS NOT NULL GROUP BY cerchi",
  fascia: "SELECT fascia AS valore, COUNT(*) AS n FROM iscrizioni WHERE fascia IS NOT NULL GROUP BY fascia",
};
export async function perRisposte(env) {
  const risultato = {};
  if (!env.DB) return risultato;
  for (const campo of Object.keys(RISPOSTE)) {
    try {
      const righe = await env.DB.prepare(TOTALI_RISPOSTE[campo]).all();
      const totali = {};
      for (const r of righe.results || []) if (RISPOSTE[campo].includes(r.valore)) totali[r.valore] = r.n;
      const somma = Object.values(totali).reduce((x, y) => x + y, 0);
      risultato[campo] = campo === "cerchi" && somma < MINIMO_CERCHI ? `meno di ${MINIMO_CERCHI}` : totali;
    } catch {
      risultato[campo] = {}; // colonna non ancora creata: nessuna risposta
    }
  }
  return risultato;
}

export async function iscrizione(request, env) {
  const risposta = await gestisci(request, env);
  await contaEsito(env, risposta.esito);
  return risposta.risposta;
}

async function gestisci(request, env) {
  const r = (esito, risposta) => ({ esito, risposta });
  if (env.ISCRIZIONI_APERTE !== "si" || !env.DB) {
    return r("chiuse", pagina("Ci siamo quasi.", "Le iscrizioni aprono tra pochissimo. Riprova tra qualche ora.", 503));
  }
  if (!stessoSito(request)) {
    return r("altro_sito", pagina("Qualcosa non torna.", "Iscriviti direttamente dal modulo sul nostro sito.", 403));
  }
  if (await troppiTentativi(request, env)) {
    return r("troppi_tentativi", pagina("Un attimo.", "Troppi tentativi in poco tempo. Riprova tra un minuto.", 429));
  }
  let modulo;
  try {
    modulo = await request.formData();
  } catch {
    return r("modulo_rotto", pagina("Qualcosa non torna.", "Il modulo non è arrivato completo. Riprova.", 400));
  }
  // Campo trappola: le persone non lo vedono, i programmi automatici sì.
  if (String(modulo.get("campo-trappola") || "") !== "") return r("trappola", grazie(request));

  const email = String(modulo.get("email") || "").trim().toLowerCase();
  const zonaScritta = String(modulo.get("zona") || "").trim();
  // Passo 1 del modulo nuovo: nessuna città → «non-indicata» e gettone per il passo 2.
  const duePassi = zonaScritta === "";
  const luogo = duePassi ? { zona: ZONA_NON_INDICATA, citta: null } : normalizzaCitta(zonaScritta.slice(0, 80));
  const invito = String(modulo.get("invito") || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const valido = email.length <= 254 && EMAIL.test(email) && luogo !== null
    // D80 A (informativa 1.3): una sola casella, «Ho almeno 18 anni e voglio entrare…», vale come conferma dei 18 anni e consenso.
    // Le pagine vecchie in cache mandano ancora «maggiorenne» a parte: se c'è, deve essere «si».
    && modulo.get("consenso") === "si" && [null, "si"].includes(modulo.get("maggiorenne"));
  if (!valido) {
    return r("dati_mancanti", pagina("Manca qualcosa.", duePassi ? "Controlla l'email e spunta la casella." : "Controlla l'email, scrivi la tua città e spunta la casella.", 400));
  }
  // Città del link personale di un'amica (campo nascosto «suggerita» scritto dal Worker): solo un suggerimento per il passo 2.
  const suggerita = duePassi ? normalizzaCitta(String(modulo.get("suggerita") || "").slice(0, 60)) : null;
  const gettone = duePassi ? nuovoGettone() : "";

  // Canale del link /da/<canale> (D26): serve solo al contatore, non entra nella riga dell'iscritto.
  const canale = canaleValido(modulo.get("canale"));
  let nuova = false;
  let codice = "";
  try {
    await env.DB.prepare(SCHEMA).run();
    try {
      await env.DB.prepare(INDICE_CODICE).run();
      await env.DB.prepare(INDICE_GETTONE).run();
    } catch (errore) {
      if (!mancaColonna(errore)) throw errore;
      await aggiungiColonne(env);
      await env.DB.prepare(INDICE_CODICE).run();
      await env.DB.prepare(INDICE_GETTONE).run();
    }
    const adesso = new Date().toISOString();
    const { presento, cerchi, fascia } = risposteFacoltative(modulo);
    const creator = codiciConfigurati(env);
    const improntaGettone = gettone ? await impronta(gettone) : null;
    const scade = gettone ? new Date(Date.now() + DURATA_GETTONE).toISOString() : null;
    let esito;
    for (let tentativo = 1; ; tentativo++) {
      do codice = generaCodice(); while (creator.has(codice)); // mai uguale a un codice dei creator
      const valori = [email, luogo.zona, invito || null, adesso, VERSIONE_INFORMATIVA, luogo.citta,
        presento, cerchi, fascia, cerchi ? adesso : null, codice, improntaGettone, scade];
      try {
        esito = await env.DB.prepare(INSERISCI).bind(...valori).run();
        break;
      } catch (errore) {
        if (mancaColonna(errore)) {
          await aggiungiColonne(env);
        } else if (!codiceDoppio(errore) || tentativo >= TENTATIVI_CODICE) {
          throw errore;
        }
      }
      if (tentativo >= TENTATIVI_CODICE) throw new Error("codice");
    }
    // Chi era già in lista non viene contato una seconda volta (e non riceve un codice nuovo).
    nuova = Boolean(esito && esito.meta && esito.meta.changes > 0);
    if (!nuova) codice = "";
  } catch (errore) {
    // Nel log solo il tipo di errore: mai l'email o altri dati della persona.
    console.error("iscrizione: errore del database", errore && errore.name);
    return r("errore_database", pagina("Qualcosa non è andato.", "Non siamo riusciti a salvare l'iscrizione. Riprova tra qualche minuto.", 500));
  }

  if (nuova) await contaIscrizione(env, canale);
  if (duePassi) {
    // Chi era già in lista non riceve il gettone: non può cambiare la riga di nessuno.
    const s = suggerita && suggerita.zona !== "estero" ? (suggerita.citta || suggerita.zona) : "";
    return r(nuova ? "nuova" : "gia_in_lista", grazie(request, canale, nuova ? s : "", codice, nuova ? gettone : ""));
  }
  return r(nuova ? "nuova" : "gia_in_lista", grazie(request, canale, luogo.citta || luogo.zona, codice));
}

// POST /completa (passo 2): città obbligatoria, domande facoltative come nel modulo vecchio.
// Aggiorna SOLO la riga con l'impronta di quel gettone, non scaduto e con zona «non-indicata»; poi il gettone sparisce.
// Le risposte facoltative già date non vengono sovrascritte (COALESCE). Stessi controlli di /iscrizione.
const COMPLETA = `UPDATE iscrizioni SET zona = ?, citta = ?,
  presento = COALESCE(presento, ?), fascia = COALESCE(fascia, ?),
  consenso_cerchi_il = CASE WHEN cerchi IS NULL AND ? IS NOT NULL THEN ? ELSE consenso_cerchi_il END,
  cerchi = COALESCE(cerchi, ?), gettone = NULL, gettone_scade = NULL
  WHERE gettone = ? AND gettone_scade > ? AND zona = '${ZONA_NON_INDICATA}' RETURNING codice`;

export async function completa(request, env) {
  const risposta = await gestisciCompleta(request, env);
  await contaEsito(env, risposta.esito);
  return risposta.risposta;
}

async function gestisciCompleta(request, env) {
  const r = (esito, risposta) => ({ esito, risposta });
  if (env.ISCRIZIONI_APERTE !== "si" || !env.DB) {
    return r("chiuse", pagina("Ci siamo quasi.", "Riprova tra qualche ora: la tua iscrizione è comunque salvata.", 503));
  }
  if (!stessoSito(request)) return r("altro_sito", pagina("Qualcosa non torna.", "Completa l'iscrizione dal nostro sito.", 403));
  if (await troppiTentativi(request, env, "completa:")) {
    return r("troppi_tentativi", pagina("Un attimo.", "Troppi tentativi in poco tempo. Riprova tra un minuto.", 429));
  }
  let modulo;
  try {
    modulo = await request.formData();
  } catch {
    return r("modulo_rotto", pagina("Qualcosa non torna.", "Il modulo non è arrivato completo. Riprova.", 400));
  }
  const gettone = String(modulo.get("t") || "");
  const luogo = normalizzaCitta(String(modulo.get("zona") || "").slice(0, 80));
  if (!GETTONE.test(gettone) || !luogo) {
    return r("passo2_dati_mancanti", pagina("Manca qualcosa.", "Scrivi la tua città e riprova.", 400));
  }
  const canale = canaleValido(modulo.get("canale"));
  const { presento, cerchi, fascia } = risposteFacoltative(modulo);
  const adesso = new Date().toISOString();
  let codice = null;
  try {
    const esito = await env.DB.prepare(COMPLETA).bind(luogo.zona, luogo.citta, presento, fascia, cerchi, cerchi ? adesso : null,
      cerchi, await impronta(gettone), adesso).all();
    const riga = (esito && esito.results || [])[0];
    if (!riga) {
      return r("passo2_scaduto", pagina("Sei già in lista.", "Questo link non vale più (scade dopo 24 ore e si usa una volta sola). La tua iscrizione è salvata: ti scriviamo quando apre Presente.", 410));
    }
    codice = riga.codice || "";
  } catch (errore) {
    console.error("completa: errore del database", errore && errore.name);
    return r("errore_database", pagina("Qualcosa non è andato.", "Non siamo riusciti a salvare la città. Riprova tra qualche minuto.", 500));
  }
  return r("passo2_completato", grazie(request, canale, luogo.citta || luogo.zona, codice));
}

