// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 3b della linea «sviluppatore-c».
//
//   GET /app/api/filo → { ok, regole, stanze: [{ id, nome, apreIl, chiudeIl, nomi: [...], porte }] }
//   («porte»: dalle 21:00 di domenica il solo numero delle porte aperte, prima null; passo 6b)
//
// Il pannello del Filo: le stanze che segue (dalle 00:30 di lunedì) e i soli nomi di battesimo dei membri. Chi è il
// Filo lo dice SOLO il token di Supabase: un «filo» scritto nella richiesta non conta. Quali stanze e quali nomi lo
// decide il database (stanze_del_filo, nomi_stanza_filo: migrazione 20261123095357); chi non è Filo riceve un elenco
// vuoto. Mai email, telefono, provincia, età, foto, voce, questionario, diario, chiavi, segnalazioni, crediti.
// Nei log solo nomi di errore e codici, mai token o nomi. Spento finché ACCESSO_APP non vale «si».
import { pannelloFilo, stanzeFiloDb, nomiFiloDb, porteFiloDb } from "../api/filo.js";

export const PERCORSO_FILO = "/app/api/filo";
const ATTESA_SUPABASE_MS = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;

function risposta(stato, corpo, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
const riprova = () => risposta(503, { ok: false, motivo: "riprova" });
const accesso = () => risposta(401, { ok: false, motivo: "accesso" });

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
    console.error("filo: accesso", e && e.name);
    return { errore: riprova() };
  }
}

async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "filo:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}

export async function filoApi(request, env, f = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== PERCORSO_FILO) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (request.method !== "GET") return risposta(405, { ok: false, motivo: "metodo" }, { allow: "GET" });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const s = server(env);
  if (!s) return riprova();

  const chi = await chiEDavvero(request, s, f);
  if (chi.errore) return chi.errore;

  const ora = new Date().toISOString();
  const esito = await pannelloFilo({ filo: chi.id, ora }, {
    stanze: (a) => stanzeFiloDb(env, a, f),
    nomi: (a) => nomiFiloDb(env, a, f),
    porte: (a) => porteFiloDb(env, a, f),
  });
  if (!esito.ok) return riprova();
  return risposta(200, esito);
}
