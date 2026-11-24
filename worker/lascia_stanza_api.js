// «Lascia la stanza» (issue #381, spec v1 del CPO del 23/11, design v4 schermata 22). Linea «sviluppatore-b», passo 2.
//
//   POST /app/api/stanza/lascia  { motivo, testo } → { ok: true, testo } | { ok: false, motivo[, testo] }
//
// Chi esce lo dice SOLO il token di Supabase: una «persona» scritta nel corpo non conta. Il motivo si controlla qui
// (400 senza chiamare il database) e di nuovo nel database con lascia_stanza (migrazione 20261124084719): stanza
// aperta, nessuna chiamata in corso, una volta sola. Nei log solo nomi di funzioni e codici, mai motivo, testo o
// persone. Spento finché ACCESSO_APP non vale «si».
import { chiEDavvero } from "./supporto_api.js";
import { TESTI_USCITA, uscitaValida } from "../api/lascia_stanza.js";

export const PERCORSO_LASCIA_STANZA = "/app/api/stanza/lascia";
const CORPO_MASSIMO = 2 * 1024; // 300 caratteri anche tutti accentati, con margine
const ATTESA_SUPABASE_MS = 1500;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;

function risposta(stato, corpo, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
const riprova = () => risposta(503, { ok: false, motivo: "riprova" });
const dati = () => risposta(400, { ok: false, motivo: "dati" });

function entro(ms, promessa) {
  let timer;
  return Promise.race([promessa, new Promise((_, no) => { timer = setTimeout(() => no(new Error("tempo scaduto")), ms); })])
    .finally(() => clearTimeout(timer));
}

async function lascia(env, persona, u, f) {
  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const chiave = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  try {
    const r = await entro(ATTESA_SUPABASE_MS, f(`${base}/rest/v1/rpc/lascia_stanza`, {
      method: "POST",
      headers: { apikey: chiave, authorization: `Bearer ${chiave}`, "content-type": "application/json" },
      body: JSON.stringify({ p_persona: persona, p_motivo: u.motivo, p_testo: u.testo }),
    }));
    if (!r.ok) {
      console.error(`lascia_stanza: risposta ${r.status}`);
      return undefined;
    }
    return await r.json();
  } catch (e) {
    console.error("lascia_stanza: errore", e && e.name);
    return undefined;
  }
}

// Legge il corpo a pezzi e si ferma oltre CORPO_MASSIMO. { dati } oppure { errore: Response }.
async function leggiCorpo(request) {
  const troppo = { errore: risposta(413, { ok: false, motivo: "troppo_grande" }) };
  const dichiarato = Number(request.headers.get("content-length"));
  if (Number.isFinite(dichiarato) && dichiarato > CORPO_MASSIMO) return troppo;
  if (!request.body) return { errore: dati() };
  const lettore = request.body.getReader();
  const pezzi = [];
  let totale = 0;
  for (;;) {
    const { done, value } = await lettore.read();
    if (done) break;
    totale += value.byteLength;
    if (totale > CORPO_MASSIMO) {
      try { await lettore.cancel(); } catch { /* niente da fare */ }
      return troppo;
    }
    pezzi.push(value);
  }
  const tutto = new Uint8Array(totale);
  let i = 0;
  for (const p of pezzi) { tutto.set(p, i); i += p.byteLength; }
  try {
    return { dati: JSON.parse(new TextDecoder().decode(tutto)) };
  } catch {
    return { errore: dati() };
  }
}

// Limite di frequenza: stesso binding gratuito delle altre richieste, chiave a parte. L'IP serve solo a contare.
async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "lascia_stanza:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}

export async function lasciaStanzaApi(request, env, f = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== PERCORSO_LASCIA_STANZA) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (request.method !== "POST") return risposta(405, { ok: false, motivo: "metodo" }, { allow: "POST" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!URL_SUPABASE.test(base) || !String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim()) return riprova();

  const corpo = await leggiCorpo(request);
  if (corpo.errore) return corpo.errore;
  const u = uscitaValida(corpo.dati);
  if (!u) return dati();

  const chi = await chiEDavvero(request, env, f);
  if (chi.errore) return chi.errore;

  const esito = await lascia(env, chi.id, u, f);
  if (esito === "ok") return risposta(200, { ok: true, testo: TESTI_USCITA.fatto });
  if (esito === "in_chiamata") return risposta(200, { ok: false, motivo: esito, testo: TESTI_USCITA.inChiamata });
  if (esito === "non_nella_stanza") return risposta(200, { ok: false, motivo: esito });
  if (esito === "non_valida") return dati();
  return riprova();
}
