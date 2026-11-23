// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 4b della linea «sviluppatore-c».
//
//   POST /app/api/filo/vocale   (multipart: stanza, tipo «lunedi»|«domenica», durata in secondi, testo, audio)
//     → 200 { ok, tipo, durata } | 400 dati | 401 accesso | 403 non_filo | 409 fuori_orario/durata/testo
//       | 413 troppo_grande | 429 troppe | 503 riprova
//
// Chi è il Filo lo dice SOLO il token di Supabase: un «filo» scritto nel modulo non conta. Stanza, orari e durate li
// controlla il database (stanze_del_filo, salva_vocale_filo); il file va nel contenitore privato «vocali_filo» con la
// chiave del server, il telefono non ci scrive mai. Nei log solo codici e nomi di errore: mai token, testo o audio.
// Spento finché ACCESSO_APP non vale «si».
import { caricaVocaleFilo, stanzeVocaleDb, caricaFileDb, salvaVocaleDb, cancellaFileDb, MAX_BYTE_VOCALE } from "../api/filo_vocale.js";

export const PERCORSO_FILO_VOCALE = "/app/api/filo/vocale";
const MAX_CORPO = MAX_BYTE_VOCALE + 64 * 1024; // audio + campi di testo del modulo
const ATTESA_SUPABASE_MS = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const STATO = Object.freeze({ dati: 400, non_filo: 403, fuori_orario: 409, durata: 409, testo: 409, tipo: 400, file: 400, riprova: 503 });

function risposta(stato, corpo, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
const riprova = () => risposta(503, { ok: false, motivo: "riprova" });
const accesso = () => risposta(401, { ok: false, motivo: "accesso" });
const dati = () => risposta(400, { ok: false, motivo: "dati" });

function entro(ms, promessa) {
  let timer;
  return Promise.race([promessa, new Promise((_, no) => { timer = setTimeout(() => no(new Error("tempo scaduto")), ms); })])
    .finally(() => clearTimeout(timer));
}

function server(env) {
  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const chiave = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return URL_SUPABASE.test(base) && chiave ? { base, chiave } : null;
}

async function chiEDavvero(request, s, f) {
  const token = (request.headers.get("authorization") || "").match(/^Bearer ([A-Za-z0-9._-]{20,4096})$/);
  if (!token) return { errore: accesso() };
  try {
    const r = await entro(ATTESA_SUPABASE_MS, f(`${s.base}/auth/v1/user`, { headers: { apikey: s.chiave, authorization: `Bearer ${token[1]}` } }));
    if (r.status === 401 || r.status === 403) return { errore: accesso() };
    if (!r.ok) return { errore: riprova() };
    const id = String(((await r.json()) || {}).id || "");
    return UUID.test(id) ? { id } : { errore: accesso() };
  } catch (e) {
    console.error("filo_vocale: accesso", e && e.name);
    return { errore: riprova() };
  }
}

async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "filo-vocale:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}

async function leggiModulo(request) {
  if (!/^multipart\/form-data/i.test(request.headers.get("content-type") || "")) return null;
  let m;
  try {
    m = await request.formData();
  } catch {
    return null;
  }
  const audio = m.get("audio");
  const durata = String(m.get("durata") ?? "");
  if (!audio || typeof audio === "string" || !/^\d{1,3}$/.test(durata)) return null;
  return {
    stanza: String(m.get("stanza") ?? ""), tipo: String(m.get("tipo") ?? ""), durata: Number(durata),
    testo: String(m.get("testo") ?? ""), audio,
  };
}

export async function filoVocaleApi(request, env, f = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== PERCORSO_FILO_VOCALE) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (request.method !== "POST") return risposta(405, { ok: false, motivo: "metodo" }, { allow: "POST" });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  const lunghezza = request.headers.get("content-length");
  if (!/^\d{1,9}$/.test(lunghezza || "")) return risposta(411, { ok: false, motivo: "lunghezza" });
  if (Number(lunghezza) > MAX_CORPO) return risposta(413, { ok: false, motivo: "troppo_grande" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const s = server(env);
  if (!s) return riprova();

  const chi = await chiEDavvero(request, s, f);
  if (chi.errore) return chi.errore;

  const m = await leggiModulo(request);
  if (!m) return dati();
  if (m.audio.size > MAX_BYTE_VOCALE) return risposta(413, { ok: false, motivo: "troppo_grande" });

  const esito = await caricaVocaleFilo({
    filo: chi.id, stanza: m.stanza, tipo: m.tipo, durata: m.durata, testo: m.testo,
    audio: { tipo: m.audio.type, byte: m.audio.size, corpo: m.audio }, ora: new Date().toISOString(),
  }, {
    stanze: (a) => stanzeVocaleDb(env, a, f),
    carica: (a) => caricaFileDb(env, a, f),
    salva: (a) => salvaVocaleDb(env, a, f),
    cancella: (p) => cancellaFileDb(env, p, f),
  });
  if (!esito.ok) return risposta(STATO[esito.motivo] || 503, { ok: false, motivo: esito.motivo in STATO ? esito.motivo : "riprova" });
  return risposta(200, esito);
}
