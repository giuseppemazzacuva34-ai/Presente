// Lavoro del lunedì (Fase 2, issue #3): legge chi ha confermato, forma le stanze, le scrive. Gira dalla GitHub Action
// «Stanze» (.github/workflows/stanze.yml) ogni lunedì alle 9 di Roma, costo zero.
//   node scripts/lavoro_lunedi.mjs            modo da MODO: «automatico» (solo lunedì 9:00–9:59 di Roma) o «prova»
// Spento finché ACCESSO_APP in wrangler.jsonc non vale «si». Il modo «prova» calcola e non scrive nulla.
// Nel log solo numeri (stanze, persone, motivi di attesa): mai id, nomi, età o province.
// I calcoli sono in api/settimana.js e api/stanze.js; la lettura e la scrittura nel database sono
// righe_settimana() e scrivi_settimana() (migrazione 20261108220000_lavoro_lunedi.sql, solo service_role).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { preparaSettimana } from "../api/settimana.js";
import { settimanaStanza, FUSO } from "../api/stanze.js";

// Lunedì tra le 9:00 e le 9:59 di Roma: la Action parte alle 7:05 e alle 8:05 UTC, così una delle due cade sempre
// alle 9 di Roma, d'estate e d'inverno; l'altra si ferma qui.
export function alleNoveDiLunedi(adesso) {
  const parti = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, weekday: "short", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(adesso).map((p) => [p.type, p.value]));
  return parti.weekday === "Mon" && parti.hour === "09";
}

// rpc(nome, argomenti) → risultato della funzione del database. Restituisce solo un riassunto in numeri.
export async function eseguiLunedi({ rpc, adesso = new Date(), accessoApp, modo = "automatico" }) {
  if (accessoApp !== "si") return { esito: "spento" };
  if (modo !== "prova" && !alleNoveDiLunedi(adesso)) return { esito: "fuori_orario" };

  // Automatico (lunedì alle 9): la stanza che apre adesso. Prova in un altro momento: la prossima apertura.
  let { apre, aperta } = settimanaStanza(adesso);
  if (aperta && !alleNoveDiLunedi(adesso)) apre = settimanaStanza(new Date(apre.getTime() + 7 * 86400000)).apre;
  const letto = await rpc("righe_settimana", { apre: apre.toISOString() });
  const aree = await rpc("conteggi_aree", {});
  const completiPerZona = Object.fromEntries((aree || []).map((a) => [a.codice, { totale: a.totale, donne: a.donne }]));

  const settimana = preparaSettimana({
    righe: letto.righe || [],
    iscrizioni: new Map(Object.entries(letto.iscrizioni || {})),
    stanzePrecedenti: new Map(Object.entries(letto.stanze_precedenti || {}).map(([id, n]) => [id, Number(n)])),
    storico: letto.storico || [],
    completiPerZona,
    adesso: apre,
  });

  const attesa = {};
  for (const a of settimana.attesa) attesa[a.motivo] = (attesa[a.motivo] || 0) + 1;
  const membri = settimana.stanze.reduce((s, x) => s + x.membri.length, 0);
  const riassunto = { stanze: settimana.stanze.length, membri, attesa };
  if (modo === "prova") return { esito: "prova", ...riassunto };

  const dati = {
    apre_il: settimana.apre_il, chiude_il: settimana.chiude_il,
    stanze: settimana.stanze.map((s) => ({ tipo: s.tipo, citta: s.citta, membri: s.membri.map((m) => ({ utente_id: m.utente_id, gratis: m.gratis })) })),
  };
  const scritto = await rpc("scrivi_settimana", { dati });
  if (scritto?.gia_fatta) return { esito: "gia_fatta", ...riassunto };
  return { esito: "scritto", ...riassunto, stanze: Number(scritto.stanze), membri: Number(scritto.membri) };
}

export function accessoDaWrangler(testo) {
  return /"ACCESSO_APP"\s*:\s*"([a-z]+)"/.exec(testo)?.[1] ?? "no";
}

const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;

async function principale() {
  const radice = fileURLToPath(new URL("..", import.meta.url));
  const accessoApp = accessoDaWrangler(readFileSync(`${radice}wrangler.jsonc`, "utf8"));
  const modo = process.env.MODO === "prova" ? "prova" : "automatico";
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const chiave = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const rpc = async (nome, argomenti) => {
    if (!URL_SUPABASE.test(url) || !chiave) throw new Error("Segreti Supabase mancanti.");
    const r = await fetch(`${url}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: { apikey: chiave, authorization: `Bearer ${chiave}`, "content-type": "application/json" },
      body: JSON.stringify(argomenti),
      signal: AbortSignal.timeout(30000),
    });
    // Mai il corpo della risposta nel log: potrebbe contenere dati. Solo il nome della funzione e il codice.
    if (!r.ok) throw new Error(`${nome}: risposta ${r.status}`);
    return r.json();
  };
  const esito = await eseguiLunedi({ rpc, accessoApp, modo });
  console.log(JSON.stringify(esito));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principale().catch((e) => {
    console.error(`Lavoro del lunedì non riuscito: ${String(e?.message || "errore").slice(0, 120)}`);
    process.exit(1);
  });
}
