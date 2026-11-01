// Contatore delle visite (decisione D43, opzione A): quante volte si aprono la home "/" e la pagina "/grazie", per giorno.
// Serve a misurare quante visite diventano iscrizioni (anche per le sponsorizzate Meta con utm_source/utm_campaign).
// Solo totali in D1: nessun IP, cookie, user agent o referrer salvato, nessuno script nella pagina.
import { CANALI, canaleValido } from "./canale.js";
import { tipoRichiesta } from "./automatiche.js";

const PAGINE = { "/": "home", "/grazie": "grazie", "/grazie.html": "grazie" };

// Sorgenti utm ammesse: i canali dei link /da più google; tutto il resto diventa "altro".
const SORGENTI = new Set([...CANALI, "google"]);

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
const PIXEL_PAGINE = { home: "home-persona", grazie: "grazie-persona" };
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
  const pagina = PIXEL_PAGINE[new URL(request.url).searchParams.get("pg")];
  if (pagina && env.DB && tipoRichiesta(request) === "persona") {
    const { sorgente, campagna } = etichettePixel(request, env);
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

const CHIAVI_CONTEGGIO = { home: "home", grazie: "grazie", precaricate: "precaricate", "home-persona": "home_persona", "grazie-persona": "grazie_persona" };
const nuovaRiga = () => ({ home: 0, grazie: 0, home_persona: 0, grazie_persona: 0, precaricate: 0 });

// Numeri per /conteggio: totali per pagina, per giorno e per sorgente/campagna utm. Solo numeri.
export async function perVisite(env) {
  const vuoto = { home: 0, grazie: 0, home_persona: 0, grazie_persona: 0, precaricate: 0, automatiche: 0, per_giorno: {}, per_utm: {} };
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
      const voce = CHIAVI_CONTEGGIO[r.pagina];
      if (!voce) continue;
      vuoto[voce] += n;
      const g = (vuoto.per_giorno[r.giorno] ||= nuovaRiga());
      g[voce] += n;
      if (r.sorgente || r.campagna) {
        const chiave = `${r.sorgente || "-"}/${r.campagna || "-"}`;
        const u = (vuoto.per_utm[chiave] ||= nuovaRiga());
        u[voce] += n;
      }
    }
  } catch {
    // La tabella nasce con la prima visita.
  }
  return vuoto;
}
