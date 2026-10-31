// Numeri pubblici della home (decisione D64, punti 2 e 4), scritti dal Worker dentro l'HTML: la pagina resta senza script.
// - «Restano N posti»: N = 150 − iscritti totali. Appare solo con MOSTRA_POSTI = "si" (testo esatto dopo l'ok del CFO).
// - Contatore per città: solo le città con almeno 10 iscritti; sotto quella soglia non si mostra nulla.
// Solo totali, mai email o altri dati delle persone. I numeri restano in memoria 60 secondi per non leggere D1 a ogni visita.
import { perCitta, nomeCitta } from "./citta.js";

export const POSTI_REGALO = 150;
export const SOGLIA_CONTATORE = 10;
export const SEGNAPOSTO_POSTI = "<!--posti-->";
export const SEGNAPOSTO_CONTATORE = "<!--contatore-citta-->";

let memoria = { quando: 0, numeri: null };

export function svuotaMemoria() {
  memoria = { quando: 0, numeri: null };
}

// fresco = true (pagina /grazie, subito dopo l'iscrizione): rilegge D1 per contare anche la persona appena entrata.
export async function numeriPubblici(env, adesso = Date.now(), { fresco = false } = {}) {
  if (!env.DB) return null;
  if (!fresco && memoria.numeri && adesso - memoria.quando < 60_000) return memoria.numeri;
  try {
    const totale = Number(await env.DB.prepare("SELECT COUNT(*) AS n FROM iscrizioni").first("n")) || 0;
    const citta = await perCitta(env);
    memoria = { quando: adesso, numeri: { totale, citta } };
    return memoria.numeri;
  } catch {
    return null;
  }
}

// Frase sotto il pulsante. Testo segnaposto in attesa del CFO (D42 per il regalo, D64 per la frase).
export function htmlPosti(numeri, env) {
  if (env.MOSTRA_POSTI !== "si" || !numeri) return "";
  const restano = POSTI_REGALO - numeri.totale;
  if (restano <= 0) return "";
  return `<p class="posti">I primi ${POSTI_REGALO} entrano con una stanza in regalo. Restano <strong>${restano}</strong> posti.</p>`;
}

export function htmlContatore(numeri) {
  if (!numeri) return "";
  const voci = Object.entries(numeri.citta)
    .map(([chiave, n]) => [nomeCitta(chiave), n])
    .filter(([nome, n]) => nome && n >= SOGLIA_CONTATORE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  if (!voci.length) return "";
  const elenco = voci.map(([nome, n]) => `<li><span>${nome}</span> <strong>${n}</strong></li>`).join("");
  return `<div class="contatore-citta"><p>Già in lista</p><ul>${elenco}</ul></div>`;
}

// Inserisce i numeri nei segnaposto; se non c'è nulla da mostrare l'HTML resta identico.
export function conNumeri(html, numeri, env) {
  const posti = htmlPosti(numeri, env);
  const contatore = htmlContatore(numeri);
  if (posti && html.includes(SEGNAPOSTO_POSTI)) html = html.replace(SEGNAPOSTO_POSTI, posti);
  if (contatore && html.includes(SEGNAPOSTO_CONTATORE)) html = html.replace(SEGNAPOSTO_CONTATORE, contatore);
  return html;
}
