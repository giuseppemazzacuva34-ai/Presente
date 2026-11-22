// Accesso solo per i tester (richiesta di Giuseppe del 22/11): terzo valore di ACCESSO_APP, «tester».
//
// - «no»: l'app resta in anteprima, come oggi.
// - «tester»: il login con email funziona SOLO per gli indirizzi scritti nel segreto EMAIL_TESTER (Cloudflare → Workers →
//   presente → Settings → Variables and Secrets), separati da virgola. Per tutti gli altri: «accesso non ancora aperto»
//   e nessuna email parte. L'elenco non sta mai nel repository, nella plancia, nelle risposte o nei log.
// - «si»: accesso aperto a tutti (dopo informativa e revisione del CISO), l'app chiede l'email direttamente a Supabase.
//
// POST /app/api/accesso { email } (solo con «tester»): se l'email è in elenco il Worker crea l'account se manca (chiave
// service_role, solo qui sul server) e chiede a Supabase l'email con link e codice SENZA creare account
// (create_user: false). Così, con le iscrizioni libere chiuse in Supabase, nessuno fuori elenco può entrare neanche
// chiamando Supabase da solo. Nei log niente: né email né risposte di Supabase.

export const PERCORSO_ACCESSO_TESTER = "/app/api/accesso";
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const EMAIL_VALIDA = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ATTESA_SUPABASE_MS = 5000;

export function modoAccesso(env) {
  const valore = String(env?.ACCESSO_APP || "").trim();
  return valore === "si" || valore === "tester" ? valore : "no";
}

// Vero con «si» e con «tester»: le API dell'app rispondono (con «tester» solo alle persone in elenco, personaAmmessa).
export function accessoAperto(env) {
  return modoAccesso(env) !== "no";
}

function pulisci(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function elenco(env) {
  return String(env?.EMAIL_TESTER || "").split(/[\s,;]+/).map(pulisci).filter(Boolean);
}

export function emailAmmessa(env, email) {
  const cercata = pulisci(email);
  if (!cercata) return false;
  return elenco(env).includes(cercata);
}

// Per le API dell'app, dopo aver letto la persona dal token (/auth/v1/user): con «tester» passa solo chi ha
// l'email in elenco e confermata.
export function personaAmmessa(env, persona) {
  const modo = modoAccesso(env);
  if (modo === "si") return Boolean(persona);
  if (modo !== "tester" || !persona) return false;
  return Boolean(persona.email_confirmed_at) && emailAmmessa(env, persona.email);
}

function risposta(stato, corpo) {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function entro(ms, promessa) {
  let timer;
  return Promise.race([promessa, new Promise((_, no) => { timer = setTimeout(() => no(new Error("tempo scaduto")), ms); })])
    .finally(() => clearTimeout(timer));
}

async function troppeRichieste(request, env) {
  if (!env.LIMITE_ACCESSO) return false;
  try {
    const { success } = await env.LIMITE_ACCESSO.limit({ key: "accesso:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}

export async function accessoTester(request, env, f = fetch) {
  if (request.method !== "POST") return new Response("Metodo non ammesso.", { status: 405, headers: { allow: "POST" } });
  if (modoAccesso(env) !== "tester") return risposta(404, { ok: false, motivo: "spento" });
  const origine = request.headers.get("origin");
  const nostra = new URL(request.url).origin;
  if (!origine || origine !== nostra) return risposta(403, { ok: false, motivo: "origine" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });

  let corpo = null;
  try { corpo = await request.json(); } catch { corpo = null; }
  const email = pulisci(corpo?.email);
  if (!EMAIL_VALIDA.test(email) || email.length > 254) return risposta(400, { ok: false, motivo: "email" });

  // Fuori elenco: nessuna chiamata a Supabase, quindi nessuna email.
  if (!emailAmmessa(env, email)) return risposta(200, { ok: false, motivo: "non_aperto" });

  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const anon = String(env.SUPABASE_ANON_KEY || "").trim();
  const servizio = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!URL_SUPABASE.test(base) || !anon || !servizio) return risposta(200, { ok: false, motivo: "generico" });

  try {
    // 1. Account del tester, se manca (422 = esiste già). Email già confermata: entra con link o codice.
    const crea = await entro(ATTESA_SUPABASE_MS, f(`${base}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: servizio, authorization: `Bearer ${servizio}`, "content-type": "application/json" },
      body: JSON.stringify({ email, email_confirm: true }),
    }));
    if (!crea.ok && crea.status !== 422) return risposta(200, { ok: false, motivo: "generico" });

    // 2. Email con link e codice di 6 cifre; il link riporta all'app.
    const ritorno = encodeURIComponent(nostra + "/app/");
    const otp = await entro(ATTESA_SUPABASE_MS, f(`${base}/auth/v1/otp?redirect_to=${ritorno}`, {
      method: "POST",
      headers: { apikey: anon, "content-type": "application/json" },
      body: JSON.stringify({ email, create_user: false }),
    }));
    if (otp.status === 429) return risposta(200, { ok: false, motivo: "troppe" });
    if (!otp.ok) return risposta(200, { ok: false, motivo: "generico" });
    return risposta(200, { ok: true });
  } catch {
    return risposta(200, { ok: false, motivo: "generico" });
  }
}
