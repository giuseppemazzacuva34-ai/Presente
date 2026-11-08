// Contatore della zona nella home (issue #3, spec v1.2 del CPO, D121 A): l'app chiede al Worker solo il testo
// «Milano e dintorni: mancano 7 persone…». Area e numeri li calcola il server; al telefono non arriva nient'altro.
// Mai più di 2 secondi e mai un blocco: ogni problema → nessun contatore.

export const ATTESA_MS = 2000;
const PERCORSO = "/app/api/zona";

export function creaZona({ token, fetch: f = globalThis.fetch, attesa = ATTESA_MS }) {
  return {
    // Testo del contatore oppure null (area accesa, estero, problemi di rete).
    async leggi() {
      const t = await token().catch(() => null);
      if (!t) return null;
      const ferma = new AbortController();
      const timer = setTimeout(() => ferma.abort(), attesa);
      try {
        const r = await f(PERCORSO, { method: "GET", signal: ferma.signal, headers: { authorization: `Bearer ${t}` } });
        if (!r.ok) return null;
        const dati = await r.json();
        return dati && typeof dati.testo === "string" && dati.testo ? dati.testo : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
