// Schermata «Il vostro incontro» nella web app (issue #6, spec v1 del CPO del 3/11, passi 1-4 e regola sulla scadenza;
// D17 A). Passo 2e della linea «sviluppatore-b».
// Stato, proposta e risposta passano da /app/api/incontro (worker/incontro_api.js): chi propone o risponde lo dice solo
// il token, le regole (orari, luogo, controproposte, 48 ore, scadenza, crediti) le decide il server. Qui si mostra lo
// stato e si aiuta a scegliere un orario valido; gli orari si calcolano con la stessa regola di api/incontro.js
// (il test lo controlla). Per ora «Dove» è solo «Un altro luogo pubblico» scritto: i locali consigliati arrivano quando
// la lista dei locali pilota sarà nel database. Niente posizione, niente salvataggi locali, niente dati nei log.
// Il modulo non tocca la pagina: riceve fetch, token e h dall'esterno, così si prova con node --test.
// Passo 2i: «Sono qui» (POST { azione: "checkin", porta }) e segnale (passi 6 e 8 della spec). La finestra, chi ha già
// fatto il check-in e la parola del segnale li dice solo il server (stato_incontro); qui non si inventa nulla.
// Passo 2r (spec v1.1 del 20/11): «Disdici» (POST { azione: "disdici", porta }) e «Annulla l'incontro» (POST { azione:
// "annulla", porta }), ognuno dopo una domanda di conferma, e la disdetta detta all'altra persona. Il nome dell'altra
// persona lo passa chi apre la schermata (apri(id, { nome })): resta in memoria, non va mai al server.
// Passo 2v (D143 B): se lo stato porta dei locali (a Milano i 30 del tab «Locali pilota»), «Dove» è un menu con i locali
// e «Un altro luogo pubblico»; i non visitati dicono «da verificare». Si manda solo l'id di un locale dell'elenco.

import { TESTI_VALUTAZIONE } from "./valutazione.js";
import { vistaFoglioBuca } from "./contesta_buca.js"; // «Ero lì» / «Non riesco» (spec v1.4)
import { vistaFoglioCambio } from "./cambia_luogo.js"; // «Cambia luogo» (spec v1, casi limite)
import { vistaFoglioAvviso } from "./avvisa_qui.js"; // «Avvisa <nome> che sei qui» (spec v1, punto 6)
import { testoIcs, TESTI_CALENDARIO } from "./calendario_incontro.js"; // «Aggiungi al calendario» (spec v1, passo 4)

const PERCORSO = "/app/api/incontro";
const ATTESA_MS = 8000;
const MEZZORA = 30 * 60 * 1000;
const PRIMA_ORA = 10 * 60; // 10:00, in minuti del giorno di Roma
const ULTIMA_ORA = 23 * 60; // 23:00 compreso
const LUOGO_MASSIMO = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATI = ["da_fissare", "proposto", "confermato", "concluso"];
const AZIONI = ["proponi", "accetto", "altra_data", "annulla", "sono_qui", "disdici", "annulla_incontro", "valuta", "ritardo"];
const RITARDI = [15, 30]; // come INCONTRO.ritardi in api/incontro.js; decide il server
const ORE_GRATIS = 6; // come INCONTRO.disdettaGratisOre in api/incontro.js (il test lo controlla); decide il server
const RISPOSTE = ["accetto", "annulla"];

export const TESTI_INCONTRO = Object.freeze({
  // Testi della spec (passi 1-4 e regole).
  viIncontrate: "Vi incontrate! Avete fino al <data> per vedervi.",
  proponi: "Proponi quando e dove",
  pubblico: "Scegliete sempre un posto pubblico e frequentato.",
  altroLuogo: "Un altro luogo pubblico",
  daVerificare: "da verificare", // D143 B
  dove: "Dove", // etichetta del menu, provvisoria
  accetto: "Accetto",
  altraData: "Propongo un'altra data",
  annulla: "Annulla l'incontro",
  confermato: "Ci vediamo <giorno> alle <ora> · <luogo>",
  caparra: "Se uno dei due non si presenta, i suoi 100 crediti vanno: 70 a chi ha aspettato, 30 a Presente.",
  scaduto: "Non siete riusciti a fissare l'incontro. I tuoi 100 crediti sono di nuovo disponibili.",
  // Provvisori, da rivedere con «contenuti».
  titolo: "Il vostro incontro",
  aspetta: "Hai fatto la tua proposta. Aspettiamo la risposta.",
  ricevuta: "Ti propone:",
  scadeProposta: "Rispondi entro <quando>.",
  controproposte: "Puoi proporre ancora <n>.",
  annullato: "L'incontro è annullato. I crediti tornano a entrambi.",
  chiuso: "Questo incontro è chiuso.",
  confermaAnnulla: "Annulli l'incontro? Non potrete più fissarlo. I crediti tornano a entrambi.",
  siAnnulla: "Sì, annulla",
  no: "No, torna indietro",
  giorno: "Giorno",
  ora: "Ora",
  luogo: "Nome e indirizzo del posto",
  invia: "Invia la proposta",
  lascia: "Lascia stare",
  localeConsigliato: "il locale consigliato",
  orarioNonVa: "Questo orario non va bene. Scegline un altro.",
  luogoNonVa: "Scrivi il nome e l'indirizzo di un posto pubblico (massimo 80 caratteri).",
  aspettaRisposta: "Aspetta la risposta alla tua proposta.",
  controproposteFinite: "Non puoi proporre altre date: puoi accettare o annullare.",
  giaConfermato: "L'incontro è già confermato.",
  propostaScaduta: "Questa proposta è scaduta.",
  orarioPassato: "L'orario proposto è già passato.",
  nonDisponibile: "Questo incontro non è più disponibile.",
  attimo: "Un attimo…",
  // Check-in e segnale (passi 6 e 8 della spec).
  sonoQui: "Sono qui",
  segnale: "Il vostro segnale: <parola>",
  creditiLiberi: "I tuoi 100 crediti sono di nuovo disponibili.",
  // Provvisori, da rivedere con «contenuti» (la spec usa il nome dell'altra persona, che lo stato non manda ancora).
  aspettaAltro: "<nome> non ha ancora fatto il check-in.", // dalla spec v1, punto 6
  finestraCheckin: "Potrai dire «Sono qui» <giorno> dalle <da> alle <fino>.",
  troppoPresto: "È ancora presto: «Sono qui» si può dire da 30 minuti prima dell'incontro.",
  troppoTardi: "Il tempo per dire «Sono qui» è finito.",
  giaFatto: "Hai già detto «Sono qui».",
  nonConfermato: "L'incontro non è ancora confermato.",
  // Disdetta e annullamento (spec v1.1 del 20/11, punto 2).
  disdici: "Disdici",
  confermaDisdici: "Disdici questo appuntamento? Potete fissarne un altro entro il <data>. Se non lo fissate, i crediti tornano a entrambi.",
  disdettoAltro: "<nome> ha disdetto l'appuntamento di <giorno>. Potete fissarne un altro entro il <data>.",
  // Provvisori, da rivedere con «contenuti» (chiesti al CPO).
  confermaDisdiciTardi: "Mancano meno di 6 ore: se disdici ora è come non presentarsi, e i tuoi 100 crediti vanno: 70 all'altra persona, 30 a Presente. Disdici lo stesso?",
  siDisdici: "Sì, disdici",
  disdettoMio: "Hai disdetto l'appuntamento di <giorno>. Potete fissarne un altro entro il <data>.",
  altraPersona: "L'altra persona",
  orarioPassatoDisdici: "L'orario dell'incontro è già passato.",
  // «Arrivo in ritardo» (spec v1, casi limite): nome del pulsante e minuti dalla spec, il resto provvisorio.
  ritardo: "Arrivo in ritardo",
  ritardo15: "+15 minuti",
  ritardo30: "+30 minuti",
  domandaRitardo: "Di quanto arrivi in ritardo? Puoi dirlo una volta sola.",
  ritardoMio: "Hai avvisato che arrivi con <n> minuti di ritardo.",
  ritardoAltro: "<nome> arriva con <n> minuti di ritardo.",
  ritardoGiaUsato: "Il ritardo si può dire una volta sola.",
  ritardoNonValido: "Scegli +15 o +30 minuti.",
});

const GIORNO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long" });
const DATA = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long" });
const ORARIO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const valida = (x) => { const d = new Date(x); return x !== null && x !== undefined && Number.isFinite(d.getTime()) ? d : null; };
const minutiRoma = (d) => { const [o, m] = ORARIO.format(d).split(":").map(Number); return o * 60 + m; };

// Gli orari che si possono proporre, per giorno di Roma: da domani alle 10:00 fino alla scadenza, ogni 30 minuti, solo
// tra 10:00 e 23:00 (stessa regola di controllaOrario in api/incontro.js; il server resta l'unico a decidere).
export function orariProposta(scadenza, adesso = new Date()) {
  const fine = valida(scadenza);
  const ora = valida(adesso);
  if (!fine || !ora) return [];
  const oggi = GIORNO.format(ora);
  const giorni = [];
  for (let x = Math.ceil(ora.getTime() / MEZZORA) * MEZZORA; x <= fine.getTime(); x += MEZZORA) {
    const d = new Date(x);
    const giorno = GIORNO.format(d);
    const m = minutiRoma(d);
    if (giorno === oggi || m < PRIMA_ORA || m > ULTIMA_ORA) continue;
    let g = giorni.at(-1);
    if (!g || g.giorno !== giorno) giorni.push(g = { giorno, orari: [] });
    g.orari.push({ valore: d.toISOString(), testo: ORARIO.format(d) });
  }
  return giorni;
}

const breve = (v) => typeof v === "string" && v.trim() !== "";
const nomeLocale = (l) => `${l.nome.trim()} · ${l.indirizzo.trim()}${l.da_verificare === true ? ` · ${TESTI_INCONTRO.daVerificare}` : ""}`;
// I locali che si possono proporre, come li manda lo stato (passo 2u); voci di forma strana scartate.
export const localiIncontro = (i) => (i && Array.isArray(i.locali) ? i.locali.filter((l) => l && typeof l === "object"
  && UUID.test(String(l.id)) && breve(l.nome) && breve(l.indirizzo)) : []);
const dove = (i) => (typeof i.luogo === "string" && i.luogo.trim() ? i.luogo.trim()
  : typeof i.locale === "string" && i.locale.trim()
    ? (i.locale_scelto && breve(i.locale_scelto.nome) && breve(i.locale_scelto.indirizzo) ? nomeLocale(i.locale_scelto) : TESTI_INCONTRO.localeConsigliato)
    : "");
function quando(i) {
  const d = valida(i.orario);
  return d ? { giorno: GIORNO.format(d), ora: ORARIO.format(d) } : null;
}
const proposta = (i) => { const q = quando(i); return q ? `${q.giorno} alle ${q.ora} · ${dove(i)}` : ""; };

// Accanto a «Ci vediamo…»: quando si potrà dire «Sono qui», o che si aspetta l'altra persona.
function testoCheckin(i, adesso, nome = null) {
  const chi = typeof nome === "string" && nome.trim() ? nome.trim() : TESTI_INCONTRO.altraPersona;
  if (i.checkin_mio === true) return i.checkin_altro === true ? null : TESTI_INCONTRO.aspettaAltro.replace("<nome>", chi);
  const da = valida(i.checkin_da);
  const fino = valida(i.checkin_fino);
  if (!da || !fino || adesso >= da) return null;
  return TESTI_INCONTRO.finestraCheckin.replace("<giorno>", GIORNO.format(da)).replace("<da>", ORARIO.format(da)).replace("<fino>", ORARIO.format(fino));
}

// «Arrivo in ritardo» già detto: a chi l'ha detto senza nome, all'altra persona col nome. Minuti strani → nessun testo.
function testoRitardo(i, nome) {
  if (!RITARDI.includes(i.ritardo_minuti)) return null;
  if (i.ritardo_mio === true) return TESTI_INCONTRO.ritardoMio.replace("<n>", String(i.ritardo_minuti));
  const chi = typeof nome === "string" && nome.trim() ? nome.trim() : TESTI_INCONTRO.altraPersona;
  return TESTI_INCONTRO.ritardoAltro.replace("<nome>", chi).replace("<n>", String(i.ritardo_minuti));
}

// Dopo una disdetta in tempo (spec v1.1): a chi l'ha ricevuta col nome, a chi l'ha fatta senza. Senza orario o
// scadenza validi nessun testo.
function testoDisdetta(i, nome) {
  const d = i.disdetta;
  if (!d || typeof d !== "object" || typeof d.mia !== "boolean") return null;
  const o = valida(d.orario);
  const s = valida(i.scadenza);
  if (!o || !s) return null;
  const chi = typeof nome === "string" && nome.trim() ? nome.trim() : TESTI_INCONTRO.altraPersona;
  return (d.mia ? TESTI_INCONTRO.disdettoMio : TESTI_INCONTRO.disdettoAltro.replace("<nome>", chi))
    .replace("<giorno>", GIORNO.format(o)).replace("<data>", DATA.format(s));
}

// Domanda di conferma per «Disdici»: nelle ultime 6 ore è una buca (spec v1, regole), prima si può rifissare.
function testoConfermaDisdici(i, adesso) {
  const o = valida(i && i.orario);
  const s = valida(i && i.scadenza);
  if (o && o.getTime() - adesso.getTime() < ORE_GRATIS * 3600 * 1000) return TESTI_INCONTRO.confermaDisdiciTardi;
  return TESTI_INCONTRO.confermaDisdici.replace("<data>", s ? DATA.format(s) : "la scadenza");
}

// Cosa mostra la schermata (spec, passi 1-4). null = stato non ancora letto o di forma sconosciuta.
export function schermataIncontro(i, adesso = new Date(), nome = null) {
  if (!i || typeof i !== "object" || !STATI.includes(i.stato)) return null;
  const azioni = Array.isArray(i.azioni) ? i.azioni.filter((a) => AZIONI.includes(a)) : [];
  if (i.esito === "avvenuto") {
    const parola = typeof i.segnale === "string" && i.segnale.trim() ? i.segnale.trim() : null;
    // Passo 3f: «valuta» (dal server, passo 3e) apre le 4 domande della valutazione (moduli/valutazione.js).
    return { tipo: "avvenuto", azioni: azioni.filter((a) => a === "valuta"), testo: TESTI_INCONTRO.creditiLiberi,
      segnale: parola ? TESTI_INCONTRO.segnale.replace("<parola>", parola) : null };
  }
  if (i.stato === "concluso" || i.esito) {
    const testo = i.esito === "scaduto" ? TESTI_INCONTRO.scaduto : i.esito === "annullato" ? TESTI_INCONTRO.annullato : TESTI_INCONTRO.chiuso;
    return { tipo: "concluso", testo, azioni: [] };
  }
  if (i.stato === "confermato") {
    const q = quando(i);
    return { tipo: "confermato", azioni, testo: TESTI_INCONTRO.caparra, checkin: testoCheckin(i, adesso, nome), ritardo: testoRitardo(i, nome),
      titolo: q ? TESTI_INCONTRO.confermato.replace("<giorno>", q.giorno).replace("<ora>", q.ora).replace("<luogo>", dove(i)) : TESTI_INCONTRO.titolo };
  }
  if (i.stato === "proposto" && i.proposta_mia === true) return { tipo: "attesa", proposta: proposta(i), testo: TESTI_INCONTRO.aspetta,
    azioni: azioni.filter((a) => a === "annulla_incontro") };
  if (i.stato === "proposto") {
    const scade = valida(i.proposta_scade);
    const rimaste = Number.isInteger(i.controproposte_rimaste) ? i.controproposte_rimaste : 0;
    return { tipo: "ricevuta", proposta: proposta(i), azioni,
      scade: scade && scade > adesso ? TESTI_INCONTRO.scadeProposta.replace("<quando>", `${GIORNO.format(scade)} alle ${ORARIO.format(scade)}`) : null,
      controproposte: azioni.includes("altra_data") ? TESTI_INCONTRO.controproposte.replace("<n>", rimaste === 1 ? "1 volta" : `${rimaste} volte`) : null };
  }
  const s = valida(i.scadenza);
  return { tipo: "da_fissare", azioni, disdetta: testoDisdetta(i, nome),
    titolo: s ? TESTI_INCONTRO.viIncontrate.replace("<data>", GIORNO.format(s)) : TESTI_INCONTRO.titolo };
}

const ERRORI = Object.freeze({
  rete: "Sei senza connessione. Riprova tra poco.",
  accesso: "Accedi di nuovo per continuare.",
  troppe: "Troppi tentativi. Aspetta un minuto.",
  non_trovato: TESTI_INCONTRO.nonDisponibile,
  incontro_chiuso: TESTI_INCONTRO.nonDisponibile,
  incontro_scaduto: TESTI_INCONTRO.nonDisponibile,
  orario_non_valido: TESTI_INCONTRO.orarioNonVa,
  prima_di_domani: TESTI_INCONTRO.orarioNonVa,
  fuori_orario: TESTI_INCONTRO.orarioNonVa,
  non_sul_passo: TESTI_INCONTRO.orarioNonVa,
  dopo_la_scadenza: TESTI_INCONTRO.orarioNonVa,
  luogo_non_valido: TESTI_INCONTRO.luogoNonVa,
  attendi_risposta: TESTI_INCONTRO.aspettaRisposta,
  controproposte_finite: TESTI_INCONTRO.controproposteFinite,
  gia_confermato: TESTI_INCONTRO.giaConfermato,
  nessuna_proposta: TESTI_INCONTRO.propostaScaduta,
  proposta_scaduta: TESTI_INCONTRO.propostaScaduta,
  orario_passato: TESTI_INCONTRO.orarioPassato,
  troppo_presto: TESTI_INCONTRO.troppoPresto,
  troppo_tardi: TESTI_INCONTRO.troppoTardi,
  gia_fatto: TESTI_INCONTRO.giaFatto,
  non_confermato: TESTI_INCONTRO.nonConfermato,
  // Stesso codice, parole diverse secondo l'azione («<azione>:<motivo>»).
  "disdici:troppo_tardi": TESTI_INCONTRO.orarioPassatoDisdici,
  ritardo_gia_usato: TESTI_INCONTRO.ritardoGiaUsato,
  ritardo_non_valido: TESTI_INCONTRO.ritardoNonValido,
});
export function testoErroreIncontro(motivo) {
  const m = String(motivo ?? "");
  if (Object.hasOwn(ERRORI, m)) return ERRORI[m];
  const dopo = m.includes(":") ? m.slice(m.indexOf(":") + 1) : null;
  return dopo !== null && Object.hasOwn(ERRORI, dopo) ? ERRORI[dopo] : "Non è andata. Riprova tra poco.";
}

// Il controllo della schermata: un incontro alla volta, una richiesta alla volta.
export function creaIncontro({ token, fetch: f = globalThis.fetch, attesa = ATTESA_MS, aggiorna = () => {}, adesso = () => new Date() }) {
  let porta = null;
  let incontro = null;
  let carica = false;
  let inCorso = false;
  let errore = null;
  let aperta = false; // modulo della proposta
  let conferma = null; // «annulla», «disdici», «annulla_incontro» o «ritardo» in attesa di conferma
  let nome = null; // nome dell'altra persona, solo per i testi (mai mandato al server)
  let bozza = { orario: "", luogo: "", locale: "" };
  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare la schermata */ } };

  async function chiedi(corpo = null) {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return { ok: false, motivo: "accesso" };
    const ferma = new AbortController();
    const timer = setTimeout(() => ferma.abort(), attesa);
    try {
      let r;
      try {
        const headers = { authorization: `Bearer ${t}` };
        if (corpo) headers["content-type"] = "application/json";
        r = await f(corpo ? PERCORSO : `${PERCORSO}?porta=${porta}`, { method: corpo ? "POST" : "GET", signal: ferma.signal, headers,
          body: corpo ? JSON.stringify(corpo) : undefined });
      } catch {
        return { ok: false, motivo: "rete" };
      }
      if (r.status === 401) return { ok: false, motivo: "accesso" };
      if (r.status === 429) return { ok: false, motivo: "troppe" };
      if (r.status === 404) return { ok: false, motivo: "non_trovato" };
      let dati;
      try { dati = await r.json(); } catch { return { ok: false, motivo: "riprova" }; }
      if (!dati || typeof dati !== "object") return { ok: false, motivo: "riprova" };
      if (dati.ok !== true) return { ok: false, motivo: String(dati.motivo || "riprova") };
      return { ok: true, dati };
    } finally {
      clearTimeout(timer);
    }
  }

  async function leggi() {
    const id = porta;
    carica = true;
    errore = null;
    avvisa();
    const r = await chiedi();
    if (porta !== id) return;
    carica = false;
    if (r.ok && r.dati.incontro && STATI.includes(r.dati.incontro.stato)) incontro = r.dati.incontro;
    else {
      errore = testoErroreIncontro(r.ok ? "riprova" : r.motivo);
      if (!r.ok && r.motivo === "non_trovato") incontro = null;
    }
    avvisa();
  }

  async function invia(corpo) {
    if (inCorso || !porta) return false;
    inCorso = true;
    errore = null;
    avvisa();
    const id = porta;
    const r = await chiedi({ ...corpo, porta: id });
    inCorso = false;
    if (porta !== id) return false;
    if (r.ok) {
      aperta = false;
      conferma = null;
      bozza = { orario: "", luogo: "", locale: "" };
      await leggi();
      return true;
    }
    // Lo stato può essere cambiato (proposta scaduta, controproposte finite, incontro chiuso): si rilegge.
    if (!["rete", "accesso", "troppe", "riprova"].includes(r.motivo)) await leggi();
    errore = testoErroreIncontro(`${corpo.azione}:${r.motivo}`);
    avvisa();
    return false;
  }

  // Azioni con la domanda di conferma: al primo tocco si chiede, al secondo si manda.
  async function confermaPoi(azione, corpo) {
    const s = schermataIncontro(incontro, adesso(), nome);
    if (!s || !s.azioni.includes(azione)) return false;
    if (conferma !== azione) {
      conferma = azione;
      aperta = false;
      avvisa();
      return false;
    }
    return invia(corpo);
  }

  return {
    async apri(id, { nome: n = null } = {}) {
      porta = UUID.test(String(id || "")) ? String(id) : null;
      nome = typeof n === "string" && n.trim() ? n.trim().slice(0, 60) : null;
      incontro = null;
      aperta = false;
      conferma = null;
      inCorso = false;
      bozza = { orario: "", luogo: "", locale: "" };
      if (!porta) {
        errore = TESTI_INCONTRO.nonDisponibile;
        avvisa();
        return;
      }
      await leggi();
    },
    chiudi() {
      porta = null;
      incontro = null;
      nome = null;
      errore = null;
      aperta = false;
      conferma = null;
      carica = false;
      avvisa();
    },
    riprova: () => (porta ? leggi() : undefined),
    // «Proponi quando e dove» e «Propongo un'altra data» aprono lo stesso modulo.
    apriProposta() {
      const s = schermataIncontro(incontro, adesso());
      if (!s || !(s.azioni.includes("proponi") || s.azioni.includes("altra_data"))) return;
      aperta = true;
      conferma = null;
      errore = null;
      // D143 B: con dei locali si parte dal primo; senza, dal luogo scritto.
      if (!bozza.locale || !localiIncontro(incontro).some((l) => l.id === bozza.locale)) {
        const primo = localiIncontro(incontro)[0];
        bozza = { ...bozza, locale: primo ? primo.id : "" };
      }
      avvisa();
    },
    lasciaProposta() {
      aperta = false;
      errore = null;
      avvisa();
    },
    // Il luogo si scrive senza ridisegnare (il campo non perde il cursore); il cambio di giorno ridisegna le ore.
    imposta(campo, valore, ridisegna = false) {
      if (campo !== "orario" && campo !== "luogo" && campo !== "locale") return;
      bozza = { ...bozza, [campo]: String(valore ?? "") };
      if (ridisegna) avvisa();
    },
    async proponi({ orario, luogo, locale = "" } = bozza) {
      if (!aperta) return false;
      if (typeof locale === "string" && locale !== "") {
        if (!localiIncontro(incontro).some((l) => l.id === locale)) {
          errore = TESTI_INCONTRO.luogoNonVa;
          avvisa();
          return false;
        }
        if (!valida(orario)) {
          errore = TESTI_INCONTRO.orarioNonVa;
          avvisa();
          return false;
        }
        return invia({ azione: "proponi", orario: new Date(orario).toISOString(), locale });
      }
      const testo = typeof luogo === "string" ? luogo.trim() : "";
      if (!testo || testo.length > LUOGO_MASSIMO) {
        errore = TESTI_INCONTRO.luogoNonVa;
        avvisa();
        return false;
      }
      if (!valida(orario)) {
        errore = TESTI_INCONTRO.orarioNonVa;
        avvisa();
        return false;
      }
      return invia({ azione: "proponi", orario: new Date(orario).toISOString(), luogo: testo });
    },
    // «Accetto» subito; «Annulla l'incontro» al secondo tocco, dopo la domanda di conferma.
    async rispondi(scelta) {
      const s = schermataIncontro(incontro, adesso());
      if (!RISPOSTE.includes(scelta) || !s || !s.azioni.includes(scelta)) return false;
      if (scelta === "annulla" && conferma !== "annulla") {
        conferma = "annulla";
        aperta = false;
        avvisa();
        return false;
      }
      return invia({ azione: "rispondi", risposta: scelta });
    },
    // «Sono qui»: solo se il server ha messo «sono_qui» tra le azioni (dentro la finestra e non ancora fatto).
    async checkin() {
      const s = schermataIncontro(incontro, adesso());
      if (!s || !s.azioni.includes("sono_qui")) return false;
      return invia({ azione: "checkin" });
    },
    // «Disdici» (incontro confermato) e «Annulla l'incontro» (da fissare o con la mia proposta): spec v1.1.
    disdici: () => confermaPoi("disdici", { azione: "disdici" }),
    annullaIncontro: () => confermaPoi("annulla_incontro", { azione: "annulla" }),
    // «Arrivo in ritardo»: il primo tocco apre la scelta (+15 o +30), la scelta manda i minuti. Solo con l'azione dal server.
    async ritardo(minuti) {
      const s = schermataIncontro(incontro, adesso(), nome);
      if (!s || !s.azioni.includes("ritardo")) return false;
      if (conferma !== "ritardo") {
        if (minuti !== undefined) return false;
        conferma = "ritardo";
        aperta = false;
        avvisa();
        return false;
      }
      if (!RITARDI.includes(minuti)) return false;
      return invia({ azione: "ritardo", minuti });
    },
    nonAnnullare() {
      conferma = null;
      avvisa();
    },
    modello: () => ({ porta, incontro, carica, inCorso, errore, proposta: aperta, conferma, nome, bozza: { ...bozza } }),
    adesso,
  };
}

// La vista (h come in flusso.js). null se la schermata non è aperta.
// opzioni.valuta (passo 3f): chi apre la schermata della valutazione; senza, il pulsante non c'è.
// opzioni.buca (#6 v1.4): il foglio «Ero lì» / «Non riesco» di moduli/contesta_buca.js; senza, non c'è.
// opzioni.cambio (#6 v1, casi limite): il foglio «Cambia luogo» di moduli/cambia_luogo.js; senza, non c'è.
// opzioni.avviso (#6 v1, punto 6): il foglio «Avvisa <nome> che sei qui» di moduli/avvisa_qui.js; senza, non c'è.
// opzioni.calendario (#6 v1, passo 4): riceve il testo del file .ics (moduli/calendario_incontro.js); senza, non c'è.
export function vistaIncontro(h, inc, { valuta = null, buca = null, cambio = null, avviso = null, calendario = null } = {}) {
  const m = inc.modello();
  if (!m.porta && !m.errore) return null;
  const T = TESTI_INCONTRO;
  const s = schermataIncontro(m.incontro, inc.adesso(), m.nome);
  const parti = [];
  if (m.carica && !s) parti.push(h("p", { classe: "nota", role: "status" }, T.attimo));
  if (s && s.titolo) parti.push(h("p", { role: "status" }, s.titolo));
  if (s && s.disdetta) parti.push(h("p", { classe: "nota", role: "status" }, s.disdetta));
  if (s && s.proposta) parti.push(h("p", null, s.tipo === "ricevuta" ? `${T.ricevuta} ${s.proposta}` : s.proposta));
  if (s && s.segnale) parti.push(h("p", { classe: "segnale", role: "status" }, s.segnale));
  if (s && s.testo) parti.push(h("p", { classe: s.tipo === "confermato" ? "nota" : null }, s.testo));
  if (s && s.checkin) parti.push(h("p", { classe: "nota", role: "status" }, s.checkin));
  if (s && s.ritardo) parti.push(h("p", { classe: "nota", role: "status" }, s.ritardo));
  if (s && s.scade) parti.push(h("p", { classe: "nota" }, s.scade));
  if (s && s.controproposte) parti.push(h("p", { classe: "nota" }, s.controproposte));
  const bloccato = m.inCorso || m.carica;
  if (s && !m.proposta && !m.conferma) {
    if (s.azioni.includes("sono_qui")) parti.push(h("button", { classe: "bottone grande", type: "button", disabled: bloccato, onclick: () => inc.checkin() }, T.sonoQui));
    if (s.azioni.includes("proponi")) parti.push(h("button", { classe: "bottone", type: "button", disabled: bloccato, onclick: () => inc.apriProposta() }, T.proponi));
    if (s.azioni.includes("accetto")) parti.push(h("button", { classe: "bottone", type: "button", disabled: bloccato, onclick: () => inc.rispondi("accetto") }, T.accetto));
    if (s.azioni.includes("altra_data")) parti.push(h("button", { classe: "bottone-secondario", type: "button", disabled: bloccato, onclick: () => inc.apriProposta() }, T.altraData));
    if (s.azioni.includes("annulla")) parti.push(h("button", { classe: "bottone-secondario", type: "button", disabled: bloccato, onclick: () => inc.rispondi("annulla") }, T.annulla));
    if (s.azioni.includes("ritardo")) parti.push(h("button", { classe: "bottone-secondario", type: "button", disabled: bloccato, onclick: () => inc.ritardo() }, T.ritardo));
    if (s.azioni.includes("disdici")) parti.push(h("button", { classe: "bottone-secondario", type: "button", disabled: bloccato, onclick: () => inc.disdici() }, T.disdici));
    if (s.azioni.includes("annulla_incontro")) parti.push(h("button", { classe: "bottone-secondario", type: "button", disabled: bloccato, onclick: () => inc.annullaIncontro() }, T.annulla));
    const ics = s.tipo === "confermato" && typeof calendario === "function"
      ? testoIcs({ porta: m.porta, orario: m.incontro.orario, luogo: dove(m.incontro) }, inc.adesso()) : null;
    if (ics) parti.push(h("button", { classe: "bottone-secondario", type: "button", onclick: () => calendario(ics) }, TESTI_CALENDARIO.bottone));
    if (s.azioni.includes("valuta") && typeof valuta === "function") parti.push(h("button", { classe: "bottone", type: "button", disabled: bloccato, onclick: () => valuta() }, TESTI_VALUTAZIONE.apri));
  }
  if (s && (m.conferma === "disdici" || m.conferma === "annulla_incontro")) {
    const disdici = m.conferma === "disdici";
    parti.push(h("p", { id: "incontro-conferma", role: "alert" }, disdici ? testoConfermaDisdici(m.incontro, inc.adesso()) : T.confermaAnnulla),
      h("button", { classe: "bottone", type: "button", disabled: bloccato, "aria-describedby": "incontro-conferma",
        onclick: () => (disdici ? inc.disdici() : inc.annullaIncontro()) }, disdici ? T.siDisdici : T.siAnnulla),
      h("button", { classe: "bottone-secondario", type: "button", disabled: bloccato, onclick: () => inc.nonAnnullare() }, T.no));
  }
  if (s && m.conferma === "ritardo") {
    parti.push(h("div", { role: "group", "aria-labelledby": "incontro-ritardo" },
      h("p", { id: "incontro-ritardo" }, T.domandaRitardo),
      h("button", { classe: "bottone", type: "button", disabled: bloccato, onclick: () => inc.ritardo(15) }, T.ritardo15),
      h("button", { classe: "bottone", type: "button", disabled: bloccato, onclick: () => inc.ritardo(30) }, T.ritardo30),
      h("button", { classe: "bottone-secondario", type: "button", disabled: bloccato, onclick: () => inc.nonAnnullare() }, T.no)));
  }
  if (s && m.conferma === "annulla") {
    parti.push(h("p", { id: "incontro-conferma", role: "alert" }, T.confermaAnnulla),
      h("button", { classe: "bottone", type: "button", disabled: bloccato, "aria-describedby": "incontro-conferma", onclick: () => inc.rispondi("annulla") }, T.siAnnulla),
      h("button", { classe: "bottone-secondario", type: "button", disabled: bloccato, onclick: () => inc.nonAnnullare() }, T.no));
  }
  if (s && m.proposta) parti.push(vistaProposta(h, inc, m, s));
  if (s && buca && !m.proposta && !m.conferma) parti.push(vistaFoglioBuca(h, buca, m.porta, s, m.incontro));
  if (s && cambio && !m.proposta && !m.conferma) parti.push(vistaFoglioCambio(h, cambio, m.porta, m.incontro, m.nome));
  if (s && avviso && !m.proposta && !m.conferma) parti.push(vistaFoglioAvviso(h, avviso, m.porta, m.incontro, m.nome, inc.adesso()));
  if (m.errore) parti.push(h("p", { classe: "errore", role: "alert" }, m.errore));
  return h("section", { classe: "incontro", "aria-labelledby": "incontro-titolo" }, h("h2", { id: "incontro-titolo" }, T.titolo), parti);
}

// Modulo della proposta: un solo menu con gli orari raggruppati per giorno, e il posto scritto.
function vistaProposta(h, inc, m, s) {
  const T = TESTI_INCONTRO;
  const giorni = orariProposta(m.incontro && m.incontro.scadenza, inc.adesso());
  const scelto = m.bozza.orario;
  const giorno = giorni.find((g) => g.orari.some((o) => o.valore === scelto)) || giorni[0] || null;
  if (giorno && !giorno.orari.some((o) => o.valore === scelto)) inc.imposta("orario", giorno.orari[0].valore);
  const attuale = inc.modello().bozza.orario;
  const locali = localiIncontro(m.incontro);
  return h("div", { classe: "proposta-incontro", role: "group", "aria-labelledby": "proposta-titolo" },
    h("h3", { id: "proposta-titolo" }, s.tipo === "ricevuta" ? T.altraData : T.proponi),
    h("div", { classe: "campo" },
      h("label", { for: "incontro-giorno" }, T.giorno),
      h("select", { id: "incontro-giorno", disabled: m.inCorso, onchange: (e) => {
        const g = giorni.find((x) => x.giorno === e.target.value);
        if (g) inc.imposta("orario", g.orari[0].valore, true);
      } }, giorni.map((g) => h("option", { value: g.giorno, selected: g === giorno }, g.giorno)))),
    h("div", { classe: "campo" },
      h("label", { for: "incontro-ora" }, T.ora),
      h("select", { id: "incontro-ora", disabled: m.inCorso, onchange: (e) => inc.imposta("orario", e.target.value) },
        (giorno ? giorno.orari : []).map((o) => h("option", { value: o.valore, selected: o.valore === attuale }, o.testo)))),
    locali.length ? h("div", { classe: "campo" },
      h("label", { for: "incontro-dove" }, T.dove),
      h("select", { id: "incontro-dove", disabled: m.inCorso, "aria-describedby": "incontro-pubblico",
        onchange: (e) => inc.imposta("locale", e.target.value, true) },
        locali.map((l) => h("option", { value: l.id, selected: l.id === m.bozza.locale }, nomeLocale(l))),
        h("option", { value: "", selected: m.bozza.locale === "" }, T.altroLuogo))) : h("p", { classe: "nota" }, T.altroLuogo),
    locali.length && m.bozza.locale !== "" ? null : h("div", { classe: "campo" },
      h("label", { for: "incontro-luogo" }, T.luogo),
      h("input", { id: "incontro-luogo", type: "text", maxlength: LUOGO_MASSIMO, autocomplete: "off", value: m.bozza.luogo,
        "aria-describedby": "incontro-pubblico", disabled: m.inCorso, oninput: (e) => inc.imposta("luogo", e.target.value) })),
    h("p", { id: "incontro-pubblico", classe: "nota", role: "note" }, T.pubblico),
    h("button", { classe: "bottone", type: "button", disabled: m.inCorso || !giorni.length, onclick: () => inc.proponi(inc.modello().bozza) },
      m.inCorso ? T.attimo : T.invia),
    h("button", { classe: "bottone-secondario", type: "button", disabled: m.inCorso, onclick: () => inc.lasciaProposta() }, T.lascia));
}
