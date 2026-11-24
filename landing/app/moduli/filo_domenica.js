// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A): schermata 36 «Il Filo · le porte aperte»
// nella web app. Passo 7a della linea «sviluppatore-c».
// Dalle 21:00 di domenica, prima della sera delle porte (#5), chi è nella stanza vede quante porte si sono aperte
// e, se il Filo l'ha registrato, il suo vocale della domenica. Il numero lo dà il Worker (GET /app/api/filo/porte:
// solo un intero, mai chi); il vocale arriva con un link firmato a scadenza breve (GET /app/api/filo/ascolta).
// Stanza senza Filo, numero assente o errore: la schermata non c'è e si va diretti alla sera (mai un numero inventato).
// Vocale mancante o in errore: resta il numero, senza scheda né lettore. Il vocale non parte mai da solo.
// Niente salvataggi nel telefono e niente log. Il modulo non tocca la pagina: la vista legge modello().

export const TESTI_FILO_DOMENICA = Object.freeze({
  occhiello: "Domenica · ore 21",
  attacco: "Questa settimana, nella nostra stanza…",
  rigaRossa: "Ora scopri se una è la tua.",
  nota: "Il Filo dice solo quante, mai chi.",
  bottone: "Scopri la tua sera",
  ascolta: "Ascolta il vocale del Filo",
  leggi: "Leggi il testo",
});

const PERCORSO_PORTE = "/app/api/filo/porte";
const PERCORSO_ASCOLTA = "/app/api/filo/ascolta?tipo=domenica";

export function durataTesto(secondi) {
  if (!Number.isInteger(secondi) || secondi < 0) return null;
  return `${Math.floor(secondi / 60)}:${String(secondi % 60).padStart(2, "0")}`;
}

function schedaVocale(vocale) {
  if (!vocale || typeof vocale !== "object") return null;
  const { url, testo, filo } = vocale;
  const durata = durataTesto(vocale.durata);
  if (typeof url !== "string" || !url.startsWith("https://")) return null;
  if (typeof testo !== "string" || testo.trim() === "") return null;
  if (typeof filo !== "string" || filo.trim() === "" || !durata) return null;
  return { titolo: `${filo.trim()} · il Filo`, sotto: `Il vocale della domenica · ${durata}`, url, testo: testo.trim() };
}

// Cosa mostra la schermata 36, oppure null se non deve comparire.
export function schermataFiloDomenica({ porte, vocale } = {}) {
  const n = porte && typeof porte === "object" ? porte.numero : undefined;
  if (!Number.isInteger(n) || n < 0) return null;
  const base = {
    occhiello: TESTI_FILO_DOMENICA.occhiello,
    attacco: TESTI_FILO_DOMENICA.attacco,
    nota: TESTI_FILO_DOMENICA.nota,
    bottone: TESTI_FILO_DOMENICA.bottone,
    scheda: schedaVocale(vocale),
  };
  if (n === 0) return { ...base, numero: null, frase: "Questa settimana nessuna porta si è aperta.", rigaRossa: null };
  return { ...base, numero: String(n), frase: n === 1 ? "porta si è aperta." : "porte si sono aperte.", rigaRossa: TESTI_FILO_DOMENICA.rigaRossa };
}

// Una GET al Worker col token di chi guarda: corpo JSON con ok true, oppure null (accesso, rete, errore).
async function leggiJson(f, percorso, t) {
  let r;
  try {
    r = await f(percorso, { method: "GET", headers: { authorization: `Bearer ${t}` } });
  } catch {
    return null;
  }
  if (!r || !r.ok) return null;
  try {
    const corpo = await r.json();
    return corpo && corpo.ok === true ? corpo : null;
  } catch {
    return null;
  }
}

export function creaFiloDomenica({ token, fetch: f = globalThis.fetch, aggiorna = () => {} } = {}) {
  let schermata = null;
  let letto = null;
  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare il modulo */ } };

  async function carica() {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return;
    const p = await leggiJson(f, PERCORSO_PORTE, t);
    if (!p || !p.porte) return;
    const a = await leggiJson(f, PERCORSO_ASCOLTA, t);
    schermata = schermataFiloDomenica({ porte: p.porte, vocale: a ? a.vocale : null });
    if (schermata) avvisa();
  }

  return {
    // Per la home, che si ridisegna spesso: la lettura parte una volta sola per apertura dell'app.
    prepara: () => (letto ??= carica()),
    modello: () => ({ schermata }),
    chiudi() {
      if (!schermata) return;
      schermata = null;
      avvisa();
    },
  };
}

// Vista (design v4, schermata 36 `#madrina-domenica`). Lettore nativo senza partenza automatica: si usa da tastiera
// e ha il nome «Ascolta il vocale del Filo»; «Leggi il testo» è l'alternativa per l'audio (WCAG 1.2.1).
// scopri: apre la sera delle porte di oggi (#5), invariata.
export function vistaFiloDomenica(h, fd, { scopri = () => {} } = {}) {
  const s = fd.modello().schermata;
  if (!s) return null;
  const vai = () => { fd.chiudi(); scopri(); };
  return h("section", { classe: "filo-domenica", "aria-labelledby": "filo-domenica-titolo" },
    h("p", { classe: "passo" }, s.occhiello),
    s.scheda ? h("div", { classe: "filo-scheda" },
      h("div", { classe: "filo-simbolo", "aria-hidden": "true" }, "!"),
      h("div", {}, h("b", {}, s.scheda.titolo), h("small", {}, s.scheda.sotto)),
      h("audio", { classe: "filo-lettore", src: s.scheda.url, controls: true, preload: "none", "aria-label": TESTI_FILO_DOMENICA.ascolta }),
      h("details", { classe: "filo-testo" }, h("summary", {}, TESTI_FILO_DOMENICA.leggi), h("p", {}, s.scheda.testo))) : null,
    h("p", { classe: "sub filo-attacco" }, s.attacco),
    h("h2", { id: "filo-domenica-titolo" },
      s.numero ? h("span", { classe: "filo-numero" }, s.numero) : null,
      s.numero ? " " : null,
      s.frase),
    s.rigaRossa ? h("p", { classe: "filo-riga-rossa" }, s.rigaRossa) : null,
    h("p", { classe: "nota" }, s.nota),
    h("button", { classe: "bottone", type: "button", onclick: vai }, s.bottone));
}
