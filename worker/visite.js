// Contatore delle visite (decisione D43, opzione A): quante volte si aprono la home "/" e la pagina "/grazie", per giorno.
// Serve a misurare quante visite diventano iscrizioni (anche per le sponsorizzate Meta con utm_source/utm_campaign).
// Solo totali in D1: nessun IP, cookie, user agent o referrer salvato, nessuno script nella pagina.
import { CANALI, canaleValido } from "./canale.js";
import { tipoRichiesta } from "./automatiche.js";

const PAGINE = { "/": "home", "/grazie": "grazie", "/grazie.html": "grazie", "/da/meta": "da-meta", "/da/meta/": "da-meta" };

// Sorgenti utm ammesse: i canali dei link /da più google, pinterest e reddit (Growth, 1/11) e threads (2/11); tutto il resto diventa "altro".
const SORGENTI = new Set([...CANALI, "google", "pinterest", "reddit", "threads"]);

const SCHEMA = `CREATE TABLE IF NOT EXISTS visite_pagina (
  pagina TEXT NOT NULL,
  giorno TEXT NOT NULL,
  sorgente TEXT NOT NULL DEFAULT '',
  campagna TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pagina, giorno, sorgente, campagna)
)`;
const PIU_UNO = "INSERT INTO visite_pagina (pagina, giorno, sorgente, campagna, n) VALUES (?, ?, ?, ?, 1) ON CONFLICT(pagina, giorno, sorgente, campagna) DO UPDATE SET n = n + 1";

function pulisci(valore) {
  return String(valore || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
}

// utm_source: solo sorgenti dell'elenco (altrimenti "altro"). utm_campaign: solo le campagne in CAMPAGNE_UTM
// (wrangler.jsonc, separate da virgola), altrimenti "altro". Così nessuno può riempire il database con valori inventati.
export function etichetteUtm(parametri, env) {
  const s = pulisci(parametri.get("utm_source"));
  const c = pulisci(parametri.get("utm_campaign"));
  const campagne = new Set(String((env && env.CAMPAGNE_UTM) || "").split(",").map(pulisci).filter(Boolean));
  return {
    sorgente: !s ? "" : SORGENTI.has(s) ? s : "altro",
    campagna: !c ? "" : campagne.has(c) ? c : "altro",
  };
}

// Restituisce la promessa del conteggio (o null se la richiesta non va contata). Non lancia mai errori.
// Le richieste HEAD non contano mai. Anteprime dei link e robot (vedi automatiche.js) finiscono nella riga "automatiche";
// i precaricamenti fatti da un telefono vero (inserzioni Meta) nella riga "precaricate", con giorno e utm,
// così "home" e "grazie" restano solo persone sicure e le visite delle sponsorizzate non spariscono.
// Sorgente: utm_source se c'è, altrimenti il canale di ?da= (link /da/<canale> e pagina /grazie dopo l'iscrizione).
export function contaVisitaPagina(request, env) {
  const url = new URL(request.url);
  const paginaVera = PAGINE[url.pathname];
  if (!paginaVera || !env.DB || request.method !== "GET") return null;
  const tipo = tipoRichiesta(request);
  const pagina = tipo === "persona" ? paginaVera : tipo === "precaricata" ? "precaricate" : "automatiche";
  const utm = etichetteUtm(url.searchParams, env);
  const sorgente = utm.sorgente || canaleValido(url.searchParams.get("da"));
  const campagna = utm.campagna;
  const giorno = new Date().toISOString().slice(0, 10);
  return (async () => {
    try {
      await env.DB.prepare(SCHEMA).run();
      await env.DB.prepare(PIU_UNO).bind(pagina, giorno, sorgente, campagna).run();
    } catch (errore) {
      console.error("visite: contatore non aggiornato", errore && errore.name);
    }
  })();
}

// MISURA VERA (D79 A, punto 1, dal 1/11): una visita conta come «persona» solo se il browser carica anche l'immagine
// trasparente 1×1 della pagina (<img src="/p.gif?pg=home">). Anteprime dei link, robot e precaricamenti di solito scaricano
// l'HTML ma non le immagini; e anche qui si scartano gli user agent automatici (automatiche.js).
// Righe «home-persona» e «grazie-persona» in visite_pagina. Sorgente e campagna si leggono dall'intestazione Referer
// (l'indirizzo della pagina che ha chiesto l'immagine: utm_source, utm_campaign o ?da=), passano dagli stessi elenchi
// chiusi di sopra e il Referer si butta. Niente cookie, IP o user agent salvati; l'immagine non va mai in cache.
export const PERCORSO_PIXEL = "/p.gif";

// PULSANTE «SEGUI @presente_app» (D82 A, dal 1/11): il link della pagina grazie passa da /segui, che conta il clic
// (riga «grazie-ig» in visite_pagina, solo persone vere, senza sorgente né campagna) e rimanda al profilo Instagram.
// Nessun dato salvato oltre al totale del giorno; il rimando non va mai in cache, così ogni clic arriva al Worker.
export const PERCORSO_SEGUI = "/segui";
export const PROFILO_INSTAGRAM = "https://www.instagram.com/presente_app/";

export async function segui(request, env, ctx) {
  if (request.method === "GET" && env.DB && tipoRichiesta(request) === "persona") {
    const giorno = new Date().toISOString().slice(0, 10);
    const conto = (async () => {
      try {
        await env.DB.prepare(SCHEMA).run();
        // /segui?da=meta = pulsante della pagina /da/meta (D92 A): riga «segui_ig»; ogni altro clic resta «grazie-ig».
        const riga = new URL(request.url).searchParams.get("da") === "meta" ? "segui_ig" : "grazie-ig";
        await env.DB.prepare(PIU_UNO).bind(riga, giorno, "", "").run();
      } catch (errore) {
        console.error("visite: clic Instagram non contato", errore && errore.name);
      }
    })();
    if (ctx && ctx.waitUntil) ctx.waitUntil(conto);
    else await conto;
  }
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
  "/guide/red-flag-green-flag",
  "/incontri-al-buio", ...CITTA_PAGINE.map((c) => `/incontri-al-buio/${c}`),
  // SEO v3 (2/11): pagine utili indicizzabili.
  "/app-incontri-sicura", "/primo-appuntamento", "/ghosting",
]);
const PREFISSO_PAGINA = "pagina:";
function rigaDelPixel(pg) {
  if (Object.prototype.hasOwnProperty.call(PIXEL_PAGINE, pg)) return PIXEL_PAGINE[pg];
  return PAGINE_CONTATE.has(pg) ? PREFISSO_PAGINA + pg : "";
}
// GIF trasparente di 1×1 pixel (42 byte).
const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));

export function etichettePixel(request, env) {
  let parametri = new URLSearchParams();
  try {
    const da = new URL(request.headers.get("referer") || "");
    if (da.host === new URL(request.url).host) parametri = da.searchParams;
  } catch {
    // nessun Referer o Referer non valido: nessuna sorgente
  }
  const utm = etichetteUtm(parametri, env);
  return { sorgente: utm.sorgente || canaleValido(parametri.get("da")), campagna: utm.campagna };
}

export async function pixel(request, env, ctx) {
  const pagina = rigaDelPixel(String(new URL(request.url).searchParams.get("pg") || ""));
  if (pagina && env.DB && tipoRichiesta(request) === "persona") {
    const { sorgente, campagna } = pagina.startsWith(PREFISSO_PAGINA) ? { sorgente: "", campagna: "" } : etichettePixel(request, env);
    const giorno = new Date().toISOString().slice(0, 10);
    const conto = (async () => {
      try {
        await env.DB.prepare(SCHEMA).run();
        await env.DB.prepare(PIU_UNO).bind(pagina, giorno, sorgente, campagna).run();
      } catch (errore) {
        console.error("visite: pixel non contato", errore && errore.name);
      }
    })();
    if (ctx && ctx.waitUntil) ctx.waitUntil(conto);
    else await conto;
  }
  return new Response(request.method === "HEAD" ? null : GIF, {
    headers: { "content-type": "image/gif", "cache-control": "no-store, max-age=0", "x-robots-tag": "noindex" },
  });
}

const CHIAVI_CONTEGGIO = { home: "home", grazie: "grazie", precaricate: "precaricate", "home-persona": "home_persona", "grazie-persona": "grazie_persona", "grazie-ig": "grazie_ig",
  "da-meta": "da_meta", "da-meta-persona": "da_meta_persona", segui_ig: "segui_ig", inizio: "inizio" };
const nuovaRiga = () => ({ home: 0, grazie: 0, home_persona: 0, grazie_persona: 0, precaricate: 0, grazie_ig: 0, da_meta: 0, da_meta_persona: 0, segui_ig: 0, inizio: 0, per_pagina: {} });

// Numeri per /conteggio: totali per pagina, per giorno e per sorgente/campagna utm. Solo numeri.
export async function perVisite(env) {
  const vuoto = { home: 0, grazie: 0, home_persona: 0, grazie_persona: 0, precaricate: 0, grazie_ig: 0, da_meta: 0, da_meta_persona: 0, segui_ig: 0, inizio: 0, automatiche: 0, per_giorno: {}, per_utm: {}, per_pagina: {} };
  if (!env.DB) return vuoto;
  try {
    const righe = await env.DB.prepare(
      "SELECT pagina, giorno, sorgente, campagna, SUM(n) AS n FROM visite_pagina GROUP BY pagina, giorno, sorgente, campagna"
    ).all();
    for (const r of righe.results || []) {
      const n = r.n || 0;
      if (r.pagina === "automatiche") {
        vuoto.automatiche += n;
        continue;
      }
      if (String(r.pagina).startsWith(PREFISSO_PAGINA)) {
        // E10: totale per percorso e, per giorno, { percorso: n } dentro per_giorno[giorno].per_pagina.
        const percorso = r.pagina.slice(PREFISSO_PAGINA.length);
        if (!PAGINE_CONTATE.has(percorso)) continue;
        vuoto.per_pagina[percorso] = (vuoto.per_pagina[percorso] || 0) + n;
        const g = (vuoto.per_giorno[r.giorno] ||= nuovaRiga());
        g.per_pagina[percorso] = (g.per_pagina[percorso] || 0) + n;
        continue;
      }
      const voce = CHIAVI_CONTEGGIO[r.pagina];
      if (!voce) continue;
      vuoto[voce] += n;
      const g = (vuoto.per_giorno[r.giorno] ||= nuovaRiga());
      g[voce] += n;
      if (r.sorgente || r.campagna) {
        const chiave = `${r.sorgente || "-"}/${r.campagna || "-"}`;
        const u = (vuoto.per_utm[chiave] ||= nuovaRiga());
        delete u.per_pagina;
        u[voce] += n;
      }
    }
  } catch {
    // La tabella nasce con la prima visita.
  }
  return vuoto;
}

// E10, punto 2: accanto a home_persona di ogni giorno, gli invii del modulo del sito (nuove + già in lista: persone che
// hanno premuto il pulsante con dati validi) e le iscrizioni nuove. Così la conversione si legge da sola. Solo numeri.
export function conInvii(visite, esiti) {
  for (const [giorno, e] of Object.entries(esiti || {})) {
    const g = (visite.per_giorno[giorno] ||= nuovaRiga());
    g.iscrizioni_nuove = e.nuova || 0;
    g.invii_modulo = (e.nuova || 0) + (e.gia_in_lista || 0);
  }
  return visite;
}
