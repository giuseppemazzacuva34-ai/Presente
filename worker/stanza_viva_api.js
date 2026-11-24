// Stanza viva (issue #380, spec v1 del CPO del 23/11, design v4 schermata 19), passo 4a della linea CTO.
//
//   POST /app/api/stanza/presenza   → 200 { ok, inStanza } — il segnale dell'app aperta e visibile (ogni 30 s)
//   GET  /app/api/stanza/presenza   → 200 { ok, persone: [{ id, stato, testo, con, gruppo }] } — lo stato della stanza
//     («gruppo» = metà del cerchio, passo 5a: «uomini» | «donne» | «altre», da gruppi_stanza, migrazione 20261124212000)
//     → 401 accesso | 404 spento | 405 metodo | 429 troppe | 503 riprova
//
// Chi è lo dice SOLO il token di Supabase (mai il corpo o l'indirizzo). Chi si vede lo decide il database
// (segnala_presenza, stati_stanza, migrazione 20261123123000): stessa stanza aperta, compatibili, senza blocchi, non
// sospesi; «con» solo se anche l'altra persona è visibile a chi guarda. Il Worker trasforma l'ultimo segnale in
// «online» (≤ 60 s) o «non in linea · da …» con le regole di api/appuntamenti.js: al telefono mai l'ora esatta e mai
// la pausa («Oggi non ricevo chiamate» non passa di qui). Niente storico: il database tiene solo l'ultimo segnale.
// Nei log solo codici e nomi di errore, mai token o id. Spento finché ACCESSO_APP non vale «si».

import { statoPresenza, testoNonInLinea } from "../api/appuntamenti.js";

export const PERCORSO_STANZA_VIVA = "/app/api/stanza/presenza";
const ATTESA_MS = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const TESTI_STATO = Object.freeze({ online: "online", in_chiamata: "in chiamata" });

function risposta(stato, corpo, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
const riprova = () => risposta(503, { ok: false, motivo: "riprova" });
const accesso = () => risposta(401, { ok: false, motivo: "accesso" });

function entro(ms, promessa) {
  let timer;
  return Promise.race([promessa, new Promise((_, no) => { timer = setTimeout(() => no(new Error("tempo scaduto")), ms); })])
    .finally(() => clearTimeout(timer));
}

function server(env) {
  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const chiave = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return URL_SUPABASE.test(base) && chiave ? { base, chiave } : null;
}

async function chiEDavvero(request, s, f) {
  const token = (request.headers.get("authorization") || "").match(/^Bearer ([A-Za-z0-9._-]{20,4096})$/);
  if (!token) return { errore: accesso() };
  try {
    const r = await entro(ATTESA_MS, f(`${s.base}/auth/v1/user`, { headers: { apikey: s.chiave, authorization: `Bearer ${token[1]}` } }));
    if (r.status === 401 || r.status === 403) return { errore: accesso() };
    if (!r.ok) return { errore: riprova() };
    const id = String(((await r.json()) || {}).id || "");
    return UUID.test(id) ? { id } : { errore: accesso() };
  } catch (e) {
    console.error("stanza_viva: accesso", e && e.name);
    return { errore: riprova() };
  }
}

async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "stanza-viva:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}

// → valore restituito dalla funzione, oppure undefined (errore).
async function rpc(s, funzione, p_persona, f) {
  try {
    const r = await entro(ATTESA_MS, f(`${s.base}/rest/v1/rpc/${funzione}`, {
      method: "POST",
      headers: { apikey: s.chiave, authorization: `Bearer ${s.chiave}`, "content-type": "application/json" },
      body: JSON.stringify({ p_persona }),
    }));
    if (!r.ok) {
      console.error("stanza_viva: database", funzione, r.status);
      return undefined;
    }
    return await r.json();
  } catch (e) {
    console.error("stanza_viva: database", funzione, e && e.name);
    return undefined;
  }
}

const dataValida = (v) => v === null || (typeof v === "string" && !Number.isNaN(Date.parse(v)));

// Righe di stati_stanza → persone per il telefono. undefined se una riga non ha la forma attesa.
export function personeDaRighe(righe, adesso = new Date()) {
  if (!Array.isArray(righe)) return undefined;
  const persone = [];
  for (const r of righe) {
    const { utente_id: id, ultimo_segnale: segnale, in_chiamata: inChiamata, in_chiamata_con: con } = r || {};
    if (!UUID.test(String(id || "")) || !dataValida(segnale) || typeof inChiamata !== "boolean"
      || !(con === null || UUID.test(String(con)))) {
      console.error("stanza_viva: riga non valida");
      return undefined;
    }
    const { stato } = statoPresenza({ ultimoSegnale: segnale, inChiamata, adesso });
    const testo = stato === "non_in_linea" ? testoNonInLinea(segnale, adesso) : TESTI_STATO[stato];
    persone.push({ id, stato, testo, con: stato === "in_chiamata" ? con : null });
  }
  return persone;
}

const GRUPPI = new Set(["uomini", "donne", "altre"]);

// Righe di gruppi_stanza → Map id → gruppo. undefined se la risposta non ha la forma attesa. Un valore diverso dai tre
// previsti diventa «altre» (mai la descrizione scritta a mano al telefono).
export function gruppiDaRighe(righe) {
  if (!Array.isArray(righe)) return undefined;
  const gruppi = new Map();
  for (const r of righe) {
    const id = String((r || {}).utente_id || "");
    if (!UUID.test(id)) {
      console.error("stanza_viva: gruppo non valido");
      return undefined;
    }
    gruppi.set(id, GRUPPI.has(r.gruppo) ? r.gruppo : "altre");
  }
  return gruppi;
}

export async function stanzaVivaApi(request, env, f = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== PERCORSO_STANZA_VIVA) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (request.method !== "GET" && request.method !== "POST") return risposta(405, { ok: false, motivo: "metodo" }, { allow: "GET, POST" });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const s = server(env);
  if (!s) return riprova();

  const chi = await chiEDavvero(request, s, f);
  if (chi.errore) return chi.errore;

  if (request.method === "POST") {
    const fatto = await rpc(s, "segnala_presenza", chi.id, f);
    if (typeof fatto !== "boolean") return riprova();
    return risposta(200, { ok: true, inStanza: fatto });
  }
  const [stati, righeGruppi] = await Promise.all([rpc(s, "stati_stanza", chi.id, f), rpc(s, "gruppi_stanza", chi.id, f)]);
  const persone = personeDaRighe(stati);
  const gruppi = gruppiDaRighe(righeGruppi);
  if (!persone || !gruppi) return riprova();
  return risposta(200, { ok: true, persone: persone.map((p) => ({ ...p, gruppo: gruppi.get(p.id) || "altre" })) });
}
