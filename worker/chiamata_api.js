// Chiamate solo voce (issue #4, passo 3b-2b-2b): le richieste del Worker per le chiamate.
//
//   POST /app/api/chiamata/apri  { verso, offerta } → { ok: true, descrizione, vista } | { ok: false, motivo }
//   GET  /app/api/chiamata       → { ok: true, vista }   (vista null se non c'è una chiamata)
//   POST /app/api/chiamata/rispondi { offerta } → { ok: true, descrizione, vista }   (solo chi riceve)
//   POST /app/api/chiamata/rifiuta  {}          → { ok: true, vista }                (solo chi riceve)
//   POST /app/api/chiamata/chiudi   { segnala } → { ok: true, vista[, segnala] }     (tutti e due; segnala solo se true)
//   POST /app/api/chiamata/ascolta  {}          → { ok: true, descrizione (offerta di Cloudflare), vista }  (tutti e due)
//   POST /app/api/chiamata/conferma { risposta } → { ok: true, vista }               (risposta del telefono, solo voce)
//   POST /app/api/chiamata/caduta   {}          → { ok: true, vista }                (ho perso la voce: partono i 30 s)
//   POST /app/api/chiamata/rientro  { offerta } → { ok: true, descrizione, vista }   («Riconnetti», solo voce)
//   POST /app/api/chiamata/carta    {}          → { ok: true, vista }                (pescata: vista.carta { id, testo, daMe })
//
// Chi chiama lo dice SOLO il token di Supabase: un «chi» scritto nel corpo non conta. Le regole (stanza, blocchi,
// 3 volte, 5 al giorno, fascia, solo voce) le applica api/apri_chiamata.js; qui solo accesso, forma della richiesta
// e codici di risposta. Al telefono solo ok/motivo, la risposta SDP e la vista: mai l'id della chiamata o le sessioni.
// Nei log solo nomi di errore, mai token, id, SDP o dati. Spento finché ACCESSO_APP non vale «si».
// Prossimo passo (3c): le schermate della chiamata nella web app.
import {
  apriChiamata, statoChiamata, rispondiChiamata, rifiutaChiamata, chiudiChiamata, ascoltaChiamata, confermaAscolto,
  cadutaChiamata, rientroChiamata, pescaCartaChiamata,
} from "../api/apri_chiamata.js";
import { stanzaDi, datiPerChiamare, carteAttiveDb, carteVisteDb, segnaCartaVista } from "../api/dati_chiamata.js";
import { nuovaSessione, pubblicaVoce, chiudiVoce, riceviVoce, confermaRisposta } from "../api/realtime.js";

export const PERCORSO_CHIAMATA = "/app/api/chiamata";
// Tutte POST con corpo JSON; «/app/api/chiamata» da solo è la GET dello stato.
const PASSI = new Set(["apri", "rispondi", "rifiuta", "chiudi", "ascolta", "conferma", "caduta", "rientro", "carta"]);
const CORPO_MASSIMO = 32 * 1024; // un'offerta solo voce sta sotto i 20 mila caratteri (api/realtime.js)
const ATTESA_SUPABASE_MS = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
// Motivi che vogliono dire «la richiesta è fatta male» o «il server non ce la fa adesso»; tutti gli altri «no»
// sono risposte delle regole (200), che l'app mostra con il suo testo.
const RICHIESTA_SBAGLIATA = new Set(["dati", "solo_voce"]);
const RIPROVA = new Set(["riprova", "realtime", "spento", "sessione", "mid"]);

function risposta(stato, corpo, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

function entro(ms, promessa) {
  let timer;
  return Promise.race([promessa, new Promise((_, no) => { timer = setTimeout(() => no(new Error("tempo scaduto")), ms); })])
    .finally(() => clearTimeout(timer));
}

// I pezzi veri: database (solo server), Realtime e Durable Object. Nei test si passano quelli finti.
export function dipendenze(env, f = fetch) {
  return {
    stanzaDi: (chi, adesso) => stanzaDi(env, chi, adesso, f),
    datiPerChiamare: (q) => datiPerChiamare(env, q, f),
    centralino: (idStanza) => env.CENTRALINO.get(env.CENTRALINO.idFromName(idStanza)),
    chiamata: (idChiamata) => env.CHIAMATA.get(env.CHIAMATA.idFromName(idChiamata)),
    nuovaSessione: () => nuovaSessione(env, f),
    pubblicaVoce: (sessione, offerta) => pubblicaVoce(env, sessione, offerta, f),
    chiudiSessione: (sessione, mids) => chiudiVoce(env, sessione, mids, f),
    riceviVoce: (mia, altra) => riceviVoce(env, mia, altra, f),
    confermaRisposta: (mia, risposta) => confermaRisposta(env, mia, risposta, f),
    nuovoId: () => crypto.randomUUID(),
    carte: () => carteAttiveDb(env, f),
    carteViste: (coppia) => carteVisteDb(env, coppia, f),
    segnaVista: (x) => segnaCartaVista(env, x, f),
    casuale: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
  };
}

function operazioniVere(env, f) {
  const d = dipendenze(env, f);
  return {
    apriChiamata: (dati) => apriChiamata(dati, d),
    statoChiamata: (dati) => statoChiamata(dati, d),
    rispondiChiamata: (dati) => rispondiChiamata(dati, d),
    rifiutaChiamata: (dati) => rifiutaChiamata(dati, d),
    chiudiChiamata: (dati) => chiudiChiamata(dati, d),
    ascoltaChiamata: (dati) => ascoltaChiamata(dati, d),
    confermaAscolto: (dati) => confermaAscolto(dati, d),
    cadutaChiamata: (dati) => cadutaChiamata(dati, d),
    rientroChiamata: (dati) => rientroChiamata(dati, d),
    pescaCarta: (dati) => pescaCartaChiamata(dati, d),
  };
}

export async function chiamataApi(request, env, f = fetch, operazioni = null) {
  const { pathname } = new URL(request.url);
  const passo = pathname.startsWith(PERCORSO_CHIAMATA + "/") ? pathname.slice(PERCORSO_CHIAMATA.length + 1) : null;
  if (pathname !== PERCORSO_CHIAMATA && !PASSI.has(passo)) return risposta(404, { ok: false, motivo: "non_trovato" });
  const metodo = passo ? "POST" : "GET";
  if (request.method !== metodo) return risposta(405, { ok: false, motivo: "metodo" }, { allow: metodo });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });

  const chi = await chiEDavvero(request, env, f);
  if (chi.errore) return chi.errore;
  const op = operazioni || operazioniVere(env, f);
  const adesso = new Date();

  try {
    if (!passo) {
      const r = await op.statoChiamata({ per: chi.id, adesso });
      if (!r || !r.ok) return risposta(r && RICHIESTA_SBAGLIATA.has(r.motivo) ? 400 : 503, { ok: false, motivo: "riprova" });
      return risposta(200, { ok: true, vista: r.vista ?? null });
    }
    const corpo = await leggiCorpo(request);
    if (corpo.errore) return corpo.errore;
    const { verso, offerta, segnala, risposta: rispostaSdp } = corpo.dati;
    const r = passo === "apri" ? await op.apriChiamata({ chi: chi.id, verso, offerta, adesso })
      : passo === "ascolta" ? await op.ascoltaChiamata({ per: chi.id, adesso })
      : passo === "conferma" ? await op.confermaAscolto({ per: chi.id, risposta: rispostaSdp, adesso })
      : passo === "caduta" ? await op.cadutaChiamata({ per: chi.id, adesso })
      : passo === "rientro" ? await op.rientroChiamata({ per: chi.id, offerta, adesso })
      : passo === "carta" ? await op.pescaCarta({ per: chi.id, adesso })
      : passo === "rispondi" ? await op.rispondiChiamata({ per: chi.id, offerta, adesso })
      : passo === "rifiuta" ? await op.rifiutaChiamata({ per: chi.id, adesso })
      : await op.chiudiChiamata({ per: chi.id, segnala: segnala === true, adesso });
    if (r && r.ok) {
      const fine = { ok: true };
      if (r.descrizione) fine.descrizione = r.descrizione;
      fine.vista = r.vista ?? null;
      if (r.segnala === true) fine.segnala = true;
      return risposta(200, fine);
    }
    const motivo = String((r && r.motivo) || "riprova");
    if (RICHIESTA_SBAGLIATA.has(motivo)) return risposta(400, { ok: false, motivo });
    if (RIPROVA.has(motivo)) return risposta(503, { ok: false, motivo: "riprova" });
    return risposta(200, { ok: false, motivo });
  } catch (e) {
    console.error("chiamata: errore", e && e.name);
    return risposta(503, { ok: false, motivo: "riprova" });
  }
}

// Chi è lo dice Supabase leggendo il token (come in worker/zona.js): { id } oppure { errore: Response }.
async function chiEDavvero(request, env, f) {
  const token = (request.headers.get("authorization") || "").match(/^Bearer ([A-Za-z0-9._-]{20,4096})$/);
  if (!token) return { errore: risposta(401, { ok: false, motivo: "accesso" }) };
  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const servizio = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!URL_SUPABASE.test(base) || !servizio) return { errore: risposta(503, { ok: false, motivo: "riprova" }) };
  try {
    const r = await entro(ATTESA_SUPABASE_MS, f(`${base}/auth/v1/user`, { headers: { apikey: servizio, authorization: `Bearer ${token[1]}` } }));
    if (r.status === 401 || r.status === 403) return { errore: risposta(401, { ok: false, motivo: "accesso" }) };
    if (!r.ok) return { errore: risposta(503, { ok: false, motivo: "riprova" }) };
    const id = String(((await r.json()) || {}).id || "");
    return UUID.test(id) ? { id } : { errore: risposta(401, { ok: false, motivo: "accesso" }) };
  } catch (e) {
    console.error("chiamata: accesso", e && e.name);
    return { errore: risposta(503, { ok: false, motivo: "riprova" }) };
  }
}

// Legge il corpo JSON senza mai tenerne in memoria più di CORPO_MASSIMO byte.
async function leggiCorpo(request) {
  const troppo = { errore: risposta(413, { ok: false, motivo: "troppo_grande" }) };
  const sbagliato = { errore: risposta(400, { ok: false, motivo: "dati" }) };
  const dichiarato = Number(request.headers.get("content-length"));
  if (Number.isFinite(dichiarato) && dichiarato > CORPO_MASSIMO) return troppo;
  if (!request.body) return sbagliato;
  const lettore = request.body.getReader();
  const pezzi = [];
  let totale = 0;
  for (;;) {
    const { done, value } = await lettore.read();
    if (done) break;
    totale += value.byteLength;
    if (totale > CORPO_MASSIMO) {
      try { await lettore.cancel(); } catch { /* niente da fare */ }
      return troppo;
    }
    pezzi.push(value);
  }
  const tutto = new Uint8Array(totale);
  let i = 0;
  for (const p of pezzi) { tutto.set(p, i); i += p.byteLength; }
  try {
    const dati = JSON.parse(new TextDecoder().decode(tutto));
    return dati && typeof dati === "object" && !Array.isArray(dati) ? { dati } : sbagliato;
  } catch {
    return sbagliato;
  }
}

// Limite di frequenza: stesso binding della provincia (LIMITE_PROVINCIA, gratuito), chiave a parte. L'IP serve solo
// a contare in memoria, mai salvato.
async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "chiamata:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}
