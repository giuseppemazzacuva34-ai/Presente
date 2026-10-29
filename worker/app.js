// Web app installabile di Presente (Fase 2, issue #1), servita dallo stesso Worker sotto /app/ (niente Cloudflare Pages).
// I file stanno in landing/app/. Qui il Worker aggiunge le intestazioni di sicurezza proprie dell'app, diverse da quelle
// della landing: l'app usa i propri script (solo dal nostro dominio) e potrà chiedere il microfono per le chiamate solo voce.

// Collegamenti ammessi dal browser: il nostro dominio, Supabase (UE, D23 A) e Cloudflare Realtime per le chiamate.
// L'indirizzo esatto del progetto Supabase è un segreto: qui si ammette solo il dominio generico di Supabase.
export const CSP_APP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://rtc.live.cloudflare.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const INTESTAZIONI_APP = {
  "content-security-policy": CSP_APP,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  // Microfono (chiamate solo voce) e fotocamera (videochiamata sfocata dopo la porta) solo per il nostro sito.
  "permissions-policy": "camera=(self), microphone=(self), geolocation=(), interest-cohort=()",
  // L'app non deve finire nei risultati di Google: la pagina da trovare è la landing.
  "x-robots-tag": "noindex",
};

export function eApp(pathname) {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export async function app(request, env) {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return conIntestazioniApp(new Response("Metodo non ammesso.", { status: 405, headers: { allow: "GET, HEAD" } }), url.pathname);
  }
  if (url.pathname === "/app/config.json") return conIntestazioniApp(configurazione(env), url.pathname);
  if (url.pathname === "/app") {
    url.pathname = "/app/";
    return conIntestazioniApp(Response.redirect(url.toString(), 301), "/app");
  }
  return conIntestazioniApp(await env.ASSETS.fetch(request), url.pathname);
}

function conIntestazioniApp(risposta, pathname) {
  const nuova = new Response(risposta.body, risposta);
  for (const [nome, valore] of Object.entries(INTESTAZIONI_APP)) nuova.headers.set(nome, valore);
  // Pagine, codice, stili e service worker sempre ricontrollati (così una correzione arriva subito, anche su iPhone);
  // le icone restano in cache per un'ora.
  const sempreNuovo = pathname.endsWith("/") || pathname.endsWith(".html") || pathname.endsWith("/sw.js") || pathname.endsWith(".webmanifest") || pathname.endsWith("/config.json")
    || pathname.endsWith(".js") || pathname.endsWith(".css");
  nuova.headers.set("cache-control", sempreNuovo ? "no-cache" : "public, max-age=3600");
  return nuova;
}

// Configurazione pubblica per la web app (#2): indirizzo del progetto Supabase e chiave «anon».
// Sono pubbliche per natura (ogni browser le riceve; chi vede cosa lo decidono le regole per riga).
// Arrivano dai secret del Worker (Cloudflare → Workers → presente → Settings → Variables and Secrets),
// non dal repository. La chiave service_role NON passa mai di qui.
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const CHIAVE_ANON = /^(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+)$/;

export function configurazione(env) {
  const indirizzo = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const chiave = String(env.SUPABASE_ANON_KEY || "").trim();
  const problemi = [];
  if (!indirizzo) problemi.push("SUPABASE_URL manca");
  else if (!URL_SUPABASE.test(indirizzo)) problemi.push("SUPABASE_URL non ha la forma https://<codice progetto>.supabase.co");
  if (!chiave) problemi.push("SUPABASE_ANON_KEY manca");
  else if (!CHIAVE_ANON.test(chiave)) problemi.push("SUPABASE_ANON_KEY non sembra una chiave pubblica di Supabase");
  else if (chiave.startsWith("eyJ") && ruoloDelToken(chiave) !== "anon") problemi.push("SUPABASE_ANON_KEY non è la chiave anon (forse è la service_role)");
  // «accesso»: true solo se le chiavi sono giuste E la variabile ACCESSO_APP vale «si» (wrangler.jsonc). Finché è
  // false la web app resta in anteprima: niente email, niente dati verso Supabase.
  const corpo = problemi.length
    ? { pronta: false, accesso: false, problemi }
    : { pronta: true, accesso: String(env.ACCESSO_APP || "").trim() === "si", supabaseUrl: indirizzo, supabaseAnonKey: chiave };
  return new Response(JSON.stringify(corpo), {
    // Sempre 200: la web app (e chi controlla) legge «pronta»; così il motivo si vede anche da un browser qualsiasi.
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Legge il ruolo scritto dentro la chiave (senza verificarla): serve solo a non pubblicare mai per sbaglio la service_role.
function ruoloDelToken(token) {
  try {
    const parte = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(parte + "=".repeat((4 - (parte.length % 4)) % 4))).role;
  } catch {
    return null;
  }
}
