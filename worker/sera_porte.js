// La sera delle porte (Fase 2, issue #5, spec v1.1 del CPO; D14 A, D16 B). Linea «sviluppatore-c».
// Il lavoro programmato del Worker chiede al database di aprire le porte delle stanze appena chiuse:
// public.apri_porte() (migrazione 20261113205404_sera_porte.sql, solo ruolo di servizio) apre in un solo calcolo per
// stanza le porte dove la chiave è reciproca, tutte all'ora della chiusura (21:00 di Roma), e cancella le chiavi.
// Parte la domenica alle 19:00 e alle 20:00 UTC (una delle due è sempre le 21:00 di Roma, d'estate e d'inverno) e
// ogni ora come riserva: rifarla non apre porte doppie e una stanza ancora aperta non si tocca.
// Spento finché ACCESSO_APP non vale «si». Nei log solo numeri, mai persone: nessuno scopre un no.

const ATTESA_MS = 10000; // lavoro in sottofondo: si può aspettare più di una richiesta del telefono

const numero = (x) => Math.max(0, Math.trunc(Number(x)) || 0);

// Restituisce { esito: "spento" | "fatto" | "errore", ...numeri }. Mai eccezioni verso chi la chiama.
export async function apriPorteDellaSera(env, f = fetch) {
  if (!env || env.ACCESSO_APP !== "si" || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { esito: "spento" };
  const chiave = env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await f(`${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/rpc/apri_porte`, {
      method: "POST",
      headers: { apikey: chiave, authorization: `Bearer ${chiave}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(ATTESA_MS),
    });
    if (!r.ok) {
      console.error(`sera delle porte: risposta ${r.status}`);
      return { esito: "errore" };
    }
    const d = (await r.json()) || {};
    const esito = { esito: "fatto", stanze: numero(d.stanze), chiavi_date: numero(d.chiavi_date), porte_aperte: numero(d.porte_aperte) };
    if (esito.stanze) console.log(`sera delle porte: stanze ${esito.stanze}, chiavi ${esito.chiavi_date}, porte ${esito.porte_aperte}`);
    return esito;
  } catch (e) {
    console.error("sera delle porte: errore", e && e.name);
    return { esito: "errore" };
  }
}
