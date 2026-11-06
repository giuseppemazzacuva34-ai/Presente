// Provincia dalla lista d'attesa (#2, specifica v1.3 del CPO): l'app chiede al Worker solo la sigla.
// Il Worker cerca nella lista l'email confermata del login; al telefono non arriva nessun altro dato della lista.
// Regola della spec: mai più di 2 secondi e mai un blocco. Ogni problema → nessuna precompilazione, si va avanti.
import { nomeMenu } from "./province.js";

export const ATTESA_MS = 2000;
const PERCORSO = "/app/api/provincia-lista";

export function creaLista({ token, fetch: f = globalThis.fetch, attesa = ATTESA_MS }) {
  async function chiama(opzioni) {
    const t = await token().catch(() => null);
    if (!t) return null;
    const ferma = new AbortController();
    const timer = setTimeout(() => ferma.abort(), attesa);
    try {
      const r = await f(PERCORSO, { ...opzioni, signal: ferma.signal,
        headers: { ...(opzioni.headers || {}), authorization: `Bearer ${t}` } });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    // Sigla della lista (es. «RM») o null.
    async leggi() {
      const dati = await chiama({ method: "GET" });
      const sigla = dati && typeof dati.sigla === "string" ? dati.sigla : "";
      return nomeMenu(sigla) ? sigla : null;
    },
    // Al «Continua» del passo 5 con la provincia della lista non cambiata: il server la salva con origine «lista».
    async conferma(sigla) {
      const dati = await chiama({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sigla }) });
      return Boolean(dati && dati.lista === true);
    },
  };
}
