// «Entra nella stanza» nella home della web app (issue #3, spec v1 del CPO) e domanda «Vuoi entrare intanto nella
// Stanza Italia?» per chi ha «Solo la mia zona» (spec v1.1, testi v1.2 con le aree vaste D121 A).
//
// La conferma è una riga della tabella conferme_stanza (migrazione 20261104221000_conferme_stanza.sql): il telefono
// manda un corpo vuoto; persona, lunedì e ora li scrive il database. Entro domenica 23:59 di Roma vale per il lunedì
// dopo, poi per quello successivo. Ci si può ripensare solo prima della scadenza (regola per riga sulla cancellazione).
// Nessun credito si scala qui: li conta il lavoro del lunedì solo se la stanza si forma (D18).
// Funziona SOLO con l'accesso acceso (ACCESSO_APP = «si»): senza token non parte nessuna chiamata.
// Questo modulo non tocca la pagina: riceve fetch e token dall'esterno, così si prova con node --test.

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const PERCORSO = "/rest/v1/conferme_stanza";

export function creaStanza({ supabaseUrl, supabaseAnonKey, token, fetch: f = globalThis.fetch, adesso = Date.now }) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl || "") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl || "")) {
    throw new Error("Indirizzo Supabase non valido");
  }
  const base = supabaseUrl.replace(/\/+$/, "");

  async function chiama(cerca, { metodo = "GET", corpo, prefer } = {}) {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return { ok: false, motivo: "accesso" };
    let r;
    try {
      r = await f(`${base}${PERCORSO}?${cerca}`, {
        method: metodo,
        headers: { apikey: supabaseAnonKey, authorization: `Bearer ${t}`, ...(corpo !== undefined ? { "content-type": "application/json" } : {}), ...(prefer ? { prefer } : {}) },
        body: corpo,
      });
    } catch {
      return { ok: false, motivo: "rete" };
    }
    if (r.status === 401) return { ok: false, motivo: "accesso" };
    if (r.status === 409) return { ok: false, motivo: "doppia" };
    if (!r.ok) return { ok: false, motivo: "salvataggio" };
    try {
      const righe = await r.json();
      return { ok: true, righe: Array.isArray(righe) ? righe : [] };
    } catch {
      return { ok: false, motivo: "salvataggio" };
    }
  }
  const lunedi = (righe) => {
    const v = righe.map((x) => x && x.apre_il).find((x) => typeof x === "string" && ISO.test(x));
    return v || null;
  };

  async function leggi() {
    const quando = new Date(adesso()).toISOString();
    const r = await chiama(`select=apre_il&apre_il=gt.${encodeURIComponent(quando)}&order=apre_il.asc&limit=1`);
    return r.ok ? { ok: true, apreIl: lunedi(r.righe) } : { ok: false, motivo: r.motivo };
  }

  return {
    // La propria conferma per un lunedì che deve ancora aprire: { ok, apreIl } (apreIl null = nessuna conferma).
    leggi,

    // «Entra nella stanza». Una conferma a settimana: se c'è già (409) si rilegge quella.
    async entra() {
      const r = await chiama("select=apre_il", { metodo: "POST", corpo: "{}", prefer: "return=representation" });
      if (r.ok) return { ok: true, apreIl: lunedi(r.righe) };
      if (r.motivo === "doppia") {
        const l = await leggi();
        return l.ok && l.apreIl ? l : { ok: false, motivo: "salvataggio" };
      }
      return r;
    },

    // «Ci ripenso»: solo prima di domenica 23:59 (dopo il database non cancella niente → «scaduta»).
    async ritira(apreIl) {
      if (typeof apreIl !== "string" || !ISO.test(apreIl)) return { ok: false, motivo: "salvataggio" };
      const r = await chiama(`apre_il=eq.${encodeURIComponent(apreIl)}&select=apre_il`, { metodo: "DELETE", prefer: "return=representation" });
      if (!r.ok) return r;
      return r.righe.length ? { ok: true } : { ok: false, motivo: "scaduta" };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Testi (funzioni pure). Date e ore sempre in ora di Roma, anche col cambio d'ora.
function parti(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { giorno: `${p.weekday} ${p.day} ${p.month}`, ora: `${Number(p.hour)}:${p.minute}` };
}

// «Ci sei: entri nella stanza di lunedì 9 novembre alle 9:00. Puoi ripensarci fino a domenica 8 novembre alle 23:59.»
export function testoConferma(apreIl) {
  const ms = typeof apreIl === "string" && ISO.test(apreIl) ? Date.parse(apreIl) : NaN;
  if (!Number.isFinite(ms)) return null;
  const apre = parti(ms);
  // Le conferme chiudono domenica 23:59 di Roma, 9 ore prima dell'apertura (stessa regola del database).
  const chiude = parti(ms - 9 * 3600 * 1000 - 60 * 1000);
  return `Ci sei: entri nella stanza di ${apre.giorno} alle ${apre.ora}. Puoi ripensarci fino a ${chiude.giorno} alle ${chiude.ora}.`;
}

// Spec v1.1: la domanda la riceve solo chi ha «Solo la mia zona» (valore salvato «citta») e la zona non è accesa
// (c'è il contatore). Sparisce quando risponde «Aspetto la mia zona»; il raggio cambia solo con «Sì, allarga il raggio».
export function chiediItalia({ raggio, contatore, aspetto }) {
  return raggio === "citta" && typeof contatore === "string" && contatore.length > 0 && !aspetto;
}

// Chi ha «Solo la mia zona» non entra nella Stanza Italia finché non tocca «Sì»: la frase del contatore che lo dice
// per gli altri qui si toglie.
export function contatoreSoloZona(testo) {
  return typeof testo === "string" ? testo.replace(/ Intanto entri nella Stanza Italia\.$/, "") : null;
}
