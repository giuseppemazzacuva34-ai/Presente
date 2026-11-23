// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 5b della linea «sviluppatore-c».
//
//   GET /app/api/filo/ascolta?tipo=lunedi|domenica
//     → 200 { ok, vocale: { url, durata, testo, filo, scade_tra } | null } | 400 dati | 401 accesso | 429 troppe
//       | 503 riprova
//
// Un membro della stanza ascolta il vocale del Filo. Chi è lo dice SOLO il token di Supabase; se e quale vocale può
// ascoltare lo decide il database (vocale_filo_membro: lunedì dalle 9:00 alla chiusura, domenica dalle 21:00 per un
// giorno, mai a chi è sospeso o uscito). Il file resta nel contenitore privato «vocali_filo»: al telefono va solo un
// link firmato che scade dopo SCADENZA_LINK_S secondi (spec, «Dati»). «vocale: null» = niente da ascoltare (la
// schermata mostra «Il vocale del Filo arriva in mattinata.» o non mostra il lettore).
// Nei log solo codici e nomi di errore: mai token, testo, nomi o percorsi dei file. Spento finché ACCESSO_APP ≠ «si».

export const PERCORSO_FILO_ASCOLTO = "/app/api/filo/ascolta";
export const SCADENZA_LINK_S = 300; // il vocale dura al massimo 90 s: 5 minuti bastano anche con una pausa
const ATTESA_MS = 1500;
const CONTENITORE = "vocali_filo";
const TIPI = new Set(["lunedi", "domenica"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9_-]{1,80}\.(webm|ogg|m4a|mp4|mp3|aac)$/;
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
    console.error("filo_ascolto: accesso", e && e.name);
    return { errore: riprova() };
  }
}

async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "filo-ascolto:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}

const intestazioni = (s) => ({ apikey: s.chiave, authorization: `Bearer ${s.chiave}`, "content-type": "application/json" });

// → riga | null (niente da ascoltare) | undefined (errore)
async function vocaleDb(s, utente, tipo, f) {
  try {
    const r = await entro(ATTESA_MS, f(`${s.base}/rest/v1/rpc/vocale_filo_membro`, {
      method: "POST", headers: intestazioni(s),
      body: JSON.stringify({ p_utente: utente, p_tipo: tipo, p_ora: new Date().toISOString() }),
    }));
    if (!r.ok) {
      console.error("filo_ascolto: database", r.status);
      return undefined;
    }
    const righe = await r.json();
    if (!Array.isArray(righe)) return undefined;
    return righe[0] || null;
  } catch (e) {
    console.error("filo_ascolto: database", e && e.name);
    return undefined;
  }
}

async function linkFirmato(s, file, f) {
  const percorso = file.split("/").map(encodeURIComponent).join("/");
  try {
    const r = await entro(ATTESA_MS, f(`${s.base}/storage/v1/object/sign/${CONTENITORE}/${percorso}`, {
      method: "POST", headers: intestazioni(s), body: JSON.stringify({ expiresIn: SCADENZA_LINK_S }),
    }));
    if (!r.ok) {
      console.error("filo_ascolto: firma", r.status);
      return null;
    }
    const firmato = String(((await r.json()) || {}).signedURL || "");
    return firmato.startsWith(`/object/sign/${CONTENITORE}/`) ? `${s.base}/storage/v1${firmato}` : null;
  } catch (e) {
    console.error("filo_ascolto: firma", e && e.name);
    return null;
  }
}

export async function filoAscoltoApi(request, env, f = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== PERCORSO_FILO_ASCOLTO) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (request.method !== "GET") return risposta(405, { ok: false, motivo: "metodo" }, { allow: "GET" });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const s = server(env);
  if (!s) return riprova();

  const chi = await chiEDavvero(request, s, f);
  if (chi.errore) return chi.errore;

  const tipo = url.searchParams.get("tipo") || "";
  if (!TIPI.has(tipo)) return risposta(400, { ok: false, motivo: "dati" });

  const riga = await vocaleDb(s, chi.id, tipo, f);
  if (riga === undefined) return riprova();
  if (riga === null) return risposta(200, { ok: true, vocale: null });
  if (typeof riga.file !== "string" || !FILE.test(riga.file)) {
    console.error("filo_ascolto: file non valido");
    return riprova();
  }
  const link = await linkFirmato(s, riga.file, f);
  if (!link) return riprova();
  return risposta(200, {
    ok: true,
    vocale: {
      url: link, durata: Number(riga.durata), testo: String(riga.testo || ""),
      filo: typeof riga.filo_nome === "string" ? riga.filo_nome : null, scade_tra: SCADENZA_LINK_S,
    },
  });
}
