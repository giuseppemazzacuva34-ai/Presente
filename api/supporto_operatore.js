// Chi risponde a «Scrivici» (issue #10, spec v1 del CPO, parte A, passo 4b della linea «sviluppatore-c»).
// Il ruolo «supporto» lo decide il database (tabella operatori_supporto, migrazione 20261116205504): qui solo la forma
// dei dati. La coda contiene solo id, email, categoria, testo, data, stato e bandiera «sicurezza»: mai voce, foto,
// questionario, diario, chiavi o valutazioni. Nei log solo codici e nomi di errore: mai testi, risposte o email.

export const MAX_RISPOSTA = 4000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const no = (motivo) => ({ ok: false, motivo });
const lunghezza = (s) => [...s].length;

// d = { coda({ operatore }) → righe | "non_operatore" | null }
export async function codaOperatore({ operatore }, d) {
  if (!UUID.test(operatore || "")) return no("dati");
  const righe = await d.coda({ operatore });
  if (righe === "non_operatore") return no("non_autorizzato");
  if (!Array.isArray(righe)) return no("riprova");
  return {
    ok: true,
    messaggi: righe.map((r) => ({
      id: r.id, email: r.email, categoria: r.categoria, testo: r.testo, creatoIl: r.creato_il,
      stato: r.stato === "risposto" ? "risposto" : "inviato", sicurezza: r.sicurezza === true,
    })),
  };
}

// d = { rispondi({ operatore, id, risposta }) → true | false | "non_operatore" | null }
export async function rispondiOperatore({ operatore, corpo }, d) {
  const c = corpo && typeof corpo === "object" ? corpo : {};
  if (!UUID.test(operatore || "") || !UUID.test(String(c.id || ""))) return no("dati");
  if (typeof c.risposta !== "string" || lunghezza(c.risposta) > MAX_RISPOSTA) return no("dati");
  if (c.risposta.trim() === "") return no("vuoto");
  const r = await d.rispondi({ operatore, id: c.id, risposta: c.risposta });
  if (r === true) return { ok: true };
  if (r === false) return no("gia_risposto");
  if (r === "non_operatore") return no("non_autorizzato");
  return no("riprova");
}

// Bozze dell'agente (parte B, D122 B): Giuseppe le vede accanto al messaggio e sceglie «Invia così · Modifica e
// invia · Scarta e scrivo io». Inviare passa da rispondiOperatore: nessuna risposta parte senza il suo tocco.
// d = { bozze({ operatore }) → righe | "non_operatore" | null }
export async function bozzeOperatore({ operatore }, d) {
  if (!UUID.test(operatore || "")) return no("dati");
  const righe = await d.bozze({ operatore });
  if (righe === "non_operatore") return no("non_autorizzato");
  if (!Array.isArray(righe)) return no("riprova");
  return {
    ok: true,
    bozze: righe.map((r) => ({
      id: r.messaggio_id, testo: r.testo, fonte: r.fonte, conIstruzioni: r.con_istruzioni === true, creataIl: r.creato_il,
    })),
  };
}

// d = { scarta({ operatore, id }) → true | false | "non_operatore" | null }
export async function scartaOperatore({ operatore, corpo }, d) {
  const c = corpo && typeof corpo === "object" ? corpo : {};
  if (!UUID.test(operatore || "") || !UUID.test(String(c.id || ""))) return no("dati");
  const r = await d.scarta({ operatore, id: c.id });
  if (r === true) return { ok: true };
  if (r === false) return no("gia_tolta");
  if (r === "non_operatore") return no("non_autorizzato");
  return no("riprova");
}

// ---------------------------------------------------------------------------------------------------------
// Database vero (solo server, chiave service_role). Errore «non_operatore» → "non_operatore"; altro → null.
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const ATTESA_MS = 1500;

async function rpc(env, nome, corpo, f) {
  const base = String(env?.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const chiave = String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!URL_SUPABASE.test(base) || !chiave) return null;
  let timer;
  try {
    const r = await Promise.race([
      f(`${base}/rest/v1/rpc/${nome}`, {
        method: "POST",
        headers: { apikey: chiave, authorization: `Bearer ${chiave}`, "content-type": "application/json" },
        body: JSON.stringify(corpo),
      }),
      new Promise((_, rifiuta) => { timer = setTimeout(() => rifiuta(new Error("tempo scaduto")), ATTESA_MS); }),
    ]);
    if (!r.ok) {
      let errore = null;
      try { errore = await r.json(); } catch { /* corpo non JSON */ }
      if (errore && errore.message === "non_operatore") return "non_operatore";
      console.error("supporto operatore: risposta", r.status);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.error("supporto operatore: errore", e && e.name);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function codaDb(env, { operatore }, f = fetch) {
  if (!UUID.test(operatore || "")) return null;
  return rpc(env, "coda_supporto_operatore", { p_operatore: operatore }, f);
}

export async function rispondiDb(env, { operatore, id, risposta }, f = fetch) {
  if (!UUID.test(operatore || "") || !UUID.test(id || "")) return null;
  return rpc(env, "rispondi_supporto_operatore", { p_operatore: operatore, p_id: id, p_risposta: risposta }, f);
}

export async function bozzeDb(env, { operatore }, f = fetch) {
  if (!UUID.test(operatore || "")) return null;
  return rpc(env, "bozze_supporto_operatore", { p_operatore: operatore }, f);
}

export async function scartaDb(env, { operatore, id }, f = fetch) {
  if (!UUID.test(operatore || "") || !UUID.test(id || "")) return null;
  return rpc(env, "scarta_bozza_operatore", { p_operatore: operatore, p_id: id }, f);
}
