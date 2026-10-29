// Worker di Presente: serve la landing (cartella /landing) e gestisce le due rotte dinamiche.
// Le pagine statiche sono servite direttamente da Cloudflare (gratis e senza limite); il Worker parte solo per
// /iscrizione, /conteggio, i link per canale /da/<canale> e la home "/" (vedi "run_worker_first" in wrangler.jsonc).
import { iscrizione } from "./iscrizione.js";
import { conteggio } from "./conteggio.js";
import { pagina } from "./pagina.js";
import { conSicurezza } from "./intestazioni.js";
import { homeConInvito } from "./invito.js";
import { daCanale } from "./canale.js";
import { contaVisitaPagina } from "./visite.js";

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    // Contatore delle visite a "/" e "/grazie" (D43): solo totali, in sottofondo per non rallentare la pagina.
    const conteggioVisita = contaVisitaPagina(request, env);
    if (conteggioVisita) {
      if (ctx && ctx.waitUntil) ctx.waitUntil(conteggioVisita);
      else await conteggioVisita;
    }
    if (pathname === "/iscrizione") {
      if (request.method === "POST") return conSicurezza(await iscrizione(request, env));
      return conSicurezza(Response.redirect(new URL("/#iscriviti", request.url).toString(), 303));
    }
    // Link per canale (D26): /da/instagram, /da/tiktok, ... contano la visita e rimandano alla home.
    if (pathname === "/da" || pathname.startsWith("/da/")) {
      const rimando = request.method === "GET" || request.method === "HEAD" ? await daCanale(request, env) : null;
      return conSicurezza(rimando || pagina("Pagina non trovata.", "Questo indirizzo non esiste. Dai un'occhiata alla nostra home.", 404));
    }
    if (pathname === "/conteggio") return conSicurezza(await conteggio(env));
    // Home: il Worker parte qui solo per precompilare il codice dei link d'invito (?invito=CODICE).
    if (pathname === "/") return conSicurezza(await homeConInvito(request, env));
    return env.ASSETS.fetch(request);
  },
};
