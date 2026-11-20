// Chi risponde a «Scrivici» (issue #10, parte A, passo 4b della linea «sviluppatore-c»): le richieste del Worker.
//
//   GET  /app/api/supporto/coda                      → { ok: true, messaggi: [...] } | 403 «non_autorizzato»
//   POST /app/api/supporto/risposta { id, risposta } → { ok: true } | { ok: false, motivo }
//   GET  /app/api/supporto/bozze                     → { ok: true, bozze: [...] } (bozze dell'agente, parte B)
//   POST /app/api/supporto/scarta { id }             → { ok: true } | { ok: false, motivo } («Scarta e scrivo io»)
//
// Chi chiama lo dice SOLO il token di Supabase; se ha il ruolo «supporto» lo decide il database. Le regole sono in
// api/supporto_operatore.js. Nei log solo nomi di errore, mai token, testi, risposte o email. Spento finché
// ACCESSO_APP non vale «si».
import { codaOperatore, rispondiOperatore, codaDb, rispondiDb, bozzeOperatore, scartaOperatore, bozzeDb, scartaDb } from "../api/supporto_operatore.js";
import { PERCORSO_SUPPORTO, risposta, chiEDavvero, leggiCorpo, troppeRichieste } from "./supporto_api.js";

export const PERCORSO_CODA = PERCORSO_SUPPORTO + "/coda";
export const PERCORSO_RISPOSTA = PERCORSO_SUPPORTO + "/risposta";
export const PERCORSO_BOZZE = PERCORSO_SUPPORTO + "/bozze";
export const PERCORSO_SCARTA = PERCORSO_SUPPORTO + "/scarta";
const METODI = { [PERCORSO_CODA]: "GET", [PERCORSO_RISPOSTA]: "POST", [PERCORSO_BOZZE]: "GET", [PERCORSO_SCARTA]: "POST" };
const CORPO_MASSIMO = 20 * 1024; // 4.000 caratteri anche da 4 byte, più l'id

export async function supportoOperatoreApi(request, env, f = fetch) {
  const percorso = new URL(request.url).pathname;
  const metodo = Object.hasOwn(METODI, percorso) ? METODI[percorso] : null;
  if (!metodo) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (request.method !== metodo) return risposta(405, { ok: false, motivo: "metodo" }, { allow: metodo });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });

  const chi = await chiEDavvero(request, env, f);
  if (chi.errore) return chi.errore;
  try {
    let r;
    if (percorso === PERCORSO_BOZZE) {
      r = await bozzeOperatore({ operatore: chi.id }, { bozze: (q) => bozzeDb(env, q, f) });
      if (r && r.ok) return risposta(200, { ok: true, bozze: r.bozze });
    } else if (percorso === PERCORSO_SCARTA) {
      const corpo = await leggiCorpo(request, CORPO_MASSIMO);
      if (corpo.errore) return corpo.errore;
      r = await scartaOperatore({ operatore: chi.id, corpo: corpo.dati }, { scarta: (q) => scartaDb(env, q, f) });
      if (r && r.ok) return risposta(200, { ok: true });
    } else if (metodo === "GET") {
      r = await codaOperatore({ operatore: chi.id }, { coda: (q) => codaDb(env, q, f) });
      if (r && r.ok) return risposta(200, { ok: true, messaggi: r.messaggi });
    } else {
      const corpo = await leggiCorpo(request, CORPO_MASSIMO);
      if (corpo.errore) return corpo.errore;
      r = await rispondiOperatore({ operatore: chi.id, corpo: corpo.dati }, { rispondi: (q) => rispondiDb(env, q, f) });
      if (r && r.ok) return risposta(200, { ok: true });
    }
    const motivo = String((r && r.motivo) || "riprova");
    if (motivo === "non_autorizzato") return risposta(403, { ok: false, motivo });
    if (motivo === "dati") return risposta(400, { ok: false, motivo });
    if (motivo === "vuoto" || motivo === "gia_risposto" || motivo === "gia_tolta") return risposta(200, { ok: false, motivo });
    return risposta(503, { ok: false, motivo: "riprova" });
  } catch (e) {
    console.error("supporto operatore: errore", e && e.name);
    return risposta(503, { ok: false, motivo: "riprova" });
  }
}
