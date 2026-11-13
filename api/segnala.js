// Invio di una segnalazione dal telefono (issue #7, spec v1.1, passo 3 della linea «sviluppatore-b»).
// Chi segnala lo dice SOLO il token (worker/segnala_api.js), mai il corpo. Le regole del modulo sono quelle di
// api/segnalazioni.js; il salvataggio (segnalazione + blocco, nella stessa transazione) è la funzione del database
// nuova_segnalazione() (migrazione 20261113145000_segnalazioni.sql), chiamata solo con la chiave del server.
// Si segnala solo chi si è incontrato nell'app: stessa stanza aperta adesso o una chiamata negli ultimi 30 giorni
// (porta e appuntamento si aggiungono con #5 e #6). Così nessuno può segnalare o bloccare un id qualsiasi.
// Al telefono tornano solo le ore di revisione e se mostrare il 112: mai id, nomi o dati dell'altra persona.
// Nei log solo codici e nomi di errore. Prossimi passi: sospensione cautelare e avviso al responsabile (1 ora).
import { MOTIVI, ORIGINI, LIMITI, priorita, bloccaDopo, validaSegnalazione } from "./segnalazioni.js";

// «Non mi sono sentita/o al sicuro» e l'origine «valutazione» arrivano dal server della #6, non dal telefono.
export const MOTIVI_DAL_TELEFONO = Object.freeze(Object.keys(MOTIVI).filter((m) => m !== "non_al_sicuro"));
export const ORIGINI_DAL_TELEFONO = Object.freeze(ORIGINI.filter((o) => o !== "valutazione"));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const no = (motivo) => ({ ok: false, motivo });

// d = { conosce({ da, contro, adesso }) → true | false | null, salva({ da, contro, motivo, origine, testo, blocca }) → id | null }
export async function segnala({ da, corpo, adesso = new Date() }, d) {
  const c = corpo && typeof corpo === "object" ? corpo : {};
  const contro = c.contro ?? null;
  const testo = c.testo ?? "";
  if (!UUID.test(da || "")) return no("dati");
  if (contro !== null && !UUID.test(String(contro))) return no("dati");
  if (!MOTIVI_DAL_TELEFONO.includes(c.motivo) || !ORIGINI_DAL_TELEFONO.includes(c.origine)) return no("dati");
  if (c.blocca !== undefined && typeof c.blocca !== "boolean") return no("dati");
  if (typeof testo !== "string" || testo.length > LIMITI.testoSegnalazione) return no("dati");
  const v = validaSegnalazione({ da, contro: contro ?? undefined, motivo: c.motivo, origine: c.origine, testo, chiamataIl: c.chiamataIl }, adesso);
  if (!v.ok) return no(v.errore === "scaduta" ? "scaduta" : "dati");

  if (contro !== null) {
    const conosce = await d.conosce({ da, contro, adesso });
    if (conosce === null || conosce === undefined) return no("riprova");
    if (conosce !== true) return no("persona");
  }
  const id = await d.salva({ da, contro, motivo: c.motivo, origine: c.origine, testo, blocca: bloccaDopo(c.origine, c.blocca ?? true) });
  if (!id) return no("riprova");
  const ore = priorita(c.motivo);
  return { ok: true, ore, pericolo: ore === 1 };
}

// ---------------------------------------------------------------------------------------------------------
// Database vero (solo server, chiave service_role). Se qualcosa non va: null → «riprova».
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const ATTESA_MS = 1500;
const GIORNO = 24 * 60 * 60 * 1000;

function server(env) {
  const base = String(env?.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const chiave = String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return URL_SUPABASE.test(base) && chiave
    ? { base, headers: { apikey: chiave, authorization: `Bearer ${chiave}`, "content-type": "application/json" } } : null;
}

async function chiedi(s, percorso, f, opzioni = {}) {
  let timer;
  try {
    const r = await Promise.race([
      f(`${s.base}/rest/v1/${percorso}`, { headers: s.headers, ...opzioni }),
      new Promise((_, rifiuta) => { timer = setTimeout(() => rifiuta(new Error("tempo scaduto")), ATTESA_MS); }),
    ]);
    if (!r.ok) {
      console.error("segnala: risposta", r.status);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.error("segnala: errore", e && e.name);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// true se le due persone sono nella stessa stanza aperta adesso o si sono chiamate negli ultimi 30 giorni.
export async function conosceDb(env, { da, contro, adesso }, f = fetch) {
  const s = server(env);
  if (!s || !UUID.test(da || "") || !UUID.test(contro || "")) return null;
  const ora = encodeURIComponent(adesso.toISOString());
  const da30 = encodeURIComponent(new Date(adesso.getTime() - LIMITI.storicoGiorni * GIORNO).toISOString());
  const [chiamate, stanze] = await Promise.all([
    chiedi(s, `chiamate?select=inizio&or=(and(chi.eq.${da},con.eq.${contro}),and(chi.eq.${contro},con.eq.${da}))&inizio=gte.${da30}&limit=1`, f),
    chiedi(s, `membri_stanza?utente_id=in.(${da},${contro})&select=utente_id,stanze!inner(id)`
      + `&stanze.apre_il=lte.${ora}&stanze.chiude_il=gt.${ora}`, f),
  ]);
  if (!Array.isArray(chiamate) || !Array.isArray(stanze)) return null;
  if (chiamate.length > 0) return true;
  const mie = new Set(stanze.filter((r) => r.utente_id === da).map((r) => r.stanze?.id));
  return stanze.some((r) => r.utente_id === contro && mie.has(r.stanze?.id));
}

export async function salvaDb(env, q, f = fetch) {
  const s = server(env);
  if (!s) return null;
  const id = await chiedi(s, "rpc/nuova_segnalazione", f, {
    method: "POST",
    body: JSON.stringify({ p_da: q.da, p_contro: q.contro, p_motivo: q.motivo, p_origine: q.origine, p_testo: q.testo, p_blocca: q.blocca }),
  });
  return typeof id === "string" && UUID.test(id) ? id : null;
}
