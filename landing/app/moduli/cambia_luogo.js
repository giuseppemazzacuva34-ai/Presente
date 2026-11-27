// «Cambia luogo» (issue #6, spec v1 del CPO del 3/11, «Casi limite»: «Locale chiuso o cambiato all'ultimo»; D51 A).
// Linea «sviluppatore-b». Fino a 1 ora prima dell'incontro confermato uno dei due propone un altro posto; cambia solo se
// l'altra persona conferma, altrimenti resta quello vecchio; giorno e ora non cambiano. Le regole le decide il database
// (cambia_luogo, rispondi_cambio_luogo): qui si leggono dallo stato dell'incontro le azioni «cambia_luogo» e
// «rispondi_cambio» e «cambio_luogo» { mio, locale, luogo, scade } (mai chi l'ha chiesto), e si manda
// POST /app/api/incontro { azione: "cambia_luogo", porta, locale | luogo } oppure
// POST /app/api/incontro { azione: "rispondi_cambio", porta, risposta: "accetto" | "rifiuto" } col token.
// Solo il nome del pulsante viene dalla spec; le altre frasi sono provvisorie, da rivedere con «contenuti».
// Niente salvataggi locali, niente log. Non tocca la pagina: riceve h, fetch e token dall'esterno (node --test).

const PERCORSO = "/app/api/incontro";
const LUOGO_MASSIMO = 80; // come nel database e in moduli/incontro.js
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RISPOSTE = ["accetto", "rifiuto"];

export const TESTI_CAMBIO = Object.freeze({
  // Dalla spec (v1, casi limite).
  bottone: "Cambia luogo",
  // Provvisori.
  domanda: "Dove vi vedete adesso?",
  nota: "Giorno e ora restano gli stessi. Il luogo cambia solo se l'altra persona conferma, fino a 1 ora prima.",
  dove: "Dove",
  altroLuogo: "Un altro luogo pubblico",
  daVerificare: "da verificare",
  luogo: "Nome e indirizzo del posto",
  manda: "Proponi il nuovo luogo",
  lascia: "Lascia stare",
  attimo: "Un attimo…",
  localeConsigliato: "un locale consigliato",
  altraPersona: "L'altra persona",
  mio: "Hai proposto di vedervi a <luogo>. Se l'altra persona non conferma entro <quando>, resta il luogo di prima.",
  altro: "<nome> propone di vedervi a <luogo>, stesso giorno e stessa ora. Rispondi entro <quando>: senza risposta resta il luogo di prima.",
  accetto: "Va bene, cambiamo",
  rifiuto: "No, resta com'era",
  proposto: "Proposta inviata.",
  cambiato: "Fatto: il luogo è cambiato.",
  rifiutato: "Va bene: resta il luogo di prima.",
  errori: Object.freeze({
    luogo_non_valido: "Scrivi il nome e l'indirizzo di un posto pubblico (massimo 80 caratteri).",
    stesso_luogo: "È già il luogo dell'incontro: scegline un altro.",
    attendi_risposta: "Hai già proposto un altro luogo: aspetta la risposta.",
    rispondi_prima: "L'altra persona ti ha proposto un altro luogo: rispondi prima.",
    troppo_tardi: "Manca meno di un'ora: il luogo non si può più cambiare.",
    nessun_cambio: "Questa proposta non c'è più.",
    non_puoi_rispondere: "Questa proposta l'hai fatta tu: risponde l'altra persona.",
    non_confermato: "L'incontro non è ancora confermato.",
    incontro_chiuso: "Questo incontro non è più disponibile.",
    generico: "Non è andata. Riprova tra poco.",
  }),
});

const GIORNO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long" });
const ORARIO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const breve = (v) => typeof v === "string" && v.trim() !== "" && v.trim().length <= LUOGO_MASSIMO;
const nomeLocale = (l) => `${l.nome.trim()} · ${l.indirizzo.trim()}${l.da_verificare === true ? ` · ${TESTI_CAMBIO.daVerificare}` : ""}`;
const elenco = (i) => (Array.isArray(i.locali) ? i.locali.filter((l) => l && typeof l === "object" && UUID.test(String(l.id))
  && typeof l.nome === "string" && l.nome.trim() && typeof l.indirizzo === "string" && l.indirizzo.trim()) : []);
// I locali che si possono proporre: quelli dello stato, meno quello dell'incontro.
const localiCambio = (i) => elenco(i).filter((l) => l.id !== i.locale);
const confermato = (i) => !!i && typeof i === "object" && i.stato === "confermato" && !i.esito;

function richiestaValida(c) {
  if (!c || typeof c !== "object" || typeof c.mio !== "boolean") return null;
  const locale = c.locale ?? null;
  const luogo = c.luogo ?? null;
  if ((locale === null) === (luogo === null)) return null;
  if (locale !== null && !(typeof locale === "string" && UUID.test(locale))) return null;
  if (luogo !== null && !breve(luogo)) return null;
  const scade = typeof c.scade === "string" ? new Date(c.scade) : null;
  if (!scade || !Number.isFinite(scade.getTime())) return null;
  return { mio: c.mio, locale, luogo, scade };
}

// Cosa mostrare: «cambia» (pulsante), «rispondi» (i due pulsanti per l'altra persona) e la frase della richiesta.
export function rigaCambio(i, nome = null) {
  const vuota = { cambia: false, rispondi: false, richiesta: null };
  if (!confermato(i)) return vuota;
  const azioni = Array.isArray(i.azioni) ? i.azioni : [];
  const c = i.cambio_luogo === null || i.cambio_luogo === undefined ? null : richiestaValida(i.cambio_luogo);
  if (i.cambio_luogo && !c) return vuota;
  if (!c) return { ...vuota, cambia: azioni.includes("cambia_luogo") };
  const trovato = c.locale ? elenco(i).find((l) => l.id === c.locale) : null;
  const dove = c.luogo ? c.luogo.trim() : trovato ? nomeLocale(trovato) : TESTI_CAMBIO.localeConsigliato;
  const quando = `${GIORNO.format(c.scade)} alle ${ORARIO.format(c.scade)}`;
  const chi = typeof nome === "string" && nome.trim() ? nome.trim() : TESTI_CAMBIO.altraPersona;
  const richiesta = (c.mio ? TESTI_CAMBIO.mio : TESTI_CAMBIO.altro.replace("<nome>", chi))
    .replace("<luogo>", dove).replace("<quando>", quando);
  return { cambia: false, rispondi: !c.mio && azioni.includes("rispondi_cambio"), richiesta };
}

const fraseErrore = (m) => (typeof m === "string" && m !== "generico" && Object.hasOwn(TESTI_CAMBIO.errori, m)
  ? TESTI_CAMBIO.errori[m] : TESTI_CAMBIO.errori.generico);

export function creaClientCambio({ token, fetch: f = globalThis.fetch }) {
  const leggiToken = () => Promise.resolve().then(token).catch(() => null);
  async function manda(corpo, riusciti) {
    const t = await leggiToken();
    if (!t) return { ok: false, testo: TESTI_CAMBIO.errori.generico };
    let r;
    try {
      const risposta = await f(PERCORSO, { method: "POST",
        headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(corpo) });
      r = await risposta.json();
    } catch {
      return { ok: false, testo: TESTI_CAMBIO.errori.generico };
    }
    if (r && r.ok === true && riusciti.includes(r.esito)) return { ok: true, esito: r.esito };
    return { ok: false, testo: fraseErrore(r && r.motivo) };
  }
  return {
    // { locale } (id di un locale dell'elenco) oppure { luogo } (nome e indirizzo scritti, 1-80 caratteri).
    async proponi(porta, { locale = "", luogo = "" } = {}) {
      if (typeof porta !== "string" || !UUID.test(porta)) return { ok: false, testo: TESTI_CAMBIO.errori.generico };
      if (typeof locale === "string" && locale !== "") {
        if (!UUID.test(locale)) return { ok: false, testo: TESTI_CAMBIO.errori.luogo_non_valido };
        return manda({ azione: "cambia_luogo", porta, locale }, ["proposto"]);
      }
      if (!breve(luogo)) return { ok: false, testo: TESTI_CAMBIO.errori.luogo_non_valido };
      return manda({ azione: "cambia_luogo", porta, luogo: luogo.trim() }, ["proposto"]);
    },
    async rispondi(porta, risposta) {
      if (typeof porta !== "string" || !UUID.test(porta) || !RISPOSTE.includes(risposta)) {
        return { ok: false, testo: TESTI_CAMBIO.errori.generico };
      }
      return manda({ azione: "rispondi_cambio", porta, risposta }, ["cambiato", "rifiutato"]);
    },
  };
}

// Il foglio dentro «Il vostro incontro»: bozza ed esiti solo in memoria; dopo un invio riuscito si rilegge lo stato.
export function creaFoglioCambio({ client, ricarica = () => {}, aggiorna = () => {} }) {
  let porta = null;
  let aperto = false;
  let bozza = { locale: "", luogo: "" };
  let invio = false;
  let errore = "";
  let esito = "";
  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare il foglio */ } };
  const rileggi = () => Promise.resolve().then(ricarica).catch(() => null);
  function sincronizza(p) {
    if (!p || p === porta) return;
    const prima = porta;
    porta = p;
    if (prima !== null) { aperto = false; bozza = { locale: "", luogo: "" }; invio = false; errore = ""; esito = ""; }
  }
  async function esegui(p, chiama, frase) {
    if (invio) return false;
    sincronizza(p);
    invio = true; errore = ""; esito = ""; avvisa();
    const r = await Promise.resolve().then(chiama).catch(() => ({ ok: false, testo: TESTI_CAMBIO.errori.generico }));
    invio = false;
    if (porta !== p) return false;
    if (r && r.ok) {
      aperto = false; bozza = { locale: "", luogo: "" }; esito = frase(r.esito);
      avvisa();
      await rileggi();
      return true;
    }
    errore = (r && r.testo) || TESTI_CAMBIO.errori.generico;
    avvisa();
    return false;
  }
  return {
    sincronizza,
    // Si parte dal primo locale diverso da quello dell'incontro; senza locali, dal posto scritto.
    apri(i) {
      const primo = i && typeof i === "object" ? localiCambio(i)[0] : null;
      aperto = true; errore = ""; esito = "";
      bozza = { locale: primo ? primo.id : "", luogo: "" };
      avvisa();
    },
    chiudi() { aperto = false; errore = ""; bozza = { locale: "", luogo: "" }; avvisa(); },
    imposta(campo, valore, ridisegna = false) {
      if (campo !== "locale" && campo !== "luogo") return;
      bozza = { ...bozza, [campo]: typeof valore === "string" ? valore : "" };
      if (ridisegna) avvisa();
    },
    async manda(p) {
      if (invio) return false;
      const scelta = bozza.locale ? { locale: bozza.locale } : { luogo: bozza.luogo };
      if (!bozza.locale && !breve(bozza.luogo)) { errore = TESTI_CAMBIO.errori.luogo_non_valido; avvisa(); return false; }
      return esegui(p, () => client.proponi(p, scelta), () => TESTI_CAMBIO.proposto);
    },
    rispondi(p, risposta) {
      if (!RISPOSTE.includes(risposta)) return Promise.resolve(false);
      return esegui(p, () => client.rispondi(p, risposta), (e) => (e === "cambiato" ? TESTI_CAMBIO.cambiato : TESTI_CAMBIO.rifiutato));
    },
    modello: () => ({ porta, aperto, bozza: { ...bozza }, invio, errore, esito }),
  };
}

// La vista del foglio (h come in flusso.js). i è lo stato dell'incontro, nome quello dell'altra persona (solo testo).
export function vistaFoglioCambio(h, fc, porta, i, nome = null) {
  if (!fc || !confermato(i)) return null;
  fc.sincronizza(porta);
  const m = fc.modello();
  const riga = rigaCambio(i, nome);
  const T = TESTI_CAMBIO;
  const parti = [];
  if (m.esito) parti.push(h("p", { classe: "nota", role: "status" }, m.esito));
  if (riga.richiesta) parti.push(h("p", { classe: "nota", role: "status", id: "cambia-luogo-richiesta" }, riga.richiesta));
  if (riga.rispondi) {
    parti.push(h("div", { classe: "azioni", role: "group", "aria-labelledby": "cambia-luogo-richiesta" },
      h("button", { classe: "bottone", type: "button", disabled: m.invio, onclick: () => fc.rispondi(porta, "accetto") }, T.accetto),
      h("button", { classe: "bottone-secondario", type: "button", disabled: m.invio, onclick: () => fc.rispondi(porta, "rifiuto") }, T.rifiuto)));
  }
  if (riga.cambia && !m.aperto) {
    parti.push(h("button", { classe: "bottone-secondario", type: "button", disabled: m.invio, onclick: () => {
      fc.apri(i);
      const campo = globalThis.document && (globalThis.document.getElementById("cambia-luogo-dove")
        || globalThis.document.getElementById("cambia-luogo-testo"));
      if (campo) campo.focus();
    } }, T.bottone));
  }
  if (riga.cambia && m.aperto) {
    const locali = localiCambio(i);
    parti.push(h("div", { classe: "proposta-incontro", role: "group", "aria-labelledby": "cambia-luogo-titolo" },
      h("h3", { id: "cambia-luogo-titolo" }, T.domanda),
      locali.length ? h("div", { classe: "campo" },
        h("label", { for: "cambia-luogo-dove" }, T.dove),
        h("select", { id: "cambia-luogo-dove", disabled: m.invio, "aria-describedby": "cambia-luogo-nota",
          onchange: (e) => fc.imposta("locale", e.target.value, true) },
          locali.map((l) => h("option", { value: l.id, selected: l.id === m.bozza.locale }, nomeLocale(l))),
          h("option", { value: "", selected: m.bozza.locale === "" }, T.altroLuogo))) : null,
      locali.length && m.bozza.locale !== "" ? null : h("div", { classe: "campo" },
        h("label", { for: "cambia-luogo-testo" }, T.luogo),
        h("input", { id: "cambia-luogo-testo", type: "text", maxlength: String(LUOGO_MASSIMO), autocomplete: "off", value: m.bozza.luogo,
          "aria-describedby": "cambia-luogo-nota", disabled: m.invio, oninput: (e) => fc.imposta("luogo", e.target.value) })),
      h("p", { id: "cambia-luogo-nota", classe: "nota", role: "note" }, T.nota),
      h("button", { classe: "bottone", type: "button", disabled: m.invio, onclick: () => fc.manda(porta) }, m.invio ? T.attimo : T.manda),
      h("button", { classe: "bottone-secondario", type: "button", disabled: m.invio, onclick: () => fc.chiudi() }, T.lascia)));
  }
  if (m.errore) parti.push(h("p", { classe: "errore", role: "alert" }, m.errore));
  return parti.length ? h("div", { classe: "cambia-luogo" }, parti) : null;
}
