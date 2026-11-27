// «Ero lì» e «Non riesco a fare il check-in» (issue #6, spec v1 «Regole» e «Casi limite», v1.4 del CPO del 27/11;
// D51 A, D156 A). Linea «sviluppatore-b». Legge GET /app/api/incontro?porta=<id>&buca=1 e manda
// POST /app/api/incontro { azione: "contesta_buca", porta, testo } (worker/incontro_api.js → contesta_buca): chi contesta
// lo dice solo il token, chi può contestare e quando lo decide il database. Arrivano solo { contestabile, stato }: mai id,
// nomi, date o saldi dell'altra persona. Nella finestra del check-in il pulsante è «Non riesco a fare il check-in», dopo
// la buca è «Ero lì» (nomi dalla spec). Le altre frasi sono provvisorie, da rivedere con «contenuti». Niente salvataggi
// locali, niente log, il testo non va da nessun'altra parte. Non tocca la pagina: si prova con node --test.

const PERCORSO = "/app/api/incontro";
const MINIMO = 10;
const MASSIMO = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATI = ["in_attesa", "accolta", "respinta"];

export const TESTI_BUCA = Object.freeze({
  // Dalla spec (v1 casi limite e regole; v1.4 punto 1).
  eroLi: "Ero lì",
  nonRiesco: "Non riesco a fare il check-in",
  altroContesta: "L'altra persona dice che non è riuscita a fare il check-in. Decidiamo entro 48 ore e ti scriviamo qui.",
  nota: "Lo legge una persona, non un algoritmo.",
  // Provvisori.
  domanda: "Cosa è successo?",
  manda: "Manda",
  annulla: "Annulla",
  inviata: "Contestazione inviata. Finché non decidiamo nessun credito si muove: ti scriviamo qui.",
  inRevisione: "In revisione",
  accolta: "Abbiamo accolto la tua contestazione: i tuoi 100 crediti tornano a te.",
  respinta: "Abbiamo letto la tua contestazione: la buca resta.",
  errori: Object.freeze({
    testo_non_valido: "Scrivi almeno 10 caratteri (al massimo 500).",
    non_contestabile: "Questo incontro non si può più contestare.",
    gia_inviata: "Hai già mandato una contestazione per questo incontro.",
    generico: "Non siamo riusciti a mandarla. Riprova tra poco.",
  }),
});

const lunghezza = (t) => (typeof t === "string" ? [...t.trim()].length : 0);
export const testoValidoBuca = (t) => typeof t === "string" && lunghezza(t) >= MINIMO && lunghezza(t) <= MASSIMO;
export const LIMITI_BUCA = Object.freeze({ minimo: MINIMO, massimo: MASSIMO });

// Quale pulsante mostrare («non_riesco», «ero_li», «in_revisione» o nessuno) e l'esito di una decisione.
// tipo è quello di schermataIncontro: «confermato» (finestra del check-in) o «concluso» (dopo la buca).
export function rigaContestaBuca(c, tipo) {
  const vuota = { bottone: null, esito: null };
  if (!c || typeof c !== "object" || typeof c.contestabile !== "boolean") return vuota;
  const stato = c.stato ?? null;
  if (stato !== null && !STATI.includes(stato)) return vuota;
  if (tipo !== "confermato" && tipo !== "concluso") return vuota;
  if (stato === "in_attesa") return { bottone: "in_revisione", esito: null };
  if (stato) return { bottone: null, esito: TESTI_BUCA[stato] };
  if (!c.contestabile) return vuota;
  return { bottone: tipo === "confermato" ? "non_riesco" : "ero_li", esito: null };
}

export function creaContestaBuca({ token, fetch: f = globalThis.fetch }) {
  const leggiToken = () => Promise.resolve().then(token).catch(() => null);
  return {
    // { ok: true, contestazione: { contestabile, stato } } oppure { ok: false, motivo: "accesso" | "rete" | "lettura" }.
    async leggi(porta) {
      if (typeof porta !== "string" || !UUID.test(porta)) return { ok: false, motivo: "lettura" };
      const t = await leggiToken();
      if (!t) return { ok: false, motivo: "accesso" };
      let r;
      try {
        r = await f(`${PERCORSO}?porta=${porta}&buca=1`, { method: "GET", headers: { authorization: `Bearer ${t}` } });
      } catch {
        return { ok: false, motivo: "rete" };
      }
      if (r.status === 401) return { ok: false, motivo: "accesso" };
      if (!r.ok) return { ok: false, motivo: "lettura" };
      let corpo;
      try { corpo = await r.json(); } catch { return { ok: false, motivo: "lettura" }; }
      const c = corpo && corpo.ok === true ? corpo.contestazione : null;
      const stato = c && typeof c === "object" ? c.stato ?? null : undefined;
      if (!c || typeof c.contestabile !== "boolean" || !(stato === null || STATI.includes(stato))) return { ok: false, motivo: "lettura" };
      return { ok: true, contestazione: { contestabile: c.contestabile, stato } };
    },
    // { ok: true } oppure { ok: false, testo } con una frase da mostrare sotto il campo.
    async manda(porta, testo) {
      if (!testoValidoBuca(testo)) return { ok: false, testo: TESTI_BUCA.errori.testo_non_valido };
      if (typeof porta !== "string" || !UUID.test(porta)) return { ok: false, testo: TESTI_BUCA.errori.generico };
      const t = await leggiToken();
      if (!t) return { ok: false, testo: TESTI_BUCA.errori.generico };
      let corpo;
      try {
        const r = await f(PERCORSO, { method: "POST",
          headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
          body: JSON.stringify({ azione: "contesta_buca", porta, testo }) });
        corpo = await r.json();
      } catch {
        return { ok: false, testo: TESTI_BUCA.errori.generico };
      }
      if (corpo && corpo.ok === true && corpo.esito === "inviata") return { ok: true };
      const m = corpo && typeof corpo.motivo === "string" ? corpo.motivo : "";
      return { ok: false, testo: m !== "generico" && Object.hasOwn(TESTI_BUCA.errori, m) ? TESTI_BUCA.errori[m] : TESTI_BUCA.errori.generico };
    },
  };
}

// Il foglio dentro «Il vostro incontro» (passo 2): lo stato si legge una volta per porta; il testo resta solo in memoria.
export function creaFoglioBuca({ client, aggiorna = () => {} }) {
  let porta = null;
  let contestazione = null;
  let lettura = Promise.resolve();
  let aperto = false;
  let testo = "";
  let invio = false;
  let errore = "";
  let inviata = false;
  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare il foglio */ } };
  return {
    sincronizza(p) {
      if (!p || p === porta) return;
      porta = p;
      contestazione = null; aperto = false; testo = ""; errore = ""; inviata = false;
      lettura = Promise.resolve().then(() => client.leggi(p)).catch(() => null).then((r) => {
        if (porta !== p) return;
        contestazione = r && r.ok ? r.contestazione : null;
        avvisa();
      });
    },
    letto: () => lettura,
    apri() { aperto = true; testo = ""; errore = ""; inviata = false; avvisa(); },
    chiudi() { aperto = false; testo = ""; errore = ""; avvisa(); },
    imposta(t) { testo = typeof t === "string" ? t : ""; },
    async manda() {
      if (invio || !porta) return false;
      if (!testoValidoBuca(testo)) { errore = TESTI_BUCA.errori.testo_non_valido; avvisa(); return false; }
      invio = true; errore = ""; avvisa();
      const p = porta;
      const r = await Promise.resolve().then(() => client.manda(p, testo)).catch(() => ({ ok: false, testo: TESTI_BUCA.errori.generico }));
      invio = false;
      if (porta !== p) return false;
      if (r && r.ok) {
        aperto = false; testo = ""; inviata = true;
        contestazione = { contestabile: false, stato: "in_attesa" };
      } else errore = (r && r.testo) || TESTI_BUCA.errori.generico;
      avvisa();
      return !!(r && r.ok);
    },
    modello: () => ({ porta, contestazione, aperto, testo, invio, errore, inviata }),
  };
}

// La vista del foglio (h come in flusso.js). s è il risultato di schermataIncontro, i lo stato dell'incontro.
export function vistaFoglioBuca(h, fb, porta, s, i) {
  if (!fb || !s || (s.tipo !== "confermato" && s.tipo !== "concluso")) return null;
  fb.sincronizza(porta);
  const m = fb.modello();
  if (m.porta !== porta) return null;
  const riga = rigaContestaBuca(m.contestazione, s.tipo);
  const parti = [];
  if (i && i.esito === "contestato" && m.contestazione && m.contestazione.stato === null) {
    parti.push(h("p", { classe: "nota", role: "status" }, TESTI_BUCA.altroContesta));
  }
  if (m.inviata) parti.push(h("p", { classe: "nota", role: "status" }, TESTI_BUCA.inviata));
  if (riga.bottone === "in_revisione") parti.push(h("p", { classe: "nota" }, TESTI_BUCA.inRevisione));
  if (riga.esito) parti.push(h("p", { classe: "nota", role: "status" }, riga.esito));
  const nome = riga.bottone === "non_riesco" ? TESTI_BUCA.nonRiesco : riga.bottone === "ero_li" ? TESTI_BUCA.eroLi : null;
  if (nome && !m.aperto) {
    parti.push(h("button", { classe: "bottone-secondario", type: "button", onclick: () => {
      fb.apri();
      const campo = globalThis.document && globalThis.document.getElementById("contesta-buca-testo");
      if (campo) campo.focus();
    } }, nome));
  }
  if (nome && m.aperto) {
    parti.push(h("div", { classe: "foglio-contesta", role: "group", "aria-label": nome },
      h("label", { for: "contesta-buca-testo" }, TESTI_BUCA.domanda),
      h("p", { classe: "nota", id: "contesta-buca-nota" }, TESTI_BUCA.nota),
      h("textarea", { id: "contesta-buca-testo", classe: "racconto-segnala", rows: "5", minlength: String(MINIMO),
        maxlength: String(MASSIMO), "aria-describedby": "contesta-buca-nota", disabled: m.invio,
        oninput: (e) => fb.imposta(e.target.value) }, m.testo),
      m.errore ? h("p", { classe: "errore", role: "alert" }, m.errore) : null,
      h("div", { classe: "azioni" },
        h("button", { classe: "bottone", type: "button", disabled: m.invio, onclick: () => fb.manda() }, m.invio ? "Invio…" : TESTI_BUCA.manda),
        h("button", { classe: "link", type: "button", disabled: m.invio, onclick: () => fb.chiudi() }, TESTI_BUCA.annulla))));
  }
  return parti.length ? h("div", { classe: "contesta-buca" }, parti) : null;
}
