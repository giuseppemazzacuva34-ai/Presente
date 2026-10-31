// Pagina /grazie dopo l'iscrizione (decisione D64, punto 3): «<Città>: mancano N persone per aprire la tua stanza».
// L'iscrizione rimanda a /grazie?citta=<città>; qui il Worker scrive la frase dentro l'HTML (niente script).
// La città dell'indirizzo passa di nuovo dalla normalizzazione (solo lettere e spazi) e non viene salvata né contata.
// N = 36 − iscritti di quella città (stanze di città a 36 iscritti, D19). Solo totali, mai dati delle persone.
import { normalizzaCitta, chiaveCitta, nomeCitta } from "./citta.js";
import { numeriPubblici } from "./numeri.js";

export const SOGLIA_STANZA = 36;
export const SEGNAPOSTO_MANCANO = "<!--mancano-->";

export function htmlMancano(nome, iscritti) {
  const mancano = SOGLIA_STANZA - iscritti;
  if (mancano <= 0) {
    return `<p class="mancano"><strong>${nome}</strong> ha già ${SOGLIA_STANZA} iscritti: ti scriviamo appena apre la tua stanza. Invita un'amica o un amico, così entra con te.</p>`;
  }
  const persone = mancano === 1 ? "manca <strong>1</strong> persona" : `mancano <strong>${mancano}</strong> persone`;
  return `<p class="mancano"><strong>${nome}</strong>: ${persone} per aprire la tua stanza. Invita un'amica o un amico e la accendete prima.</p>`;
}

export async function grazieConCitta(request, env) {
  const risposta = await env.ASSETS.fetch(request);
  const tipo = risposta.headers.get("content-type") || "";
  if (risposta.status !== 200 || !tipo.includes("text/html")) return risposta;
  const luogo = normalizzaCitta(String(new URL(request.url).searchParams.get("citta") || "").slice(0, 80));
  const nome = luogo ? nomeCitta(chiaveCitta(luogo.zona, luogo.citta)) : "";
  if (!nome) return risposta;
  const numeri = await numeriPubblici(env, Date.now(), { fresco: true });
  if (!numeri) return risposta;
  const html = await risposta.text();
  if (!html.includes(SEGNAPOSTO_MANCANO)) return new Response(html, risposta);
  const nuova = new Response(html.replace(SEGNAPOSTO_MANCANO, htmlMancano(nome, numeri.citta[chiaveCitta(luogo.zona, luogo.citta)] || 0)), risposta);
  nuova.headers.set("cache-control", "private, no-store");
  nuova.headers.delete("etag");
  nuova.headers.delete("content-length");
  return nuova;
}
