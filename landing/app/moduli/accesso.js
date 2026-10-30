// Accesso alla web app con Supabase Auth (issue #2, specifica v1 passo 2): niente password, l'utente riceve un'email.
// Si usano le API HTTP di Supabase con fetch (nessuna libreria). Due modi di entrare, con la stessa email:
//  1. il link nell'email: apre /app/ con i token nella parte dopo «#» (che non arriva mai a nessun server);
//  2. il codice di 6 cifre nella stessa email, da scrivere nell'app. Serve su iPhone: la web app aggiunta alla Home
//     ha una memoria separata da Safari, quindi il link (che si apre in Safari) non la farebbe entrare.
//
// SPENTO finché il Worker non dice «accesso: true» in /app/config.json (secret ACCESSO_APP = «si»): si accende solo
// dopo l'informativa privacy dell'app (T08) e la revisione di sicurezza del CISO (T15). Fino ad allora l'app resta
// in anteprima e questo codice non manda nulla.
//
// Questo modulo non tocca la pagina: riceve fetch, memoria e indirizzo dall'esterno, così si prova con node --test.

const CHIAVE_MEMORIA = "presente.sessione";
const EMAIL_VALIDA = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Messaggi per l'utente: mai il testo grezzo del server (può contenere dettagli interni).
export const MESSAGGI = {
  email: "Controlla l'email: sembra scritta male.",
  troppe: "Hai chiesto troppi link in poco tempo. Riprova tra qualche minuto.",
  scaduto: "Link scaduto, te ne mandiamo un altro.",
  codice: "Codice sbagliato o scaduto. Controlla l'ultima email o chiedine un altro.",
  rete: "Non riusciamo a collegarci. Controlla la connessione e riprova.",
  generico: "Qualcosa non ha funzionato. Riprova tra poco.",
};

export function creaAccesso({ supabaseUrl, supabaseAnonKey, fetch: f = globalThis.fetch, memoria = null, adesso = () => Date.now() }) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl || "") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl || "")) {
    throw new Error("Indirizzo Supabase non valido");
  }
  const base = supabaseUrl.replace(/\/+$/, "");
  const intestazioni = (token) => ({
    apikey: supabaseAnonKey,
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });

  async function chiama(percorso, { metodo = "POST", corpo, token } = {}) {
    let risposta;
    try {
      risposta = await f(base + percorso, { method: metodo, headers: intestazioni(token), body: corpo ? JSON.stringify(corpo) : undefined });
    } catch {
      return { ok: false, motivo: "rete" };
    }
    let dati = null;
    try { dati = await risposta.json(); } catch { /* corpo vuoto */ }
    if (risposta.ok) return { ok: true, dati };
    const codice = String(dati?.error_code || dati?.code || dati?.error || "");
    if (risposta.status === 429 || codice === "over_email_send_rate_limit") return { ok: false, motivo: "troppe" };
    if (codice === "otp_expired" || codice === "invalid_grant" || risposta.status === 403) return { ok: false, motivo: "scaduto" };
    if (codice === "validation_failed" || codice === "email_address_invalid") return { ok: false, motivo: "email" };
    return { ok: false, motivo: "generico" };
  }

  function leggi() {
    try {
      const testo = memoria?.getItem(CHIAVE_MEMORIA);
      const s = testo ? JSON.parse(testo) : null;
      return s && typeof s.accessToken === "string" && typeof s.refreshToken === "string" ? s : null;
    } catch { return null; }
  }
  function scrivi(sessione) {
    try {
      if (sessione) memoria?.setItem(CHIAVE_MEMORIA, JSON.stringify(sessione));
      else memoria?.removeItem(CHIAVE_MEMORIA);
    } catch { /* memoria non disponibile (navigazione privata): la sessione dura finché la pagina è aperta */ }
  }
  let inMemoria = leggi();

  function daRisposta(dati) {
    if (!dati?.access_token || !dati?.refresh_token) return null;
    const durata = Number(dati.expires_in) > 0 ? Number(dati.expires_in) : 3600;
    // Solo i token, la scadenza e l'id: niente email né altri dati del profilo nella memoria del telefono.
    return { accessToken: dati.access_token, refreshToken: dati.refresh_token, scadeIl: adesso() + durata * 1000, utenteId: dati.user?.id || null };
  }
  function imposta(sessione) { inMemoria = sessione; scrivi(sessione); return sessione; }

  return {
    // Passo 2: manda l'email con il link e il codice. Crea l'account se non esiste.
    async mandaLink(email, ritorno) {
      const pulita = String(email || "").trim().toLowerCase();
      if (!EMAIL_VALIDA.test(pulita) || pulita.length > 254) return { ok: false, motivo: "email" };
      const qs = ritorno ? `?redirect_to=${encodeURIComponent(ritorno)}` : "";
      const r = await chiama(`/auth/v1/otp${qs}`, { corpo: { email: pulita, create_user: true } });
      return r.ok ? { ok: true } : r;
    },

    // Codice di 6 cifre scritto dall'utente.
    async verificaCodice(email, codice) {
      const pulito = String(codice || "").replace(/\s+/g, "");
      if (!/^\d{6}$/.test(pulito)) return { ok: false, motivo: "codice" };
      const r = await chiama("/auth/v1/verify", { corpo: { type: "email", email: String(email || "").trim().toLowerCase(), token: pulito } });
      if (!r.ok) return { ok: false, motivo: r.motivo === "rete" || r.motivo === "troppe" ? r.motivo : "codice" };
      const s = daRisposta(r.dati);
      return s ? { ok: true, sessione: imposta(s) } : { ok: false, motivo: "codice" };
    },

    // Arrivo dal link nell'email: legge i token dopo «#» e restituisce anche l'indirizzo da mostrare (senza «#»),
    // così la pagina toglie subito i token dalla barra degli indirizzi e dalla cronologia.
    daLink(indirizzo) {
      const url = new URL(indirizzo);
      const frammento = new URLSearchParams(url.hash.replace(/^#/, ""));
      if (!frammento.has("access_token") && !frammento.has("error") && !frammento.has("error_code")) return null;
      url.hash = "";
      const pulito = url.pathname + url.search;
      if (frammento.has("error") || frammento.has("error_code")) {
        const codice = frammento.get("error_code") || "";
        return { ok: false, motivo: codice === "otp_expired" ? "scaduto" : "generico", indirizzo: pulito };
      }
      const s = daRisposta({ access_token: frammento.get("access_token"), refresh_token: frammento.get("refresh_token"), expires_in: frammento.get("expires_in") });
      return s ? { ok: true, sessione: imposta(s), indirizzo: pulito } : { ok: false, motivo: "generico", indirizzo: pulito };
    },

    // Token valido da usare nelle chiamate: se scade entro un minuto lo rinnova. null = bisogna rientrare.
    async token() {
      const s = inMemoria;
      if (!s) return null;
      if (s.scadeIl - adesso() > 60_000) return s.accessToken;
      const r = await chiama("/auth/v1/token?grant_type=refresh_token", { corpo: { refresh_token: s.refreshToken } });
      if (!r.ok) {
        if (r.motivo !== "rete") imposta(null); // rinnovo rifiutato: si rientra con una nuova email
        return null;
      }
      const nuova = daRisposta(r.dati);
      imposta(nuova ? { ...nuova, utenteId: nuova.utenteId || s.utenteId } : null);
      return nuova ? nuova.accessToken : null;
    },

    connesso() { return Boolean(inMemoria); },

    // Id dell'utente (serve per le cartelle voci/<id>/ e foto/<id>/). Se arriva dal link non c'è nella risposta:
    // si legge dal token stesso (campo «sub»). Solo per comporre gli indirizzi: chi è davvero lo verifica Supabase.
    utenteId() {
      const s = inMemoria;
      if (!s) return null;
      if (s.utenteId) return s.utenteId;
      try {
        const parte = s.accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const sub = JSON.parse(atob(parte + "=".repeat((4 - (parte.length % 4)) % 4))).sub;
        return /^[0-9a-f-]{36}$/.test(sub || "") ? sub : null;
      } catch { return null; }
    },

    async esci() {
      const s = inMemoria;
      imposta(null);
      if (s) await chiama("/auth/v1/logout", { token: s.accessToken });
    },
  };
}
