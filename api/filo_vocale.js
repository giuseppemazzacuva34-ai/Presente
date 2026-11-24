// Caricamento del vocale del Filo (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 4a della linea «sviluppatore-c».
// Ordine: dati → la stanza è del Filo (stanze_del_filo) → file nel contenitore privato «vocali_filo» con un nome
// casuale → salva_vocale_filo (orari, durate e permessi li decide il database: migrazione 20261123102100) → si
// cancella il file sostituito. Se il database rifiuta o non risponde, il file appena caricato si cancella.
// Il vocale lo registra il Filo con la sua voce: nessuna voce generata, nessuna analisi dell'audio.
// Nei log solo codici e nomi di errore: mai testo del vocale, nomi o token.
import { stanzeFiloDb } from "./filo.js";

export const MAX_BYTE_VOCALE = 2097152; // come file_size_limit del contenitore
export const ESTENSIONI_AUDIO = Object.freeze({
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/aac": "aac",
});
const DURATA_MAX = Object.freeze({ lunedi: 90, domenica: 60 });
const MOTIVI_DB = new Set(["fuori_orario", "durata", "testo", "non_filo", "tipo", "file"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const no = (motivo) => ({ ok: false, motivo });
const lunghezza = (s) => [...s].length; // come char_length() di Postgres

export const tipoAudio = (t) => String(t || "").split(";")[0].trim().toLowerCase();

function datiGiusti({ filo, stanza, tipo, durata, testo, audio, ora }) {
  if (!UUID.test(filo || "") || !UUID.test(stanza || "")) return false;
  if (!Object.hasOwn(DURATA_MAX, tipo)) return false;
  if (!Number.isInteger(durata) || durata < 10 || durata > DURATA_MAX[tipo]) return false;
  if (typeof testo !== "string" || testo.trim() === "" || lunghezza(testo.trim()) > 900) return false;
  if (!audio || typeof audio !== "object" || !Object.hasOwn(ESTENSIONI_AUDIO, tipoAudio(audio.tipo))) return false;
  if (!Number.isInteger(audio.byte) || audio.byte < 1 || audio.byte > MAX_BYTE_VOCALE) return false;
  return typeof ora === "string" && !Number.isNaN(Date.parse(ora));
}

// d = { stanze({ filo, ora }) → righe | null, carica({ percorso, tipoAudio, audio }) → bool,
//       salva({ filo, stanza, tipo, file, durata, testo, ora }) → { ok: true, vecchio } | { ok: false, motivo } | null,
//       cancella([percorsi]) → bool }
export async function caricaVocaleFilo(v, d) {
  if (!v || typeof v !== "object" || !datiGiusti(v)) return no("dati");
  const { filo, stanza, tipo, durata, ora } = v;
  const testo = v.testo.trim();

  const righe = await d.stanze({ filo, ora });
  if (!Array.isArray(righe)) return no("riprova");
  if (!righe.some((r) => r && r.id === stanza)) return no("non_filo");

  const formato = tipoAudio(v.audio.tipo);
  const file = `${crypto.randomUUID()}.${ESTENSIONI_AUDIO[formato]}`;
  const percorso = `${stanza}/${file}`;
  if (!(await d.carica({ percorso, tipoAudio: formato, audio: v.audio }))) return no("riprova");

  const esito = await d.salva({ filo, stanza, tipo, file, durata, testo, ora });
  if (!esito || esito.ok !== true) {
    await d.cancella([percorso]);
    return no(esito && MOTIVI_DB.has(esito.motivo) ? esito.motivo : "riprova");
  }
  if (typeof esito.vecchio === "string" && esito.vecchio && esito.vecchio !== percorso) {
    if (!(await d.cancella([esito.vecchio]))) console.error("filo_vocale: file vecchio non cancellato");
  }
  return { ok: true, tipo, durata };
}

// ---------------------------------------------------------------------------------------------------------
// Supabase vero (solo server, chiave service_role).
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const ATTESA_MS = 1500;
const ATTESA_FILE_MS = 8000;
const CONTENITORE = "vocali_filo";

function server(env) {
  const base = String(env?.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const chiave = String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return URL_SUPABASE.test(base) && chiave ? { base, chiave } : null;
}

async function entro(ms, promessa) {
  let timer;
  try {
    return await Promise.race([promessa, new Promise((_, no) => { timer = setTimeout(() => no(new Error("tempo scaduto")), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

export const stanzeVocaleDb = (env, a, f = fetch) => stanzeFiloDb(env, a, f);

// audio.corpo: ArrayBuffer/Uint8Array/Blob con i byte del vocale.
export async function caricaFileDb(env, { percorso, tipoAudio: formato, audio }, f = fetch) {
  const s = server(env);
  if (!s) return false;
  try {
    const r = await entro(ATTESA_FILE_MS, f(`${s.base}/storage/v1/object/${CONTENITORE}/${percorso}`, {
      method: "POST",
      headers: { apikey: s.chiave, authorization: `Bearer ${s.chiave}`, "content-type": formato, "x-upsert": "false" },
      body: audio.corpo,
    }));
    if (!r.ok) console.error("filo_vocale: caricamento", r.status);
    return r.ok;
  } catch (e) {
    console.error("filo_vocale: caricamento", e && e.name);
    return false;
  }
}

export async function cancellaFileDb(env, percorsi, f = fetch) {
  const s = server(env);
  if (!s) return false;
  try {
    const r = await entro(ATTESA_MS, f(`${s.base}/storage/v1/object/${CONTENITORE}`, {
      method: "DELETE",
      headers: { apikey: s.chiave, authorization: `Bearer ${s.chiave}`, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: percorsi }),
    }));
    if (!r.ok) console.error("filo_vocale: cancellazione", r.status);
    return r.ok;
  } catch (e) {
    console.error("filo_vocale: cancellazione", e && e.name);
    return false;
  }
}

export async function salvaVocaleDb(env, { filo, stanza, tipo, file, durata, testo, ora }, f = fetch) {
  const s = server(env);
  if (!s) return null;
  try {
    const r = await entro(ATTESA_MS, f(`${s.base}/rest/v1/rpc/salva_vocale_filo`, {
      method: "POST",
      headers: { apikey: s.chiave, authorization: `Bearer ${s.chiave}`, "content-type": "application/json" },
      body: JSON.stringify({ p_filo: filo, p_stanza: stanza, p_tipo: tipo, p_file: file, p_durata: durata,
        p_testo: testo, p_ora: ora }),
    }));
    if (!r.ok) {
      let errore = null;
      try { errore = await r.json(); } catch { /* corpo non JSON */ }
      const motivo = errore && typeof errore.message === "string" ? errore.message : "";
      if (MOTIVI_DB.has(motivo)) return { ok: false, motivo };
      console.error("filo_vocale: salvataggio", r.status);
      return null;
    }
    const vecchio = await r.json();
    return { ok: true, vecchio: typeof vecchio === "string" ? vecchio : null };
  } catch (e) {
    console.error("filo_vocale: salvataggio", e && e.name);
    return null;
  }
}
