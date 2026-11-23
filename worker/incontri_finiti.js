// Incontri finiti (Fase 2, issue #6 spec v1 del CPO, «Regole» › buca e «nessun check-in»; D12 A). Linea «sviluppatore-b».
// Ogni ora (cron «23 * * * *» già in wrangler.jsonc, gratuito) il Worker chiede al database di chiudere gli incontri
// finiti che nessuno ha aperto: public.chiudi_incontri_finiti() (migrazione *_buca_incontro.sql, solo ruolo di
// servizio) applica la buca (100 + 70 Coin a chi ha aspettato, 30 a Presente) o restituisce i crediti a entrambi. Ogni lettura
// dell'incontro lo chiude già da sola: questo lavoro serve solo per chi non riapre l'app.
// Spento finché ACCESSO_APP non vale «si» o «tester». Nei log solo numeri, mai persone.

const ATTESA_MS = 10000;

// Restituisce { esito: "spento" | "fatto" | "errore", chiusi? }. Mai eccezioni verso chi la chiama.
import { accessoAperto } from "./accesso_tester.js";
export async function chiudiIncontriFiniti(env, f = fetch) {
  if (!env || !accessoAperto(env) || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { esito: "spento" };
  const chiave = env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await f(`${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/rpc/chiudi_incontri_finiti`, {
      method: "POST",
      headers: { apikey: chiave, authorization: `Bearer ${chiave}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(ATTESA_MS),
    });
    if (!r.ok) {
      console.error(`incontri finiti: risposta ${r.status}`);
      return { esito: "errore" };
    }
    const chiusi = Math.max(0, Math.trunc(Number(await r.json())) || 0);
    if (chiusi) console.log(`incontri finiti: chiusi ${chiusi}`);
    return { esito: "fatto", chiusi };
  } catch (e) {
    console.error("incontri finiti: errore", e && e.name);
    return { esito: "errore" };
  }
}
