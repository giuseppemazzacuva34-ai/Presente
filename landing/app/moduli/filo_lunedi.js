// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A): schermata 18 «Il Filo apre la stanza» nella web
// app. Passo 9a della linea «sviluppatore-c».
// Dalle 9:00 di lunedì, la prima volta che apre l'app (una sola volta a settimana), chi è in una stanza con un Filo vede
// la scheda del Filo, il suo vocale di benvenuto, i nomi di battesimo di oggi e le regole. Chi è e se l'ha già vista lo
// dice il Worker (GET /app/api/filo/benvenuto); il vocale arriva con un link firmato a scadenza breve
// (GET /app/api/filo/ascolta?tipo=lunedi). «Entra nella stanza» è sempre attivo e segna la schermata come vista
// (POST /app/api/filo/benvenuto). Stanza senza Filo, già vista o errore: niente schermata, la stanza apre come sempre.
// I nomi sono quelli che l'app ha già (compagni_di_stanza: niente bloccati, sospesi, usciti) più il proprio.
// Il vocale non parte mai da solo. Niente salvataggi nel telefono e niente log.
import { durataTesto } from "./filo_domenica.js";

export const TESTI_FILO_LUNEDI = Object.freeze({
  occhiello: "Lunedì · La tua stanza apre",
  sotto: "Vi accompagna tutta la settimana",
  viPresento: "Vi presento",
  regoleTitolo: "Le regole:",
  regole: "solo voce, 15 minuti · niente numeri né social prima della porta · rispetto, sempre · chi dà buca paga.",
  attesa: "Il vocale del Filo arriva in mattinata.",
  bottone: "Entra nella stanza",
  ascolta: "Ascolta il vocale del Filo",
  leggi: "Leggi il testo",
});

const PERCORSO_BENVENUTO = "/app/api/filo/benvenuto";
const PERCORSO_ASCOLTA = "/app/api/filo/ascolta?tipo=lunedi";

const pulito = (x) => (typeof x === "string" ? x.trim() : "");

function vocaleValido(v) {
  if (!v || typeof v !== "object") return null;
  const durata = durataTesto(v.durata);
  const testo = pulito(v.testo);
  if (typeof v.url !== "string" || !v.url.startsWith("https://") || !testo || !durata) return null;
  return { url: v.url, durata, testo };
}

function nomiDiOggi(persone, mioNome) {
  const visti = new Set();
  const nomi = [];
  for (const p of Array.isArray(persone) ? persone : []) {
    const nome = p && typeof p === "object" ? pulito(p.nome).slice(0, 40) : "";
    const chiave = p && (p.id ?? nome);
    if (!nome || visti.has(chiave)) continue;
    visti.add(chiave);
    nomi.push({ nome, io: false });
  }
  nomi.sort((a, b) => a.nome.localeCompare(b.nome, "it"));
  const mio = pulito(mioNome).slice(0, 40);
  if (mio) nomi.push({ nome: mio, io: true });
  return nomi;
}

// Cosa mostra la schermata 18, oppure null se non deve comparire.
export function schermataFiloLunedi({ benvenuto, vocale, persone, mioNome } = {}) {
  if (!benvenuto || typeof benvenuto !== "object" || benvenuto.visto !== false) return null;
  if (typeof benvenuto.stanza !== "string" || benvenuto.stanza === "") return null;
  const filo = pulito(benvenuto.filo);
  const v = vocaleValido(vocale);
  return {
    stanza: benvenuto.stanza,
    occhiello: TESTI_FILO_LUNEDI.occhiello,
    scheda: { titolo: filo ? `${filo} · il Filo della stanza` : "Il Filo della stanza", sotto: TESTI_FILO_LUNEDI.sotto },
    vocale: v,
    attesa: v ? null : TESTI_FILO_LUNEDI.attesa,
    nomi: nomiDiOggi(persone, mioNome),
  };
}

// Una richiesta al Worker col token di chi guarda: corpo JSON con ok true, oppure null (accesso, rete, errore).
async function chiedi(f, percorso, t, { metodo = "GET", corpo } = {}) {
  let r;
  try {
    const headers = { authorization: `Bearer ${t}` };
    if (corpo !== undefined) headers["content-type"] = "application/json";
    r = await f(percorso, { method: metodo, headers, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
  } catch {
    return null;
  }
  if (!r || !r.ok) return null;
  try {
    const c = await r.json();
    return c && c.ok === true ? c : null;
  } catch {
    return null;
  }
}

export function creaFiloLunedi({ token, fetch: f = globalThis.fetch, aggiorna = () => {} } = {}) {
  let benvenuto = null;
  let vocale = null;
  let letto = false;
  let lettura = null;
  let segnato = false;
  let lettore = null; // { url, nodo }: lo stesso elemento audio tra un ridisegno e l'altro
  let rinnovi = 0;
  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare il modulo */ } };
  const gettone = () => Promise.resolve().then(token).catch(() => null);

  async function carica() {
    try {
      const t = await gettone();
      if (!t) return;
      const b = await chiedi(f, PERCORSO_BENVENUTO, t);
      if (!b || !b.benvenuto || b.benvenuto.visto !== false) return;
      benvenuto = b.benvenuto;
      const a = await chiedi(f, PERCORSO_ASCOLTA, t);
      vocale = a ? a.vocale ?? null : null;
    } finally {
      letto = true;
      avvisa();
    }
  }

  return {
    // Per la home, che si ridisegna spesso: la lettura parte una volta sola per apertura dell'app.
    prepara: () => (lettura ??= carica()),
    modello: () => ({ benvenuto, vocale, letto }),
    // «Entra nella stanza»: la schermata sparisce subito; il server la segna vista una volta sola. Se la richiesta non
    // riesce si entra lo stesso (al massimo la schermata ricompare alla prossima apertura).
    async entra(poi = () => {}) {
      const stanza = benvenuto && benvenuto.stanza;
      benvenuto = null;
      avvisa();
      try { poi(); } catch { /* la vista non deve fermare il modulo */ }
      if (!stanza || segnato) return;
      segnato = true;
      const t = await gettone();
      if (t) await chiedi(f, PERCORSO_BENVENUTO, t, { metodo: "POST", corpo: { stanza } });
    },
    // Il lettore si crea una volta per link: un ridisegno della home non interrompe la voce.
    lettore(url, crea) {
      if (!lettore || lettore.url !== url) lettore = { url, nodo: crea() };
      return lettore.nodo;
    },
    // Link firmato scaduto (5 minuti) o rete caduta: si chiede un link nuovo, al massimo due volte.
    async rinnova(nodo) {
      if (rinnovi >= 2 || !benvenuto || !vocale) return;
      rinnovi++;
      const t = await gettone();
      if (!t) return;
      const a = await chiedi(f, PERCORSO_ASCOLTA, t);
      const nuovo = vocaleValido(a ? a.vocale : null);
      if (!nuovo || !benvenuto) return;
      vocale = a.vocale;
      if (lettore) lettore.url = nuovo.url;
      if (nodo) nodo.src = nuovo.url;
    },
  };
}

// Vista (design v4, schermata 18 `#madrina-apre`). Lettore nativo senza partenza automatica: si usa da tastiera e ha il
// nome «Ascolta il vocale del Filo»; «Leggi il testo» è l'alternativa per l'audio (WCAG 1.2.1).
// persone: le persone della stanza che l'app ha già; mioNome: il proprio nome; entra: apre la stanza.
export function vistaFiloLunedi(h, fl, { persone = [], mioNome = "", entra = () => {} } = {}) {
  const m = fl.modello();
  const s = schermataFiloLunedi({ benvenuto: m.benvenuto, vocale: m.vocale, persone, mioNome });
  if (!s) return null;
  return h("section", { classe: "filo-lunedi", "aria-labelledby": "filo-lunedi-titolo" },
    h("p", { classe: "passo" }, s.occhiello),
    h("div", { classe: "filo-scheda" },
      h("div", { classe: "filo-simbolo", "aria-hidden": "true" }, "!"),
      h("div", {}, h("h2", { id: "filo-lunedi-titolo" }, s.scheda.titolo), h("small", {}, s.scheda.sotto))),
    s.vocale ? [
      fl.lettore(s.vocale.url, () => {
        let nodo = null;
        nodo = h("audio", { classe: "filo-lettore", src: s.vocale.url, controls: true, preload: "none",
          "aria-label": TESTI_FILO_LUNEDI.ascolta, onerror: () => fl.rinnova(nodo) });
        return nodo;
      }),
      h("details", { classe: "filo-testo" }, h("summary", {}, TESTI_FILO_LUNEDI.leggi), h("p", {}, s.vocale.testo)),
    ] : h("p", { classe: "nota", role: "status" }, s.attesa),
    s.nomi.length ? [
      h("p", { classe: "etichetta" }, TESTI_FILO_LUNEDI.viPresento),
      h("ul", { classe: "filo-nomi" }, s.nomi.map((n) =>
        n.io ? h("li", { classe: "filo-io" }, `${n.nome} (tu)`) : h("li", {}, n.nome))),
    ] : null,
    h("p", { classe: "nota filo-regole" }, h("strong", {}, TESTI_FILO_LUNEDI.regoleTitolo), " ", TESTI_FILO_LUNEDI.regole),
    h("button", { classe: "bottone", type: "button", onclick: () => fl.entra(entra) }, TESTI_FILO_LUNEDI.bottone));
}

// Nella home, al posto di «La tua stanza» aperta (flusso.js): mentre legge «Un attimo…» (niente lampo della stanza
// prima della schermata 18), poi la schermata 18 finché non si tocca «Entra nella stanza». null = la stanza di sempre
// (senza modulo, stanza senza Filo, già vista, errore).
export function vistaStanzaFilo(h, fl, opzioni = {}) {
  if (!fl) return null;
  fl.prepara();
  if (!fl.modello().letto) return h("p", { classe: "nota", role: "status" }, "Un attimo…");
  return vistaFiloLunedi(h, fl, opzioni);
}
