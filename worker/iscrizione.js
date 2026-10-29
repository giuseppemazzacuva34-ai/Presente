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
const VERSIONE_INFORMATIVA = "1.1-2026-10-26";
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

const SCHEMA = `CREATE TABLE IF NOT EXISTS iscrizioni (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  zona TEXT NOT NULL,
  invito TEXT,
  consenso_il TEXT NOT NULL,
  versione_informativa TEXT NOT NULL
)`;

function grazie(request) {
  return Response.redirect(new URL("/grazie", request.url).toString(), 303);
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

export async function iscrizione(request, env) {
  if (env.ISCRIZIONI_APERTE !== "si" || !env.DB) {
    return pagina("Ci siamo quasi.", "Le iscrizioni aprono tra pochissimo. Riprova tra qualche ora.", 503);
  }
  if (!stessoSito(request)) {
    return pagina("Qualcosa non torna.", "Iscriviti direttamente dal modulo sul nostro sito.", 403);
  }
  if (await troppiTentativi(request, env)) {
    return pagina("Un attimo.", "Troppi tentativi in poco tempo. Riprova tra un minuto.", 429);
  }
  let modulo;
  try {
    modulo = await request.formData();
  } catch {
    return pagina("Qualcosa non torna.", "Il modulo non è arrivato completo. Riprova.", 400);
  }
  // Campo trappola: le persone non lo vedono, i programmi automatici sì.
  if (String(modulo.get("campo-trappola") || "") !== "") return grazie(request);

  const email = String(modulo.get("email") || "").trim().toLowerCase();
  const zona = String(modulo.get("zona") || "");
  const invito = String(modulo.get("invito") || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const valido = email.length <= 254 && EMAIL.test(email) && ZONE.has(zona)
    && modulo.get("maggiorenne") === "si" && modulo.get("consenso") === "si";
  if (!valido) {
    return pagina("Manca qualcosa.", "Controlla l'email, scegli la città e spunta le due caselle.", 400);
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
    return pagina("Qualcosa non è andato.", "Non siamo riusciti a salvare l'iscrizione. Riprova tra qualche minuto.", 500);
  }

  if (nuova) await contaIscrizione(env, canale);
  return grazie(request);
}

