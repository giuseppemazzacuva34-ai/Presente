// Worker di Presente: serve la landing (cartella /landing) e gestisce le due rotte dinamiche.
// Le pagine statiche sono servite direttamente da Cloudflare (gratis e senza limite); il Worker parte solo per
// /iscrizione e /conteggio (vedi "run_worker_first" in wrangler.jsonc).
import { iscrizione } from "./iscrizione.js";
import { conteggio } from "./conteggio.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/iscrizione") {
      if (request.method === "POST") return iscrizione(request, env);
      return Response.redirect(new URL("/#iscriviti", request.url).toString(), 303);
    }
    if (pathname === "/conteggio") return conteggio(env);
    return env.ASSETS.fetch(request);
  },
};
