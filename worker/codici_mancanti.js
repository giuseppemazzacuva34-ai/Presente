// Codice invito personale per OGNI iscritto (D98 A, richiesta del Coordinatore del 3/11).
// Chi si iscrive dal sito riceve il codice subito (worker/iscrizione.js); chi arriva dal modulo Meta no.
// Qui il Worker completa le righe senza codice: stesso generatore casuale (mai derivato dall'email), indice unico,
// mai uguale a un codice delle presentatrici. Gira ogni ora (cron in wrangler.jsonc) e dopo ogni contatto Meta.
// Aggiorna solo righe con codice ancora vuoto: non cambia mai un codice già dato.

import { generaCodice, codiciConfigurati } from "./invito.js";

const INDICE_CODICE = "CREATE UNIQUE INDEX IF NOT EXISTS iscrizioni_codice ON iscrizioni(codice)";
const SENZA_CODICE = "SELECT id FROM iscrizioni WHERE codice IS NULL LIMIT 500";
const DAI_CODICE = "UPDATE iscrizioni SET codice = ? WHERE id = ? AND codice IS NULL";
const TENTATIVI = 5;

const collisione = (e) => /UNIQUE constraint failed: iscrizioni\.codice/i.test(String(e && e.message));

// Restituisce quanti codici ha assegnato. Mai eccezioni verso chi la chiama.
export async function assegnaCodiciMancanti(env, genera = generaCodice) {
  if (!env || !env.DB) return 0;
  const creator = codiciConfigurati(env);
  let assegnati = 0;
  try {
    await env.DB.prepare(INDICE_CODICE).run();
    const { results } = await env.DB.prepare(SENZA_CODICE).all();
    for (const { id } of results || []) {
      for (let t = 0; t < TENTATIVI; t++) {
        let codice;
        do codice = genera(); while (creator.has(codice));
        try {
          const r = await env.DB.prepare(DAI_CODICE).bind(codice, id).run();
          if (r && r.meta && r.meta.changes > 0) assegnati++;
          break;
        } catch (e) {
          if (!collisione(e)) throw e;
        }
      }
    }
  } catch (e) {
    console.error("codici mancanti: errore", e && e.name);
  }
  if (assegnati) console.log(`codici mancanti: assegnati ${assegnati}`); // solo numeri
  return assegnati;
}
