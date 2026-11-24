// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 6b della linea «sviluppatore-c».
//
//   GET /app/api/filo/porte
//     → 200 { ok, porte: { stanza, numero } | null } | 401 accesso | 429 troppe | 503 riprova
//
// Chi è nella stanza legge il numero delle porte aperte per la schermata 36, dalle 21:00 di domenica per un giorno.
// Chi è lo dice SOLO il token di Supabase; se c'è un numero lo decide il database (porte_stanza_membro, migrazione
// 20261123215547): nessuna riga se la stanza non ha un Filo (la schermata 36 non compare), se le porte non sono
// ancora state aperte, o se la persona è sospesa o uscita. Il numero è quello salvato una volta da apri_porte (#5).
// Mai chi: al telefono vanno solo l'id della stanza e un intero. «porte: null» = la schermata 36 non compare.
// Nei log solo codici e nomi di errore, mai token. Spento finché ACCESSO_APP non vale «si».

export const PERCORSO_FILO_PORTE = "/app/api/filo/porte";
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
    console.error("filo_porte: accesso", e && e.name);
    return { errore: riprova() };
  }
}

async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "filo-porte:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}

// → { stanza, numero } | null (niente da mostrare) | undefined (errore o risposta strana)
async function porteDb(s, utente, f) {
  try {
    const r = await entro(ATTESA_MS, f(`${s.base}/rest/v1/rpc/porte_stanza_membro`, {
      method: "POST",
      headers: { apikey: s.chiave, authorization: `Bearer ${s.chiave}`, "content-type": "application/json" },
      body: JSON.stringify({ p_utente: utente, p_ora: new Date().toISOString() }),
    }));
    if (!r.ok) {
      console.error("filo_porte: database", r.status);
      return undefined;
    }
    const righe = await r.json();
    if (!Array.isArray(righe)) return undefined;
    if (righe.length === 0) return null;
    const { stanza_id: stanza, porte: numero } = righe[0] || {};
    if (!UUID.test(String(stanza || "")) || !Number.isInteger(numero) || numero < 0) {
      console.error("filo_porte: riga non valida");
      return undefined;
    }
    return { stanza, numero };
  } catch (e) {
    console.error("filo_porte: database", e && e.name);
    return undefined;
  }
}

export async function filoPorteApi(request, env, f = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== PERCORSO_FILO_PORTE) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (request.method !== "GET") return risposta(405, { ok: false, motivo: "metodo" }, { allow: "GET" });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const s = server(env);
  if (!s) return riprova();

  const chi = await chiEDavvero(request, s, f);
  if (chi.errore) return chi.errore;

  const porte = await porteDb(s, chi.id, f);
  if (porte === undefined) return riprova();
  return risposta(200, { ok: true, porte });
}
