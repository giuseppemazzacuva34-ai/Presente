// Riceve il modulo della lista d'attesa e salva l'iscrizione nel database D1 (binding "DB").
// Gratis sul piano Free di Cloudflare: 100.000 richieste al giorno per le funzioni, 100.000 righe scritte al giorno su D1.
// Le iscrizioni restano chiuse finché la variabile ISCRIZIONI_APERTE non vale "si" (dopo l'approvazione dell'informativa, D5).
import { pagina } from "./_pagina.js";

const ZONE = new Set(["isola", "nolo", "porta-romana", "altra-zona"]);
const VERSIONE_INFORMATIVA = "bozza-2026-10-26";
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

export async function onRequestPost({ request, env }) {
  if (env.ISCRIZIONI_APERTE !== "si" || !env.DB) {
    return pagina("Ci siamo quasi.", "Le iscrizioni aprono tra pochissimo. Riprova tra qualche ora.", 503);
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
    return pagina("Manca qualcosa.", "Controlla l'email, scegli la zona e spunta le due caselle.", 400);
  }

  await env.DB.prepare(SCHEMA).run();
  await env.DB.prepare(
    "INSERT INTO iscrizioni (email, zona, invito, consenso_il, versione_informativa) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING"
  ).bind(email, zona, invito || null, new Date().toISOString(), VERSIONE_INFORMATIVA).run();

  return grazie(request);
}

export function onRequestGet({ request }) {
  return Response.redirect(new URL("/#iscriviti", request.url).toString(), 303);
}
