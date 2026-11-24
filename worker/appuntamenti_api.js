// «Fissa una chiamata» (issue #380, spec v1 del CPO del 23/11, design v4 schermata 20), passo 4b della linea CTO.
//
//   GET  /app/api/stanza/appuntamenti → 200 { ok, appuntamenti: [{ id, altra, propostoDaMe, stato, quando, messaggio,
//                                        fase, puoControproporre, annullatoDallAltra, testo? }] }
//   POST /app/api/stanza/appuntamenti → 200 { ok: true } | 200 { ok: false, motivo, testo }
//     { azione: "proponi", con, quando, messaggio? } · { azione: "conferma" | "no" | "annulla", id }
//     { azione: "altro", id, quando, messaggio? }   («Un altro orario»)
//     → 400 richiesta | 401 accesso | 404 spento | 405 metodo | 429 troppe | 503 riprova
//
// Chi è lo dice SOLO il token di Supabase (mai il corpo). Il Worker controlla le due cose che il database non sa:
// il messaggio senza numeri, email, link o social (controllaMessaggio, lo stesso controllo della frase della chiave) e
// l'orario dentro le fasce di tutte e due (oreProponibili). Limiti (3 aperti, 1 con la stessa persona, 2
// controproposte), blocchi, segnalazioni, sospesi, 3 chiamate e passi di 30 minuti li decide il database
// (migrazione 20261123190000), anche se qualcuno chiama l'API a mano. La pausa non si legge e non si scopre: dei
// profili si leggono solo fascia_da e fascia_a. Appuntamenti e messaggi non vanno agli algoritmi. Nei log solo codici
// e nomi di errore, mai token, id o messaggi. Spento finché ACCESSO_APP non vale «si».

import { TESTI_APPUNTAMENTI, controllaMessaggio, faseAppuntamento, oreProponibili, puoControproporre }
  from "../api/appuntamenti.js";

export const PERCORSO_APPUNTAMENTI = "/app/api/stanza/appuntamenti";
const ATTESA_MS = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const ORA = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;
const AZIONI = new Set(["proponi", "conferma", "no", "altro", "annulla"]);
const STATI = new Set(["proposto", "confermato", "scaduto", "rifiutato", "annullato", "tre_chiamate"]);
// Esiti del database e testi della spec. Il motivo dell'altra persona non si dice mai.
const TESTI_ESITO = Object.freeze({
  non_valida: null,
  non_disponibile: TESTI_APPUNTAMENTI.nonDisponibile,
  gia_con_lei: null,
  tre_aperti: TESTI_APPUNTAMENTI.treAperti,
  orario: null,
  troppo_lungo: TESTI_APPUNTAMENTI.troppoLungo,
  non_trovato: null,
  controproposte_finite: null,
});
const TESTI_STATO = Object.freeze({
  scaduto: TESTI_APPUNTAMENTI.scaduta,
  annullato: TESTI_APPUNTAMENTI.annullato,
  tre_chiamate: TESTI_APPUNTAMENTI.treChiamate,
});

function risposta(stato, corpo, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
const riprova = () => risposta(503, { ok: false, motivo: "riprova" });
const accesso = () => risposta(401, { ok: false, motivo: "accesso" });
const malformata = () => risposta(400, { ok: false, motivo: "richiesta" });
const no = (motivo, testo = TESTI_ESITO[motivo] ?? null) => risposta(200, { ok: false, motivo, testo });

function entro(ms, promessa) {
  let timer;
  return Promise.race([promessa, new Promise((_, rifiuta) => { timer = setTimeout(() => rifiuta(new Error("tempo scaduto")), ms); })])
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
    console.error("appuntamenti: accesso", e && e.name);
    return { errore: riprova() };
  }
}

async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "appuntamenti:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}

// → JSON restituito, oppure undefined (errore, tempo scaduto).
async function chiedi(s, percorso, f, corpo) {
  const headers = { apikey: s.chiave, authorization: `Bearer ${s.chiave}` };
  const init = corpo === undefined ? { headers }
    : { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(corpo) };
  try {
    const r = await entro(ATTESA_MS, f(`${s.base}/rest/v1/${percorso}`, init));
    if (!r.ok) {
      console.error("appuntamenti: database", percorso.split("?")[0], r.status);
      return undefined;
    }
    return await r.json();
  } catch (e) {
    console.error("appuntamenti: database", percorso.split("?")[0], e && e.name);
    return undefined;
  }
}

const dataValida = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));

// Righe di appuntamenti_di → appuntamenti per il telefono. undefined se una riga non ha la forma attesa.
export function appuntamentiDaRighe(righe, adesso) {
  if (!Array.isArray(righe)) return undefined;
  const lista = [];
  for (const r of righe) {
    const { id, altra, proposto_da_me: propostoDaMe, stato, quando, messaggio, controproposte, annullato_dall_altra: annullatoDallAltra } = r || {};
    if (!UUID.test(String(id || "")) || !UUID.test(String(altra || "")) || typeof propostoDaMe !== "boolean"
      || !STATI.has(stato) || !dataValida(quando) || !(messaggio === null || typeof messaggio === "string")
      || !Number.isInteger(controproposte) || typeof annullatoDallAltra !== "boolean") {
      console.error("appuntamenti: riga non valida");
      return undefined;
    }
    const aperto = stato === "proposto" || stato === "confermato";
    const fase = aperto ? faseAppuntamento({ stato, quando }, adesso).fase : stato;
    const voce = { id, altra, propostoDaMe, stato, quando, messaggio, fase,
      puoControproporre: stato === "proposto" && !propostoDaMe && puoControproporre({ controproposte }), annullatoDallAltra };
    if (TESTI_STATO[fase]) voce.testo = TESTI_STATO[fase];
    lista.push(voce);
  }
  return lista;
}

// Corpo della richiesta POST → { azione, con?, id?, quando?, messaggio? } oppure null se non ha la forma attesa.
function leggiCorpo(corpo, chi) {
  if (!corpo || typeof corpo !== "object" || !AZIONI.has(corpo.azione)) return null;
  const { azione } = corpo;
  if (azione === "proponi") {
    if (!UUID.test(String(corpo.con || "")) || corpo.con === chi || typeof corpo.quando !== "string") return null;
    return { azione, con: corpo.con, quando: corpo.quando, messaggio: corpo.messaggio };
  }
  if (!UUID.test(String(corpo.id || ""))) return null;
  if (azione === "altro") {
    if (typeof corpo.quando !== "string") return null;
    return { azione, id: corpo.id, quando: corpo.quando, messaggio: corpo.messaggio };
  }
  return { azione, id: corpo.id };
}

// Fasce di disponibilità delle due persone (solo da e a: mai la pausa). undefined se il database non risponde.
async function fasceDi(s, chi, altra, f) {
  const righe = await chiedi(s, `profili?id=in.(${chi},${altra})&select=id,fascia_da,fascia_a`, f);
  if (!Array.isArray(righe)) return undefined;
  const fascia = (id) => {
    const p = righe.find((x) => x && x.id === id) || {};
    return ORA.test(p.fascia_da || "") && ORA.test(p.fascia_a || "") ? { da: p.fascia_da, a: p.fascia_a } : null;
  };
  return { mia: fascia(chi), sua: fascia(altra) };
}

// Stanza aperta adesso: { apre, chiude }, null se non ce n'è una, undefined se il database non risponde.
async function stanzaAperta(s, chi, adesso, f) {
  const ora = encodeURIComponent(adesso.toISOString());
  const righe = await chiedi(s, `membri_stanza?utente_id=eq.${chi}&select=stanze!inner(id,apre_il,chiude_il)`
    + `&stanze.apre_il=lte.${ora}&stanze.chiude_il=gt.${ora}&limit=1`, f);
  if (!Array.isArray(righe)) return undefined;
  const st = righe[0] && righe[0].stanze;
  if (!st || !dataValida(st.apre_il) || !dataValida(st.chiude_il)) return null;
  return { apre: new Date(st.apre_il), chiude: new Date(st.chiude_il) };
}

// Messaggio e orario per «proponi» e «altro». → { quando, messaggio } oppure { errore: Response }.
async function controllaOrario(s, chi, altra, { quando, messaggio }, adesso, f) {
  const msg = controllaMessaggio(messaggio);
  if (!msg.ok) return { errore: no(msg.motivo, msg.testo) };
  const t = Date.parse(quando);
  if (!Number.isFinite(t)) return { errore: no("orario") };
  const stanza = await stanzaAperta(s, chi, adesso, f);
  if (stanza === undefined) return { errore: riprova() };
  if (!stanza) return { errore: no("non_disponibile") };
  const fasce = await fasceDi(s, chi, altra, f);
  if (!fasce) return { errore: riprova() };
  const ore = oreProponibili({ adesso, stanza, fasciaMia: fasce.mia, fasciaSua: fasce.sua });
  if (!ore.some((o) => o.getTime() === t)) return { errore: no("orario") };
  return { quando: new Date(t).toISOString(), messaggio: msg.messaggio };
}

const esito = (valore) => {
  if (valore === "ok") return risposta(200, { ok: true });
  if (typeof valore === "string" && Object.hasOwn(TESTI_ESITO, valore)) return no(valore);
  console.error("appuntamenti: esito sconosciuto");
  return riprova();
};

async function scrivi(s, chi, richiesta, adesso, f) {
  const { azione } = richiesta;
  if (azione === "proponi") {
    const ok = await controllaOrario(s, chi, richiesta.con, richiesta, adesso, f);
    if (ok.errore) return ok.errore;
    return esito(await chiedi(s, "rpc/proponi_appuntamento", f,
      { p_chi: chi, p_con: richiesta.con, p_quando: ok.quando, p_messaggio: ok.messaggio }));
  }
  if (azione === "annulla") return esito(await chiedi(s, "rpc/annulla_appuntamento", f, { p_persona: chi, p_id: richiesta.id }));
  if (azione === "conferma" || azione === "no") {
    return esito(await chiedi(s, "rpc/rispondi_appuntamento", f,
      { p_persona: chi, p_id: richiesta.id, p_azione: azione, p_quando: null, p_messaggio: null }));
  }
  // «Un altro orario»: l'altra persona e le controproposte si leggono dal database, mai dal corpo.
  const miei = appuntamentiDaRighe(await chiedi(s, "rpc/appuntamenti_di", f, { p_persona: chi }), adesso);
  if (!miei) return riprova();
  const a = miei.find((x) => x.id === richiesta.id && x.stato === "proposto" && !x.propostoDaMe);
  if (!a) return no("non_trovato");
  if (!a.puoControproporre) return no("controproposte_finite");
  const ok = await controllaOrario(s, chi, a.altra, richiesta, adesso, f);
  if (ok.errore) return ok.errore;
  return esito(await chiedi(s, "rpc/rispondi_appuntamento", f,
    { p_persona: chi, p_id: a.id, p_azione: "altro", p_quando: ok.quando, p_messaggio: ok.messaggio }));
}

export async function appuntamentiApi(request, env, f = fetch, orologio = () => new Date()) {
  const url = new URL(request.url);
  if (url.pathname !== PERCORSO_APPUNTAMENTI) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (request.method !== "GET" && request.method !== "POST") return risposta(405, { ok: false, motivo: "metodo" }, { allow: "GET, POST" });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const s = server(env);
  if (!s) return riprova();

  const chi = await chiEDavvero(request, s, f);
  if (chi.errore) return chi.errore;
  const adesso = orologio();

  if (request.method === "GET") {
    const lista = appuntamentiDaRighe(await chiedi(s, "rpc/appuntamenti_di", f, { p_persona: chi.id }), adesso);
    if (!lista) return riprova();
    return risposta(200, { ok: true, appuntamenti: lista });
  }
  let corpo;
  try {
    const testo = await request.text();
    if (testo.length > 2048) return malformata();
    corpo = JSON.parse(testo);
  } catch {
    return malformata();
  }
  const richiesta = leggiCorpo(corpo, chi.id);
  if (!richiesta) return malformata();
  return scrivi(s, chi.id, richiesta, adesso, f);
}
