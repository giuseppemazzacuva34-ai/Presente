// Contatore delle visite (decisione D43, opzione A): quante volte si aprono la home "/" e la pagina "/grazie", per giorno.
// Serve a misurare quante visite diventano iscrizioni (anche per le sponsorizzate Meta con utm_source/utm_campaign).
// Solo totali in D1: nessun IP, cookie, user agent o referrer salvato, nessuno script nella pagina.
import { CANALI, canaleValido } from "./canale.js";
import { richiestaAutomatica } from "./automatiche.js";

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
// Le richieste HEAD non contano mai. Anteprime dei link, robot e prefetch (vedi automatiche.js) finiscono in una riga a parte, pagina "automatiche",
// così i numeri di "home" e "grazie" sono solo persone e si vede quanto rumore è stato scartato.
// Sorgente: utm_source se c'è, altrimenti il canale di ?da= (link /da/<canale> e pagina /grazie dopo l'iscrizione).
export function contaVisitaPagina(request, env) {
  const url = new URL(request.url);
  const paginaVera = PAGINE[url.pathname];
  if (!paginaVera || !env.DB || request.method !== "GET") return null;
  const pagina = richiestaAutomatica(request) ? "automatiche" : paginaVera;
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

// Numeri per /conteggio: totali per pagina, per giorno e per sorgente/campagna utm. Solo numeri.
export async function perVisite(env) {
  const vuoto = { home: 0, grazie: 0, automatiche: 0, per_giorno: {}, per_utm: {} };
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
      if (r.pagina !== "home" && r.pagina !== "grazie") continue;
      vuoto[r.pagina] += n;
      const g = (vuoto.per_giorno[r.giorno] ||= { home: 0, grazie: 0 });
      g[r.pagina] += n;
      if (r.sorgente || r.campagna) {
        const chiave = `${r.sorgente || "-"}/${r.campagna || "-"}`;
        const u = (vuoto.per_utm[chiave] ||= { home: 0, grazie: 0 });
        u[r.pagina] += n;
      }
    }
  } catch {
    // La tabella nasce con la prima visita.
  }
  return vuoto;
}
