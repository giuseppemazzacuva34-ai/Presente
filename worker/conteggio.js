// Numeri della lista d'attesa per la plancia: solo totali, nessun dato personale.
export async function conteggio(env) {
  const intestazioni = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (!env.DB) return new Response(JSON.stringify({ totale: 0, per_zona: {}, nota: "database non collegato" }), { headers: intestazioni });
  try {
    const totale = await env.DB.prepare("SELECT COUNT(*) AS n FROM iscrizioni").first("n");
    const zone = await env.DB.prepare("SELECT zona, COUNT(*) AS n FROM iscrizioni GROUP BY zona").all();
    const conInvito = await env.DB.prepare("SELECT COUNT(*) AS n FROM iscrizioni WHERE invito IS NOT NULL").first("n");
    const per_zona = Object.fromEntries((zone.results || []).map((r) => [r.zona, r.n]));
    return new Response(JSON.stringify({ totale, per_zona, con_invito: conInvito, aggiornato: new Date().toISOString() }), { headers: intestazioni });
  } catch {
    // La tabella nasce con la prima iscrizione.
    return new Response(JSON.stringify({ totale: 0, per_zona: {}, con_invito: 0 }), { headers: intestazioni });
  }
}
