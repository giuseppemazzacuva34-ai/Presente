// Pagina /grazie dopo l'iscrizione (decisione D64, punto 3): «<Città>: mancano N persone per aprire la tua stanza».
// L'iscrizione rimanda a /grazie?citta=<città>; qui il Worker scrive la frase dentro l'HTML (niente script).
// La città dell'indirizzo passa di nuovo dalla normalizzazione (solo lettere e spazi) e non viene salvata né contata.
// N = 36 − iscritti di quella città (stanze di città a 36 iscritti, D19). Solo totali, mai dati delle persone.
import { normalizzaCitta, chiaveCitta, nomeCitta } from "./citta.js";
import { numeriPubblici } from "./numeri.js";
import { CODICE_PERSONALE, linkPersonale } from "./invito.js";

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

// «Porta un'amica» (spec referral parte 2, D69 A): con ?c=<codice personale> il blocco fra <!--invito--> e <!--/invito-->
// diventa il link personale, già dentro i messaggi WhatsApp e Telegram. Il codice deve avere la forma giusta
// (6 caratteri dell'alfabeto): qualunque altro valore lascia la pagina com'è. Nessuna promessa di premi (DPR 430/2001).
export const INIZIO_INVITO = "<!--invito-->";
export const FINE_INVITO = "<!--/invito-->";

export function htmlInvito(link, nome) {
  const dove = nome ? `<strong>${nome}</strong>` : "la tua città";
  const testo = `Ti giro questa: un'app di incontri al buio dove nessuno vede le tue foto finché non vi scegliete in due. `
    + `Prima ci si parla a voce, poi si decide se vedersi. ${nome || "La nostra città"} apre quando arriva a ${SOGLIA_STANZA} iscritti: `
    + `entra in lista (è gratis) da qui 👉 ${link}`;
  const whatsapp = "https://wa.me/?text=" + encodeURIComponent(testo);
  const telegram = "https://t.me/share/url?url=" + encodeURIComponent(link) + "&amp;text=" + encodeURIComponent(testo.replace(/ da qui 👉 .*$/, ""));
  return `<p>Si parte con la Stanza Italia. Le stanze della tua città aprono a ${SOGLIA_STANZA} iscritti: chi si iscrive con il tuo link fa salire ${dove}. Pensa a un'amica stanca delle solite app, o a un amico.</p>
        <p class="link-personale">Il tuo link personale: <strong>${link.replace(/&/g, "&amp;")}</strong></p>
        <p><a class="bottone" href="${whatsapp}" rel="noopener">Invia su WhatsApp</a></p>
        <p><a class="bottone bottone-chiaro" href="${telegram}" rel="noopener">Invia su Telegram</a></p>
        <p class="nota">Il codice nel link è casuale e non dice nulla di te: serve solo a contare quante persone arrivano con il tuo invito.</p>
`;
}

export async function grazieConCitta(request, env) {
  const risposta = await env.ASSETS.fetch(request);
  const tipo = risposta.headers.get("content-type") || "";
  if (risposta.status !== 200 || !tipo.includes("text/html")) return risposta;
  const parametri = new URL(request.url).searchParams;
  const luogo = normalizzaCitta(String(parametri.get("citta") || "").slice(0, 80));
  const chiave = luogo ? chiaveCitta(luogo.zona, luogo.citta) : "";
  const nome = chiave ? nomeCitta(chiave) : "";
  const codice = String(parametri.get("c") || "");
  const personale = CODICE_PERSONALE.test(codice);
  if (!nome && !personale) return risposta;
  let html = await risposta.text();
  const originale = html;
  if (nome && html.includes(SEGNAPOSTO_MANCANO)) {
    const numeri = await numeriPubblici(env, Date.now(), { fresco: true });
    if (numeri) html = html.replace(SEGNAPOSTO_MANCANO, htmlMancano(nome, numeri.citta[chiave] || 0));
  }
  const inizio = html.indexOf(INIZIO_INVITO);
  const fine = html.indexOf(FINE_INVITO);
  if (personale && inizio !== -1 && fine > inizio) {
    const link = linkPersonale(request.url, codice, nome ? chiave : "");
    html = html.slice(0, inizio + INIZIO_INVITO.length) + "\n        " + htmlInvito(link, nome) + "        " + html.slice(fine);
  }
  if (html === originale) return new Response(html, risposta);
  const nuova = new Response(html, risposta);
  nuova.headers.set("cache-control", "private, no-store");
  nuova.headers.delete("etag");
  nuova.headers.delete("content-length");
  return nuova;
}
