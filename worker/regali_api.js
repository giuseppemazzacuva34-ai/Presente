// Regali nelle stanze (issue #331, spec v1 del CPO, parte C; D145 A). Passo 5, linea «sviluppatore-c».
//
//   GET  /app/api/regali          → { ok, saldo, avvisi: [{ id, da, regalo, testo }] }   (saldo_crediti, regali_da_vedere)
//   GET  /app/api/regali?da=<id>  → { ok, ricevuti: [{ regalo, quanti }], testo }        (regali_ricevuti_da)
//   POST /app/api/regali          { azione: "manda", a, regalo, chiave } → { ok: true, saldo } | { ok: false, motivo, testo }
//                                 { azione: "visti", ids: [...] }        → { ok: true }    (segna_regali_visti)
//
// Chi manda e chi riceve lo dice SOLO il token di Supabase: un «da» scritto nel corpo non conta. Tutte le regole
// (stanza aperta, stessa stanza, compatibili, blocchi, segnalazioni, sospensioni, 3 e 10 al giorno, saldo, doppio
// tocco con la stessa chiave) le applica il database con manda_regalo (migrazione 20261122105601_regali.sql).
// Blocco, segnalazione, sospensione, fuori stanza e non compatibile tornano tutti come «non_puoi» con lo stesso
// testo: chi è bloccato o segnalato non lo scopre. In beta i Coin sono di prova: nessun pagamento, nessun servizio
// esterno. Nei log solo nomi di funzioni e codici, mai token o persone. Spento finché ACCESSO_APP non vale «si».
import { REGALI, TESTI_COIN, avvisoRegalo, ricevutiTesto, tiMancano } from "../api/coin.js";

export const PERCORSO_REGALI = "/app/api/regali";
const CORPO_MASSIMO = 4 * 1024; // al massimo 50 id da 36 caratteri
const VISTI_MASSIMO = 50;
const ATTESA_SUPABASE_MS = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const NASCOSTI = new Set(["blocco", "segnalazione", "sospensione", "non_nella_stanza", "non_compatibile"]);
const PREZZO = new Map(REGALI.map((r) => [r.id, r.coin]));

function risposta(stato, corpo, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
const riprova = () => risposta(503, { ok: false, motivo: "riprova" });
const dati = () => risposta(400, { ok: false, motivo: "dati" });

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

async function rpc(s, nome, argomenti, f) {
  try {
    const r = await entro(ATTESA_SUPABASE_MS, f(`${s.base}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: { apikey: s.chiave, authorization: `Bearer ${s.chiave}`, "content-type": "application/json" },
      body: JSON.stringify(argomenti),
    }));
    if (!r.ok) {
      console.error(`regali: ${nome} risposta ${r.status}`);
      return undefined;
    }
    return await r.json();
  } catch (e) {
    console.error(`regali: ${nome} errore`, e && e.name);
    return undefined;
  }
}

export async function regaliApi(request, env, f = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== PERCORSO_REGALI) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (request.method !== "GET" && request.method !== "POST") return risposta(405, { ok: false, motivo: "metodo" }, { allow: "GET, POST" });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const s = server(env);
  if (!s) return riprova();

  const chi = await chiEDavvero(request, s, f);
  if (chi.errore) return chi.errore;

  if (request.method === "GET") {
    if (url.searchParams.has("da")) {
      const da = String(url.searchParams.get("da") || "");
      if (!UUID.test(da)) return dati();
      const ricevuti = await rpc(s, "regali_ricevuti_da", { p_persona: chi.id, p_da: da }, f);
      if (!Array.isArray(ricevuti)) return riprova();
      const lista = ricevuti.filter((x) => x && PREZZO.has(x.regalo) && Number.isInteger(x.quanti))
        .map((x) => ({ regalo: x.regalo, quanti: x.quanti }));
      return risposta(200, { ok: true, ricevuti: lista, testo: ricevutiTesto(lista) });
    }
    const saldo = await rpc(s, "saldo_crediti", { p_persona: chi.id }, f);
    if (!Number.isInteger(saldo)) return riprova();
    const da_vedere = await rpc(s, "regali_da_vedere", { p_persona: chi.id }, f);
    if (!Array.isArray(da_vedere)) return riprova();
    const avvisi = da_vedere.filter((x) => x && UUID.test(String(x.id || "")) && PREZZO.has(x.regalo))
      .map((x) => ({ id: x.id, da: x.da, regalo: x.regalo, testo: avvisoRegalo(x.regalo, x.nome) }));
    return risposta(200, { ok: true, saldo, avvisi });
  }

  const corpo = await leggiCorpo(request);
  if (corpo.errore) return corpo.errore;
  const d = corpo.dati;

  if (d.azione === "visti") {
    if (!Array.isArray(d.ids) || d.ids.length > VISTI_MASSIMO || !d.ids.every((x) => UUID.test(String(x)))) return dati();
    const n = await rpc(s, "segna_regali_visti", { p_persona: chi.id, p_ids: d.ids }, f);
    return Number.isInteger(n) ? risposta(200, { ok: true }) : riprova();
  }

  if (d.azione !== "manda" || !UUID.test(String(d.a || "")) || d.a === chi.id || !PREZZO.has(d.regalo)
      || !UUID.test(String(d.chiave || ""))) {
    return dati();
  }
  const esito = await rpc(s, "manda_regalo", { p_da: chi.id, p_a: d.a, p_regalo: d.regalo, p_chiave: d.chiave }, f);
  if (typeof esito !== "string") return riprova();
  if (esito === "ok") {
    const saldo = await rpc(s, "saldo_crediti", { p_persona: chi.id }, f);
    return risposta(200, { ok: true, saldo: Number.isInteger(saldo) ? saldo : null });
  }
  if (NASCOSTI.has(esito)) return risposta(200, { ok: false, motivo: "non_puoi", testo: TESTI_COIN.nonPuoi });
  if (esito === "stanza_chiusa") return risposta(200, { ok: false, motivo: esito, testo: TESTI_COIN.stanzaChiusa });
  if (esito === "saldo") {
    const saldo = await rpc(s, "saldo_crediti", { p_persona: chi.id }, f);
    const manca = Number.isInteger(saldo) ? Math.max(1, PREZZO.get(d.regalo) - saldo) : null;
    return risposta(200, { ok: false, motivo: esito, testo: manca ? tiMancano(manca) : null });
  }
  // limite_persona e limite_giorno: il testo lo scrive il CPO (spec senza frase); l'app mostra un testo neutro.
  if (esito === "limite_persona" || esito === "limite_giorno") return risposta(200, { ok: false, motivo: esito, testo: null });
  return dati();
}

// Chi è lo dice Supabase leggendo il token (come in worker/chiavi_api.js): { id } oppure { errore: Response }.
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
    console.error("regali: accesso", e && e.name);
    return { errore: riprova() };
  }
}

async function leggiCorpo(request) {
  const troppo = { errore: risposta(413, { ok: false, motivo: "troppo_grande" }) };
  const sbagliato = { errore: dati() };
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
    const d = JSON.parse(new TextDecoder().decode(tutto));
    return d && typeof d === "object" && !Array.isArray(d) ? { dati: d } : sbagliato;
  } catch {
    return sbagliato;
  }
}

// Limite di frequenza: stesso binding gratuito delle chiamate (LIMITE_PROVINCIA), chiave a parte. L'IP serve solo
// a contare in memoria, mai salvato.
async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "regali:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}
