// Testi di «Lascia la stanza» cancellati 30 giorni dopo la chiusura della stanza (issue #381, spec v1 del CPO del 23/11,
// «Dati»). Linea «sviluppatore-b», passo 5. Ogni ora (cron «23 * * * *» già in wrangler.jsonc, gratuito) il Worker
// chiede al database public.pulisci_testi_uscita() (migrazione *_uscite_pulizia.sql, solo ruolo di servizio): toglie il
// testo libero, il codice del motivo resta per il riepilogo #8. Spento finché ACCESSO_APP non vale «si» o «tester».
// Nei log solo numeri, mai testi.
import { accessoAperto } from "./accesso_tester.js"; // «si» o «tester» (#8, test interno)

const ATTESA_MS = 10000;

// Restituisce { esito: "spento" | "fatto" | "errore", tolti? }. Mai eccezioni verso chi la chiama.
export async function pulisciTestiUscita(env, f = fetch) {
  if (!env || !accessoAperto(env) || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { esito: "spento" };
  const chiave = env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await f(`${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/rpc/pulisci_testi_uscita`, {
      method: "POST",
      headers: { apikey: chiave, authorization: `Bearer ${chiave}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(ATTESA_MS),
    });
    if (!r.ok) {
      console.error(`testi uscita: risposta ${r.status}`);
      return { esito: "errore" };
    }
    const tolti = Math.max(0, Math.trunc(Number(await r.json())) || 0);
    if (tolti) console.log(`testi uscita: tolti ${tolti}`);
    return { esito: "fatto", tolti };
  } catch (e) {
    console.error("testi uscita: errore", e && e.name);
    return { esito: "errore" };
  }
}
