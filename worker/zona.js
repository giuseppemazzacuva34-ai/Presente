// Contatore della zona nella home della web app (issue #3, spec v1.2 del CPO, D121 A).
//
// GET /app/api/zona → { zona, accesa, testo }
//   zona   nome dell'area della persona («Milano e dintorni») oppure null (estero, provincia mancante, problemi);
//   accesa true se l'area ha già 36 profili completi e almeno il 40% donne;
//   testo  «Milano e dintorni: mancano 7 persone…» oppure null (area accesa o numeri non disponibili).
// La persona è quella del token (Supabase). L'area la ricava il server dalla provincia IN VIGORE salvata nel profilo:
// nulla della richiesta (parametri, corpo) la cambia. I numeri vengono da conteggi_aree() (solo totale e donne, solo con
// la chiave del server); al telefono arriva solo il testo della propria zona: mai numeri di altre aree, nomi o email.
// Spento finché ACCESSO_APP non vale «si». Ogni problema → risposta vuota: il contatore non blocca mai l'app.
import { areaDi, accesa, testoContatore } from "../api/aree.js";

export const PERCORSO_ZONA = "/app/api/zona";
// Il telefono non aspetta più di 2 secondi: il server si ferma prima.
const ATTESA_SUPABASE_MS = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const NESSUNA = Object.freeze({ zona: null, accesa: false, testo: null });

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

// Provincia valida oggi: se un cambio vale solo dal lunedì dopo, conta ancora quella di prima (come conteggi_aree()).
export function provinciaInVigore(profilo, adesso = Date.now()) {
  if (!profilo) return null;
  const dal = profilo.provincia_in_vigore_dal ? Date.parse(profilo.provincia_in_vigore_dal) : NaN;
  if (Number.isFinite(dal) && dal > adesso) return profilo.provincia_precedente || null;
  return profilo.provincia || null;
}

export async function contatoreZona(request, env, f = fetch) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Metodo non ammesso.", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const token = (request.headers.get("authorization") || "").match(/^Bearer ([A-Za-z0-9._-]{20,4096})$/);
  if (!token) return risposta(401, { ok: false, motivo: "accesso" });

  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const servizio = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!URL_SUPABASE.test(base) || !servizio) return risposta(200, NESSUNA);
  const chiaveServer = { apikey: servizio, authorization: `Bearer ${servizio}` };

  let id;
  try {
    // Chi è lo dice Supabase leggendo il token (non ci fidiamo di id mandati dal telefono).
    const chi = await entro(ATTESA_SUPABASE_MS, f(`${base}/auth/v1/user`, { headers: { apikey: servizio, authorization: `Bearer ${token[1]}` } }));
    if (chi.status === 401 || chi.status === 403) return risposta(401, { ok: false, motivo: "accesso" });
    if (!chi.ok) return risposta(200, NESSUNA);
    id = String(((await chi.json()) || {}).id || "");
  } catch {
    return risposta(200, NESSUNA);
  }
  if (!UUID.test(id)) return risposta(401, { ok: false, motivo: "accesso" });

  let area;
  try {
    const r = await entro(ATTESA_SUPABASE_MS, f(`${base}/rest/v1/profili?id=eq.${id}&select=provincia,provincia_precedente,provincia_in_vigore_dal&limit=1`, { headers: chiaveServer }));
    if (!r.ok) return risposta(200, NESSUNA);
    const righe = await r.json();
    area = areaDi(provinciaInVigore(Array.isArray(righe) ? righe[0] : null));
  } catch {
    return risposta(200, NESSUNA);
  }
  if (!area) return risposta(200, NESSUNA);

  // Da qui la zona è nota: se i numeri mancano si mostra solo il nome, mai un numero inventato.
  const senzaNumeri = { zona: area.nome, accesa: false, testo: null };
  let conto;
  try {
    const r = await entro(ATTESA_SUPABASE_MS, f(`${base}/rest/v1/rpc/conteggi_aree`, {
      method: "POST", headers: { ...chiaveServer, "content-type": "application/json" }, body: "{}",
    }));
    if (!r.ok) return risposta(200, senzaNumeri);
    const righe = await r.json();
    if (!Array.isArray(righe)) return risposta(200, senzaNumeri);
    // Un'area senza profili completi può mancare dalle righe: vale zero.
    const riga = righe.find((x) => x && x.codice === area.codice) || { totale: 0, donne: 0 };
    conto = { totale: Number(riga.totale) || 0, donne: Number(riga.donne) || 0 };
  } catch {
    return risposta(200, senzaNumeri);
  }
  return risposta(200, { zona: area.nome, accesa: accesa(conto), testo: testoContatore(area, conto) });
}

// Limite di frequenza: stesso binding della provincia (LIMITE_PROVINCIA), con una chiave a parte. L'IP serve solo a
// contare in memoria, mai salvato.
async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "zona:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}
