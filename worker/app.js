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
  if (url.pathname === "/app") {
    url.pathname = "/app/";
    return conIntestazioniApp(Response.redirect(url.toString(), 301), "/app");
  }
  return conIntestazioniApp(await env.ASSETS.fetch(request), url.pathname);
}

function conIntestazioniApp(risposta, pathname) {
  const nuova = new Response(risposta.body, risposta);
  for (const [nome, valore] of Object.entries(INTESTAZIONI_APP)) nuova.headers.set(nome, valore);
  // Pagine e service worker sempre ricontrollati, così un aggiornamento arriva subito; icone e stili in cache per un'ora.
  const sempreNuovo = pathname.endsWith("/") || pathname.endsWith(".html") || pathname.endsWith("/sw.js") || pathname.endsWith(".webmanifest");
  nuova.headers.set("cache-control", sempreNuovo ? "no-cache" : "public, max-age=3600");
  return nuova;
}
