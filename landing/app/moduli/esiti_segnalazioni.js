// Esito per chi segnala nella web app (issue #7, spec v1.1 definitiva, passo 4: «Alla chiusura, notifica in app:
// «Abbiamo esaminato la tua segnalazione e preso i provvedimenti necessari.» oppure «…: non abbiamo trovato violazioni
// delle regole.» Mai il dettaglio della sanzione»). Passo 10b della linea «sviluppatore-b».
// I dati arrivano SOLO dalle funzioni di Supabase della migrazione *_esiti_segnalazioni.sql, decise dal token:
// id ed esito delle proprie segnalazioni chiuse e non lette. Mai chi è segnalato, motivo, racconto o sanzione.
// Il corpo non dice chi chiede. Niente salvataggi locali, niente log. Il modulo non tocca la pagina (node --test).

const LEGGI = "/rest/v1/rpc/miei_esiti_segnalazioni";
const LETTO = "/rest/v1/rpc/esito_segnalazione_letto";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Gli stessi testi di esitoPerChiSegnala() in api/segnalazioni.js (il test lo controlla).
export const TESTI_ESITO = Object.freeze({
  archiviata: "Abbiamo esaminato la tua segnalazione: non abbiamo trovato violazioni delle regole.",
  provvedimenti: "Abbiamo esaminato la tua segnalazione e preso i provvedimenti necessari.",
  ok: "Ho capito",
});

// Una notifica: { id, testo } oppure null se la riga non è valida.
export function voceEsito(riga) {
  if (!riga || typeof riga !== "object" || !UUID.test(riga.id || "")) return null;
  if (!Object.hasOwn(TESTI_ESITO, riga.esito) || riga.esito === "ok") return null;
  return { id: riga.id, testo: TESTI_ESITO[riga.esito] };
}

export function creaEsiti({ supabaseUrl, supabaseAnonKey, token, fetch: f = globalThis.fetch }) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl || "") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl || "")) {
    throw new Error("Indirizzo Supabase non valido");
  }
  const base = supabaseUrl.replace(/\/+$/, "");
  async function chiama(percorso, corpo) {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return { ok: false, motivo: "accesso" };
    let r;
    try {
      r = await f(`${base}${percorso}`, {
        method: "POST",
        headers: { apikey: supabaseAnonKey, authorization: `Bearer ${t}`, "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });
    } catch {
      return { ok: false, motivo: "rete" };
    }
    if (r.status === 401) return { ok: false, motivo: "accesso" };
    if (!r.ok) return { ok: false, motivo: "lettura" };
    return { ok: true, r };
  }
  return {
    // { ok: true, esiti: [{ id, testo }…] } oppure { ok: false, motivo: "accesso" | "rete" | "lettura" }.
    async leggi() {
      const x = await chiama(LEGGI, {});
      if (!x.ok) return x;
      let righe;
      try { righe = await x.r.json(); } catch { return { ok: false, motivo: "lettura" }; }
      return { ok: true, esiti: Array.isArray(righe) ? righe.map(voceEsito).filter(Boolean) : [] };
    },
    // «Ho capito»: la notifica non torna più.
    async letto(id) {
      if (!UUID.test(id || "")) return { ok: false, motivo: "id" };
      const x = await chiama(LETTO, { p_id: id });
      return x.ok ? { ok: true } : x;
    },
  };
}
