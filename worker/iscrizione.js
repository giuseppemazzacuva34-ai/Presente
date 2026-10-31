// Riceve il modulo della lista d'attesa e salva l'iscrizione nel database D1 (binding "DB").
// Gratis sul piano Free di Cloudflare Workers: 100.000 richieste al giorno, 100.000 righe scritte al giorno su D1.
// Le iscrizioni restano chiuse finché la variabile ISCRIZIONI_APERTE non vale "si" (dopo l'approvazione dell'informativa, D5).
import { pagina } from "./pagina.js";
import { canaleValido, contaIscrizione } from "./canale.js";
import { ZONE, normalizzaCitta } from "./citta.js";

// Il campo si chiama ancora "zona" ma dal 26 ottobre contiene la città; dal 31/10 (D64) è scritta a mano
// e il Worker la riporta a una zona (worker/citta.js). Per le «altre città italiane» la città semplificata va in «citta».
export { ZONE };
export const VERSIONE_INFORMATIVA = "1.2-2026-10-30";
export const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

const SCHEMA = `CREATE TABLE IF NOT EXISTS iscrizioni (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  zona TEXT NOT NULL,
  invito TEXT,
  consenso_il TEXT NOT NULL,
  versione_informativa TEXT NOT NULL,
  sorgente TEXT NOT NULL DEFAULT 'landing',
  citta TEXT
)`;
// citta (dal 31/10, D64): solo per zona «altra-citta-italia», la città scritta e semplificata (es. «reggio emilia»).
// Nel database vero la colonna si aggiunge da sola alla prima iscrizione (ALTER TABLE qui sotto) se non c'è ancora.
const AGGIUNGI_CITTA = "ALTER TABLE iscrizioni ADD COLUMN citta TEXT";
const INSERISCI = "INSERT INTO iscrizioni (email, zona, invito, consenso_il, versione_informativa, sorgente, citta) VALUES (?, ?, ?, ?, ?, 'landing', ?) ON CONFLICT(email) DO NOTHING";

function mancaColonnaCitta(errore) {
  return /no column named citta|has no column|no such column/i.test(String(errore && errore.message));
}
// sorgente (dal 30/10, D53 = A): "landing" per il modulo del sito, "meta_modulo" per i contatti del modulo
// dentro Facebook e Instagram importati con scripts/importa_meta.mjs. Nel database vero la colonna è stata
// aggiunta il 30/10 con ALTER TABLE (le righe già presenti valgono "landing").

// Dopo l'iscrizione si va a /grazie; se l'iscritto arriva da un canale (D26) l'indirizzo porta ?da=<canale>,
// così il contatore delle visite (D43) conta /grazie per giorno e per sorgente. Solo il nome del canale, nessun dato personale.
function grazie(request, canale = "") {
  const url = new URL("/grazie", request.url);
  if (canale) url.searchParams.set("da", canale);
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
async function troppiTentativi(request, env) {
  if (!env.LIMITE_ISCRIZIONI) return false;
  const chiave = "iscrizione:" + (request.headers.get("cf-connecting-ip") || "sconosciuto");
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
export const ESITI = ["nuova", "gia_in_lista", "chiuse", "altro_sito", "troppi_tentativi", "modulo_rotto", "trappola", "dati_mancanti", "errore_database"];

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
  const luogo = normalizzaCitta(String(modulo.get("zona") || "").slice(0, 80));
  const invito = String(modulo.get("invito") || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const valido = email.length <= 254 && EMAIL.test(email) && luogo !== null
    && modulo.get("maggiorenne") === "si" && modulo.get("consenso") === "si";
  if (!valido) {
    return r("dati_mancanti", pagina("Manca qualcosa.", "Controlla l'email, scrivi la tua città e spunta le due caselle.", 400));
  }

  // Canale del link /da/<canale> (D26): serve solo al contatore, non entra nella riga dell'iscritto.
  const canale = canaleValido(modulo.get("canale"));
  let nuova = false;
  try {
    await env.DB.prepare(SCHEMA).run();
    const valori = [email, luogo.zona, invito || null, new Date().toISOString(), VERSIONE_INFORMATIVA, luogo.citta];
    let esito;
    try {
      esito = await env.DB.prepare(INSERISCI).bind(...valori).run();
    } catch (errore) {
      if (!mancaColonnaCitta(errore)) throw errore;
      await env.DB.prepare(AGGIUNGI_CITTA).run();
      esito = await env.DB.prepare(INSERISCI).bind(...valori).run();
    }
    // Chi era già in lista non viene contato una seconda volta.
    nuova = Boolean(esito && esito.meta && esito.meta.changes > 0);
  } catch (errore) {
    // Nel log solo il tipo di errore: mai l'email o altri dati della persona.
    console.error("iscrizione: errore del database", errore && errore.name);
    return r("errore_database", pagina("Qualcosa non è andato.", "Non siamo riusciti a salvare l'iscrizione. Riprova tra qualche minuto.", 500));
  }

  if (nuova) await contaIscrizione(env, canale);
  return r(nuova ? "nuova" : "gia_in_lista", grazie(request, canale));
}

