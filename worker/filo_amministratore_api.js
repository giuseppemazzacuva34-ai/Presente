// Il pannello dell'amministratore per il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 12b
// della linea «sviluppatore-c»:
//
//   GET  /app/api/filo-amministratore/stanze                           → { ok, stanze: [...] }
//   POST /app/api/filo-amministratore/assegna     { stanza, email }    → { ok } | { ok: false, motivo }
//   POST /app/api/filo-amministratore/togli-filo  { stanza }           → { ok, tolto }
//   GET  /app/api/filo-amministratore/ascolta?stanza=&tipo=            → { ok, vocale: { url, durata, testo, file } | null }
//   POST /app/api/filo-amministratore/togli-vocale { stanza, tipo, file } → { ok, tolto }
//   GET  /app/api/filo-amministratore/aree                                → { ok, aree: [...] }       (spec v1.2)
//   POST /app/api/filo-amministratore/assegna-area { tipo, citta, email }  → { ok } | { ok: false, motivo }
//   POST /app/api/filo-amministratore/togli-area   { tipo, citta }         → { ok, tolto }
//   errori: 400 dati · 401 accesso · 403 non_amministratore · 404 · 405 · 413 · 429 troppe · 503 riprova
//
// Chi è lo dice SOLO il token di Supabase; se è amministratore (tabella moderatori) lo decide il database, che rifiuta
// ogni funzione a chi non lo è (migrazione *_filo_amministratore.sql). Il vocale si ascolta con un link firmato breve
// del contenitore privato «vocali_filo». Un vocale inadatto si toglie in quest'ordine: è ancora quel file? → cancella
// il file dal contenitore → togli la riga (se il file non si cancella la riga resta e si riprova: niente file orfani).
// Nei log solo codici e nomi di errore: mai token, email, testi, nomi o percorsi. Spento finché ACCESSO_APP ≠ «si».

export const PERCORSO_FILO_AMMINISTRATORE = "/app/api/filo-amministratore";
const SCADENZA_LINK_S = 300;
const ATTESA_MS = 1500;
const CORPO_MASSIMO = 2048;
const CONTENITORE = "vocali_filo";
const TIPI = new Set(["lunedi", "domenica"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9_-]{1,80}\.(webm|ogg|m4a|mp4|mp3|aac)$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const MOTIVI_ASSEGNA = new Set(["persona", "stanza", "filo_membro"]);
const METODI = {
  "/stanze": "GET", "/assegna": "POST", "/togli-filo": "POST", "/ascolta": "GET", "/togli-vocale": "POST",
  "/aree": "GET", "/assegna-area": "POST", "/togli-area": "POST",
};
const MOTIVI_ASSEGNA_AREA = new Set(["persona", "area"]);

// Area del Filo (spec v1.2): { tipo: "citta", citta: "Milano" } o { tipo: "italia" } → { tipo, citta } | null
function areaValida(corpo) {
  if (corpo.tipo === "italia") return corpo.citta === undefined || corpo.citta === null || corpo.citta === "" ? { tipo: "italia", citta: null } : null;
  if (corpo.tipo !== "citta" || typeof corpo.citta !== "string") return null;
  const citta = corpo.citta.trim();
  return citta.length >= 1 && citta.length <= 80 ? { tipo: "citta", citta } : null;
}

function risposta(stato, corpo, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
const riprova = () => risposta(503, { ok: false, motivo: "riprova" });
const dati = () => risposta(400, { ok: false, motivo: "dati" });
const accesso = () => risposta(401, { ok: false, motivo: "accesso" });
const nonAmministratore = () => risposta(403, { ok: false, motivo: "non_amministratore" });

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
const intestazioni = (s) => ({ apikey: s.chiave, authorization: `Bearer ${s.chiave}`, "content-type": "application/json" });

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
    console.error("filo_amministratore: accesso", e && e.name);
    return { errore: riprova() };
  }
}

async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "filo-amministratore:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}

// → { ok: true, corpo } | { ok: false, stato, motivo } | null (errore di rete o risposta illeggibile)
async function rpc(s, nome, parametri, f) {
  try {
    const r = await entro(ATTESA_MS, f(`${s.base}/rest/v1/rpc/${nome}`, {
      method: "POST", headers: intestazioni(s), body: JSON.stringify(parametri),
    }));
    if (r.status === 204) return { ok: true, corpo: null };
    const testo = await r.text();
    let corpo = null;
    try { corpo = testo ? JSON.parse(testo) : null; } catch { corpo = null; }
    if (r.ok) return { ok: true, corpo };
    if (r.status >= 500) console.error("filo_amministratore: database", nome, r.status);
    return { ok: false, stato: r.status, motivo: corpo && typeof corpo.message === "string" ? corpo.message : "" };
  } catch (e) {
    console.error("filo_amministratore: database", nome, e && e.name);
    return null;
  }
}

async function linkFirmato(s, file, f) {
  const percorso = file.split("/").map(encodeURIComponent).join("/");
  try {
    const r = await entro(ATTESA_MS, f(`${s.base}/storage/v1/object/sign/${CONTENITORE}/${percorso}`, {
      method: "POST", headers: intestazioni(s), body: JSON.stringify({ expiresIn: SCADENZA_LINK_S }),
    }));
    if (!r.ok) {
      console.error("filo_amministratore: firma", r.status);
      return null;
    }
    const firmato = String(((await r.json()) || {}).signedURL || "");
    return firmato.startsWith(`/object/sign/${CONTENITORE}/`) ? `${s.base}/storage/v1${firmato}` : null;
  } catch (e) {
    console.error("filo_amministratore: firma", e && e.name);
    return null;
  }
}

async function cancellaFile(s, file, f) {
  try {
    const r = await entro(ATTESA_MS, f(`${s.base}/storage/v1/object/${CONTENITORE}`, {
      method: "DELETE", headers: intestazioni(s), body: JSON.stringify({ prefixes: [file] }),
    }));
    if (!r.ok) console.error("filo_amministratore: cancellazione file", r.status);
    return r.ok;
  } catch (e) {
    console.error("filo_amministratore: cancellazione file", e && e.name);
    return false;
  }
}

async function leggiCorpo(request) {
  const dichiarato = Number(request.headers.get("content-length"));
  if (Number.isFinite(dichiarato) && dichiarato > CORPO_MASSIMO) return { errore: risposta(413, { ok: false, motivo: "troppo_grande" }) };
  try {
    const testo = await request.text();
    if (testo.length > CORPO_MASSIMO) return { errore: risposta(413, { ok: false, motivo: "troppo_grande" }) };
    const valore = JSON.parse(testo);
    return valore && typeof valore === "object" && !Array.isArray(valore) ? { dati: valore } : { errore: dati() };
  } catch {
    return { errore: dati() };
  }
}

// Esito di una rpc in risposta: null → 503; 403 non_amministratore → 403; altrimenti undefined (va avanti chi chiama).
function esitoComune(r) {
  if (!r) return riprova();
  if (!r.ok && r.stato === 403 && r.motivo === "non_amministratore") return nonAmministratore();
  return undefined;
}

// Il vocale attuale della stanza: { vocale } | { vocale: null } | { errore: Response }
async function vocaleAttuale(s, chi, stanza, tipo, f) {
  const r = await rpc(s, "vocale_filo_amministratore", { p_amministratore: chi, p_stanza: stanza, p_tipo: tipo }, f);
  const comune = esitoComune(r);
  if (comune) return { errore: comune };
  if (!r.ok || !Array.isArray(r.corpo)) return { errore: riprova() };
  const riga = r.corpo[0];
  if (!riga) return { vocale: null };
  if (typeof riga.file !== "string" || !FILE.test(riga.file)) {
    console.error("filo_amministratore: file non valido");
    return { errore: riprova() };
  }
  return { vocale: riga };
}

export async function filoAmministratoreApi(request, env, f = fetch) {
  const url = new URL(request.url);
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  const passo = url.pathname.slice(PERCORSO_FILO_AMMINISTRATORE.length);
  if (!url.pathname.startsWith(PERCORSO_FILO_AMMINISTRATORE + "/") || !Object.hasOwn(METODI, passo)) {
    return risposta(404, { ok: false, motivo: "non_trovato" });
  }
  if (request.method !== METODI[passo]) return risposta(405, { ok: false, motivo: "metodo" }, { allow: METODI[passo] });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const s = server(env);
  if (!s) return riprova();
  const chi = await chiEDavvero(request, s, f);
  if (chi.errore) return chi.errore;
  const ora = new Date().toISOString();

  if (passo === "/stanze") {
    const r = await rpc(s, "stanze_filo_amministratore", { p_amministratore: chi.id, p_ora: ora }, f);
    const comune = esitoComune(r);
    if (comune) return comune;
    return r.ok && Array.isArray(r.corpo) ? risposta(200, { ok: true, stanze: r.corpo }) : riprova();
  }

  if (passo === "/ascolta") {
    const stanza = url.searchParams.get("stanza") || "";
    const tipo = url.searchParams.get("tipo") || "";
    if (!UUID.test(stanza) || !TIPI.has(tipo)) return dati();
    const v = await vocaleAttuale(s, chi.id, stanza, tipo, f);
    if (v.errore) return v.errore;
    if (!v.vocale) return risposta(200, { ok: true, vocale: null });
    const link = await linkFirmato(s, v.vocale.file, f);
    if (!link) return riprova();
    return risposta(200, { ok: true, vocale: { url: link, durata: Number(v.vocale.durata), testo: String(v.vocale.testo || ""), file: v.vocale.file } });
  }

  if (passo === "/aree") {
    const r = await rpc(s, "fili_aree_amministratore", { p_amministratore: chi.id }, f);
    const comune = esitoComune(r);
    if (comune) return comune;
    return r.ok && Array.isArray(r.corpo) ? risposta(200, { ok: true, aree: r.corpo }) : riprova();
  }

  const corpo = await leggiCorpo(request);
  if (corpo.errore) return corpo.errore;

  if (passo === "/assegna-area" || passo === "/togli-area") {
    const area = areaValida(corpo.dati);
    if (!area) return dati();
    if (passo === "/togli-area") {
      const r = await rpc(s, "togli_filo_area", { p_amministratore: chi.id, p_tipo: area.tipo, p_citta: area.citta }, f);
      const comune = esitoComune(r);
      if (comune) return comune;
      return r.ok && typeof r.corpo === "boolean" ? risposta(200, { ok: true, tolto: r.corpo }) : riprova();
    }
    const email = typeof corpo.dati.email === "string" ? corpo.dati.email.trim() : "";
    if (email.length > 254 || !EMAIL.test(email)) return dati();
    const r = await rpc(s, "assegna_filo_area", { p_amministratore: chi.id, p_tipo: area.tipo, p_citta: area.citta, p_email: email, p_ora: ora }, f);
    const comune = esitoComune(r);
    if (comune) return comune;
    if (r.ok) return risposta(200, { ok: true });
    if (r.stato >= 400 && r.stato < 500 && MOTIVI_ASSEGNA_AREA.has(r.motivo)) return risposta(200, { ok: false, motivo: r.motivo });
    return riprova();
  }

  const stanza = corpo.dati.stanza;
  if (typeof stanza !== "string" || !UUID.test(stanza)) return dati();

  if (passo === "/assegna") {
    const email = typeof corpo.dati.email === "string" ? corpo.dati.email.trim() : "";
    if (email.length > 254 || !EMAIL.test(email)) return dati();
    const r = await rpc(s, "assegna_filo_stanza", { p_amministratore: chi.id, p_stanza: stanza, p_email: email, p_ora: ora }, f);
    const comune = esitoComune(r);
    if (comune) return comune;
    if (r.ok) return risposta(200, { ok: true });
    if (r.stato >= 400 && r.stato < 500 && MOTIVI_ASSEGNA.has(r.motivo)) return risposta(200, { ok: false, motivo: r.motivo });
    return riprova();
  }

  if (passo === "/togli-filo") {
    const r = await rpc(s, "togli_filo_stanza", { p_amministratore: chi.id, p_stanza: stanza }, f);
    const comune = esitoComune(r);
    if (comune) return comune;
    return r.ok && typeof r.corpo === "boolean" ? risposta(200, { ok: true, tolto: r.corpo }) : riprova();
  }

  // /togli-vocale
  const { tipo, file } = corpo.dati;
  if (!TIPI.has(tipo) || typeof file !== "string" || !FILE.test(file)) return dati();
  const v = await vocaleAttuale(s, chi.id, stanza, tipo, f);
  if (v.errore) return v.errore;
  if (!v.vocale || v.vocale.file !== file) return risposta(200, { ok: true, tolto: false });
  if (!(await cancellaFile(s, file, f))) return riprova();
  const r = await rpc(s, "togli_vocale_filo_amministratore", { p_amministratore: chi.id, p_stanza: stanza, p_tipo: tipo, p_file: file, p_ora: ora }, f);
  const comune = esitoComune(r);
  if (comune) return comune;
  return r.ok && typeof r.corpo === "boolean" ? risposta(200, { ok: true, tolto: r.corpo }) : riprova();
}
