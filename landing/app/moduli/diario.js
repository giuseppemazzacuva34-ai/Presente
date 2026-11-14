// Il diario privato nella web app (issue #5, spec v1.1 del CPO, passi 2 e 3; D51 A). Passo 7b della linea
// «sviluppatore-c». «Lo leggi solo tu. Non lo usiamo per niente.»
// Le note si leggono e si scrivono SOLO dal telefono di chi le scrive, direttamente sulla tabella public.diario di
// Supabase con il proprio token: le regole per riga (migrazione *_diario.sql) lasciano passare solo le proprie righe.
// Il Worker e il ruolo di servizio non le vedono mai. Il corpo non dice mai chi scrive: lo dice il token.
// Niente salvataggi locali, niente log. Il modulo non tocca la pagina: riceve fetch e token dall'esterno, così si
// prova con node --test.

const PERCORSO = "/rest/v1/diario";
const MASSIMO = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const TESTI_DIARIO = Object.freeze({
  suggerimento: "Cosa ti è rimasto di questa chiamata?",
  nota: "Lo leggi solo tu. Non lo usiamo per niente.",
  salva: "Salva",
  salta: "Salta",
  appunti: "I tuoi appunti",
});

const chi = (nome) => (typeof nome === "string" && nome.trim() ? nome.trim() : "questa persona");

// Schermata dopo la chiamata (spec, passo 2).
export function schermataDiario(nome) {
  return {
    titolo: `Il tuo diario su ${chi(nome)}`,
    suggerimento: TESTI_DIARIO.suggerimento,
    nota: TESTI_DIARIO.nota,
    salva: TESTI_DIARIO.salva,
    salta: TESTI_DIARIO.salta,
    massimo: MASSIMO,
  };
}

// Stesse regole della tabella: da 1 a 1000 caratteri, non solo spazi.
export function controllaTesto(testo) {
  const t = typeof testo === "string" ? testo.trim() : "";
  if (!t) return { ok: false, motivo: "vuoto" };
  if (t.length > MASSIMO) return { ok: false, motivo: "lungo" };
  return { ok: true, testo: t };
}

const dataValida = (x) => typeof x === "string" && Number.isFinite(new Date(x).getTime());
const GIORNO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long" });

// Una nota della sezione «I tuoi appunti» (spec, passo 3): data, durata, testo.
export function appunto(riga) {
  if (!riga || !dataValida(riga.chiamata_il) || typeof riga.testo !== "string") return null;
  const minuti = Math.max(1, Math.floor((Number(riga.durata) || 0) / 60));
  return { chiamataIl: riga.chiamata_il, data: GIORNO.format(new Date(riga.chiamata_il)), durata: `${minuti} min`, testo: riga.testo };
}

export function creaDiario({ supabaseUrl, supabaseAnonKey, token, fetch: f = globalThis.fetch }) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl || "") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl || "")) {
    throw new Error("Indirizzo Supabase non valido");
  }
  const base = `${supabaseUrl.replace(/\/+$/, "")}${PERCORSO}`;

  async function richiesta(url, method, corpo) {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return { motivo: "accesso" };
    const headers = { apikey: supabaseAnonKey, authorization: `Bearer ${t}` };
    if (corpo !== undefined) Object.assign(headers, { "content-type": "application/json", prefer: "return=minimal" });
    try {
      return { r: await f(url, { method, headers, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) }) };
    } catch {
      return { motivo: "rete" };
    }
  }
  const esito = ({ r, motivo }) => {
    if (motivo) return { ok: false, motivo };
    if (r.ok) return { ok: true };
    if (r.status === 401) return { ok: false, motivo: "accesso" };
    if (r.status === 409) return { ok: false, motivo: "gia_scritta" };
    return { ok: false, motivo: "rifiutato" };
  };
  const filtro = (chiamataIl) => `${base}?chiamata_il=eq.${encodeURIComponent(chiamataIl)}`;

  return {
    // Le proprie note su una persona, dalla più recente: { ok: true, appunti: [...] } oppure { ok: false, motivo }.
    async appunti(con) {
      if (!UUID.test(con || "")) return { ok: false, motivo: "non_valida" };
      const { r, motivo } = await richiesta(`${base}?select=chiamata_il,durata,testo&con=eq.${con}&order=chiamata_il.desc`, "GET");
      if (motivo) return { ok: false, motivo };
      if (r.status === 401) return { ok: false, motivo: "accesso" };
      if (!r.ok) return { ok: false, motivo: "lettura" };
      let righe;
      try { righe = await r.json(); } catch { return { ok: false, motivo: "lettura" }; }
      return { ok: true, appunti: (Array.isArray(righe) ? righe : []).map(appunto).filter(Boolean) };
    },
    // Una nota per chiamata: la tabella controlla che la chiamata ci sia stata e sia durata almeno 60 secondi.
    async salva({ con, chiamataIl, durata, testo }) {
      if (!UUID.test(con || "") || !dataValida(chiamataIl) || !Number.isInteger(durata) || durata < 60 || durata > 900) {
        return { ok: false, motivo: "non_valida" };
      }
      const c = controllaTesto(testo);
      if (!c.ok) return c;
      return esito(await richiesta(base, "POST", { con, chiamata_il: chiamataIl, durata, testo: c.testo }));
    },
    async modifica(chiamataIl, testo) {
      if (!dataValida(chiamataIl)) return { ok: false, motivo: "non_valida" };
      const c = controllaTesto(testo);
      if (!c.ok) return c;
      return esito(await richiesta(filtro(chiamataIl), "PATCH", { testo: c.testo }));
    },
    async cancella(chiamataIl) {
      if (!dataValida(chiamataIl)) return { ok: false, motivo: "non_valida" };
      return esito(await richiesta(filtro(chiamataIl), "DELETE"));
    },
  };
}
