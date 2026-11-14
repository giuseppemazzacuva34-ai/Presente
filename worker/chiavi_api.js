// Chiavi e sera delle porte (issue #5, spec v1.1 del CPO; D14 A, D51 A). Passo 5b, linea «sviluppatore-c».
//
//   GET  /app/api/chiavi       → { ok, stanza, chiude_il?, chiuse?, restanti?, date? }   (stato_chiavi)
//   POST /app/api/chiavi       { azione: "dai" | "riprendi" | "frase", a, frase? }
//                              → { ok: true, stato } | { ok: false, motivo, testo }
//   GET  /app/api/chiavi/sera  → { ok, stato: "nessuna" | "attesa" | "pronta", porte?, testo? }   (sera_di)
//
// Chi è lo dice SOLO il token di Supabase: un «da» scritto nel corpo non conta. Tutte le regole (2 chiavi, solo a
// chi hai chiamato, frase senza contatti, chiuse dalle 20:59:00, blocchi) le applica il database con le funzioni
// della migrazione 20261113161516_chiavi.sql; qui solo accesso, forma della richiesta e testi per l'utente.
// Nessuno scopre un no: al telefono tornano solo le chiavi date da chi chiede e le porte aperte, mai le ricevute.
// Nei log solo nomi di errore e codici, mai token, persone o frasi. Spento finché ACCESSO_APP non vale «si».
import { TESTI_CHIAVI } from "../api/chiavi.js";

export const PERCORSO_CHIAVI = "/app/api/chiavi";
const PERCORSO_SERA = PERCORSO_CHIAVI + "/sera";
const CORPO_MASSIMO = 2 * 1024; // frase di 140 caratteri al massimo, anche con caratteri di 4 byte
const ATTESA_SUPABASE_MS = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const FUNZIONI = { dai: "dai_chiave", riprendi: "riprendi_chiave", frase: "cambia_frase" };
const TESTI = {
  chiuse: TESTI_CHIAVI.chiuse,
  contatti: TESTI_CHIAVI.contatti,
  troppo_lunga: TESTI_CHIAVI.troppoLunga,
  finite: TESTI_CHIAVI.finite,
  non_chiamato: TESTI_CHIAVI.nonChiamato,
  non_nella_stanza: TESTI_CHIAVI.nonNellaStanza,
};

function risposta(stato, corpo, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
const riprova = () => risposta(503, { ok: false, motivo: "riprova" });

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

// Una funzione del database (solo ruolo di servizio). Restituisce il valore, oppure undefined se qualcosa non va.
async function rpc(s, nome, argomenti, f) {
  try {
    const r = await entro(ATTESA_SUPABASE_MS, f(`${s.base}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: { apikey: s.chiave, authorization: `Bearer ${s.chiave}`, "content-type": "application/json" },
      body: JSON.stringify(argomenti),
    }));
    if (!r.ok) {
      console.error(`chiavi: ${nome} risposta ${r.status}`);
      return undefined;
    }
    return await r.json();
  } catch (e) {
    console.error(`chiavi: ${nome} errore`, e && e.name);
    return undefined;
  }
}

export async function chiaviApi(request, env, f = fetch) {
  const { pathname } = new URL(request.url);
  if (pathname !== PERCORSO_CHIAVI && pathname !== PERCORSO_SERA) return risposta(404, { ok: false, motivo: "non_trovato" });
  const ammessi = pathname === PERCORSO_SERA ? "GET" : "GET, POST";
  if (!ammessi.split(", ").includes(request.method)) return risposta(405, { ok: false, motivo: "metodo" }, { allow: ammessi });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const s = server(env);
  if (!s) return riprova();

  const chi = await chiEDavvero(request, s, f);
  if (chi.errore) return chi.errore;

  if (pathname === PERCORSO_SERA) {
    const sera = await rpc(s, "sera_di", { p_utente: chi.id }, f);
    if (!sera || typeof sera !== "object" || !["nessuna", "attesa", "pronta"].includes(sera.stato)) return riprova();
    if (sera.stato !== "pronta") return risposta(200, { ok: true, stato: sera.stato });
    const porte = Array.isArray(sera.porte) ? sera.porte : [];
    // Chi non ha porte vede sempre lo stesso testo, che abbia dato chiavi o no.
    return risposta(200, porte.length ? { ok: true, stato: "pronta", porte } : { ok: true, stato: "pronta", porte, testo: TESTI_CHIAVI.nessunaPorta });
  }

  if (request.method === "GET") {
    const stato = await rpc(s, "stato_chiavi", { p_utente: chi.id }, f);
    return stato && typeof stato === "object" ? risposta(200, { ok: true, ...stato }) : riprova();
  }

  const corpo = await leggiCorpo(request);
  if (corpo.errore) return corpo.errore;
  const { azione, a, frase } = corpo.dati;
  if (!Object.hasOwn(FUNZIONI, azione) || !UUID.test(String(a || "")) || (frase != null && typeof frase !== "string")) {
    return risposta(400, { ok: false, motivo: "dati" });
  }
  const argomenti = azione === "riprendi" ? { p_da: chi.id, p_a: a } : { p_da: chi.id, p_a: a, p_frase: frase ?? null };
  const esito = await rpc(s, FUNZIONI[azione], argomenti, f);
  if (typeof esito !== "string") return riprova();
  if (esito !== "ok") return risposta(200, { ok: false, motivo: esito, testo: TESTI[esito] ?? null });
  const stato = await rpc(s, "stato_chiavi", { p_utente: chi.id }, f);
  return risposta(200, { ok: true, stato: stato && typeof stato === "object" ? stato : null });
}

// Chi è lo dice Supabase leggendo il token (come in worker/chiamata_api.js): { id } oppure { errore: Response }.
async function chiEDavvero(request, s, f) {
  const token = (request.headers.get("authorization") || "").match(/^Bearer ([A-Za-z0-9._-]{20,4096})$/);
  if (!token) return { errore: risposta(401, { ok: false, motivo: "accesso" }) };
  try {
    const r = await entro(ATTESA_SUPABASE_MS, f(`${s.base}/auth/v1/user`, { headers: { apikey: s.chiave, authorization: `Bearer ${token[1]}` } }));
    if (r.status === 401 || r.status === 403) return { errore: risposta(401, { ok: false, motivo: "accesso" }) };
    if (!r.ok) return { errore: riprova() };
    const id = String(((await r.json()) || {}).id || "");
    return UUID.test(id) ? { id } : { errore: risposta(401, { ok: false, motivo: "accesso" }) };
  } catch (e) {
    console.error("chiavi: accesso", e && e.name);
    return { errore: riprova() };
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
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "chiavi:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}
