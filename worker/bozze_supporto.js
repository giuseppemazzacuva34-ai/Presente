// Bozze di «Scrivici» cancellate 30 giorni dopo la risposta (Fase 2, issue #10 parte B v1 del CPO, «Conservazione»;
// D122 B). Linea «sviluppatore-c». Ogni ora (cron «23 * * * *» già in wrangler.jsonc, gratuito) il Worker chiede al
// database public.pulisci_bozze_supporto() (migrazione *_supporto_bozze_30_giorni.sql, solo ruolo di servizio).
// Spento finché ACCESSO_APP non vale «si» o «tester». Nei log solo numeri, mai testi.

const ATTESA_MS = 10000;

// Restituisce { esito: "spento" | "fatto" | "errore", tolte? }. Mai eccezioni verso chi la chiama.
import { accessoAperto } from "./accesso_tester.js";
export async function pulisciBozzeSupporto(env, f = fetch) {
  if (!env || !accessoAperto(env) || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { esito: "spento" };
  const chiave = env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await f(`${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/rpc/pulisci_bozze_supporto`, {
      method: "POST",
      headers: { apikey: chiave, authorization: `Bearer ${chiave}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(ATTESA_MS),
    });
    if (!r.ok) {
      console.error(`bozze supporto: risposta ${r.status}`);
      return { esito: "errore" };
    }
    const tolte = Math.max(0, Math.trunc(Number(await r.json())) || 0);
    if (tolte) console.log(`bozze supporto: tolte ${tolte}`);
    return { esito: "fatto", tolte };
  } catch (e) {
    console.error("bozze supporto: errore", e && e.name);
    return { esito: "errore" };
  }
}
