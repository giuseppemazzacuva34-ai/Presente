// Incontro dopo il doppio sì (issue #6, spec v1 del CPO del 3/11, punti 2 e 3). Passo 2c, linea «sviluppatore-b».
//   POST /app/api/incontro  { azione: "proponi", porta, orario (ISO), locale | luogo }  → proponi_incontro
//        «Proponi quando e dove» e «Propongo un'altra data»: esito «proposto» o «controproposto»
//   POST /app/api/incontro  { azione: "rispondi", porta, risposta: "accetto" | "annulla" } → rispondi_incontro
//        esito «confermato» o «annullato»
//   POST /app/api/incontro  { azione: "checkin", porta }                              → checkin_incontro
//        «Sono qui»: esito «sono_qui» (si aspetta l'altro) o «avvenuto» (segnale pronto, caparre sbloccate) (passo 2g)
//   GET  /app/api/incontro?porta=<id>                                                → stato_incontro
//        { ok: true, incontro: { stato, scadenza, orario, locale, luogo, proposta_mia, proposta_scade,
//          controproposte_rimaste, azioni, ritardo_minuti, esito,
//          checkin_mio, checkin_altro, checkin_da, checkin_fino, segnale, disdetta } }  (passi 2d, 2h e 2q)
//   POST /app/api/incontro  { azione: "disdici", porta }                              → disdici_incontro
//        «Disdici» (spec v1.1, passo 2m): esito «disdetto» (da fissare) o «disdetto_tardi» (buca di chi disdice)
//   POST /app/api/incontro  { azione: "annulla", porta }                              → annulla_incontro
//        «Annulla l'incontro» (passo 2o): esito «annullato», crediti a entrambi, poi nessuna proposta
//   Passo 2u (D143 B): il GET aggiunge a «incontro» locali [{ id, nome, indirizzo, tipo, fascia, da_verificare }] (quelli
//   che chi legge può proporre) e locale_scelto { nome, indirizzo, da_verificare } | null, da locali_incontro. Se quella
//   lettura non va, l'incontro si legge lo stesso, senza locali.
// Chi propone o risponde lo dice SOLO il token, mai il corpo. Le regole (orari 10:00–23:00 di Roma ogni 30 minuti da
// domani alla scadenza, un solo luogo, 3 controproposte, 48 ore, scadenza, crediti) le applica il database: qui solo
// la forma dei dati. Spento finché ACCESSO_APP non vale «si». Nei log solo nomi delle funzioni e codici, mai dati.
import { risposta, chiEDavvero, leggiCorpo } from "./supporto_api.js";

export const PERCORSO_INCONTRO = "/app/api/incontro";
const CORPO_MASSIMO = 1024;
const ATTESA_SUPABASE_MS = 1500;
const TESTO_MASSIMO = 200; // il database ammette 80 caratteri: qui si scarta solo ciò che è chiaramente sbagliato
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const RISPOSTE = ["accetto", "annulla"];
const RIUSCITI = { proponi_incontro: ["proposto", "controproposto"], rispondi_incontro: ["confermato", "annullato"],
  checkin_incontro: ["sono_qui", "avvenuto"],
  // Passo 2m (spec v1.1): «Disdici» → «disdetto» (torna da fissare) o «disdetto_tardi» (buca di chi disdice).
  disdici_incontro: ["disdetto", "disdetto_tardi"],
  // Passo 2o (spec v1.1): «Annulla l'incontro» da «da fissare» o con una proposta in corso → crediti a entrambi.
  annulla_incontro: ["annullato"] };
const RIFIUTI = {
  proponi_incontro: ["orario_non_valido", "prima_di_domani", "fuori_orario", "non_sul_passo", "dopo_la_scadenza",
    "luogo_non_valido", "attendi_risposta", "controproposte_finite", "gia_confermato", "incontro_chiuso", "incontro_scaduto"],
  rispondi_incontro: ["nessuna_proposta", "proposta_scaduta", "non_puoi_rispondere", "orario_passato", "incontro_chiuso",
    "incontro_scaduto"],
  checkin_incontro: ["troppo_presto", "troppo_tardi", "non_confermato", "gia_fatto", "incontro_chiuso"],
  disdici_incontro: ["non_confermato", "troppo_tardi", "incontro_chiuso", "incontro_scaduto"],
  annulla_incontro: ["gia_confermato", "incontro_chiuso", "incontro_scaduto"],
};
const NON_TROVATO = ["non_nella_porta", "nessun_incontro"];
// Campi dello stato che arrivano al telefono: solo questi, anche se il database ne mandasse altri.
const CAMPI_STATO = ["stato", "scadenza", "orario", "locale", "luogo", "proposta_mia", "proposta_scade",
  "controproposte_rimaste", "azioni", "ritardo_minuti", "esito",
  // Passo 2h: check-in «Sono qui» (solo sì/no, mai orari esatti dell'altro), finestra e segnale dopo i due check-in.
  "checkin_mio", "checkin_altro", "checkin_da", "checkin_fino", "segnale",
  // Passo 2q (spec v1.1): disdetta in tempo { mia, il, orario }, ripulita da soloDisdetta.
  "disdetta"];
const STATI = ["da_fissare", "proposto", "confermato", "concluso"];
const dati = () => risposta(400, { ok: false, motivo: "dati" });
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

async function rpc(s, nome, argomenti, f) {
  try {
    const r = await entro(ATTESA_SUPABASE_MS, f(`${s.base}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: { apikey: s.chiave, authorization: `Bearer ${s.chiave}`, "content-type": "application/json" },
      body: JSON.stringify(argomenti),
    }));
    if (!r.ok) {
      console.error(`incontro: ${nome} risposta ${r.status}`);
      return undefined;
    }
    return await r.json();
  } catch (e) {
    console.error(`incontro: ${nome} errore`, e && e.name);
    return undefined;
  }
}

// Esito del database → risposta al telefono. Un esito che non conosciamo è un guasto: «riprova», mai un successo.
async function esegui(s, nome, argomenti, f) {
  const esito = await rpc(s, nome, argomenti, f);
  if (RIUSCITI[nome].includes(esito)) return risposta(200, { ok: true, esito });
  if (RIFIUTI[nome].includes(esito)) return risposta(200, { ok: false, motivo: esito });
  if (NON_TROVATO.includes(esito)) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (esito !== undefined) console.error(`incontro: ${nome} esito sconosciuto`);
  return riprova();
}

// Testo facoltativo: assente → null; stringa non troppo lunga → così com'è (gli spazi li toglie il database); altro → errore.
function testo(x) {
  if (x === undefined || x === null) return { valore: null };
  if (typeof x !== "string" || x.length > TESTO_MASSIMO) return { errore: true };
  return { valore: x };
}

export async function incontroApi(request, env, f = fetch) {
  if (new URL(request.url).pathname !== PERCORSO_INCONTRO) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (request.method !== "POST" && request.method !== "GET") return risposta(405, { ok: false, motivo: "metodo" }, { allow: "GET, POST" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const s = server(env);
  if (!s) return riprova();
  const chi = await chiEDavvero(request, env, f);
  if (chi.errore) return chi.errore;
  if (request.method === "GET") return stato(s, request, chi, f);

  const corpo = await leggiCorpo(request, CORPO_MASSIMO);
  if (corpo.errore) return corpo.errore;
  const { azione, porta } = corpo.dati || {};
  if (!UUID.test(String(porta || ""))) return dati();

  if (azione === "proponi") {
    const { orario } = corpo.dati;
    if (typeof orario !== "string" || !ISO.test(orario) || !Number.isFinite(Date.parse(orario))) return dati();
    const locale = testo(corpo.dati.locale);
    const luogo = testo(corpo.dati.luogo);
    if (locale.errore || luogo.errore) return dati();
    return esegui(s, "proponi_incontro",
      { p_porta: porta, p_persona: chi.id, p_orario: new Date(Date.parse(orario)).toISOString(), p_locale: locale.valore, p_luogo: luogo.valore }, f);
  }
  if (azione === "rispondi") {
    const { risposta: scelta } = corpo.dati;
    if (!RISPOSTE.includes(scelta)) return dati();
    return esegui(s, "rispondi_incontro", { p_porta: porta, p_persona: chi.id, p_risposta: scelta }, f);
  }
  if (azione === "checkin") return esegui(s, "checkin_incontro", { p_porta: porta, p_persona: chi.id }, f);
  if (azione === "disdici") return esegui(s, "disdici_incontro", { p_porta: porta, p_persona: chi.id }, f);
  if (azione === "annulla") return esegui(s, "annulla_incontro", { p_porta: porta, p_persona: chi.id }, f);
  return dati();
}

// Disdetta nello stato (passo 2q): solo «mia» sì/no e due orari, mai chi ha disdetto. Forma diversa → null.
const orarioONull = (v) => v === null || (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)));
const TIPI_LOCALE = ["bar", "wine bar", "caffè", "bistrot", "cocktail bar", "enoteca"];
const LOCALI_MASSIMI = 40;
const breve = (v, max) => typeof v === "string" && v.length >= 1 && v.length <= max;
function soloLocale(l) {
  if (!l || typeof l !== "object" || Array.isArray(l) || !UUID.test(String(l.id)) || !breve(l.nome, 80)
    || !breve(l.indirizzo, 120) || !TIPI_LOCALE.includes(l.tipo) || typeof l.da_verificare !== "boolean"
    || !(l.fascia === null || l.fascia === undefined || breve(l.fascia, 40))) return null;
  return { id: l.id, nome: l.nome, indirizzo: l.indirizzo, tipo: l.tipo, fascia: l.fascia ?? null, da_verificare: l.da_verificare };
}
function soloScelto(l) {
  if (!l || typeof l !== "object" || !breve(l.nome, 80) || !breve(l.indirizzo, 120) || typeof l.da_verificare !== "boolean") return null;
  return { nome: l.nome, indirizzo: l.indirizzo, da_verificare: l.da_verificare };
}
function soloLocali(r) {
  const elenco = r && typeof r === "object" && Array.isArray(r.locali) ? r.locali.map(soloLocale).filter(Boolean).slice(0, LOCALI_MASSIMI) : [];
  return { locali: elenco, locale_scelto: r && typeof r === "object" ? soloScelto(r.scelto) : null };
}
function soloDisdetta(d) {
  if (!d || typeof d !== "object" || Array.isArray(d) || typeof d.mia !== "boolean") return null;
  const il = d.il ?? null;
  const orario = d.orario ?? null;
  if (!orarioONull(il) || !orarioONull(orario)) return null;
  return { mia: d.mia, il, orario };
}

// Stato dell'incontro per la persona del token. Un errore noto → 404 senza dire perché; una risposta di forma
// sconosciuta è un guasto → «riprova».
async function stato(s, request, chi, f) {
  const porta = new URL(request.url).searchParams.get("porta") || "";
  if (!UUID.test(porta)) return dati();
  const r = await rpc(s, "stato_incontro", { p_porta: porta, p_persona: chi.id }, f);
  if (r && typeof r === "object" && NON_TROVATO.includes(r.errore)) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (!r || typeof r !== "object" || !STATI.includes(r.stato) || !Array.isArray(r.azioni)) {
    if (r !== undefined) console.error("incontro: stato_incontro forma sconosciuta");
    return riprova();
  }
  const incontro = Object.fromEntries(CAMPI_STATO.map((k) => [k, r[k] ?? null]));
  incontro.disdetta = soloDisdetta(r.disdetta);
  Object.assign(incontro, soloLocali(await rpc(s, "locali_incontro", { p_porta: porta, p_persona: chi.id }, f)));
  return risposta(200, { ok: true, incontro });
}

// Limite di frequenza: stesso binding gratuito delle altre richieste (LIMITE_PROVINCIA), chiave a parte. L'IP serve
// solo a contare in memoria, mai salvato.
async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "incontro:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}
