// «Stanza viva» e «Fissa una chiamata» nella web app (issue #380, spec v1 del CPO del 23/11, design v4 schermate
// 19-20), passo 5c della linea CTO: regole della pagina e richieste al Worker.
//
// Il telefono non decide niente di definitivo: stati, orari proponibili, messaggio, limiti e fasi li dà e li
// ricontrolla il server (worker/stanza_viva_api.js e worker/appuntamenti_api.js). Qui solo cosa mostrare:
// - CHIAMA o FISSA su ogni riga (spec punto 3), con il motivo del server (mai la pausa: ha lo stesso testo della fascia);
// - giorni e ore della schermata 20 a partire dagli orari che il server accetterebbe;
// - gli avvisi in cima alla stanza (punti 5-6), solo per le due persone dell'appuntamento.
// Testi e numeri sono gli stessi di api/appuntamenti.js (la pagina non può importarlo): lo controlla
// test/appuntamenti_stanza_app.test.mjs. Nessun salvataggio locale; nei messaggi d'errore mai nomi o id.

import { testoPulsante } from "./compagni.js";

const PRESENZA = "/app/api/stanza/presenza";
const APPUNTAMENTI = "/app/api/stanza/appuntamenti";
const FUSO = "Europe/Rome";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const TESTI_FISSA = Object.freeze({
  chiama: "Chiama",
  fissa: "Fissa",
  titolo: (nome) => `Fissa una chiamata con ${nome}`,
  giorno: "Giorno",
  ora: "Ora",
  messaggio: "Messaggio (facoltativo)",
  segnaposto: "Ti va di sentirci stasera?",
  spiega: (nome) => `${nome} riceve la proposta e la conferma, o te ne propone un'altra. Vi avvisiamo 10 minuti prima.`,
  annulla: "Annulla",
  proponi: "Proponi",
  fatto: (nome) => `Proposta mandata a ${nome}.`,
  nessunOrario: "Questa settimana non c'è un orario che vada bene a tutte e due.",
  orari: "Un attimo, cerco gli orari…",
  connessione: "Connessione persa. Riprovo…",
  // Uguali a TESTI_APPUNTAMENTI di api/appuntamenti.js.
  contatti: "Niente numeri, link o social prima della porta.",
  treAperti: "Hai già 3 appuntamenti aperti.",
  massimo: 120,
  segnaleOgni: 30000,
  generico: "Non è andata. Riprova tra poco.",
  rete: "Sei senza connessione. Riprova tra poco.",
  inAttesa: "Proposta in attesa",
  fissata: "Chiamata fissata",
});

// ── Ore di Roma ──
const parti = (d, opzioni) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, ...opzioni })
  .formatToParts(d).map((p) => [p.type, p.value]));
const giornoId = (d) => { const p = parti(d, { year: "numeric", month: "2-digit", day: "2-digit" }); return `${p.year}-${p.month}-${p.day}`; };
const oraTesto = (d) => { const p = parti(d, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); return `${Number(p.hour)}:${p.minute}`; };
const ORA_PIENA = (d) => { const p = parti(d, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); return `${p.hour}:${p.minute}`; };
const settimana = (d) => new Intl.DateTimeFormat("it-IT", { timeZone: FUSO, weekday: "long" }).format(d);
// Il giorno dopo nel calendario di Roma (anche nella notte del cambio d'ora).
const domani = (d) => { const [y, m, g] = giornoId(d).split("-").map(Number); return new Date(Date.UTC(y, m - 1, g + 1)).toISOString().slice(0, 10); };
const valida = (v) => (typeof v === "string" || v instanceof Date) && Number.isFinite(new Date(v).getTime());

function nomeGiorno(d, adesso) {
  const id = giornoId(d);
  if (id === giornoId(adesso)) return "oggi";
  if (id === domani(adesso)) return "domani";
  return settimana(d);
}
const maiuscola = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// «oggi alle 21:00», «domani alle 21:00», «giovedì alle 9:30».
export function quandoTesto(iso, adesso) {
  const d = new Date(iso);
  return `${nomeGiorno(d, adesso)} alle ${oraTesto(d)}`;
}

// Orari del server (ISO) → [{ id, nome: "Oggi" | "Domani" | "Giovedì", ore: [{ iso, testo: "20:00" }] }].
export function giorniEOre(ore, adesso) {
  const giorni = [];
  for (const iso of Array.isArray(ore) ? ore : []) {
    if (typeof iso !== "string" || !valida(iso)) continue;
    const d = new Date(iso);
    const id = giornoId(d);
    let g = giorni.find((x) => x.id === id);
    if (!g) giorni.push(g = { id, nome: maiuscola(nomeGiorno(d, adesso)), ore: [] });
    g.ore.push({ iso, testo: ORA_PIENA(d) });
  }
  return giorni;
}

// Domenica dalle 20:30 «FISSA» sparisce (le chiamate chiudono alle 21).
function vicinoAllaChiusura(adesso) {
  const p = parti(adesso, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return p.weekday === "Sun" && Number(p.hour) * 60 + Number(p.minute) >= 20 * 60 + 30;
}

const OCCUPATO = "È in un'altra chiamata";
const FASCIA = /^Disponibile (da|domani dalle) /;
const APERTO = new Set(["in_attesa", "fissato", "promemoria"]);

// CHIAMA, FISSA o il testo del server su una riga della stanza (spec punto 3 e 7).
// etichetta: testo del pulsante dal server («Chiama» o uno dei testi di TESTI_PULSANTE); stato: dalla presenza;
// appuntamento: { fase } dell'appuntamento con questa persona, se c'è.
// → { tipo: "chiama" | "fissa" | "testo", testo, motivo? }
export function azioneRiga({ etichetta = "", stato = "", adesso, appuntamento = null }) {
  const t = testoPulsante(etichetta);
  const fase = appuntamento && appuntamento.fase;
  if (fase === "chiama") return { tipo: "chiama", testo: TESTI_FISSA.chiama };
  const aperto = APERTO.has(fase);
  const chiusura = vicinoAllaChiusura(adesso);
  if (t === OCCUPATO || FASCIA.test(t)) {
    return aperto || chiusura ? { tipo: "testo", testo: t } : { tipo: "fissa", testo: TESTI_FISSA.fissa, motivo: t };
  }
  if (t) return { tipo: "testo", testo: t };
  if (stato === "online" || chiusura) return { tipo: "chiama", testo: TESTI_FISSA.chiama };
  if (aperto) return { tipo: "testo", testo: fase === "in_attesa" ? TESTI_FISSA.inAttesa : TESTI_FISSA.fissata };
  return { tipo: "fissa", testo: TESTI_FISSA.fissa, motivo: null };
}

// Lo stato scritto sotto il nome (mai solo un colore). «in chiamata con <nome>» solo se chi guarda vede l'altra
// persona; un testo che non ha la forma attesa non si mostra (mai un'ora esatta).
const NON_IN_LINEA = /^non in linea( · da (poco|ieri|\d{1,2} h|\d{1,3} giorni))?$/;
export function rigaStato(s, nomi) {
  if (!s || typeof s !== "object") return "";
  if (s.stato === "online" && s.testo === "online") return "online";
  if (s.stato === "in_chiamata" && s.testo === "in chiamata") {
    return nomi && nomi.has(s.con) ? `in chiamata con ${nomi.get(s.con)}` : "in chiamata";
  }
  if (s.stato === "non_in_linea" && NON_IN_LINEA.test(s.testo || "")) return s.testo;
  return "";
}

// Avvisi in cima alla stanza (spec punti 5-6). nomi: Map id → nome delle persone che chi guarda vede.
// → [{ id, altra, tipo, testo, messaggio, azioni: [{ azione, testo }], urgente }]
export function avvisiAppuntamenti(lista, nomi, adesso) {
  const avvisi = [];
  for (const a of Array.isArray(lista) ? lista : []) {
    if (!a || !UUID.test(a.id || "") || !nomi || !nomi.has(a.altra) || !valida(a.quando)) continue;
    const n = nomi.get(a.altra);
    const quando = quandoTesto(a.quando, adesso);
    const voce = (tipo, testo, azioni = [], extra = {}) => avvisi.push({ id: a.id, altra: a.altra, tipo, testo, messaggio: null, azioni, urgente: false, ...extra });
    const ok = [{ azione: "chiudi", testo: "Ok" }];
    if (a.stato === "proposto" && a.fase === "in_attesa") {
      if (a.propostoDaMe) voce("mandata", `Proposta mandata a ${n} · ${quando}`, [{ azione: "annulla", testo: TESTI_FISSA.annulla }]);
      else {
        voce("ricevuta", `${n} ti propone una chiamata · ${quando}`, [
          { azione: "conferma", testo: "Conferma" },
          ...(a.puoControproporre ? [{ azione: "altro", testo: "Un altro orario" }] : []),
          { azione: "no", testo: "No, grazie" },
        ], { messaggio: typeof a.messaggio === "string" && a.messaggio ? a.messaggio : null });
      }
    } else if (a.stato === "confermato" && (a.fase === "fissato" || a.fase === "promemoria")) {
      const annulla = [{ azione: "annulla", testo: "Annulla l'appuntamento" }];
      if (a.fase === "promemoria") voce("promemoria", `Tra 10 minuti: chiamata con ${n}.`, annulla, { urgente: true });
      else voce("fissato", `◷ Chiamata fissata con ${n} · ${quando}`, annulla);
    } else if (a.stato === "confermato" && a.fase === "chiama") {
      voce("chiama", `◷ Chiamata fissata con ${n} · adesso`, [{ azione: "chiama", testo: TESTI_FISSA.chiama }], { urgente: true });
    } else if (a.fase === "scaduto" && a.propostoDaMe) {
      voce("esito", a.testo || "Nessuna risposta: la proposta è scaduta.", ok);
    } else if (a.stato === "rifiutato" && a.propostoDaMe) {
      voce("esito", `${n} non può a quell'ora.`, ok);
    } else if (a.stato === "annullato") {
      voce("esito", a.annullatoDallAltra ? `${n} ha annullato l'appuntamento.` : (a.testo || "L'appuntamento è annullato."), ok);
    } else if (a.stato === "tre_chiamate") {
      voce("esito", a.testo || "Avete già parlato 3 volte. Ora tocca alle chiavi", ok);
    }
  }
  return avvisi;
}

// ── Richieste al Worker con il token di chi usa l'app ──
const AZIONI = new Set(["conferma", "no", "altro", "annulla"]);
const pulisci = (m) => { const t = typeof m === "string" ? m.replace(/\s+/g, " ").trim() : ""; return t || null; };

export function creaStanzaViva({ token, fetch: f = (...a) => globalThis.fetch(...a) } = {}) {
  async function chiedi(percorso, corpo) {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return { ok: false, motivo: "accesso", testo: TESTI_FISSA.generico };
    let r;
    try {
      r = await f(percorso, {
        method: corpo === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${t}`, ...(corpo === undefined ? {} : { "content-type": "application/json" }) },
        ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      });
    } catch {
      return { ok: false, motivo: "rete", testo: TESTI_FISSA.rete };
    }
    let dati = null;
    try { dati = await r.json(); } catch { /* risposta vuota */ }
    if (!r.ok || !dati || typeof dati !== "object") {
      return { ok: false, motivo: (dati && typeof dati.motivo === "string" && dati.motivo) || "riprova", testo: TESTI_FISSA.generico };
    }
    if (dati.ok !== true) {
      return { ok: false, motivo: typeof dati.motivo === "string" ? dati.motivo : "riprova",
        testo: typeof dati.testo === "string" && dati.testo ? dati.testo : TESTI_FISSA.generico };
    }
    return dati;
  }
  const conElenco = (campo) => (dati) => (dati.ok && !Array.isArray(dati[campo]) ? { ok: false, motivo: "riprova", testo: TESTI_FISSA.generico } : dati);

  return {
    segnale: () => chiedi(PRESENZA, {}),
    stati: () => chiedi(PRESENZA).then(conElenco("persone")),
    appuntamenti: () => chiedi(APPUNTAMENTI).then(conElenco("appuntamenti")),
    ore(con) {
      if (!UUID.test(con || "")) return Promise.resolve({ ok: false, motivo: "richiesta", testo: TESTI_FISSA.generico });
      return chiedi(`${APPUNTAMENTI}?con=${con}`).then(conElenco("ore"));
    },
    proponi({ con, quando, messaggio } = {}) {
      return chiedi(APPUNTAMENTI, { azione: "proponi", con, quando, messaggio: pulisci(messaggio) });
    },
    rispondi(id, azione, { quando, messaggio } = {}) {
      if (!AZIONI.has(azione) || !UUID.test(id || "")) return Promise.resolve({ ok: false, motivo: "richiesta", testo: TESTI_FISSA.generico });
      return chiedi(APPUNTAMENTI, azione === "altro" ? { azione, id, quando, messaggio: pulisci(messaggio) } : { azione, id });
    },
  };
}

// ── Il «battito» (spec punto 1, passo 5d): con l'app aperta e VISIBILE, un segnale ogni 30 secondi e la rilettura di
// stati e appuntamenti. In secondo piano nessuna richiesta; tornando visibile si riparte subito. Mai due giri insieme.
// Rete giù: { persa: true } con gli stati di prima (la vista li mostra grigi). Accesso scaduto o funzione spenta: si
// ferma. Pagina e timer si passano da fuori, così si prova con node --test.
export function creaBattito({ viva, quando, pagina, setTimeout: dopo = globalThis.setTimeout, clearTimeout: annulla = globalThis.clearTimeout }) {
  let attivo = false;
  let inGiro = false;
  let timer = null;
  let giro = 0;
  let ultimo = { persa: false, letto: false, persone: [], appuntamenti: [] };
  const visibile = () => !pagina || pagina.visibilityState === "visible";
  const cancella = () => { if (timer !== null) { annulla(timer); timer = null; } };

  async function battito() {
    if (!attivo || inGiro || !visibile()) return;
    cancella();
    inGiro = true;
    const questo = giro;
    let segnale = null, stati = null, appuntamenti = null;
    try {
      segnale = await viva.segnale();
      if (segnale && segnale.ok) [stati, appuntamenti] = await Promise.all([viva.stati(), viva.appuntamenti()]);
    } catch { segnale = null; }
    inGiro = false;
    if (questo !== giro || !attivo) return;
    if (segnale && (segnale.motivo === "spento" || segnale.motivo === "accesso")) { ferma(); return; }
    const ok = segnale && segnale.ok && stati && stati.ok && appuntamenti && appuntamenti.ok;
    ultimo = ok ? { persa: false, letto: true, persone: stati.persone, appuntamenti: appuntamenti.appuntamenti } : { ...ultimo, persa: true };
    try { quando(ultimo); } catch { /* la vista non deve fermare il battito */ }
    if (!attivo || !visibile()) return;
    cancella();
    timer = dopo(battito, TESTI_FISSA.segnaleOgni);
  }
  const cambio = () => { if (visibile()) battito(); else cancella(); };
  function ferma() {
    attivo = false;
    giro++;
    cancella();
    if (pagina) pagina.removeEventListener("visibilitychange", cambio);
  }
  return {
    avvia() {
      if (attivo) return Promise.resolve();
      attivo = true;
      if (pagina) pagina.addEventListener("visibilitychange", cambio);
      return battito();
    },
    ferma,
    subito: () => battito(),
    attivo: () => attivo,
    ultimo: () => ultimo,
  };
}
