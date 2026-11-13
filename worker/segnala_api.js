// Segnalazioni (issue #7, passo 3, linea «sviluppatore-b»): la richiesta del Worker.
//
//   POST /app/api/segnala { contro?, motivo, origine, testo?, blocca?, chiamataIl? }
//        → { ok: true, ore, pericolo } | { ok: false, motivo }
//
// Chi segnala lo dice SOLO il token di Supabase: un «da» scritto nel corpo non conta. Le regole sono in
// api/segnala.js (e api/segnalazioni.js); qui solo accesso, forma della richiesta e codici di risposta.
// Al telefono tornano solo le ore di revisione e se mostrare il 112. Nei log solo nomi di errore, mai token o dati.
// Spento finché ACCESSO_APP non vale «si».
import { segnala, conosceDb, salvaDb } from "../api/segnala.js";

export const PERCORSO_SEGNALA = "/app/api/segnala";
const CORPO_MASSIMO = 8 * 1024; // racconto di 1000 caratteri al massimo, anche con caratteri di 4 byte
const ATTESA_SUPABASE_MS = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const RICHIESTA_SBAGLIATA = new Set(["dati"]);
const RIPROVA = new Set(["riprova"]);

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

function operazioniVere(env, f) {
  const d = { conosce: (q) => conosceDb(env, q, f), salva: (q) => salvaDb(env, q, f) };
  return { segnala: (q) => segnala(q, d) };
}

export async function segnalaApi(request, env, f = fetch, operazioni = null) {
  if (new URL(request.url).pathname !== PERCORSO_SEGNALA) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (request.method !== "POST") return risposta(405, { ok: false, motivo: "metodo" }, { allow: "POST" });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });

  const chi = await chiEDavvero(request, env, f);
  if (chi.errore) return chi.errore;
  const corpo = await leggiCorpo(request);
  if (corpo.errore) return corpo.errore;
  const op = operazioni || operazioniVere(env, f);
  try {
    const r = await op.segnala({ da: chi.id, corpo: corpo.dati, adesso: new Date() });
    if (r && r.ok) return risposta(200, { ok: true, ore: r.ore, pericolo: r.pericolo === true });
    const motivo = String((r && r.motivo) || "riprova");
    if (RICHIESTA_SBAGLIATA.has(motivo)) return risposta(400, { ok: false, motivo });
    if (RIPROVA.has(motivo)) return risposta(503, { ok: false, motivo: "riprova" });
    return risposta(200, { ok: false, motivo });
  } catch (e) {
    console.error("segnala: errore", e && e.name);
    return risposta(503, { ok: false, motivo: "riprova" });
  }
}

// Chi è lo dice Supabase leggendo il token (come in worker/chiamata_api.js): { id } oppure { errore: Response }.
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
    console.error("segnala: accesso", e && e.name);
    return { errore: risposta(503, { ok: false, motivo: "riprova" }) };
  }
}

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

// Limite di frequenza: stesso binding gratuito delle chiamate (LIMITE_PROVINCIA), chiave a parte. L'IP serve solo
// a contare in memoria, mai salvato.
async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "segnala:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}
