// «Lascia la stanza» nella web app (issue #381, spec v1 del CPO del 23/11, design v4 schermata 22). Linea
// «sviluppatore-b», passo 4a: stato della schermata, richiesta al Worker e vista.
//
// Chi lo usa (fondo della stanza, schermata 19):
//   apriSchermataUscita(contenitore, { uscita: creaUscita({ token }), alResto, alFatto(testo), alAiuto })
//
// Il telefono non decide niente: stanza aperta, chiamata in corso, motivo e testo li ricontrolla il server
// (worker/lascia_stanza_api.js → lascia_stanza). Qui solo la scelta del motivo e una richiesta. Nessun salvataggio
// locale, nessun motivo nei log. Motivi e testi sono gli stessi di api/lascia_stanza.js (la pagina non può importarlo):
// lo controlla test/lascia_stanza_app.test.mjs.

const PERCORSO = "/app/api/stanza/lascia";

export const MOTIVI_APP = Object.freeze([
  { id: "tempo", testo: "Questa settimana non ho tempo" },
  { id: "persone", testo: "Non mi trovo con le persone della stanza" },
  { id: "conosciuto", testo: "Ho conosciuto qualcuno" },
  { id: "app", testo: "Problemi con l'app" },
  { id: "altro", testo: "Altro, lo scrivo io" },
]);
const MINIMO = 3;
const MASSIMO = 300;

export const TESTI_APP = Object.freeze({
  titolo: "Vuoi lasciare la stanza?",
  sotto: "Dicci il motivo. Le persone della stanza vedranno solo che hai lasciato la stanza.",
  coin: "I crediti della stanza non tornano indietro. Le chiavi che hai dato e ricevuto si annullano.",
  resto: "Resto",
  lascia: "Lascia la stanza",
  app: "Se qualcosa non funziona, scrivici dall'Aiuto.",
  inChiamata: "Prima chiudi la chiamata.",
  fatto: "Hai lasciato la stanza. Ti aspettiamo lunedì.",
  // Testi già usati nell'app.
  aiuto: "Aiuto",
  nonNellaStanza: "La stanza è chiusa.",
  generico: "Non è andata. Riprova tra poco.",
  rete: "Sei senza connessione. Riprova tra poco.",
  // Etichetta del campo «Altro» (WCAG: etichetta visibile).
  altro: `Scrivi il motivo (da ${MINIMO} a ${MASSIMO} caratteri)`,
});

const CODICI = new Set(MOTIVI_APP.map((m) => m.id));
const pulito = (t) => (typeof t === "string" ? t.trim() : "");
const testoBuono = (t) => pulito(t).length >= MINIMO && pulito(t).length <= MASSIMO;

// Cosa mostra la schermata. fase: "scelta" | "invio".
export function statoUscita({ scelto = null, testo = "", fase = "scelta", errore = null } = {}) {
  const motivo = CODICI.has(scelto) ? scelto : null;
  const pronto = motivo !== null && (motivo !== "altro" || testoBuono(testo));
  const invio = fase === "invio";
  return {
    titolo: TESTI_APP.titolo,
    sotto: TESTI_APP.sotto,
    motivi: MOTIVI_APP.map((m) => ({ id: m.id, testo: m.testo, scelto: m.id === motivo })),
    altro: motivo === "altro" ? { etichetta: TESTI_APP.altro, valore: typeof testo === "string" ? testo : "", massimo: MASSIMO } : null,
    aiuto: motivo === "app" ? TESTI_APP.app : null,
    coin: TESTI_APP.coin,
    resto: { testo: TESTI_APP.resto, attivo: !invio },
    lascia: { testo: TESTI_APP.lascia, attivo: pronto && !invio },
    errore: typeof errore === "string" && errore ? errore : null,
  };
}

// Richiesta al Worker con il token di chi usa l'app. Mai un'uscita inventata.
export function creaUscita({ token, fetch: f = (...a) => globalThis.fetch(...a) } = {}) {
  return {
    async lascia({ motivo, testo } = {}) {
      const t = await Promise.resolve().then(token).catch(() => null);
      if (!t) return { ok: false, motivo: "accesso", testo: TESTI_APP.generico };
      const corpo = { motivo, testo: motivo === "altro" ? pulito(testo) : null };
      let r;
      try {
        r = await f(PERCORSO, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
          body: JSON.stringify(corpo),
        });
      } catch {
        return { ok: false, motivo: "rete", testo: TESTI_APP.rete };
      }
      let c = null;
      try { c = await r.json(); } catch { /* sotto */ }
      if (r.ok && c && c.ok === true) return { ok: true, testo: typeof c.testo === "string" && c.testo ? c.testo : TESTI_APP.fatto };
      const m = c && typeof c.motivo === "string" ? c.motivo : "riprova";
      if (m === "in_chiamata") return { ok: false, motivo: m, testo: TESTI_APP.inChiamata };
      if (m === "non_nella_stanza") return { ok: false, motivo: m, testo: TESTI_APP.nonNellaStanza };
      return { ok: false, motivo: m, testo: TESTI_APP.generico };
    },
  };
}

function el(doc, tag, classe, testo) {
  const e = doc.createElement(tag);
  if (classe) e.className = classe;
  if (testo != null) e.textContent = testo;
  return e;
}

// Stile: classi già esistenti in app.css (motivi-segnala, casella, racconto-segnala, nota, errore, azioni, bottoni).
// La schermata 22. Le scelte sono radio veri dentro un fieldset con legend (tastiera e lettori di schermo); il campo
// «Altro» si crea alla prima scelta e poi non si ridisegna mai (fuoco e cursore restano dove sono).
export function apriSchermataUscita(contenitore, { uscita, alResto, alFatto, alAiuto } = {}) {
  const doc = contenitore.ownerDocument;
  const st = { scelto: null, testo: "", fase: "scelta", errore: null };
  let aperta = true;

  const schermo = el(doc, "section", null);
  schermo.setAttribute("aria-labelledby", "uscita-titolo");
  const titolo = el(doc, "h1", null, TESTI_APP.titolo);
  titolo.id = "uscita-titolo";
  titolo.setAttribute("id", "uscita-titolo");

  const gruppo = el(doc, "fieldset", "motivi-segnala");
  const legenda = el(doc, "legend", null, TESTI_APP.sotto);
  gruppo.append(legenda);
  const scelte = MOTIVI_APP.map((m) => {
    const etichetta = el(doc, "label", "casella");
    const r = doc.createElement("input");
    r.type = "radio";
    r.setAttribute("type", "radio");
    r.name = "motivo-uscita";
    r.setAttribute("name", "motivo-uscita");
    r.value = m.id;
    r.setAttribute("value", m.id);
    r.addEventListener("change", () => { if (r.checked) { st.scelto = m.id; st.errore = null; aggiorna(); } });
    etichetta.append(r, el(doc, "span", null, m.testo));
    gruppo.append(etichetta);
    return r;
  });

  // Campo «Altro», creato alla prima scelta.
  let altro = null;
  function campoAltro() {
    if (altro) return altro;
    const box = el(doc, "div", null);
    const etichetta = el(doc, "label", null, TESTI_APP.altro);
    etichetta.setAttribute("for", "uscita-altro-testo");
    const campo = doc.createElement("textarea");
    campo.id = "uscita-altro-testo";
    campo.setAttribute("id", "uscita-altro-testo");
    campo.setAttribute("maxlength", String(MASSIMO));
    campo.setAttribute("rows", "3");
    campo.className = "racconto-segnala";
    campo.addEventListener("input", () => { st.testo = campo.value; aggiornaPulsanti(); });
    box.append(etichetta, campo);
    altro = box;
    return box;
  }

  const zonaAiuto = el(doc, "p", "nota");
  const vaiAiuto = el(doc, "button", "link", TESTI_APP.aiuto);
  vaiAiuto.setAttribute("type", "button");
  vaiAiuto.addEventListener("click", () => { if (typeof alAiuto === "function") alAiuto(); });
  zonaAiuto.append(el(doc, "span", null, TESTI_APP.app));
  if (typeof alAiuto === "function") zonaAiuto.append(" ", vaiAiuto); // senza Aiuto collegato, solo il testo

  const coin = el(doc, "p", "nota", TESTI_APP.coin);
  const errore = el(doc, "p", "errore");
  errore.setAttribute("role", "alert");

  const azioni = el(doc, "div", "azioni");
  const resto = el(doc, "button", "bottone-secondario", TESTI_APP.resto);
  resto.setAttribute("type", "button");
  resto.addEventListener("click", () => { if (st.fase !== "invio") chiudi(); });
  const lascia = el(doc, "button", "bottone", TESTI_APP.lascia);
  lascia.setAttribute("type", "button");
  lascia.addEventListener("click", invia);
  azioni.append(resto, lascia);

  function chiudi() {
    if (!aperta) return;
    aperta = false;
    schermo.remove();
    if (typeof alResto === "function") alResto();
  }

  async function invia() {
    const s = statoUscita(st);
    if (!s.lascia.attivo) return; // secondo tocco o motivo mancante
    st.fase = "invio";
    st.errore = null;
    aggiornaPulsanti();
    const r = await uscita.lascia({ motivo: st.scelto, testo: st.testo });
    if (!aperta) return;
    st.fase = "scelta";
    if (r.ok) {
      aperta = false;
      schermo.remove();
      if (typeof alFatto === "function") alFatto(r.testo);
      return;
    }
    st.errore = r.testo;
    aggiorna();
  }

  function aggiornaPulsanti() {
    const s = statoUscita(st);
    lascia.disabled = !s.lascia.attivo;
    resto.disabled = !s.resto.attivo;
    for (const r of scelte) r.disabled = st.fase === "invio";
    if (altro) altro.hidden = !s.altro;
    errore.textContent = s.errore || "";
  }

  // Tutto si costruisce una volta sola: spostare i nodi (replaceChildren) toglierebbe il fuoco a chi usa la tastiera
  // mentre sceglie con le frecce. Il campo «Altro» entra nella sua zona alla prima scelta; il resto si mostra o nasconde.
  const zonaAltro = el(doc, "div", null);
  schermo.append(titolo, gruppo, zonaAltro, zonaAiuto, coin, errore, azioni);

  function aggiorna() {
    const s = statoUscita(st);
    if (s.altro && !altro) zonaAltro.append(campoAltro());
    zonaAiuto.hidden = !s.aiuto;
    aggiornaPulsanti();
  }

  schermo.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && st.fase !== "invio") { e.preventDefault(); chiudi(); }
  });
  aggiorna();
  contenitore.append(schermo);
  titolo.setAttribute("tabindex", "-1");
  titolo.focus();
  return { chiudi, nodo: schermo };
}
