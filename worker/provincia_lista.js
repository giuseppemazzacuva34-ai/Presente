// Provincia precompilata dalla lista d'attesa (issue #2, specifica v1.3 del CPO, D84 A).
//
// GET  /app/api/provincia-lista  → { sigla: "RM" } oppure { sigla: null }. Solo la sigla: nessun altro dato della lista
//      arriva al telefono. La persona è quella del token (Supabase), con l'email confermata; la lista si cerca con
//      quell'email. Mai l'email nei log o nella risposta.
// POST /app/api/provincia-lista  { sigla } → { lista: true|false }. Quando al passo 5 la persona conferma senza cambi la
//      provincia della lista, il server ricontrolla la lista e la salva con origine «lista» (funzione
//      conferma_provincia_lista, solo con la chiave service_role). Se qualcosa non va risponde { lista: false } e l'app
//      salva come sempre (origine «scelta»): la precompilazione non blocca mai nessuno.
// Spento finché ACCESSO_APP non vale «si». La lista e l'app restano due archivi separati: qui non si scrive nella lista.
import { ESTERO, nomeProvincia, provinciaDaZona } from "./province.js";

export const PERCORSO_PROVINCIA_LISTA = "/app/api/provincia-lista";
// La spec chiede al telefono di non aspettare più di 2 secondi: il server si ferma prima.
const ATTESA_LISTA_MS = 1200;
const ATTESA_SUPABASE_MS = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const SIGLA = /^[A-Z]{2}$/;

function risposta(stato, corpo) {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function entro(ms, promessa) {
  let timer;
  return Promise.race([promessa, new Promise((_, no) => { timer = setTimeout(() => no(new Error("tempo scaduto")), ms); })])
    .finally(() => clearTimeout(timer));
}

export async function provinciaLista(request, env, f = fetch) {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Metodo non ammesso.", { status: 405, headers: { allow: "GET, POST" } });
  }
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  if (request.method === "POST") {
    // Solo dalla nostra web app: un altro sito non può far scrivere nulla.
    const origine = request.headers.get("origin");
    if (!origine || origine !== new URL(request.url).origin) return risposta(403, { ok: false, motivo: "origine" });
  }
  const token = (request.headers.get("authorization") || "").match(/^Bearer ([A-Za-z0-9._-]{20,4096})$/);
  if (!token) return risposta(401, { ok: false, motivo: "accesso" });

  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const servizio = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const vuota = () => risposta(200, request.method === "GET" ? { sigla: null } : { lista: false });
  if (!URL_SUPABASE.test(base) || !servizio) return vuota();

  let persona;
  try {
    // Chi è lo dice Supabase leggendo il token (non ci fidiamo di id o email mandati dal telefono).
    const chi = await entro(ATTESA_SUPABASE_MS, f(`${base}/auth/v1/user`, { headers: { apikey: servizio, authorization: `Bearer ${token[1]}` } }));
    if (chi.status === 401 || chi.status === 403) return risposta(401, { ok: false, motivo: "accesso" });
    if (!chi.ok) return vuota();
    persona = await chi.json();
  } catch {
    return vuota();
  }
  const id = String((persona && persona.id) || "");
  if (!UUID.test(id)) return risposta(401, { ok: false, motivo: "accesso" });
  // Solo con l'email confermata: altrimenti chiunque scriva l'email di un altro leggerebbe la sua provincia.
  const email = String((persona && persona.email) || "").trim().toLowerCase();
  if (!email || !persona.email_confirmed_at) return vuota();

  const sigla = await siglaDallaLista(env, email);
  if (request.method === "GET") return risposta(200, { sigla });

  let chiesta = null;
  try {
    chiesta = String(((await request.json()) || {}).sigla || "");
  } catch {
    return risposta(400, { ok: false, motivo: "dati" });
  }
  if (!sigla || chiesta !== sigla) return risposta(200, { lista: false });
  try {
    const r = await entro(ATTESA_SUPABASE_MS, f(`${base}/rest/v1/rpc/conferma_provincia_lista`, {
      method: "POST",
      headers: { apikey: servizio, authorization: `Bearer ${servizio}`, "content-type": "application/json" },
      body: JSON.stringify({ utente: id, sigla }),
    }));
    if (!r.ok) return risposta(200, { lista: false });
    return risposta(200, { lista: (await r.json()) === true });
  } catch {
    return risposta(200, { lista: false });
  }
}

// Sigla della provincia per un'email della lista: la colonna «provincia» se c'è e vale, altrimenti la zona vecchia
// solo quando è sicura (provinciaDaZona). null in tutti gli altri casi, anche se la lista è lenta o non risponde.
export async function siglaDallaLista(env, email) {
  if (!env.DB) return null;
  let riga = null;
  try {
    riga = await entro(ATTESA_LISTA_MS, env.DB.prepare("SELECT provincia, zona, citta FROM iscrizioni WHERE email = ? LIMIT 1").bind(email).first());
  } catch (e) {
    // Database creato prima della colonna provincia: si legge solo la zona.
    if (!/provincia/.test(String(e && e.message))) return null;
    try {
      riga = await entro(ATTESA_LISTA_MS, env.DB.prepare("SELECT zona, citta FROM iscrizioni WHERE email = ? LIMIT 1").bind(email).first());
    } catch {
      return null;
    }
  }
  if (!riga) return null;
  if (riga.provincia) {
    const s = String(riga.provincia);
    if (SIGLA.test(s) && (s === ESTERO || nomeProvincia(s))) return s;
    // Solo il tipo di problema: mai l'email o altri dati della persona.
    console.error("provincia-lista: sigla in lista non valida");
    return null;
  }
  return provinciaDaZona(riga.zona, riga.citta);
}

// Limite di frequenza (binding LIMITE_PROVINCIA in wrangler.jsonc): l'IP serve solo a contare in memoria, mai salvato.
async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "provincia:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}
