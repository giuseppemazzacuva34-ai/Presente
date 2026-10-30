// Riceve il modulo della lista d'attesa e salva l'iscrizione nel database D1 (binding "DB").
// Gratis sul piano Free di Cloudflare Workers: 100.000 richieste al giorno, 100.000 righe scritte al giorno su D1.
// Le iscrizioni restano chiuse finché la variabile ISCRIZIONI_APERTE non vale "si" (dopo l'approvazione dell'informativa, D5).
import { pagina } from "./pagina.js";
import { canaleValido, contaIscrizione } from "./canale.js";

// Il campo si chiama ancora "zona" ma dal 26 ottobre contiene la città.
const ZONE = new Set([
  "milano", "roma", "napoli", "torino", "bologna", "firenze", "genova", "venezia-padova", "verona",
  "brescia-bergamo", "bari", "palermo", "catania", "cagliari", "altra-citta-italia", "estero",
]);
const VERSIONE_INFORMATIVA = "1.2-2026-10-30";
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

const SCHEMA = `CREATE TABLE IF NOT EXISTS iscrizioni (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  zona TEXT NOT NULL,
  invito TEXT,
  consenso_il TEXT NOT NULL,
  versione_informativa TEXT NOT NULL
)`;

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
  const zona = String(modulo.get("zona") || "");
  const invito = String(modulo.get("invito") || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const valido = email.length <= 254 && EMAIL.test(email) && ZONE.has(zona)
    && modulo.get("maggiorenne") === "si" && modulo.get("consenso") === "si";
  if (!valido) {
    return r("dati_mancanti", pagina("Manca qualcosa.", "Controlla l'email, scegli la città e spunta le due caselle.", 400));
  }

  // Canale del link /da/<canale> (D26): serve solo al contatore, non entra nella riga dell'iscritto.
  const canale = canaleValido(modulo.get("canale"));
  let nuova = false;
  try {
    await env.DB.prepare(SCHEMA).run();
    const esito = await env.DB.prepare(
      "INSERT INTO iscrizioni (email, zona, invito, consenso_il, versione_informativa) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING"
    ).bind(email, zona, invito || null, new Date().toISOString(), VERSIONE_INFORMATIVA).run();
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

