// Link per canale (decisione D26, parte 1): https://presenteincontri.app/da/instagram, /da/tiktok, ...
// Servono a capire da quale canale arrivano visite e iscrizioni, senza alcun dato personale:
// il Worker conta solo «canale, giorno, quante volte» in due tabelle D1. Nessun cookie, IP o user agent salvato,
// e il canale NON viene scritto nella riga dell'iscritto.
import { pulisciCodice } from "./invito.js";
import { richiestaAutomatica } from "./automatiche.js";

// Elenco chiuso: qualunque altro canale risponde 404. "meta" = sponsorizzate (D25), "creator" = link dei creator.
export const CANALI = new Set(["instagram", "tiktok", "facebook", "whatsapp", "meta", "creator"]);

const SCHEMA_VISITE = `CREATE TABLE IF NOT EXISTS visite_canale (
  canale TEXT NOT NULL,
  giorno TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (canale, giorno)
)`;
const SCHEMA_ISCRIZIONI = `CREATE TABLE IF NOT EXISTS iscrizioni_canale (
  canale TEXT NOT NULL,
  giorno TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (canale, giorno)
)`;
const PIU_UNO_VISITE = "INSERT INTO visite_canale (canale, giorno, n) VALUES (?, ?, 1) ON CONFLICT(canale, giorno) DO UPDATE SET n = n + 1";
const PIU_UNO_ISCRIZIONI = "INSERT INTO iscrizioni_canale (canale, giorno, n) VALUES (?, ?, 1) ON CONFLICT(canale, giorno) DO UPDATE SET n = n + 1";

// Restituisce il canale solo se è nell'elenco, altrimenti stringa vuota.
export function canaleValido(valore) {
  const c = String(valore || "").trim().toLowerCase();
  return CANALI.has(c) ? c : "";
}

function oggi() {
  return new Date().toISOString().slice(0, 10);
}

async function piuUno(env, schema, sql, canale) {
  if (!env.DB || !canale) return;
  try {
    await env.DB.prepare(schema).run();
    await env.DB.prepare(sql).bind(canale, oggi()).run();
  } catch (errore) {
    // Un contatore che non si aggiorna non deve mai bloccare la visita o l'iscrizione.
    console.error("canale: contatore non aggiornato", errore && errore.name);
  }
}

export const contaVisita = (env, canale) => piuUno(env, SCHEMA_VISITE, PIU_UNO_VISITE, canale);
export const contaIscrizione = (env, canale) => piuUno(env, SCHEMA_ISCRIZIONI, PIU_UNO_ISCRIZIONI, canale);

// GET /da/<canale>: +1 visita e rimando alla home con ?da=<canale> (e ?invito= se il link lo porta, per i creator).
export async function daCanale(request, env) {
  const url = new URL(request.url);
  const canale = url.pathname.replace(/^\/da\/?/, "").replace(/\/$/, "");
  if (!CANALI.has(canale)) return null;
  // Anteprime dei link e robot (automatiche.js) ricevono lo stesso rimando ma non contano come visita.
  if (!richiestaAutomatica(request)) await contaVisita(env, canale);
  const destinazione = new URL("/", url);
  destinazione.searchParams.set("da", canale);
  const codice = pulisciCodice(url.searchParams.get("invito"));
  if (codice) destinazione.searchParams.set("invito", codice);
  return new Response(null, { status: 302, headers: { location: destinazione.toString(), "cache-control": "no-store" } });
}

// Numeri per /conteggio: { canale: { visite, iscrizioni } } per ogni canale dell'elenco.
export async function perCanale(env) {
  const risultato = Object.fromEntries([...CANALI].map((c) => [c, { visite: 0, iscrizioni: 0 }]));
  for (const [tabella, chiave] of [["visite_canale", "visite"], ["iscrizioni_canale", "iscrizioni"]]) {
    try {
      const sql = tabella === "visite_canale"
        ? "SELECT canale, SUM(n) AS n FROM visite_canale GROUP BY canale"
        : "SELECT canale, SUM(n) AS n FROM iscrizioni_canale GROUP BY canale";
      const righe = await env.DB.prepare(sql).all();
      for (const r of righe.results || []) if (CANALI.has(r.canale)) risultato[r.canale][chiave] = r.n || 0;
    } catch {
      // La tabella nasce con il primo conteggio.
    }
  }
  return risultato;
}
