// «La tua stanza» nella web app (issue #4 passo 3c-3a, con la #3): le persone della propria stanza, ognuna con la
// sua scheda e il pulsante «Chiama».
//
// I dati arrivano SOLO dalla funzione compagni_di_stanza() di Supabase (migrazione 20261103220000): nome, età e
// città delle persone compatibili della stanza aperta, decise dal database con il token dell'utente. Mai foto,
// questionario, email o filtri. Qui si tengono solo i quattro campi, nient'altro; niente salvataggi locali.
// Funziona SOLO con l'accesso acceso (ACCESSO_APP = «si»): senza token non parte nessuna richiesta.
// Il modulo non tocca la pagina: riceve fetch e token dall'esterno, così si prova con node --test.

const PERCORSO = "/rest/v1/rpc/compagni_di_stanza";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function creaCompagni({ supabaseUrl, supabaseAnonKey, token, fetch: f = globalThis.fetch }) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl || "") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl || "")) {
    throw new Error("Indirizzo Supabase non valido");
  }
  const base = supabaseUrl.replace(/\/+$/, "");

  return {
    // { ok: true, persone: [{ id, nome, eta, citta }] } oppure { ok: false, motivo: "accesso" | "rete" | "lettura" }.
    async leggi() {
      const t = await Promise.resolve().then(token).catch(() => null);
      if (!t) return { ok: false, motivo: "accesso" };
      let r;
      try {
        r = await f(`${base}${PERCORSO}`, {
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
    },
  };
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

// Testi della scheda (spec #4 v1, passo 1: «Dalla scheda di una persona della stanza: pulsante Chiama»).
// Il pulsante non c'è mentre si è già in una chiamata: una sola alla volta. I «no» delle regole (3 volte, 5 al
// giorno, fascia, permesso) li dice il server al tocco, con i testi di chiamata.js.
export function schedaCompagno(p, { inChiamata = false } = {}) {
  return {
    titolo: p.eta ? `${p.nome}, ${p.eta}` : p.nome,
    sottotitolo: p.citta || "",
    chiama: !inChiamata,
  };
}

// Il nome da mostrare in chiamata: la vista del server dice solo l'id dell'altra persona (vista.altra).
export function nomeInChiamata(vista, persone) {
  if (!vista || typeof vista !== "object" || !Array.isArray(persone)) return "";
  const p = persone.find((x) => x.id === vista.altra);
  return p ? p.nome : "";
}
