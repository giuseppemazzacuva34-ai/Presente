// Numeri pubblici della home (decisione D64, punti 2 e 4), scritti dal Worker dentro l'HTML: la pagina resta senza script.
// - «I primi 150 iscritti hanno 9 crediti in regalo… Restano N posti.»: N = 150 − iscritti totali, solo con MOSTRA_POSTI = "si".
// - Contatore per città: solo le città con almeno 10 iscritti; sotto quella soglia non si mostra nulla.
// Solo totali, mai email o altri dati delle persone. I numeri restano in memoria 60 secondi per non leggere D1 a ogni visita.
import { perCitta, nomeCitta, NOMI_ZONE } from "./citta.js";

export const POSTI_REGALO = 150;
export const SOGLIA_CONTATORE = 10;
export const SEGNAPOSTO_POSTI = "<!--posti-->";
// Dal 1/11 (D79 A, punto 2) la frase dei posti sta SOPRA il modulo con «N persone già in lista»; la nota del CFO sotto il pulsante.
export const SEGNAPOSTO_POSTI_NOTA = "<!--posti-nota-->";
export const SEGNAPOSTO_CONTATORE = "<!--contatore-citta-->";
export const SEGNAPOSTO_CLASSIFICA = "<!--classifica-->";
export const SOGLIA_APERTURA = 36;

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

// Frase dei posti: testo esatto del CFO (31/10), regalo deciso con D42. Si accende con MOSTRA_POSTI = "si".
// Dal 1/11 (D79 A, prova sociale) davanti c'è «N persone già in lista.», con N = iscritti totali (stesso numero di sempre).
export const NOTA_POSTI = `<p class="posti-nota">Il regalo si aggiunge al primo acquisto di crediti entro 30 giorni dall'apertura. La prima stanza è gratis per tutti. Crediti non convertibili in denaro.</p>`;

export function htmlPosti(numeri, env, { conNota = true } = {}) {
  if (env.MOSTRA_POSTI !== "si" || !numeri) return "";
  const restano = POSTI_REGALO - numeri.totale;
  if (restano <= 0) return "";
  const coda = restano === 1 ? "Resta <strong>1</strong> posto." : `Restano <strong>${restano}</strong> posti.`;
  const persone = numeri.totale === 1 ? "<strong>1</strong> persona già in lista." : `<strong>${numeri.totale}</strong> persone già in lista.`;
  return `<p class="posti">${numeri.totale > 0 ? persone + " " : ""}I primi ${POSTI_REGALO} iscritti hanno 9 crediti in regalo, una stanza in più, al primo acquisto. ${coda}</p>`
    + (conNota ? NOTA_POSTI : "");
}

// D76 A (1/11): contatore e classifica mostrano solo le 14 città con stanza prevista (NOMI_ZONE).
// Le città scritte a mano non compaiono mai per nome nelle pagine pubbliche, a qualunque numero.
export function cittaConStanza(chiave) {
  return Object.prototype.hasOwnProperty.call(NOMI_ZONE, chiave);
}

export function htmlContatore(numeri) {
  if (!numeri) return "";
  const voci = Object.entries(numeri.citta)
    .filter(([chiave]) => cittaConStanza(chiave))
    .map(([chiave, n]) => [nomeCitta(chiave), n])
    .filter(([nome, n]) => nome && n >= SOGLIA_CONTATORE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  if (!voci.length) return "";
  const elenco = voci.map(([nome, n]) => `<li><span>${nome}</span> <strong>${n}</strong></li>`).join("");
  return `<div class="contatore-citta"><p>Già in lista</p><ul>${elenco}</ul></div>`;
}

// Classifica pubblica delle città (D74 A, punto 4 «passaparola»): solo nome della città e conteggio, mai nomi di persone.
// Stessa soglia del contatore (10 iscritti): sotto, una città non compare, così nessun numero piccolo fa intuire chi c'è.
export function htmlClassifica(numeri) {
  if (!numeri) return "";
  const voci = Object.entries(numeri.citta)
    .filter(([chiave]) => cittaConStanza(chiave))
    .map(([chiave, n]) => [nomeCitta(chiave), n])
    .filter(([nome, n]) => nome && n >= SOGLIA_CONTATORE)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "it"))
    .slice(0, 10);
  const titolo = `<h2 id="classifica">La corsa delle città. <em>La prima a ${SOGLIA_APERTURA} apre.</em></h2>`;
  if (!voci.length) {
    return `<section class="classifica" aria-labelledby="classifica">${titolo}<p>Nessuna città ha ancora ${SOGLIA_CONTATORE} iscritti: con il tuo link la tua può essere la prima a entrare in classifica.</p></section>`;
  }
  const righe = voci.map(([nome, n]) => {
    const mancano = SOGLIA_APERTURA - n;
    const stato = mancano > 0 ? `mancano ${mancano}` : "apre";
    return `<li><span>${nome}</span> <strong>${n}</strong> <small>${stato}</small></li>`;
  }).join("");
  return `<section class="classifica" aria-labelledby="classifica">${titolo}<ol>${righe}</ol><p class="nota">Solo i totali per città, da ${SOGLIA_CONTATORE} iscritti in su. Nessun nome.</p></section>`;
}

// Inserisce i numeri nei segnaposto; se non c'è nulla da mostrare l'HTML resta identico.
export function conNumeri(html, numeri, env) {
  const notaSeparata = html.includes(SEGNAPOSTO_POSTI_NOTA);
  const posti = htmlPosti(numeri, env, { conNota: !notaSeparata });
  const contatore = htmlContatore(numeri);
  if (posti && html.includes(SEGNAPOSTO_POSTI)) html = html.replace(SEGNAPOSTO_POSTI, posti);
  if (posti && notaSeparata) html = html.replace(SEGNAPOSTO_POSTI_NOTA, NOTA_POSTI);
  if (contatore && html.includes(SEGNAPOSTO_CONTATORE)) html = html.replace(SEGNAPOSTO_CONTATORE, contatore);
  return html;
}
