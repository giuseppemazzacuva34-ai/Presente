// Pulizia dei gettoni del passo 2 scaduti (informativa 1.5, richiesta CISO del 3/11). Gira nel lavoro orario.
// Toglie solo gettone e scadenza delle righe già scadute (sempre con il filtro): la riga d'iscrizione resta.
// Le scadenze sono stringhe ISO in UTC (worker/iscrizione.js), quindi il confronto tra testi è corretto.

const PULISCI = "UPDATE iscrizioni SET gettone = NULL, gettone_scade = NULL WHERE gettone_scade < ?";

// Restituisce quanti gettoni ha tolto. Mai eccezioni verso chi la chiama.
export async function pulisciGettoniScaduti(env, ora = new Date()) {
  if (!env || !env.DB) return 0;
  try {
    const r = await env.DB.prepare(PULISCI).bind(ora.toISOString()).run();
    const n = (r && r.meta && r.meta.changes) || 0;
    if (n) console.log(`gettoni scaduti: tolti ${n}`); // solo numeri
    return n;
  } catch (e) {
    console.error("gettoni scaduti: errore", e && e.name);
    return 0;
  }
}
