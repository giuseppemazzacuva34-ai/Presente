// «La tua stanza» nella web app (issue #4 passo 3c-3a, con la #3): le persone della propria stanza, ognuna con la
// sua scheda e il pulsante «Chiama».
//
// I dati arrivano SOLO dalla funzione compagni_di_stanza() di Supabase (migrazione 20261103220000): nome, età e
// città delle persone compatibili della stanza aperta, decise dal database con il token dell'utente. Mai foto,
// questionario, email o filtri. Qui si tengono solo i quattro campi, nient'altro; niente salvataggi locali.
// Funziona SOLO con l'accesso acceso (ACCESSO_APP = «si»): senza token non parte nessuna richiesta.
// Il modulo non tocca la pagina: riceve fetch e token dall'esterno, così si prova con node --test.

const PERCORSO = "/rest/v1/rpc/compagni_di_stanza";
// Stanza appena chiusa (#5 spec v1.1 passo 9): da domenica 21:00 a lunedì 9:00 di Roma, stessi quattro campi, in sola
// lettura. Si chiede solo quando la stanza aperta non dà nessuno (migrazione 20261115170000).
const PERCORSO_CHIUSA = "/rest/v1/rpc/compagni_stanza_chiusa";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function creaCompagni({ supabaseUrl, supabaseAnonKey, token, fetch: f = globalThis.fetch }) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl || "") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl || "")) {
    throw new Error("Indirizzo Supabase non valido");
  }
  const base = supabaseUrl.replace(/\/+$/, "");

  return {
    // { ok: true, persone: [{ id, nome, eta, citta }] } — con «chiusa: true» se è la stanza appena chiusa (sola
    // lettura) — oppure { ok: false, motivo: "accesso" | "rete" | "lettura" }.
    async leggi() {
      const t = await Promise.resolve().then(token).catch(() => null);
      if (!t) return { ok: false, motivo: "accesso" };
      const aperta = await rpc(PERCORSO, t);
      if (!aperta.ok || aperta.persone.length) return aperta;
      // Nessuna stanza aperta: forse è appena chiusa. Se questa lettura non riesce, la stanza resta semplicemente vuota.
      const chiusa = await rpc(PERCORSO_CHIUSA, t);
      return chiusa.ok && chiusa.persone.length ? { ok: true, chiusa: true, persone: chiusa.persone } : aperta;
    },
    // Design v4, schermata 19 (testata_stanza.js): tipo, città e apertura della stanza aperta adesso, dalla tabella
    // stanze (regola per riga: solo le stanze di cui fai parte). { ok: true, tipo, citta, apreIl } o { ok: false }.
    async stanza(adesso = new Date()) {
      const t = await Promise.resolve().then(token).catch(() => null);
      if (!t) return { ok: false };
      const ora = adesso.toISOString();
      const q = new URLSearchParams({ select: "tipo,citta,apre_il", apre_il: `lte.${ora}`, chiude_il: `gt.${ora}`, order: "apre_il.desc", limit: "1" });
      try {
        const r = await f(`${base}/rest/v1/stanze?${q}`, { method: "GET", headers: { apikey: supabaseAnonKey, authorization: `Bearer ${t}` } });
        if (!r.ok) return { ok: false };
        const [x] = await r.json();
        if (!x || (x.tipo !== "italia" && x.tipo !== "citta") || typeof x.apre_il !== "string") return { ok: false };
        return { ok: true, tipo: x.tipo, citta: typeof x.citta === "string" ? x.citta.trim().slice(0, 60) : null, apreIl: x.apre_il };
      } catch {
        return { ok: false };
      }
    },
  };

  async function rpc(percorso, t) {
    let r;
    try {
      r = await f(`${base}${percorso}`, {
        method: "POST",
        headers: { apikey: supabaseAnonKey, authorization: `Bearer ${t}`, "content-type": "application/json" },
        body: "{}",
      });
    } catch {
      return { ok: false, motivo: "rete" };
    }
    if (r.status === 401) return { ok: false, motivo: "accesso" };
    if (!r.ok) return { ok: false, motivo: "lettura" };
    let righe;
    try { righe = await r.json(); } catch { return { ok: false, motivo: "lettura" }; }
    return { ok: true, persone: pulisci(righe) };
  }
}

// Solo righe con un id valido, una volta sola, e solo i quattro campi; in ordine di nome.
function pulisci(righe) {
  if (!Array.isArray(righe)) return [];
  const viste = new Map();
  for (const x of righe) {
    if (!x || typeof x !== "object" || !UUID.test(x.utente_id || "") || viste.has(x.utente_id)) continue;
    const nome = typeof x.nome === "string" ? x.nome.trim().slice(0, 40) : "";
    if (!nome) continue;
    viste.set(x.utente_id, {
      id: x.utente_id,
      nome,
      eta: Number.isInteger(x.eta) && x.eta >= 18 && x.eta < 120 ? x.eta : null,
      citta: typeof x.citta === "string" ? x.citta.trim().slice(0, 60) : "",
    });
  }
  return [...viste.values()].sort((a, b) => a.nome.localeCompare(b.nome, "it"));
}

// Testi sul pulsante «Chiama» disattivato (spec #4 v1.3 § 2), identici a api/chiamate.js e a chiamata.js. Arrivano
// da GET /app/api/chiamata/pulsanti; si mostra SOLO uno di questi (o l'orario della fascia nella sua forma esatta):
// qualunque altro testo si ignora e il pulsante resta «Chiama» (decide il server al tocco). Mai pausa, numeri o nomi.
const TESTI_PULSANTE = new Set([
  "Avete già parlato 3 volte. Ora tocca alle chiavi",
  "Per oggi hai fatto 5 chiamate. A domani",
  "Per oggi non può ricevere altre chiamate. Riprova domani.",
  "È in un'altra chiamata",
  "Chiedi di parlare",
]);
const TESTO_FASCIA = /^Disponibile (da|domani dalle) ([01]?[0-9]|2[0-4]):[0-5][0-9]$/;
export const testoPulsante = (t) => (typeof t === "string" && (TESTI_PULSANTE.has(t) || TESTO_FASCIA.test(t)) ? t : "");

// Testi della scheda (spec #4 v1, passo 1: «Dalla scheda di una persona della stanza: pulsante Chiama»).
// Il pulsante non c'è mentre si è già in una chiamata: una sola alla volta. Con un testo della v1.3 (3c-5b-2b) il
// pulsante è disattivato e porta quel testo; «descrizione» è per il lettore di schermo (aria-label).
export function schedaCompagno(p, { inChiamata = false, testo = "" } = {}) {
  const titolo = p.eta ? `${p.nome}, ${p.eta}` : p.nome;
  const t = testoPulsante(testo);
  return {
    titolo,
    sottotitolo: p.citta || "",
    chiama: !inChiamata && !t,
    etichetta: t || "Chiama",
    descrizione: t ? `${titolo}: ${t}` : `Chiama ${titolo}`,
  };
}

// Il nome da mostrare in chiamata: la vista del server dice solo l'id dell'altra persona (vista.altra).
export function nomeInChiamata(vista, persone) {
  if (!vista || typeof vista !== "object" || !Array.isArray(persone)) return "";
  const p = persone.find((x) => x.id === vista.altra);
  return p ? p.nome : "";
}
