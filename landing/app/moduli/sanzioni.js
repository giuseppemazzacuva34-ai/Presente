// Messaggio a chi riceve una sanzione e «Contesta» nella web app (issue #7, spec v1.1 definitiva, punti 7-8; D51 A:
// in beta i ricorsi li decide Giuseppe). Passo 12c della linea «sviluppatore-b».
// I dati arrivano SOLO dalle funzioni di Supabase della migrazione *_ricorsi.sql, decise dal token: livello, regola,
// date e stato del ricorso delle proprie sanzioni. Mai chi ha segnalato, racconto o motivo scritto da chi decide.
// Il corpo non dice chi chiede. Niente salvataggi locali, niente log. Il modulo non tocca la pagina (node --test).

const LEGGI = "/rest/v1/rpc/mie_sanzioni";
const RICORSO = "/rest/v1/rpc/nuovo_ricorso";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Testi della spec (punti 7-8).
export const TESTI_SANZIONE = Object.freeze({
  livelli: Object.freeze({
    avviso: "Avviso",
    sospensione_7: "Sospensione di 7 giorni",
    sospensione_30: "Sospensione di 30 giorni",
    esclusione: "Esclusione definitiva",
  }),
  contesta: "Contesta",
  domanda: "Perché pensi che sia sbagliata?",
  conferma: "Risposta entro 7 giorni (14 per l'esclusione definitiva).",
  massimo: 2000,
});

const DATA = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Rome" });
function data(iso) {
  const d = new Date(iso || "");
  return Number.isNaN(d.getTime()) ? "" : DATA.format(d);
}

// Una sanzione da mostrare: { id, titolo, regola, fine, contesta, stato } oppure null se la riga non è valida.
export function voceSanzione(riga) {
  if (!riga || typeof riga !== "object" || !UUID.test(riga.id || "")) return null;
  if (!Object.hasOwn(TESTI_SANZIONE.livelli, riga.livello)) return null;
  const regola = typeof riga.regola === "string" && riga.regola.trim() ? `Regola violata: ${riga.regola.trim()}` : "";
  const fine = riga.fine_il && data(riga.fine_il) ? `Fino al ${data(riga.fine_il)}` : "";
  let stato = "";
  if (riga.ricorso_stato === "in_attesa") stato = `Ricorso inviato: risposta entro il ${data(riga.risposta_entro)}.`;
  return { id: riga.id, titolo: TESTI_SANZIONE.livelli[riga.livello], regola, fine, contesta: riga.contestabile === true, stato };
}

export function creaSanzioni({ supabaseUrl, supabaseAnonKey, token, fetch: f = globalThis.fetch }) {
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
    return { ok: r.ok, r };
  }
  return {
    // { ok: true, sanzioni: [voce…] } oppure { ok: false, motivo: "accesso" | "rete" | "lettura" }.
    async leggi() {
      const x = await chiama(LEGGI, {});
      if (x.motivo) return x;
      if (!x.ok) return { ok: false, motivo: "lettura" };
      let righe;
      try { righe = await x.r.json(); } catch { return { ok: false, motivo: "lettura" }; }
      return { ok: true, sanzioni: Array.isArray(righe) ? righe.map(voceSanzione).filter(Boolean) : [] };
    },
    // «Contesta»: { ok: true } oppure { ok: false, motivo: "testo" | "id" | "gia_fatto" | "scaduto" | "accesso" | "rete" | "lettura" }.
    async contesta(id, testo) {
      const t = typeof testo === "string" ? testo.trim() : "";
      if (!t || t.length > TESTI_SANZIONE.massimo) return { ok: false, motivo: "testo" };
      if (!UUID.test(id || "")) return { ok: false, motivo: "id" };
      const x = await chiama(RICORSO, { p_sanzione: id, p_testo: t });
      if (x.motivo) return x;
      if (x.ok) return { ok: true };
      let errore = null;
      try { errore = await x.r.json(); } catch { /* corpo vuoto */ }
      const m = errore && typeof errore.message === "string" ? errore.message : "";
      return { ok: false, motivo: m === "gia_fatto" || m === "scaduto" ? m : "lettura" };
    },
  };
}
