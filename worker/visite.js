// Worker Cloudflare «presente»: conta le visite e gli esiti dell'iscrizione nel database D1 (progetto/sviluppo-fase2).
// Niente pixel o script di terzi: solo le righe che servono per i numeri del CFO e di Growth (D1, D47, E10).
import { PROFILO_INSTAGRAM } from "./costanti.js";

const SORGENTI_AMMESSE = new Set([
  "instagram", "facebook", "tiktok", "youtube", "threads", "pinterest", "reddit", "meta", "creator", "amico", "whatsapp",
]);

const ROBOT = /bot|crawl|spider|facebookexternalhit|facebot|whatsapp|preview|curl|wget|python-requests|go-http-client|node(?!js)/i;

function ripulisci(valore) {
  if (typeof valore !== "string") return "";
  const v = valore.trim().slice(0, 64);
  return /^[a-z0-9_-]+$/i.test(v) ? v.toLowerCase() : "";
}

function sorgenteAmmessa(valore) {
  const v = ripulisci(valore);
  return SORGENTI_AMMESSE.has(v) ? v : "";
}

export function segui(richiesta) {
  const automatica = ROBOT.test(richiesta.headers.get("user-agent") || "");
  return new Response(null, { status: 302, headers: { location: PROFILO_INSTAGRAM, "cache-control": "no-store, max-age=0", "x-robots-tag": "noindex" } });
}
// «inizio» (2/11): chi tocca il primo campo del modulo della home (regola .modulo-eroe:focus-within in stile.css).
// L'immagine la chiede il foglio di stile, quindi il Referer è stile.css: la riga resta senza sorgente né campagna.
const PIXEL_PAGINE = { home: "home-persona", grazie: "grazie-persona", "da-meta": "da-meta-persona", inizio: "inizio" };

// VISITE DELLE GUIDE E DELLE PAGINE CITTÀ (esperimento E10 di Growth, 2/11): le pagine /guide/* e /incontri-al-buio/*
// hanno la stessa immagine 1×1 con ?pg=<percorso>. Conta solo un percorso di questo elenco chiuso (un test controlla che
// ogni pagina del sito ci sia), solo persone vere come home_persona, senza sorgente né campagna: riga «pagina:<percorso>».
const CITTA_PAGINE = ["bari", "bergamo", "bologna", "brescia", "cagliari", "catania", "firenze", "genova", "milano", "napoli",
  "padova", "palermo", "roma", "torino", "venezia", "verona"];
export const PAGINE_CONTATE = new Set([
  "/guide", "/guide/perche-le-app-di-incontri-deludono", "/guide/primo-appuntamento-al-buio",
  "/guide/red-flag-green-flag", "/guide/chi-paga-il-conto", "/guide/innamorarsi-di-una-voce",
  "/incontri-al-buio", ...CITTA_PAGINE.map((c) => `/incontri-al-buio/${c}`),
  // SEO v3 (2/11): pagine utili indicizzabili.
  "/app-incontri-sicura", "/primo-appuntamento", "/ghosting",
]);
const PREFISSO_PAGINA = "pagina:";
function rigaDelPixel(pg) {
  if (Object.prototype.hasOwnProperty.call(PIXEL_PAGINE, pg)) return PIXEL_PAGINE[pg];
  return PAGINE_CONTATE.has(pg) ? PREFISSO_PAGINA + pg : "";
}
