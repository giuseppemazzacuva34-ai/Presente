// Numeri della lista d'attesa per la plancia: solo totali, nessun dato personale.
// per_canale: visite e iscrizioni per canale dei link /da/<canale> (D26), solo contatori.
// visite: aperture di "/" e "/grazie" per giorno e per utm (D43), solo totali.
// esiti_iscrizione: per giorno, quanti invii del modulo sono andati bene o sono stati respinti e perché (solo numeri).
// per_codice: iscritti per codice invito dei creator, solo per i codici elencati in CODICI_INVITO (mai email, mai nomi liberi).
import { codiciConfigurati, pulisciCodice } from "./invito.js";
import { perCanale } from "./canale.js";
import { perVisite } from "./visite.js";
import { perEsiti } from "./iscrizione.js";

export async function conteggio(env) {
  const intestazioni = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (!env.DB) return new Response(JSON.stringify({ totale: 0, per_zona: {}, nota: "database non collegato" }), { headers: intestazioni });
  try {
    const totale = await env.DB.prepare("SELECT COUNT(*) AS n FROM iscrizioni").first("n");
    const zone = await env.DB.prepare("SELECT zona, COUNT(*) AS n FROM iscrizioni GROUP BY zona").all();
    const conInvito = await env.DB.prepare("SELECT COUNT(*) AS n FROM iscrizioni WHERE invito IS NOT NULL").first("n");
    const per_zona = Object.fromEntries((zone.results || []).map((r) => [r.zona, r.n]));
    const per_codice = await perCodice(env);
    const per_canale = await perCanale(env);
    const visite = await perVisite(env);
    const esiti_iscrizione = await perEsiti(env);
    return new Response(JSON.stringify({ totale, per_zona, con_invito: conInvito, per_codice, per_canale, visite, esiti_iscrizione, aggiornato: new Date().toISOString() }), { headers: intestazioni });
  } catch {
    // La tabella nasce con la prima iscrizione.
    const per_canale = await perCanale(env);
    const visite = await perVisite(env);
    const esiti_iscrizione = await perEsiti(env);
    return new Response(JSON.stringify({ totale: 0, per_zona: {}, con_invito: 0, per_codice: {}, per_canale, visite, esiti_iscrizione }), { headers: intestazioni });
  }
}

// Conta per codice: chi arriva dal link ha il codice già scritto; chi lo digita a mano può usare minuscole o spazi,
// per questo il confronto avviene sul valore ripulito. Il risultato contiene solo i codici configurati.
async function perCodice(env) {
  const codici = codiciConfigurati(env);
  const conteggi = Object.fromEntries([...codici].map((c) => [c, 0]));
  if (!codici.size) return conteggi;
  const righe = await env.DB.prepare("SELECT invito, COUNT(*) AS n FROM iscrizioni WHERE invito IS NOT NULL GROUP BY invito").all();
  for (const r of righe.results || []) {
    const codice = pulisciCodice(r.invito);
    if (codici.has(codice)) conteggi[codice] += r.n;
  }
  return conteggi;
}
