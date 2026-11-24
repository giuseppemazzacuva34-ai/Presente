// Pulizia dei vocali del Filo 7 giorni dopo la chiusura della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A:
// «I file dei vocali spariscono 7 giorni dopo la chiusura»). Linea «sviluppatore-c», passo 11b.
// Ogni ora (cron «23 * * * *» già in wrangler.jsonc, gratuito), col ruolo di servizio:
//   1. vocali_filo_scaduti(ora) → percorsi nel contenitore privato «vocali_filo» (migrazione *_filo_pulizia.sql);
//   2. cancella quei file dal contenitore (API di Storage, non tabelle a mano: niente file orfani);
//   3. togli_vocali_filo(percorsi, ora) → toglie le righe (solo se davvero scadute) e «vista»/«ascoltato» delle stanze
//      chiuse da 7 giorni.
// Se i file non si cancellano, le righe restano e si riprova al giro dopo. Gira anche prima di ACCESSO_APP = «si»:
// cancella soltanto dati scaduti, non mostra nulla a nessuno. Nei log solo numeri e codici, mai percorsi o testi.

const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const PERCORSO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9._-]{1,200}$/;
const ATTESA_MS = 10000;
const CONTENITORE = "vocali_filo";

function server(env) {
  const base = String(env?.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const chiave = String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return URL_SUPABASE.test(base) && chiave ? { base, chiave } : null;
}

async function chiama(s, percorso, metodo, corpo, f) {
  return f(`${s.base}${percorso}`, {
    method: metodo,
    headers: { apikey: s.chiave, authorization: `Bearer ${s.chiave}`, "content-type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(ATTESA_MS),
  });
}

// Restituisce { esito: "spento" | "fatto" | "errore", tolti? }. Mai eccezioni verso chi la chiama.
export async function pulisciVocaliFilo(env, f = fetch) {
  const s = server(env);
  if (!s) return { esito: "spento" };
  const ora = new Date().toISOString();
  try {
    const r = await chiama(s, "/rest/v1/rpc/vocali_filo_scaduti", "POST", { p_ora: ora }, f);
    if (!r.ok) {
      console.error(`vocali filo: elenco ${r.status}`);
      return { esito: "errore" };
    }
    const righe = await r.json();
    if (!Array.isArray(righe) || !righe.every((x) => x && typeof x.percorso === "string" && PERCORSO.test(x.percorso))) {
      console.error("vocali filo: elenco non valido");
      return { esito: "errore" };
    }
    const percorsi = righe.map((x) => x.percorso);
    if (percorsi.length) {
      const c = await chiama(s, `/storage/v1/object/${CONTENITORE}`, "DELETE", { prefixes: percorsi }, f);
      if (!c.ok) {
        console.error(`vocali filo: cancellazione file ${c.status}`);
        return { esito: "errore" };
      }
    }
    const t = await chiama(s, "/rest/v1/rpc/togli_vocali_filo", "POST", { p_percorsi: percorsi, p_ora: ora }, f);
    if (!t.ok) {
      console.error(`vocali filo: righe ${t.status}`);
      return { esito: "errore" };
    }
    const tolti = Math.max(0, Math.trunc(Number(await t.json())) || 0);
    if (tolti) console.log(`vocali filo: tolti ${tolti}`);
    return { esito: "fatto", tolti };
  } catch (e) {
    console.error("vocali filo: errore", e && e.name);
    return { esito: "errore" };
  }
}
