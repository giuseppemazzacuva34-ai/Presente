// Link d'invito dei creator: https://presenteincontri.app/?invito=CODICE precompila il campo «Chi ti ha invitato?».
// La pagina resta senza script: è il Worker a scrivere il codice dentro l'HTML prima di mandarlo al browser.
// Il codice viene ripulito: solo lettere e numeri, massimo 20 caratteri, in maiuscolo. Nient'altro entra nella pagina.

import { canaleValido } from "./canale.js";
import { numeriPubblici, conNumeri } from "./numeri.js";
import { normalizzaCitta, chiaveCitta, nomeCitta } from "./citta.js";

// «Porta un'amica» (spec referral, parte 2; D69 A): a ogni nuova iscrizione il Worker crea un codice personale casuale
// di 6 caratteri, senza 0/O/1/I (si leggono male), unico e NON derivato dall'email. Serve solo a contare quante persone
// si iscrivono con quell'invito (informativa 1.2). 32 simboli ^ 6 = circa un miliardo di combinazioni.
export const ALFABETO_CODICE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODICE_PERSONALE = /^[A-HJ-NP-Z2-9]{6}$/;

export function generaCodice(casuale = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  // 256 è multiplo di 32: il resto della divisione non favorisce nessun simbolo.
  return Array.from(casuale(6), (b) => ALFABETO_CODICE[b % 32]).join("");
}

// Città del link personale (?citta=<chiave>): passa dalla stessa normalizzazione del modulo e torna il nome leggibile
// («Milano», «Reggio Emilia») o "" se non è una città italiana. Solo lettere, spazi e apostrofi entrano nella pagina.
export function cittaDelLink(valore) {
  const luogo = normalizzaCitta(String(valore || "").slice(0, 60));
  if (!luogo || luogo.zona === "estero") return "";
  return nomeCitta(chiaveCitta(luogo.zona, luogo.citta));
}

// Link personale da condividere: passa da /da/amico (conta la visita del canale «amico») e porta codice e città,
// così chi lo apre trova il modulo già compilato con l'invito e la città di chi l'ha invitato (modificabile).
export function linkPersonale(base, codice, chiave = "") {
  const url = new URL("/da/amico", base);
  url.searchParams.set("invito", codice);
  if (chiave && chiave !== "estero" && chiave !== "altra-citta-italia") url.searchParams.set("citta", chiave);
  return url.toString();
}

const SEGNAPOSTO = '<input id="invito" name="invito"';

export function pulisciCodice(valore) {
  return String(valore || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 20).toUpperCase();
}

// Punto del modulo dove il Worker aggiunge il campo nascosto «canale» (link /da/<canale>, D26).
const SEGNAPOSTO_CANALE = 'action="/iscrizione">';
// Campo città del modulo: con ?citta= del link personale viene precompilato (la persona può sempre cambiarlo).
const SEGNAPOSTO_CITTA = '<input id="zona" name="zona"';

// Serve la home; se l'indirizzo ha ?invito=CODICE valido, restituisce la stessa pagina con il campo già compilato.
// Se ha ?da=<canale> dell'elenco chiuso (vedi canale.js), aggiunge al modulo il campo nascosto «canale».
export async function homeConInvito(request, env) {
  const risposta = await env.ASSETS.fetch(request);
  const parametri = new URL(request.url).searchParams;
  const codice = pulisciCodice(parametri.get("invito"));
  // Senza ?da=, una sorgente utm che è anche un canale (es. utm_source=meta delle sponsorizzate) vale come canale:
  // così anche le iscrizioni dalla campagna finiscono nel contatore iscrizioni_canale.
  const canale = canaleValido(parametri.get("da")) || canaleValido(parametri.get("utm_source"));
  // La città si precompila solo insieme a un codice d'invito (link personale «porta un'amica»).
  const citta = codice ? cittaDelLink(parametri.get("citta")) : "";
  const tipo = risposta.headers.get("content-type") || "";
  if (risposta.status !== 200 || !tipo.includes("text/html")) return risposta;
  // Numeri pubblici della home (D64): «restano N posti» e contatore per città, solo totali.
  const numeri = await numeriPubblici(env);
  if (!codice && !canale && !numeri) return risposta;

  const originale = await risposta.text();
  let html = conNumeri(originale, numeri, env);
  if (!codice && !canale && html === originale) return new Response(originale, risposta);
  if (codice && html.includes(SEGNAPOSTO)) html = html.replace(SEGNAPOSTO, `${SEGNAPOSTO} value="${codice}"`);
  if (citta && html.includes(SEGNAPOSTO_CITTA)) html = html.replace(SEGNAPOSTO_CITTA, `${SEGNAPOSTO_CITTA} value="${citta}"`);
  if (canale && html.includes(SEGNAPOSTO_CANALE)) {
    html = html.replace(SEGNAPOSTO_CANALE, `${SEGNAPOSTO_CANALE}\n        <input type="hidden" name="canale" value="${canale}">`);
  }
  const nuova = new Response(html, risposta);
  // Pagina personalizzata: nessuna copia in cache condivisa.
  nuova.headers.set("cache-control", "private, no-store");
  nuova.headers.delete("etag");
  nuova.headers.delete("content-length");
  return nuova;
}

// Codici dei creator da contare in /conteggio (variabile CODICI_INVITO in wrangler.jsonc, separati da virgola).
// Solo questi codici compaiono nei totali: i nomi liberi scritti nel campo invito non escono mai.
export function codiciConfigurati(env) {
  return new Set(String(env.CODICI_INVITO || "").split(",").map(pulisciCodice).filter(Boolean));
}
