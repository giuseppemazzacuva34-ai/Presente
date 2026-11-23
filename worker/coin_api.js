// Coin del design v4 (issue #349, spec #331 v1.1 del CPO, punti 1 e 5). Passo 5b, linea «sviluppatore-b».
//
//   GET /app/api/coin → { ok, saldo, primaStanzaUsata, pagamenti }
//
// - saldo: saldo_crediti del database (mai calcolato qui).
// - primaStanzaUsata: prima_stanza_usata; il foglio «Coin quasi finiti» (schermata 21) non compare a chi non ha ancora
//   usato la prima stanza in regalo.
// - pagamenti: l'interruttore PAGAMENTI_GOMRY, spento di base. Si accende solo con una decisione di Giuseppe che
//   conferma commissioni Gomry, contratto dati (DPA) e ok del legale (D150 B). Questo file non chiama MAI Gomry né
//   altri servizi di pagamento: dice solo all'app se l'interruttore è acceso.
// Chi chiede lo dice SOLO il token di Supabase. Nei log solo nomi di funzioni e codici, mai token o persone.
// Spento finché ACCESSO_APP non vale «si».
import { chiEDavvero } from "./supporto_api.js";

export const PERCORSO_COIN = "/app/api/coin";
const ATTESA_SUPABASE_MS = 1500;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;

function risposta(stato, corpo, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
const riprova = () => risposta(503, { ok: false, motivo: "riprova" });

export const pagamentiAccesi = (env) => String((env && env.PAGAMENTI_GOMRY) ?? "") === "si";

function entro(ms, promessa) {
  let timer;
  return Promise.race([promessa, new Promise((_, no) => { timer = setTimeout(() => no(new Error("tempo scaduto")), ms); })])
    .finally(() => clearTimeout(timer));
}

async function rpc(env, nome, argomenti, f) {
  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const chiave = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  try {
    const r = await entro(ATTESA_SUPABASE_MS, f(`${base}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: { apikey: chiave, authorization: `Bearer ${chiave}`, "content-type": "application/json" },
      body: JSON.stringify(argomenti),
    }));
    if (!r.ok) {
      console.error(`coin: ${nome} risposta ${r.status}`);
      return undefined;
    }
    return await r.json();
  } catch (e) {
    console.error(`coin: ${nome} errore`, e && e.name);
    return undefined;
  }
}

// Limite di frequenza: stesso binding gratuito delle altre richieste, chiave a parte. L'IP serve solo a contare.
async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "coin:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}

export async function coinApi(request, env, f = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== PERCORSO_COIN) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (request.method !== "GET") return risposta(405, { ok: false, motivo: "metodo" }, { allow: "GET" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!URL_SUPABASE.test(base) || !String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim()) return riprova();

  const chi = await chiEDavvero(request, env, f);
  if (chi.errore) return chi.errore;

  const [saldo, primaStanzaUsata] = await Promise.all([
    rpc(env, "saldo_crediti", { p_persona: chi.id }, f),
    rpc(env, "prima_stanza_usata", { p_persona: chi.id }, f),
  ]);
  if (!Number.isInteger(saldo) || saldo < 0 || typeof primaStanzaUsata !== "boolean") return riprova();
  return risposta(200, { ok: true, saldo, primaStanzaUsata, pagamenti: pagamentiAccesi(env) });
}
