// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 10b della linea «sviluppatore-c».
//
//   GET  /app/api/filo/riascolto → 200 { ok, riascolto: { stanza, nuovo } | null }
//   POST /app/api/filo/riascolto  { stanza } → 200 { ok, segnato }
//     | 400 dati | 401 accesso | 405 metodo | 429 troppe | 503 riprova
//
// Voce «Il vocale del Filo» nella stanza: il vocale del lunedì si riascolta tutta la settimana; se è arrivato dopo la
// schermata 18 ha un pallino rosso fino al primo ascolto (POST lo spegne). Chi è lo dice SOLO il token di Supabase; cosa
// c'è lo decide il database (vocale_filo_stato e segna_ascolto_filo, migrazione 20261124155440): niente se la stanza
// non ha Filo, se il vocale non è arrivato, a sospesi, a chi ha lasciato la stanza, fuori orario. Il vocale vero
// arriva da GET /app/api/filo/ascolta?tipo=lunedi. Al telefono vanno solo l'id della stanza e «nuovo». Nei log solo
// codici e nomi di errore, mai token. Spento finché ACCESSO_APP non vale «si».

export const PERCORSO_FILO_RIASCOLTO = "/app/api/filo/riascolto";
const ATTESA_MS = 1500;
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
    const r = await entro(ATTESA_MS, f(`${s.base}/auth/v1/user`, { headers: { apikey: s.chiave, authorization: `Bearer ${token[1]}` } }));
    if (r.status === 401 || r.status === 403) return { errore: accesso() };
    if (!r.ok) return { errore: riprova() };
    const id = String(((await r.json()) || {}).id || "");
    return UUID.test(id) ? { id } : { errore: accesso() };
  } catch (e) {
    console.error("filo_riascolto: accesso", e && e.name);
    return { errore: riprova() };
  }
}

async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "filo-riascolto:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}

async function rpc(s, nome, corpo, f) {
  try {
    const r = await entro(ATTESA_MS, f(`${s.base}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: { apikey: s.chiave, authorization: `Bearer ${s.chiave}`, "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }));
    if (!r.ok) {
      console.error("filo_riascolto: database", r.status);
      return undefined;
    }
    return await r.json();
  } catch (e) {
    console.error("filo_riascolto: database", e && e.name);
    return undefined;
  }
}

// → { stanza, nuovo } | null (nessuna voce) | undefined (errore o risposta strana)
async function riascoltoDb(s, utente, f) {
  const righe = await rpc(s, "vocale_filo_stato", { p_utente: utente, p_ora: new Date().toISOString() }, f);
  if (!Array.isArray(righe)) return undefined;
  if (righe.length === 0) return null;
  const { stanza_id: stanza, nuovo } = righe[0] || {};
  if (!UUID.test(String(stanza || "")) || typeof nuovo !== "boolean") {
    console.error("filo_riascolto: riga non valida");
    return undefined;
  }
  return { stanza, nuovo };
}

async function stanzaDalCorpo(request) {
  try {
    const corpo = await request.json();
    const stanza = corpo && typeof corpo === "object" && !Array.isArray(corpo) ? String(corpo.stanza || "") : "";
    return UUID.test(stanza) ? stanza : null;
  } catch {
    return null;
  }
}

export async function filoRiascoltoApi(request, env, f = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== PERCORSO_FILO_RIASCOLTO) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (request.method !== "GET" && request.method !== "POST") return risposta(405, { ok: false, motivo: "metodo" }, { allow: "GET, POST" });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const s = server(env);
  if (!s) return riprova();

  const chi = await chiEDavvero(request, s, f);
  if (chi.errore) return chi.errore;

  if (request.method === "GET") {
    const riascolto = await riascoltoDb(s, chi.id, f);
    if (riascolto === undefined) return riprova();
    return risposta(200, { ok: true, riascolto });
  }
  const stanza = await stanzaDalCorpo(request);
  if (!stanza) return risposta(400, { ok: false, motivo: "dati" });
  const segnato = await rpc(s, "segna_ascolto_filo", { p_utente: chi.id, p_stanza: stanza, p_ora: new Date().toISOString() }, f);
  if (typeof segnato !== "boolean") return riprova();
  return risposta(200, { ok: true, segnato });
}
