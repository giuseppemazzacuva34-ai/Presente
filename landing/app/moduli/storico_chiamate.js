// «Le tue chiamate» nella web app (issue #7, spec v1.1 definitiva, caso limite «Persona già bloccata: si può ancora
// segnalare dallo storico delle chiamate («Le tue chiamate» → ⋯ → Segnala) per 30 giorni»). Passo 9b della linea
// «sviluppatore-b».
// I dati arrivano SOLO dalla funzione mie_chiamate_recenti() di Supabase (migrazione *_storico_chiamate.sql): id e
// nome dell'altra persona, inizio e durata delle chiamate finite degli ultimi 30 giorni, decisi dal database con il
// token. Mai età, città, foto, esito o diario. Il corpo non dice chi chiede. Niente salvataggi locali, niente log.
// La segnalazione passa dal modulo di segnala.js (origine «storico_chiamate» e inizio della chiamata: il server
// rifiuta oltre i 30 giorni). Il modulo non tocca la pagina: riceve fetch e token dall'esterno (node --test).

const PERCORSO = "/rest/v1/rpc/mie_chiamate_recenti";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const QUANDO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export const TESTI_STORICO = Object.freeze({
  titolo: "Le tue chiamate",
  vuoto: "Nessuna chiamata negli ultimi 30 giorni.",
  nota: "Puoi segnalare una chiamata fino a 30 giorni dopo.",
  segnala: "Segnala",
  torna: "Torna all'app",
});

// Una riga dell'elenco: { con, nome, chiamataIl, quando, durata } oppure null se la riga non è valida.
export function voceStorico(riga) {
  if (!riga || typeof riga !== "object" || !UUID.test(riga.con || "")) return null;
  const t = new Date(riga.inizio);
  if (typeof riga.inizio !== "string" || !Number.isFinite(t.getTime())) return null;
  const nome = typeof riga.nome === "string" && riga.nome.trim() ? riga.nome.trim().slice(0, 40) : "Una persona";
  const minuti = Math.max(1, Math.floor((Number(riga.durata) || 0) / 60));
  return { con: riga.con, nome, chiamataIl: riga.inizio, quando: QUANDO.format(t).replace(" alle ore ", ", "), durata: `${minuti} min` };
}

// Cosa passare al modulo di segnalazione per questa chiamata.
export function segnalaDaStorico(v) {
  if (!v || !UUID.test(v.con || "")) return null;
  return { contro: v.con, origine: "storico_chiamate", chiamataIl: v.chiamataIl, nome: v.nome };
}

export function creaStorico({ supabaseUrl, supabaseAnonKey, token, fetch: f = globalThis.fetch }) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl || "") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl || "")) {
    throw new Error("Indirizzo Supabase non valido");
  }
  const url = `${supabaseUrl.replace(/\/+$/, "")}${PERCORSO}`;
  return {
    // { ok: true, chiamate: [voce…] } oppure { ok: false, motivo: "accesso" | "rete" | "lettura" }.
    async leggi() {
      const t = await Promise.resolve().then(token).catch(() => null);
      if (!t) return { ok: false, motivo: "accesso" };
      let r;
      try {
        r = await f(url, {
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
      return { ok: true, chiamate: Array.isArray(righe) ? righe.map(voceStorico).filter(Boolean) : [] };
    },
  };
}
