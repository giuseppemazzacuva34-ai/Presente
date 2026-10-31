// Numeri della lista d'attesa per la plancia: solo totali, nessun dato personale.
// per_canale: visite e iscrizioni per canale dei link /da/<canale> (D26), solo contatori.
// visite: aperture di "/" e "/grazie" per giorno e per utm (D43), solo totali.
// esiti_iscrizione: per giorno, quanti invii del modulo sono andati bene o sono stati respinti e perché (solo numeri).
// per_sorgente: iscritti dal modulo del sito ("landing") e dal modulo dentro Facebook/Instagram ("meta_modulo"), solo totali.
// per_citta: iscritti per città (le zone, più le «altre città italiane» scritte a mano dal 31/10, D64), solo totali.
//   /conteggio è pubblico: una città scritta a mano compare col suo nome solo da MINIMO_CITTA_LIBERA iscritti in su,
//   sotto finisce in «altra-citta-italia». Così un paese con 1 iscritto (o un testo qualsiasi scritto nel campo città)
//   non diventa pubblico. Revisione CISO del 31/10.
// per_risposta (dal 31/10, D33/D65): totali nazionali di ciascuna domanda facoltativa, mai incrociati con città o email;
//   «chi cerchi» si mostra solo da 10 risposte in su, prima vale "meno di 10".
// per_codice: iscritti per codice invito dei creator, solo per i codici elencati in CODICI_INVITO (mai email, mai nomi liberi).
// inviti_personali (dal 31/10, «porta un'amica», D69 A): quante persone si sono iscritte con il codice personale di un
//   altro iscritto e quante persone hanno portato 1, 2 o 3+ amici. Solo totali: i codici personali non escono mai qui.
import { codiciConfigurati, pulisciCodice, CODICE_PERSONALE } from "./invito.js";
import { perCanale } from "./canale.js";
import { perVisite } from "./visite.js";
import { perEsiti, perRisposte } from "./iscrizione.js";
import { perCitta, ZONE } from "./citta.js";

export async function conteggio(env) {
  const intestazioni = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (!env.DB) return new Response(JSON.stringify({ totale: 0, per_zona: {}, nota: "database non collegato" }), { headers: intestazioni });
  try {
    const totale = await env.DB.prepare("SELECT COUNT(*) AS n FROM iscrizioni").first("n");
    const zone = await env.DB.prepare("SELECT zona, COUNT(*) AS n FROM iscrizioni GROUP BY zona").all();
    const conInvito = await env.DB.prepare("SELECT COUNT(*) AS n FROM iscrizioni WHERE invito IS NOT NULL").first("n");
    const per_zona = Object.fromEntries((zone.results || []).map((r) => [r.zona, r.n]));
    const per_codice = await perCodice(env);
    const per_sorgente = await perSorgente(env);
    const per_citta = raggruppaCittaPiccole(await perCitta(env));
    const per_canale = await perCanale(env);
    const visite = await perVisite(env);
    const esiti_iscrizione = await perEsiti(env);
    const per_risposta = await perRisposte(env);
    const inviti_personali = await invitiPersonali(env);
    return new Response(JSON.stringify({ totale, per_zona, per_citta, per_risposta, per_sorgente, con_invito: conInvito, per_codice, inviti_personali, per_canale, visite, esiti_iscrizione, aggiornato: new Date().toISOString() }), { headers: intestazioni });
  } catch {
    // La tabella nasce con la prima iscrizione.
    const per_canale = await perCanale(env);
    const visite = await perVisite(env);
    const esiti_iscrizione = await perEsiti(env);
    return new Response(JSON.stringify({ totale: 0, per_zona: {}, con_invito: 0, per_codice: {}, per_canale, visite, esiti_iscrizione }), { headers: intestazioni });
  }
}

async function perSorgente(env) {
  try {
    const righe = await env.DB.prepare("SELECT sorgente, COUNT(*) AS n FROM iscrizioni GROUP BY sorgente").all();
    return Object.fromEntries((righe.results || []).map((r) => [r.sorgente, r.n]));
  } catch {
    return {};
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

// Nel campo «Chi ti ha invitato?» può esserci il codice (dal link) o un nome con il codice scritto a mano
// («Giulia K7MQ2P»): conta solo una parola di 6 caratteri che è il codice di un iscritto; i nomi non si sommano mai.
export function codiceNelCampo(invito, esistenti) {
  const parole = String(invito || "").toUpperCase().split(/[^A-Z0-9]+/).filter((p) => CODICE_PERSONALE.test(p));
  const intero = pulisciCodice(invito);
  if (CODICE_PERSONALE.test(intero)) parole.unshift(intero);
  return parole.find((p) => esistenti.has(p)) || "";
}

export async function invitiPersonali(env) {
  const vuoto = { iscritti_con_invito: 0, persone_che_hanno_invitato: 0, per_numero_di_amici: { "1": 0, "2": 0, "3+": 0 } };
  try {
    const codici = await env.DB.prepare("SELECT codice FROM iscrizioni WHERE codice IS NOT NULL").all();
    const esistenti = new Set((codici.results || []).map((r) => r.codice));
    if (!esistenti.size) return vuoto;
    const inviti = await env.DB.prepare("SELECT invito, COUNT(*) AS n FROM iscrizioni WHERE invito IS NOT NULL GROUP BY invito").all();
    const perCodice = {};
    for (const r of inviti.results || []) {
      const c = codiceNelCampo(r.invito, esistenti);
      if (c) perCodice[c] = (perCodice[c] || 0) + (r.n || 0);
    }
    const risultato = vuoto;
    for (const n of Object.values(perCodice)) {
      risultato.iscritti_con_invito += n;
      risultato.persone_che_hanno_invitato += 1;
      risultato.per_numero_di_amici[n >= 3 ? "3+" : String(n)] += 1;
    }
    return risultato;
  } catch {
    return vuoto; // colonna codice non ancora creata
  }
}

// Città scritte a mano con meno di MINIMO_CITTA_LIBERA iscritti: sommate in «altra-citta-italia», senza nome.
export const MINIMO_CITTA_LIBERA = 10;
export function raggruppaCittaPiccole(perCittaGrezzo) {
  const risultato = {};
  for (const [chiave, n] of Object.entries(perCittaGrezzo || {})) {
    const k = ZONE.has(chiave) || n >= MINIMO_CITTA_LIBERA ? chiave : "altra-citta-italia";
    risultato[k] = (risultato[k] || 0) + n;
  }
  return risultato;
}
