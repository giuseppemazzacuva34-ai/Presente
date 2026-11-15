// «Blocca» dalla scheda della persona (issue #7, spec v1.1 punto 5 e regola «Blocco»; passo 8a della linea
// «sviluppatore-b»). Il blocco è immediato e definitivo, senza revisione e senza avvisare l'altra persona.
// Il telefono scrive SOLO la propria riga in public.blocchi con il proprio token: le regole per riga
// (migrazione 20261109220000_chiamate.sql) accettano solo chi = auth.uid() e non permettono di togliere un blocco.
// Gli effetti li fa il database: compagni nascosti (20261114144008), chiavi annullate (trigger della #5).
// Il modulo non tocca la pagina: riceve fetch, token e id dall'esterno, così si prova con node --test.
// Niente salvataggi locali, niente log.

const PERCORSO = "/rest/v1/blocchi";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Spec punto 5: «Blocca <nome>» → conferma → «Blocca».
export function confermaBlocco(nome) {
  const n = typeof nome === "string" && nome.trim() ? nome.trim() : "";
  return {
    titolo: `Blocca ${n || "questa persona"}`,
    testo: "Non vi vedrete più in nessuna stanza. Non potrete chiamarvi. Non lo saprà. Non si può annullare.",
    conferma: "Blocca",
    annulla: "Annulla",
  };
}

export function creaBlocca({ supabaseUrl, supabaseAnonKey, token, utenteId, fetch: f = globalThis.fetch }) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl || "") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl || "")) {
    throw new Error("Indirizzo Supabase non valido");
  }
  const base = supabaseUrl.replace(/\/+$/, "");
  return {
    // → { ok: true } | { ok: false, motivo: "accesso" | "persona" | "rete" | "riprova" }
    async blocca(altra) {
      const io = String((typeof utenteId === "function" ? utenteId() : "") || "");
      if (!UUID.test(String(altra || "")) || altra === io) return { ok: false, motivo: "persona" };
      const t = await Promise.resolve().then(token).catch(() => null);
      if (!t || !UUID.test(io)) return { ok: false, motivo: "accesso" };
      let r;
      try {
        r = await f(`${base}${PERCORSO}`, {
          method: "POST",
          headers: { apikey: supabaseAnonKey, authorization: `Bearer ${t}`, "content-type": "application/json", prefer: "return=minimal" },
          body: JSON.stringify({ chi: io, bloccato: altra }),
        });
      } catch {
        return { ok: false, motivo: "rete" };
      }
      if (r.status === 401) return { ok: false, motivo: "accesso" };
      // 409: la riga c'è già (blocco già fatto, anche da una segnalazione): per chi tocca «Blocca» è fatto.
      if (r.ok || r.status === 409) return { ok: true };
      return { ok: false, motivo: "riprova" };
    },
  };
}
