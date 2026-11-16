// «Scrivici» della pagina Aiuto (issue #10, spec v1 del CPO, parte A, passo 2 della linea «sviluppatore-c»).
// Chi scrive lo dice SOLO il token (worker/supporto_api.js), mai il corpo. Il salvataggio, il limite di 5 messaggi al
// giorno e la bandiera «sicurezza» sono nel database (migrazione 20261116105646_supporto.sql), chiamato solo con la
// chiave del server. Qui: forma del messaggio e lettura di «I miei messaggi» (sempre e solo dell'utente del token).
// Nei log solo codici e nomi di errore: mai il testo dei messaggi. Nessuna IA legge questi messaggi (parte B a parte).

export const CATEGORIE = Object.freeze({
  account: "Account e accesso",
  stanza_chiamate: "Stanza e chiamate",
  chiavi_porte: "Chiavi e porte",
  crediti: "Crediti",
  incontro: "Incontro",
  test: "Test",
  altro: "Altro",
});
export const MAX_CARATTERI = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const no = (motivo) => ({ ok: false, motivo });
// Come char_length() di Postgres: una emoji conta 1.
const lunghezza = (s) => [...s].length;

// d = { invia({ utente, categoria, testo }) → { esito, id?, sicurezza? } | null }
export async function inviaSupporto({ utente, corpo }, d) {
  const c = corpo && typeof corpo === "object" ? corpo : {};
  if (!UUID.test(utente || "")) return no("dati");
  if (typeof c.categoria !== "string" || !Object.hasOwn(CATEGORIE, c.categoria)) return no("dati");
  if (typeof c.testo !== "string" || lunghezza(c.testo) > MAX_CARATTERI) return no("dati");
  if (c.testo.trim() === "") return no("vuoto");
  const r = await d.invia({ utente, categoria: c.categoria, testo: c.testo });
  if (!r || typeof r !== "object") return no("riprova");
  if (r.esito === "vuoto" || r.esito === "troppi") return no(r.esito);
  if (r.esito !== "inviato" || !UUID.test(String(r.id || ""))) return no("riprova");
  return { ok: true, id: r.id, sicurezza: r.sicurezza === true };
}

// d = { miei({ utente }) → righe | null }
export async function mieiMessaggi({ utente }, d) {
  if (!UUID.test(utente || "")) return no("dati");
  const righe = await d.miei({ utente });
  if (!Array.isArray(righe)) return no("riprova");
  return {
    ok: true,
    messaggi: righe.map((r) => ({
      id: r.id, categoria: r.categoria, testo: r.testo, creatoIl: r.creato_il,
      stato: r.stato === "risposto" ? "risposto" : "inviato", risposta: r.risposta ?? null, rispostoIl: r.risposto_il ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Database vero (solo server, chiave service_role). Se qualcosa non va: null → «riprova».
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const ATTESA_MS = 1500;

function server(env) {
  const base = String(env?.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const chiave = String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return URL_SUPABASE.test(base) && chiave
    ? { base, headers: { apikey: chiave, authorization: `Bearer ${chiave}`, "content-type": "application/json" } } : null;
}

async function rpc(env, nome, corpo, f) {
  const s = server(env);
  if (!s) return null;
  let timer;
  try {
    const r = await Promise.race([
      f(`${s.base}/rest/v1/rpc/${nome}`, { method: "POST", headers: s.headers, body: JSON.stringify(corpo) }),
      new Promise((_, rifiuta) => { timer = setTimeout(() => rifiuta(new Error("tempo scaduto")), ATTESA_MS); }),
    ]);
    if (!r.ok) {
      console.error("supporto: risposta", r.status);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.error("supporto: errore", e && e.name);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function inviaDb(env, { utente, categoria, testo }, f = fetch) {
  if (!UUID.test(utente || "")) return null;
  return rpc(env, "invia_supporto", { p_utente: utente, p_categoria: categoria, p_testo: testo }, f);
}

export async function mieiDb(env, { utente }, f = fetch) {
  if (!UUID.test(utente || "")) return null;
  return rpc(env, "miei_messaggi_supporto", { p_utente: utente }, f);
}
