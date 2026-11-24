import { eliminaAccount, PERCORSO_ELIMINA } from "./elimina.js";
import { provinciaLista, PERCORSO_PROVINCIA_LISTA } from "./provincia_lista.js";
import { contatoreZona, PERCORSO_ZONA } from "./zona.js";
import { chiamataApi, PERCORSO_CHIAMATA } from "./chiamata_api.js";
import { segnalaApi, PERCORSO_SEGNALA } from "./segnala_api.js";
import { chiaviApi, PERCORSO_CHIAVI } from "./chiavi_api.js";
import { pannelloApi, PERCORSO_PANNELLO } from "./pannello_api.js";
import { supportoApi, PERCORSO_SUPPORTO } from "./supporto_api.js";
import { supportoOperatoreApi } from "./supporto_operatore_api.js";
import { svelamentoApi, PERCORSO_SVELAMENTO } from "./svelamento_api.js";
import { incontroApi, PERCORSO_INCONTRO } from "./incontro_api.js";
import { regaliApi, PERCORSO_REGALI } from "./regali_api.js";
import { accessoTester, cancelloTester, PERCORSO_ACCESSO_TESTER, modoAccesso } from "./accesso_tester.js";
import { coinApi, PERCORSO_COIN } from "./coin_api.js";
import { filoApi, PERCORSO_FILO } from "./filo_api.js";
import { filoVocaleApi, PERCORSO_FILO_VOCALE } from "./filo_vocale_api.js";
import { filoAscoltoApi, PERCORSO_FILO_ASCOLTO } from "./filo_ascolto_api.js";
import { filoPorteApi, PERCORSO_FILO_PORTE } from "./filo_porte_api.js";
import { filoBenvenutoApi, PERCORSO_FILO_BENVENUTO } from "./filo_benvenuto_api.js";
import { storicoRegaliApi, PERCORSO_STORICO_REGALI } from "./storico_regali_api.js";
import { stanzaVivaApi, PERCORSO_STANZA_VIVA } from "./stanza_viva_api.js";
import { appuntamentiApi, PERCORSO_APPUNTAMENTI } from "./appuntamenti_api.js";
import { lasciaStanzaApi, PERCORSO_LASCIA_STANZA } from "./lascia_stanza_api.js"; // #381, linea B
import { filoRiascoltoApi, PERCORSO_FILO_RIASCOLTO } from "./filo_riascolto_api.js"; // #360, linea C
import { filoAmministratoreApi, PERCORSO_FILO_AMMINISTRATORE } from "./filo_amministratore_api.js"; // #360, linea C

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

export async function app(request, env, f = fetch) {
  const url = new URL(request.url);
  if (url.pathname === PERCORSO_ACCESSO_TESTER) return conIntestazioniApp(await accessoTester(request, env, f), url.pathname);
  // ACCESSO_APP = «tester»: le API rispondono solo a chi ha l'email nel segreto EMAIL_TESTER (worker/accesso_tester.js).
  // Superato il controllo, l'API vede l'accesso acceso come con «si». I lavori programmati restano spenti (leggono «si»).
  if (url.pathname.startsWith("/app/api/") && modoAccesso(env) === "tester") {
    const fermo = await cancelloTester(request, env, f);
    if (fermo) return conIntestazioniApp(fermo, url.pathname);
    env = { ...env, ACCESSO_APP: "si" };
  }
  if (url.pathname === PERCORSO_ELIMINA) return conIntestazioniApp(await eliminaAccount(request, env), url.pathname);
  if (url.pathname === PERCORSO_PROVINCIA_LISTA) return conIntestazioniApp(await provinciaLista(request, env), url.pathname);
  if (url.pathname === PERCORSO_ZONA) return conIntestazioniApp(await contatoreZona(request, env), url.pathname);
  if (url.pathname === PERCORSO_CHIAMATA || url.pathname.startsWith(PERCORSO_CHIAMATA + "/")) {
    return conIntestazioniApp(await chiamataApi(request, env), url.pathname);
  }
  if (url.pathname === PERCORSO_SEGNALA) return conIntestazioniApp(await segnalaApi(request, env), url.pathname);
  if (url.pathname === PERCORSO_CHIAVI || url.pathname.startsWith(PERCORSO_CHIAVI + "/")) {
    return conIntestazioniApp(await chiaviApi(request, env), url.pathname);
  }
  if (url.pathname === PERCORSO_SVELAMENTO) return conIntestazioniApp(await svelamentoApi(request, env), url.pathname);
  if (url.pathname.startsWith(PERCORSO_PANNELLO + "/")) return conIntestazioniApp(await pannelloApi(request, env), url.pathname);
  if (url.pathname === PERCORSO_SUPPORTO) return conIntestazioniApp(await supportoApi(request, env), url.pathname);
  if (url.pathname.startsWith(PERCORSO_SUPPORTO + "/")) return conIntestazioniApp(await supportoOperatoreApi(request, env), url.pathname);
  if (url.pathname === PERCORSO_INCONTRO) return conIntestazioniApp(await incontroApi(request, env), url.pathname);
  if (url.pathname === PERCORSO_REGALI) return conIntestazioniApp(await regaliApi(request, env), url.pathname);
  if (url.pathname === PERCORSO_COIN) return conIntestazioniApp(await coinApi(request, env), url.pathname);
  if (url.pathname === PERCORSO_FILO) return conIntestazioniApp(await filoApi(request, env), url.pathname);
  if (url.pathname === PERCORSO_FILO_VOCALE) return conIntestazioniApp(await filoVocaleApi(request, env), url.pathname);
  if (url.pathname === PERCORSO_FILO_ASCOLTO) return conIntestazioniApp(await filoAscoltoApi(request, env), url.pathname);
  if (url.pathname === PERCORSO_FILO_PORTE) return conIntestazioniApp(await filoPorteApi(request, env), url.pathname);
  if (url.pathname === PERCORSO_FILO_BENVENUTO) return conIntestazioniApp(await filoBenvenutoApi(request, env), url.pathname);
  if (url.pathname === PERCORSO_STORICO_REGALI) return conIntestazioniApp(await storicoRegaliApi(request, env), url.pathname);
  if (url.pathname === PERCORSO_STANZA_VIVA) return conIntestazioniApp(await stanzaVivaApi(request, env), url.pathname);
  if (url.pathname === PERCORSO_APPUNTAMENTI) return conIntestazioniApp(await appuntamentiApi(request, env), url.pathname);
  if (url.pathname === PERCORSO_LASCIA_STANZA) return conIntestazioniApp(await lasciaStanzaApi(request, env), url.pathname);
  if (url.pathname === PERCORSO_FILO_RIASCOLTO) return conIntestazioniApp(await filoRiascoltoApi(request, env), url.pathname);
  if (url.pathname.startsWith(PERCORSO_FILO_AMMINISTRATORE + "/")) return conIntestazioniApp(await filoAmministratoreApi(request, env), url.pathname);
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
  if (pathname.startsWith("/app/api/")) {
    nuova.headers.set("cache-control", "no-store");
    return nuova;
  }
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
  // «accesso»: true solo se le chiavi sono giuste E la variabile ACCESSO_APP vale «si» o «tester» (wrangler.jsonc).
  // Finché è false la web app resta in anteprima: niente email, niente dati verso Supabase. «modo» = «tester» dice
  // all'app di chiedere l'email al Worker (/app/api/accesso), che la manda solo agli indirizzi di EMAIL_TESTER.
  const modo = modoAccesso(env);
  const corpo = problemi.length
    ? { pronta: false, accesso: false, problemi }
    : { pronta: true, accesso: modo !== "no", modo, supabaseUrl: indirizzo, supabaseAnonKey: chiave };
  // Con accesso acceso dice solo SE ci sono la chiave server e l'elenco dei tester (sì/no, mai i valori):
  // serve a «Verifica segreti» per spiegare un «Qualcosa non ha funzionato» senza aprire i log.
  if (!problemi.length && modo !== "no") {
    corpo.controlli = {
      chiaveServer: String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim() !== "",
      elencoTester: String(env.EMAIL_TESTER || "").trim() !== "",
    };
  }
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
