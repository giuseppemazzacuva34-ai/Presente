// «I tuoi regali» (schermata 28 del design v4, issue #349; regole dei regali #331). Linea «sviluppatore-b».
//
//   GET /app/api/regali/storico → { ok, titolo, totale, attuale: { citta, persone: [{ nome, dettaglio, quando }] } | null,
//                                   passate: { stanze, persone, dettaglio } | null }
//
// Una sola lettura del database (storico_regali, migrazione 20261123174042_storico_regali.sql): bloccati e segnalati
// esclusi lì, delle stanze passate solo numeri. Nessun id di persona nella risposta. Chi chiede lo dice SOLO il token
// di Supabase. Nei log solo nomi di funzioni e codici. Spento finché ACCESSO_APP non vale «si».
import { chiEDavvero } from "./supporto_api.js";
import { vistaStorico } from "../api/storico_regali.js";

export const PERCORSO_STORICO_REGALI = "/app/api/regali/storico";
const ATTESA_SUPABASE_MS = 1500;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;

function risposta(stato, corpo, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
const riprova = () => risposta(503, { ok: false, motivo: "riprova" });

function entro(ms, promessa) {
  let timer;
  return Promise.race([promessa, new Promise((_, no) => { timer = setTimeout(() => no(new Error("tempo scaduto")), ms); })])
    .finally(() => clearTimeout(timer));
}

async function leggiStorico(env, persona, f) {
  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const chiave = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  try {
    const r = await entro(ATTESA_SUPABASE_MS, f(`${base}/rest/v1/rpc/storico_regali`, {
      method: "POST",
      headers: { apikey: chiave, authorization: `Bearer ${chiave}`, "content-type": "application/json" },
      body: JSON.stringify({ p_persona: persona }),
    }));
    if (!r.ok) {
      console.error(`storico_regali: risposta ${r.status}`);
      return undefined;
    }
    return await r.json();
  } catch (e) {
    console.error("storico_regali: errore", e && e.name);
    return undefined;
  }
}

// Limite di frequenza: stesso binding gratuito delle altre richieste, chiave a parte. L'IP serve solo a contare.
async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "storico_regali:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}

export async function storicoRegaliApi(request, env, f = fetch, adesso = () => new Date()) {
  const url = new URL(request.url);
  if (url.pathname !== PERCORSO_STORICO_REGALI) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (request.method !== "GET") return risposta(405, { ok: false, motivo: "metodo" }, { allow: "GET" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!URL_SUPABASE.test(base) || !String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim()) return riprova();

  const chi = await chiEDavvero(request, env, f);
  if (chi.errore) return chi.errore;

  const vista = vistaStorico(await leggiStorico(env, chi.id, f), adesso());
  if (!vista) return riprova();
  return risposta(200, { ok: true, ...vista });
}
