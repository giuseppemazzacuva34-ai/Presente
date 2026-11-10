// Chiamate solo voce (issue #4, passo 3b-2a): scrive UNA riga del registro (tabella public.chiamate, PR #146).
// Solo chi / con / inizio / durata / esito. La scrive il server con la chiave service_role (secret del Worker,
// mai nel telefono); la tabella non si scrive dal telefono. Ripetibile: se la riga c'è già (stessa chi + inizio)
// non si crea un doppione, così il Durable Object può riprovare senza paura. Nei log solo il codice di risposta.

const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function registraChiamata(env, riga, f = fetch) {
  const base = String(env?.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const servizio = String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!URL_SUPABASE.test(base) || !servizio) return false;
  if (!riga || !UUID.test(riga.chi) || !UUID.test(riga.con)) return false;
  const { chi, con, inizio, durata, esito } = riga;
  try {
    const r = await f(`${base}/rest/v1/chiamate?on_conflict=chi,inizio`, {
      method: "POST",
      headers: {
        apikey: servizio,
        authorization: `Bearer ${servizio}`,
        "content-type": "application/json",
        prefer: "return=minimal, resolution=ignore-duplicates",
      },
      body: JSON.stringify({ chi, con, inizio, durata, esito }),
    });
    if (!r.ok) console.error("registro chiamate: risposta", r.status);
    return r.ok;
  } catch (e) {
    console.error("registro chiamate: errore", e && e.name);
    return false;
  }
}
