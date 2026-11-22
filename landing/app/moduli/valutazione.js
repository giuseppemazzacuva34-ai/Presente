// Le 4 domande della valutazione dopo l'incontro (issue #6, spec v1 del CPO del 3/11, «Valutazione (D20)»; D20 A).
// Passo 3f della linea «sviluppatore-b».
// Una domanda per schermata, risposta obbligatoria; «Non ora» salta tutto senza mandare nulla (la valutazione resta
// aperta 7 giorni: lo dice il server con l'azione «valuta» nello stato dell'incontro, passo 3e).
// All'ultima risposta parte una sola richiesta POST /app/api/incontro { azione: "valuta", porta, presentato, foto_sue,
// come_in_chiamata, sicuro } (worker/incontro_api.js → valuta_incontro): chi risponde lo dice solo il token.
// Mai voti, stelle o domande sull'aspetto; nessun riepilogo sull'altra persona qui (solo riepiloghi alla cieca, altrove).
// Con «No» alla sicurezza il server ha già fatto partire un controllo di 1 ora (#7, passo 16b): qui si propone di
// raccontare. Le risposte restano nella memoria della pagina fino all'invio: niente salvataggi locali, niente log.
// Il modulo non tocca la pagina: riceve fetch, token e h dall'esterno, così si prova con node --test.

const PERCORSO = "/app/api/incontro";
const ATTESA_MS = 8000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const TESTI_VALUTAZIONE = Object.freeze({
  // Testi della spec.
  titolo: "Com'è andata? Tutto bene?",
  nonOra: "Non ora",
  racconta: "Vuoi raccontarci cosa è successo?",
  // Provvisori, da rivedere con «contenuti».
  apri: "Com'è andata?",
  passo: "<n> di 4",
  indietro: "Indietro",
  altraPersona: "L'altra persona",
  privata: "Questa risposta resta tra te e Presente: <nome> non la vedrà mai.",
  attimo: "Un attimo…",
  grazie: "Grazie. Le risposte restano nascoste finché non avete risposto tutti e due.",
  giaAvvisati: "Una persona di Presente controllerà entro 1 ora. <nome> non saprà mai cosa hai risposto.",
  pericolo: "Se sei in pericolo ora, chiama il 112.",
  raccontaSi: "Sì, racconto",
  chiudi: "Chiudi",
});

const chi = (nome) => (typeof nome === "string" && nome.trim() ? nome.trim().slice(0, 60) : null);

// Le domande nell'ordine della spec; i valori sono quelli di api/valutazione.js (il test lo controlla).
export function domandeValutazione(nome) {
  const n = chi(nome);
  return [
    { id: "presentato", testo: `${n || TESTI_VALUTAZIONE.altraPersona} si è presentata/o?`,
      risposte: [["si", "Sì"], ["in_ritardo", "Sì, ma in ritardo"], ["no", "No"]] },
    { id: "foto_sue", testo: "Le foto erano davvero sue?", risposte: [["si", "Sì"], ["non_sicuro", "Non ne sono sicura/o"], ["no", "No"]] },
    { id: "come_in_chiamata", testo: "Era come in chiamata?", risposte: [["si", "Sì"], ["piu_o_meno", "Più o meno"], ["no", "No"]] },
    { id: "sicuro", testo: "Ti sei sentita/o al sicuro?", risposte: [[true, "Sì"], [false, "No"]],
      nota: TESTI_VALUTAZIONE.privata.replace("<nome>", n || "L'altra persona") },
  ];
}

const ERRORI = Object.freeze({
  rete: "Sei senza connessione. Riprova tra poco.",
  accesso: "Accedi di nuovo per continuare.",
  troppe: "Troppi tentativi. Aspetta un minuto.",
  gia_fatta: "Hai già risposto. Grazie!",
  chiusa: "Il tempo per rispondere è finito.",
  non_avvenuto: "Questa valutazione non è disponibile.",
  non_trovato: "Questa valutazione non è disponibile.",
});
export const testoErroreValutazione = (motivo) => (Object.hasOwn(ERRORI, String(motivo)) ? ERRORI[motivo] : "Non è andata. Riprova tra poco.");
// Con questi motivi non serve riprovare: la valutazione è chiusa per questa persona.
const FINALI = ["gia_fatta", "chiusa", "non_avvenuto", "non_trovato"];

export function creaValutazione({ token, fetch: f = globalThis.fetch, attesa = ATTESA_MS, aggiorna = () => {}, finito = () => {} }) {
  let porta = null;
  let nome = null;
  let passo = 0;
  let risposte = {};
  let inCorso = false;
  let errore = null;
  let esito = null; // «grazie», «racconta» o «chiusa»
  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare la schermata */ } };
  const fine = (e) => { try { finito(e); } catch { /* idem */ } };

  async function manda(corpo) {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return { ok: false, motivo: "accesso" };
    const ferma = new AbortController();
    const timer = setTimeout(() => ferma.abort(), attesa);
    try {
      let r;
      try {
        r = await f(PERCORSO, { method: "POST", signal: ferma.signal,
          headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(corpo) });
      } catch {
        return { ok: false, motivo: "rete" };
      }
      if (r.status === 401) return { ok: false, motivo: "accesso" };
      if (r.status === 429) return { ok: false, motivo: "troppe" };
      let dati;
      try { dati = await r.json(); } catch { return { ok: false, motivo: "riprova" }; }
      if (!dati || typeof dati !== "object") return { ok: false, motivo: "riprova" };
      if (dati.ok !== true) return { ok: false, motivo: r.status === 404 ? "non_trovato" : String(dati.motivo || "riprova") };
      return ["grazie", "racconta"].includes(dati.esito) ? { ok: true, esito: dati.esito } : { ok: false, motivo: "riprova" };
    } finally {
      clearTimeout(timer);
    }
  }

  async function invia() {
    inCorso = true;
    errore = null;
    avvisa();
    const id = porta;
    const r = await manda({ azione: "valuta", porta: id, presentato: risposte.presentato, foto_sue: risposte.foto_sue,
      come_in_chiamata: risposte.come_in_chiamata, sicuro: risposte.sicuro });
    inCorso = false;
    if (porta !== id) return false;
    if (r.ok) {
      esito = r.esito;
      avvisa();
      fine(esito);
      return true;
    }
    errore = testoErroreValutazione(r.motivo);
    if (FINALI.includes(r.motivo)) {
      esito = "chiusa";
      fine(esito);
    }
    avvisa();
    return false;
  }

  return {
    apri(id, { nome: n = null } = {}) {
      porta = UUID.test(String(id || "")) ? String(id) : null;
      nome = chi(n);
      passo = 0;
      risposte = {};
      inCorso = false;
      errore = null;
      esito = null;
      avvisa();
    },
    // Una risposta della lista porta alla domanda successiva; all'ultima si manda tutto.
    async rispondi(valore) {
      if (!porta || inCorso || esito) return false;
      const d = domandeValutazione(nome)[passo];
      if (!d || !d.risposte.some(([v]) => v === valore)) return false;
      risposte = { ...risposte, [d.id]: valore };
      if (passo < 3) {
        passo += 1;
        errore = null;
        avvisa();
        return true;
      }
      return invia();
    },
    indietro() {
      if (!porta || inCorso || esito || passo === 0) return;
      passo -= 1;
      errore = null;
      avvisa();
    },
    // «Non ora»: chiude senza mandare nulla (o, dopo l'invio, chiude e basta).
    chiudi() {
      const prima = esito;
      porta = null;
      nome = null;
      passo = 0;
      risposte = {};
      errore = null;
      esito = null;
      inCorso = false;
      avvisa();
      fine(prima || "non_ora");
    },
    modello: () => ({ porta, nome, passo, risposte: { ...risposte }, inCorso, errore, esito }),
  };
}

// La vista (h come in flusso.js). null se la valutazione non è aperta. opzioni.racconta apre il racconto (#7).
export function vistaValutazione(h, val, { racconta = null } = {}) {
  const m = val.modello();
  if (!m.porta) return null;
  const T = TESTI_VALUTAZIONE;
  const parti = [];
  if (m.esito === "grazie") {
    parti.push(h("p", { role: "status" }, T.grazie));
  } else if (m.esito === "racconta") {
    parti.push(h("p", { role: "status" }, T.giaAvvisati.replace("<nome>", m.nome || T.altraPersona)),
      h("p", { classe: "nota" }, h("a", { href: "tel:112" }, T.pericolo)),
      h("p", { id: "valutazione-racconta" }, T.racconta));
    if (typeof racconta === "function") {
      parti.push(h("button", { classe: "bottone", type: "button", "aria-describedby": "valutazione-racconta", onclick: () => racconta() }, T.raccontaSi));
    }
  } else if (!m.esito) {
    const d = domandeValutazione(m.nome)[m.passo];
    parti.push(h("p", { classe: "nota" }, T.passo.replace("<n>", String(m.passo + 1))),
      h("fieldset", { classe: "domanda-valutazione", "aria-describedby": d.nota ? "valutazione-nota" : null },
        h("legend", null, d.testo),
        d.nota ? h("p", { id: "valutazione-nota", classe: "nota" }, d.nota) : null,
        d.risposte.map(([v, t]) => h("button", { classe: "bottone", type: "button", disabled: m.inCorso,
          "aria-pressed": m.risposte[d.id] === v ? "true" : "false", onclick: () => val.rispondi(v) }, t))));
    if (m.inCorso) parti.push(h("p", { classe: "nota", role: "status" }, T.attimo));
    if (m.passo > 0) parti.push(h("button", { classe: "bottone-secondario", type: "button", disabled: m.inCorso, onclick: () => val.indietro() }, T.indietro));
  }
  if (m.errore) parti.push(h("p", { classe: "errore", role: "alert" }, m.errore));
  if (m.esito !== "grazie" && m.esito !== "chiusa") {
    parti.push(h("button", { classe: "bottone-secondario", type: "button", disabled: m.inCorso, onclick: () => val.chiudi() }, T.nonOra));
  } else {
    parti.push(h("button", { classe: "bottone-secondario", type: "button", onclick: () => val.chiudi() }, T.chiudi));
  }
  return h("section", { classe: "valutazione", "aria-labelledby": "valutazione-titolo" }, h("h2", { id: "valutazione-titolo" }, T.titolo), parti);
}
