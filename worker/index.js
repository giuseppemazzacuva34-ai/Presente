// Worker di Presente: serve la landing (cartella /landing) e gestisce le due rotte dinamiche.
// Le pagine statiche sono servite direttamente da Cloudflare (gratis e senza limite); il Worker parte solo per
// /iscrizione, /conteggio, /meta/webhook, i link per canale /da/<canale>, la web app /app/ e la home "/" (vedi "run_worker_first" in wrangler.jsonc).
import { iscrizione, completa } from "./iscrizione.js";
import { conteggio } from "./conteggio.js";
import { pagina } from "./pagina.js";
import { conSicurezza } from "./intestazioni.js";
import { homeConInvito } from "./invito.js";
import { grazieConCitta } from "./grazie.js";
import { daCanale } from "./canale.js";
import { contaVisitaPagina, pixel, PERCORSO_PIXEL, segui, PERCORSO_SEGUI } from "./visite.js";
import { app, eApp } from "./app.js";
import { metaWebhook, PERCORSO_META } from "./meta.js";

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    // Contatore delle visite a "/" e "/grazie" (D43): solo totali, in sottofondo per non rallentare la pagina.
    const conteggioVisita = contaVisitaPagina(request, env);
    if (conteggioVisita) {
      if (ctx && ctx.waitUntil) ctx.waitUntil(conteggioVisita);
      else await conteggioVisita;
    }
    // Webhook di Meta per i commenti «BUIO» (docs/meta-webhook.md): nessuna intestazione HTML, risponde solo a Meta.
    if (pathname === PERCORSO_META) return await metaWebhook(request, env, ctx);
    // Misura vera (D79 A): l'immagine 1×1 che solo un browser vero scarica insieme alla pagina.
    if (pathname === PERCORSO_PIXEL) return await pixel(request, env, ctx);
    // Pulsante «Segui @presente_app» della pagina grazie (D82 A): conta il clic e rimanda a Instagram.
    if (pathname === PERCORSO_SEGUI) return conSicurezza(await segui(request, env, ctx));
    if (pathname === "/iscrizione") {
      if (request.method === "POST") return conSicurezza(await iscrizione(request, env));
      return conSicurezza(Response.redirect(new URL("/#iscriviti", request.url).toString(), 303));
    }
    // Passo 2 del modulo (D79 A): città e domande facoltative dopo l'iscrizione con sola email.
    if (pathname === "/completa") {
      if (request.method === "POST") return conSicurezza(await completa(request, env));
      return conSicurezza(Response.redirect(new URL("/grazie", request.url).toString(), 303));
    }
    // Link per canale (D26): /da/instagram, /da/tiktok, ... contano la visita e rimandano alla home.
    if (pathname === "/da" || pathname.startsWith("/da/")) {
      const rimando = request.method === "GET" || request.method === "HEAD" ? await daCanale(request, env) : null;
      return conSicurezza(rimando || pagina("Pagina non trovata.", "Questo indirizzo non esiste. Dai un'occhiata alla nostra home.", 404));
    }
    // Web app installabile (Fase 2, #1): stessi file statici, ma con le intestazioni di sicurezza dell'app.
    if (eApp(pathname)) return await app(request, env);
    if (pathname === "/conteggio") return conSicurezza(await conteggio(env));
    // Home: il Worker parte qui solo per precompilare il codice dei link d'invito (?invito=CODICE).
    if (pathname === "/") return conSicurezza(await homeConInvito(request, env));
    // Pagina dopo l'iscrizione (D64): «<Città>: mancano N persone per aprire la tua stanza».
    if (pathname === "/grazie" || pathname === "/grazie.html") return conSicurezza(await grazieConCitta(request, env));
    return env.ASSETS.fetch(request);
  },
};
