// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 3a della linea «sviluppatore-c»:
// il pannello del Filo lato server. Chi è Filo, quali stanze segue e quali nomi può leggere lo decide il database
// (fili_stanza, stanze_del_filo, nomi_stanza_filo: migrazione 20261123095357). Qui solo la forma dei dati: per ogni
// stanza id, nome della stanza, apertura, chiusura e i nomi di battesimo dei membri. Mai email, telefono, provincia,
// età, foto, voce, questionario, diario, chiavi, segnalazioni, Coin. Nei log solo codici e nomi di errore, mai nomi.

export const REGOLE_FILO =
  "Le regole: solo voce, 15 minuti · niente numeri né social prima della porta · rispetto, sempre · chi dà buca paga.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const no = (motivo) => ({ ok: false, motivo });
const oraValida = (ora) => typeof ora === "string" && !Number.isNaN(Date.parse(ora));

// d = { stanze({ filo, ora }) → righe | null, nomi({ filo, stanza, ora }) → righe | "non_filo" | null }
export async function pannelloFilo({ filo, ora }, d) {
  if (!UUID.test(filo || "") || !oraValida(ora)) return no("dati");
  const righe = await d.stanze({ filo, ora });
  if (!Array.isArray(righe)) return no("riprova");
  const stanze = [];
  for (const s of righe) {
    const nomi = await d.nomi({ filo, stanza: s.id, ora });
    if (nomi === "non_filo") continue; // stanza chiusa tra le due letture
    if (!Array.isArray(nomi)) return no("riprova");
    stanze.push({
      id: s.id, nome: s.nome ?? null, apreIl: s.apre_il, chiudeIl: s.chiude_il,
      nomi: nomi.map((n) => n.nome),
    });
  }
  return { ok: true, regole: REGOLE_FILO, stanze };
}

// ---------------------------------------------------------------------------------------------------------
// Database vero (solo server, chiave service_role). Errore «non_filo» → "non_filo"; altro → null.
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
      if (errore && errore.message === "non_filo") return "non_filo";
      console.error("filo: risposta", r.status);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.error("filo: errore", e && e.name);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function stanzeFiloDb(env, { filo, ora }, f = fetch) {
  if (!UUID.test(filo || "") || !oraValida(ora)) return null;
  return rpc(env, "stanze_del_filo", { p_filo: filo, p_ora: ora }, f);
}

export async function nomiFiloDb(env, { filo, stanza, ora }, f = fetch) {
  if (!UUID.test(filo || "") || !UUID.test(stanza || "") || !oraValida(ora)) return null;
  return rpc(env, "nomi_stanza_filo", { p_filo: filo, p_stanza: stanza, p_ora: ora }, f);
}
