// Schermata della porta nella web app (issue #65, spec v1 del CPO, passi 1-4; D48 A, D12 A, D18 A). Passi 4c, 3b e 5b,
// linea del CTO. Passo 5b: con le due caparre, «Ci sono adesso» e «Scegli un orario» (fino a 3 mezz'ore dentro le 48
// ore; la prima comune la fissa il server). Le fasce dell'altra persona non arrivano mai al telefono. Dopo «Vai allo svelamento»: nome, età, conto alla rovescia delle 48 ore e caparra («Blocca 100 Coin»).
// Le regole (100 Coin, una caparra per persona e porta, mai sotto zero, porte chiuse o scadute) le decide il server
// (/app/api/svelamento, worker/svelamento_api.js): qui si mostrano le sue risposte.
// Il corpo non dice mai chi blocca: lo dice solo il token. Una porta chiusa da un blocco o da una sospensione dà solo
// «Questa porta si è chiusa.», mai il motivo. In beta i Coin sono di prova: «Ricarica» mostra solo il testo della
// beta, nessun pagamento (Stripe in Fase 4). Niente salvataggi locali.
// Il modulo non tocca la pagina: riceve fetch, token e h dall'esterno, così si prova con node --test.
// I testi sono gli stessi di api/svelamento.js (TESTI_SVELAMENTO): il test lo controlla.

import { TESTI_SALA, vistaSala } from "./sala_attesa.js";
import { vistaSchermata } from "./schermata_svelamento.js";
import { vistaCome } from "./svelamento_come.js";

const PERCORSO = "/app/api/svelamento";
const ATTESA_MS = 8000;
const CAPARRA = 10;
const MINUTO = 60 * 1000;
const ORA = 60 * MINUTO;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const TESTI = Object.freeze({
  aperta: "Una porta si è aperta. Hai 48 ore per lo svelamento.",
  blocca: "Blocca 100 crediti",
  spiegazioneCaparra: "I tuoi 100 crediti restano bloccati. Se uno dei due dice no o non risponde, tornano a entrambi. Li perdi solo se dai buca a un appuntamento confermato.",
  aspettaCaparra: "Aspettiamo che anche <nome> blocchi la caparra.",
  ricarica: "Ricarica",
  beta: "In beta i crediti sono di prova",
  portaChiusa: "Questa porta si è chiusa.",
  scaduta: "Il tempo per lo svelamento è finito. I tuoi crediti sono di nuovo disponibili.",
  // Provvisorio, da rivedere con «contenuti»: il passo 3 della spec (video o foto, quando) arriva con il passo 5.
  entrambe: "Avete bloccato entrambi i crediti. Ora scegliete insieme come e quando fare lo svelamento.", // testo di Contenuti, 17/11
  torna: "Torna alla stanza",
  // Passo 3 della spec: «Come vuoi lo svelamento». Si cambia fino all'inizio; la scelta dell'altra persona non si vede.
  sceltaTitolo: "Come vuoi lo svelamento?",
  sceltaVideo: "Videochiamata di 10 secondi",
  sceltaFoto: "Preferisco le foto",
  // Provvisorio, da rivedere con «contenuti».
  giaIniziato: "Lo svelamento è già iniziato: la scelta non si può più cambiare.",
  // Passo 4 della spec: «Quando». I testi dei pulsanti sono quelli del server (TESTI_SVELAMENTO).
  prontoOra: "Ci sono adesso",
  scegliOrario: "Scegli un orario",
  fasciaFissata: "Lo svelamento è fissato",
  nessunaFascia: "Ancora nessun orario in comune.",
  // Provvisori, da rivedere con «contenuti».
  quandoTitolo: "Quando?",
  mioPronto: "<nome> ha ancora <minuti> per entrare.",
  entrambiPronti: "Potete entrare adesso.",
  orariSpiegazione: "Segna fino a 3 mezz'ore. L'app fissa la prima che avete in comune.",
  orario: "Orario",
  nessunOrario: "Nessuno",
  salvaOrari: "Salva gli orari",
  almenoUno: "Scegli almeno un orario.",
  mancaCaparra: "Servono prima le due caparre.",
  fasceNonValide: "Uno degli orari non va più bene. Scegline un altro.",
  // Passo 7d-3b (spec passo 6): dalla sala d'attesa si entra; finché manca l'altra persona si aspetta (max 10 minuti).
  aspetta: "Aspettiamo <nome>…",
  nonArrivato: "<nome> non c'è. Proponi un altro momento.",
  // Provvisorio, da rivedere con «contenuti».
  entra: "Entra",
  // Passo 8b-3a (spec passi 8-9, regola del CPO del 21/11): il sì/no segreto. Conferma e Annulla sono quelli del server.
  si: "Sì",
  no: "No",
  confermaSi: "Rispondi sì? Non potrai cambiarla.",
  confermaNo: "Rispondi no? Non potrai cambiarla.",
  conferma: "Conferma",
  annulla: "Annulla",
  domanda: "Vuoi incontrare <nome>?",
  // Provvisori, da rivedere con «contenuti».
  giaRisposto: "Hai già risposto: la risposta non si può cambiare.",
  titoloSvelamento: "Svelamento",
});
const RISPOSTE = ["si", "no"];
const ESITI = ["doppio_si", "chiusa"];
const MAX_FASCE = 3;
const ENTRA_MS = 3000; // mentre si aspetta l'altra persona si richiede «entra» ogni 3 secondi
const VIDEO_ATTIVO = new Set(["collego", "aspetta", "in_corso", "caduta"]);
const FASCIA_MS = 30 * MINUTO;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const SCELTE = ["video", "foto"];

const nome = (n) => (typeof n === "string" && n.trim() ? n.trim() : "");
const plurale = (n, uno, molti) => `${n} ${n === 1 ? uno : molti}`;

// «Mancano 34 ore e 30 minuti per lo svelamento.» sull'orologio di chi guarda; null a porta scaduta.
export function contoPorta(scadeIl, adesso = new Date()) {
  const manca = new Date(scadeIl).getTime() - adesso.getTime();
  if (!Number.isFinite(manca) || manca <= 0) return null;
  const ore = Math.floor(manca / ORA);
  const minuti = Math.floor((manca % ORA) / MINUTO);
  if (ore > 0) return `${ore === 1 ? "Manca" : "Mancano"} ${plurale(ore, "ora", "ore")} e ${plurale(minuti, "minuto", "minuti")} per lo svelamento.`;
  const m = Math.max(1, minuti);
  return `${m === 1 ? "Manca" : "Mancano"} ${plurale(m, "minuto", "minuti")} per lo svelamento.`;
}

// Passo 8b-3a: «Mancano 33 ore e 0 minuti per rispondere.» (48 ore dalla fine dello svelamento); null a tempo finito.
export function contoRisposta(scadeIl, adesso = new Date()) {
  const conto = contoPorta(scadeIl, adesso);
  return conto ? conto.replace("per lo svelamento.", "per rispondere.") : null;
}

// Le mezz'ore che si possono ancora segnare: iniziano da adesso in poi (allineate a :00 o :30) e finiscono entro la
// scadenza della porta. Stessa regola del server (fasceValide in api/svelamento.js), che resta l'unico a decidere.
export function fascePossibili(scadeIl, adesso = new Date()) {
  const fine = new Date(scadeIl).getTime();
  const ora = adesso.getTime();
  if (!Number.isFinite(fine) || !Number.isFinite(ora)) return [];
  const out = [];
  for (let x = Math.ceil(ora / FASCIA_MS) * FASCIA_MS; x + FASCIA_MS <= fine; x += FASCIA_MS) out.push(new Date(x).toISOString());
  return out;
}

const GIORNO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long" });
const ORARIO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
// «martedì 17 novembre, 21:30» (ora italiana); "" se l'orario non è leggibile.
export function etichettaFascia(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${GIORNO.format(d)}, ${ORARIO.format(d)}`;
}

// Passo 4 della spec («Quando»): solo con la caparra di tutti e due.
function quandoPorta(p, n, adesso) {
  if (p.mia_caparra !== true || p.sua_caparra !== true) return null;
  const mie = Array.isArray(p.mie_fasce) ? p.mie_fasce.filter((x) => typeof x === "string" && ISO.test(x)).slice(0, MAX_FASCE) : [];
  const fissata = typeof p.fascia_fissata === "string" && etichettaFascia(p.fascia_fissata)
    ? `${TESTI.fasciaFissata}: ${etichettaFascia(p.fascia_fissata)}` : null;
  const restaMs = p.mio_pronto === true ? new Date(p.pronto_scade_il).getTime() - adesso.getTime() : NaN;
  const mioVivo = Number.isFinite(restaMs) && restaMs > 0;
  const suo = p.suo_pronto === true;
  const minuti = mioVivo ? Math.ceil(restaMs / MINUTO) : 0;
  return {
    titolo: TESTI.quandoTitolo, ora: TESTI.prontoOra, orario: TESTI.scegliOrario,
    entrambi: mioVivo && suo ? TESTI.entrambiPronti : null,
    mioPronto: mioVivo && !suo ? TESTI.mioPronto.replace("<nome>", n).replace("<minuti>", plurale(minuti, "minuto", "minuti")) : null,
    pronta: suo && !mioVivo && typeof p.pronta === "string" && p.pronta ? p.pronta : null,
    fissata,
    nessuna: mie.length && !fissata ? TESTI.nessunaFascia : null,
    mie,
    opzioni: fascePossibili(p.scade_il, adesso).map((valore) => ({ valore, testo: etichettaFascia(valore) })),
  };
}

const chiDi = (p) => { const n = nome(p.nome) || "questa persona"; return Number.isInteger(p.eta) ? `${n}, ${p.eta}` : n; };

// Cosa mostra la schermata di una porta (spec, passi 1-4). null = stato non ancora letto.
export function schermataPorta(stato, idPorta, adesso = new Date()) {
  if (!stato || !Array.isArray(stato.porte)) return null;
  const valido = UUID.test(String(idPorta || ""));
  const trova = (l) => (valido && Array.isArray(l) ? l.find((x) => x && x.porta === idPorta) : null) || null;
  // Passo 8b-3a: l'esito (uguale per entrambi, testo del server) vince; poi la porta svelata in attesa del sì/no.
  const e = trova(stato.esiti);
  if (e) {
    if (!ESITI.includes(e.esito) || typeof e.testo !== "string" || !e.testo) return { tipo: "chiusa", testo: TESTI.portaChiusa };
    return { tipo: "esito", porta: e.porta, esito: e.esito, testo: e.testo, chi: chiDi(e) };
  }
  const sv = trova(stato.svelate);
  if (sv) {
    const hoRisposto = sv.ho_risposto === true;
    return {
      tipo: "risposta", porta: sv.porta, chi: chiDi(sv),
      domanda: typeof sv.domanda === "string" && sv.domanda ? sv.domanda : TESTI.domanda.replace("<nome>", nome(sv.nome) || "questa persona"),
      conto: hoRisposto ? null : contoRisposta(sv.risposta_scade_il, adesso),
      hoRisposto,
      // Solo il testo del server: mai cosa si è risposto, mai se l'altra persona ha risposto.
      inAttesa: hoRisposto && typeof sv.in_attesa === "string" && sv.in_attesa ? sv.in_attesa : null,
    };
  }
  const p = trova(stato.porte);
  if (!p) return { tipo: "chiusa", testo: TESTI.portaChiusa };
  const conto = contoPorta(p.scade_il, adesso);
  if (!conto) return { tipo: "scaduta", testo: TESTI.scaduta };
  const n = nome(p.nome) || "questa persona";
  const saldo = Number.isFinite(stato.saldo) ? Math.max(0, stato.saldo) : 0;
  let caparra;
  if (p.mia_caparra === true && p.sua_caparra === true) caparra = { tipo: "entrambe", testo: TESTI.entrambe };
  else if (p.mia_caparra === true) {
    caparra = { tipo: "aspetta", testo: typeof p.aspetta === "string" && p.aspetta ? p.aspetta : TESTI.aspettaCaparra.replace("<nome>", n) };
  } else if (saldo >= CAPARRA) caparra = { tipo: "blocca", bottone: TESTI.blocca, spiegazione: TESTI.spiegazioneCaparra };
  else {
    const mancano = CAPARRA - saldo;
    caparra = { tipo: "ricarica", testo: mancano === 1 ? "Ti manca 1 credito" : `Ti mancano ${mancano} crediti`,
      bottone: TESTI.ricarica, beta: TESTI.beta, spiegazione: TESTI.spiegazioneCaparra };
  }
  // Passo 3: dopo la propria caparra. «video» è la predefinita; un valore non previsto vale come «video».
  const scelta = p.mia_caparra === true ? {
    attuale: SCELTE.includes(p.mia_scelta) ? p.mia_scelta : "video",
    opzioni: [{ valore: "video", testo: TESTI.sceltaVideo }, { valore: "foto", testo: TESTI.sceltaFoto }],
  } : null;
  return {
    tipo: "porta", porta: p.porta, titolo: TESTI.aperta,
    chi: Number.isInteger(p.eta) ? `${n}, ${p.eta}` : n,
    conto, saldo: `I tuoi crediti: ${saldo}`, caparra, scelta, quando: quandoPorta(p, n, adesso),
    // Passo 6b: «momento» e «tipo» solo come li dà il server (passo 6a); un tipo sconosciuto non accende la fotocamera.
    momento: p.momento === true,
    tipoSvelamento: p.momento === true && SCELTE.includes(p.tipo) ? p.tipo : null,
  };
}

const ERRORI = Object.freeze({
  rete: "Sei senza connessione. Riprova tra poco.",
  accesso: "Accedi di nuovo per continuare.",
  troppe: "Troppi tentativi. Aspetta un minuto.",
  non_trovata: TESTI.portaChiusa,
  gia_iniziato: TESTI.giaIniziato,
  manca_caparra: TESTI.mancaCaparra,
  fasce_non_valide: TESTI.fasceNonValide,
  gia_risposto: TESTI.giaRisposto,
});
export const testoErroreSvelamento = (motivo) => (Object.hasOwn(ERRORI, motivo) ? ERRORI[motivo] : "Non è andata. Riprova tra poco.");
const errore = (motivo) => ({ ok: false, motivo, testo: testoErroreSvelamento(motivo) });

export function creaSvelamento({ token, fetch: f = globalThis.fetch, attesa = ATTESA_MS }) {
  async function chiedi(corpo = null) {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return errore("accesso");
    const ferma = new AbortController();
    const timer = setTimeout(() => ferma.abort(), attesa);
    try {
      let r;
      try {
        const headers = { authorization: `Bearer ${t}` };
        if (corpo) headers["content-type"] = "application/json";
        r = await f(PERCORSO, { method: corpo ? "POST" : "GET", signal: ferma.signal, headers, body: corpo ? JSON.stringify(corpo) : undefined });
      } catch {
        return errore("rete");
      }
      if (r.status === 401) return errore("accesso");
      if (r.status === 429) return errore("troppe");
      if (r.status === 404) return errore("non_trovata");
      let dati;
      try { dati = await r.json(); } catch { return errore("riprova"); }
      if (!dati || typeof dati !== "object" || (r.status !== 200 && dati.ok !== false)) return errore("riprova");
      if (dati.ok === false) {
        // Il testo per l'utente lo manda il server per i rifiuti delle regole (crediti, scaduta, chiusa).
        if (dati.motivo === "gia_iniziato") return errore("gia_iniziato");
        return typeof dati.testo === "string" && dati.testo ? { ok: false, motivo: String(dati.motivo || ""), testo: dati.testo }
          : errore(String(dati.motivo || "riprova"));
      }
      return { ok: true, dati };
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async leggi() {
      const r = await chiedi();
      if (!r.ok) return r;
      const { ok, ...stato } = r.dati;
      return { ok: true, stato };
    },
    async blocca(porta) {
      if (!UUID.test(String(porta || ""))) return errore("non_trovata");
      const r = await chiedi({ azione: "caparra", porta });
      return r.ok ? { ok: true, esito: r.dati.esito, stato: r.dati.stato ?? null } : r;
    },
    // Passo 3b: la propria scelta, mai quella dell'altra persona (chi sceglie lo dice solo il token).
    async scegli(porta, scelta) {
      if (!UUID.test(String(porta || "")) || !SCELTE.includes(scelta)) return errore("riprova");
      const r = await chiedi({ azione: "scelta", porta, scelta });
      return r.ok ? { ok: true, esito: r.dati.esito, stato: r.dati.stato ?? null } : r;
    },
    // Passo 5b: «Ci sono adesso» (vale 5 minuti, lo decide il server).
    async pronto(porta) {
      if (!UUID.test(String(porta || ""))) return errore("non_trovata");
      const r = await chiedi({ azione: "pronto", porta });
      return r.ok ? { ok: true, esito: r.dati.esito, stato: r.dati.stato ?? null } : r;
    },
    // Passo 5b: da 1 a 3 inizi di mezz'ora; futuri e dentro le 48 ore lo controlla il server.
    async fasce(porta, fasce) {
      if (!UUID.test(String(porta || "")) || !Array.isArray(fasce) || fasce.length < 1 || fasce.length > MAX_FASCE
        || !fasce.every((x) => typeof x === "string" && ISO.test(x))) return errore("riprova");
      const r = await chiedi({ azione: "fasce", porta, fasce });
      return r.ok ? { ok: true, esito: r.dati.esito, stato: r.dati.stato ?? null } : r;
    },
    // Passo 7d-1: ingresso dalla sala d'attesa e richieste video (worker/svelamento_api.js, passi 6c e 7c).
    // Chi entra lo dice solo il token; al telefono non arriva mai un id di sessione.
    async entra(porta) {
      if (!UUID.test(String(porta || ""))) return errore("non_trovata");
      const r = await chiedi({ azione: "entra", porta });
      if (!r.ok) return r;
      return SCELTE.includes(r.dati.tipo) ? { ok: true, esito: r.dati.esito, tipo: r.dati.tipo } : { ok: true, esito: r.dati.esito };
    },
    async pubblica(porta, offerta) {
      if (!UUID.test(String(porta || "")) || !offerta || offerta.type !== "offer") return errore("riprova");
      const r = await chiedi({ azione: "pubblica", porta, offerta });
      return r.ok ? { ok: true, descrizione: r.dati.descrizione, vista: r.dati.vista ?? null } : r;
    },
    async ricevi(porta) {
      if (!UUID.test(String(porta || ""))) return errore("non_trovata");
      const r = await chiedi({ azione: "ricevi", porta });
      return r.ok ? { ok: true, descrizione: r.dati.descrizione, vista: r.dati.vista ?? null } : r;
    },
    async conferma(porta, risposta) {
      if (!UUID.test(String(porta || "")) || !risposta || risposta.type !== "answer") return errore("riprova");
      const r = await chiedi({ azione: "conferma", porta, risposta });
      return r.ok ? { ok: true, vista: r.dati.vista ?? null } : r;
    },
    // Passo 7d-3b: «Chiudi e segnala» durante il video (passo 7d-3a lato server: porta chiusa, blocco, caparre a entrambi).
    async chiudiESegnala(porta) {
      if (!UUID.test(String(porta || ""))) return errore("non_trovata");
      const r = await chiedi({ azione: "chiudi_e_segnala", porta });
      return r.ok ? { ok: true, esito: r.dati.esito } : r;
    },
    // Passo 8b-3a: il sì/no segreto (passo 8b-2a lato server). Chi risponde lo dice solo il token.
    async rispondi(porta, risposta) {
      if (!UUID.test(String(porta || "")) || !RISPOSTE.includes(risposta)) return errore("riprova");
      const r = await chiedi({ azione: "rispondi", porta, risposta });
      return r.ok ? { ok: true, esito: r.dati.esito, testo: r.dati.testo ?? null, stato: r.dati.stato ?? null } : r;
    },
    // Passo 8b-3b: la connessione è caduta prima dei 10 secondi; il server ferma il timer e aspetta «Riprova».
    async cadutaVideo(porta) {
      if (!UUID.test(String(porta || ""))) return errore("non_trovata");
      const r = await chiedi({ azione: "caduta", porta });
      return r.ok ? { ok: true, vista: r.dati.vista ?? null } : r;
    },
    async vistaVideo(porta) {
      if (!UUID.test(String(porta || ""))) return errore("non_trovata");
      const r = await chiedi({ azione: "vista", porta });
      return r.ok ? { ok: true, vista: r.dati.vista ?? null } : r;
    },
  };
}

// Passo 7d-3b-2: i dati per il modulo della segnalazione (#7, flusso.js) dopo «Chiudi e segnala» dal video.
export function segnalaDaPorta(sg) {
  if (!sg || sg.origine !== "chiudi_e_segnala" || !UUID.test(String(sg.contro || ""))) return null;
  return { segnala: { contro: sg.contro, origine: "chiudi_e_segnala", chiamataIl: null }, nome: nome(sg.nome), schermo: { titolo: "Segnala" } };
}

// Il controllo della schermata: una porta aperta alla volta, una richiesta alla volta.
// sala(passaAlleFoto, aggiorna) crea la sala d'attesa (sala_attesa.js, passo 6b); senza, la sala non compare.
// video(porta, { nome, quandoFinito, quandoSegnala, quandoEsci }) crea la schermata del video (schermata_svelamento.js,
// passo 7d-3b) solo quando il server dice «iniziato» con «video»; senza, «Entra» non compare.
// ogni/ferma: il giro che richiede «entra» mentre si aspetta l'altra persona (una richiesta alla volta).
export function creaPortaSvelamento({ svelamento, aggiorna = () => {}, adesso = () => new Date(), sala: creaSala = null,
  video: creaVideo = null, ogni = (fn, ms) => setInterval(fn, ms), ferma: fermaGiro = (id) => clearInterval(id), entraOgni = ENTRA_MS }) {
  let porta = null;
  let stato = null;
  let carica = false;
  let inCorso = false;
  let errore = null;
  let ricarica = false;
  let orari = false;
  let bozza = ["", "", ""];
  let ingresso = null; // null | "entro" | "attesa": «Entra» chiesto al server, in attesa dell'altra persona
  let giro = null;
  let inVoloEntra = false;
  let schermata = null; // la schermata del video, solo dopo «iniziato» + «video»
  let segnala = null;   // dopo «Chiudi e segnala»: { contro, origine, nome } per il modulo della #7
  let conferma = null;  // passo 8b-3a: "si" | "no" in attesa di «Conferma» (solo in memoria)
  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare la schermata */ } };
  // «Passa alle foto» dalla sala: la propria scelta diventa «foto» (vale per entrambi, lo decide il server).
  async function passaAlleFoto() {
    const id = porta;
    if (!id) return { ok: false };
    const r = await svelamento.scegli(id, "foto").catch(() => ({ ok: false, motivo: "rete" }));
    if (porta !== id) return { ok: false };
    if (r && r.ok) {
      if (r.stato) stato = r.stato;
      else await leggi();
      return { ok: true };
    }
    return { ok: false, testo: (r && r.testo) || testoErroreSvelamento(r && r.motivo) };
  }
  const sala = typeof creaSala === "function" ? creaSala(passaAlleFoto, avvisa) : null;
  // Dopo ogni lettura la sala segue il server: «foto» spegne la fotocamera, fuori dal momento la sala si chiude.
  const seguiSala = () => {
    if (!sala || sala.modello().stato === "chiusa") return;
    const s = schermataPorta(stato, porta, adesso());
    sala.aggiornaTipo(s && s.tipo === "porta" && s.momento ? s.tipoSvelamento : null);
  };

  const datiPorta = () => (stato && Array.isArray(stato.porte) ? stato.porte.find((x) => x && x.porta === porta) : null) || null;
  const nomeAltra = () => nome(datiPorta()?.nome) || "l'altra persona";

  function fermaIngresso() {
    if (giro !== null) { try { fermaGiro(giro); } catch { /* già fermo */ } }
    giro = null;
    ingresso = null;
    inVoloEntra = false;
  }
  function chiudiVideo() {
    if (schermata) { try { schermata.chiudi(); } catch { /* già chiusa */ } }
    schermata = null;
  }

  // Passo 7d-3b: «Chiudi e segnala» dal video. La schermata ha già spento tutto; qui si chiede al server di chiudere la
  // porta (blocco e caparre a entrambi) e si prepara il modulo della #7 contro l'altra persona.
  function quandoSegnala(id, p) {
    segnala = p && UUID.test(String(p.con || "")) ? { contro: p.con, origine: "chiudi_e_segnala", nome: nome(p.nome) } : null;
    avvisa();
    Promise.resolve().then(() => svelamento.chiudiESegnala(id)).catch(() => null)
      .then(() => { if (porta === id) return leggi(); }).catch(() => {});
  }

  function apriVideo(id) {
    if (sala) sala.chiudi(); // l'anteprima si spegne: la fotocamera la riaccende il video
    const p = datiPorta();
    schermata = creaVideo(id, {
      nome: nome(p && p.nome),
      quandoFinito: () => { if (porta === id) { avvisa(); leggi(); } },
      quandoEsci: () => { if (porta === id) leggi(); },
      quandoSegnala: () => { if (porta === id) quandoSegnala(id, p); },
    });
    avvisa();
    schermata.apri();
  }

  // Una richiesta «entra»; il giro la ripete mentre l'altra persona non c'è.
  async function chiediEntra() {
    const id = porta;
    if (!id || inVoloEntra || !ingresso) return;
    inVoloEntra = true;
    const r = await Promise.resolve().then(() => svelamento.entra(id)).catch(() => ({ ok: false, motivo: "rete" }));
    inVoloEntra = false;
    if (porta !== id || !ingresso) return;
    if (r && r.ok && r.esito === "in_attesa") {
      ingresso = "attesa";
      if (giro === null) giro = ogni(() => chiediEntra(), entraOgni);
      avvisa();
      return;
    }
    if (r && r.ok && r.esito === "iniziato") {
      fermaIngresso();
      if (r.tipo === "video" && typeof creaVideo === "function") { apriVideo(id); return; }
      await leggi(); // «foto»: la sala lo segue e spegne la fotocamera
      return;
    }
    const motivo = r && r.motivo;
    // Senza rete o con troppe richieste, mentre si aspetta, si riprova al giro dopo.
    if (ingresso === "attesa" && ["rete", "troppe", "riprova"].includes(motivo)) return;
    fermaIngresso();
    if (sala) sala.chiudi();
    await leggi();
    if (motivo === "non_arrivato") errore = TESTI.nonArrivato.replace("<nome>", nomeAltra());
    else if (!["porta_chiusa", "porta_scaduta", "non_trovata"].includes(motivo)) errore = (r && r.testo) || testoErroreSvelamento(motivo);
    avvisa();
  }

  async function leggi() {
    const id = porta;
    carica = true;
    errore = null;
    avvisa();
    const r = await svelamento.leggi().catch(() => ({ ok: false, motivo: "rete" }));
    if (porta !== id) return;
    carica = false;
    if (r && r.ok) stato = r.stato;
    else errore = (r && r.testo) || testoErroreSvelamento(r && r.motivo);
    if (r && r.ok) seguiSala();
    avvisa();
  }

  // Invia una richiesta del passo 5b; true se il server l'ha accettata.
  async function invia(richiesta) {
    if (inCorso || !porta) return false;
    const attuale = schermataPorta(stato, porta, adesso());
    if (!attuale || attuale.tipo !== "porta" || !attuale.quando) return false;
    inCorso = true;
    errore = null;
    avvisa();
    const id = porta;
    const r = await Promise.resolve().then(() => richiesta(id)).catch(() => ({ ok: false, motivo: "rete" }));
    inCorso = false;
    if (porta !== id) return false;
    if (r && r.ok) {
      if (r.stato) stato = r.stato;
      else await leggi();
      avvisa();
      return true;
    }
    const motivo = r && r.motivo;
    if (["porta_chiusa", "porta_scaduta", "non_trovata"].includes(motivo)) {
      await leggi();
      return false;
    }
    if (["gia_iniziato", "fasce_non_valide", "manca_caparra"].includes(motivo)) await leggi();
    errore = (r && r.testo) || testoErroreSvelamento(motivo);
    avvisa();
    return false;
  }

  return {
    async apri(id) {
      fermaIngresso();
      chiudiVideo();
      segnala = null;
      conferma = null;
      if (sala) sala.chiudi();
      porta = String(id || "");
      stato = null;
      ricarica = false;
      inCorso = false;
      orari = false;
      bozza = ["", "", ""];
      await leggi();
    },
    chiudi() {
      fermaIngresso();
      chiudiVideo();
      if (sala) sala.chiudi();
      porta = null;
      stato = null;
      errore = null;
      conferma = null;
      ricarica = false;
      orari = false;
      carica = false;
      avvisa();
    },
    riprova: () => leggi(),
    // Passo 6b: si rilegge lo stato (il tipo può essere cambiato) e si apre la sala solo nel momento.
    async entraSala() {
      if (!sala || !porta) return;
      await leggi();
      const s = schermataPorta(stato, porta, adesso());
      if (s && s.tipo === "porta" && s.momento) sala.apri({ tipo: s.tipoSvelamento });
      avvisa();
    },
    sala: () => sala,
    // Passo 7d-3b: «Entra» dalla sala d'attesa, solo con l'anteprima accesa e la schermata del video disponibile.
    async entra() {
      if (!porta || ingresso || schermata || typeof creaVideo !== "function" || !sala || sala.modello().stato !== "anteprima") return;
      ingresso = "entro";
      errore = null;
      avvisa();
      await chiediEntra();
    },
    video: () => schermata,
    // Il modulo della segnalazione è stato inviato o chiuso.
    fineSegnala() {
      segnala = null;
      avvisa();
    },
    // Passo 8b-3a: Sì o No apre la conferma; nulla parte prima di «Conferma».
    scegliRisposta(valore) {
      if (inCorso || !porta || !RISPOSTE.includes(valore)) return;
      const s = schermataPorta(stato, porta, adesso());
      if (!s || s.tipo !== "risposta" || s.hoRisposto) return;
      conferma = valore;
      errore = null;
      avvisa();
    },
    annullaRisposta() {
      if (conferma === null) return;
      conferma = null;
      avvisa();
    },
    async confermaRisposta() {
      if (inCorso || !porta || !conferma) return;
      const s = schermataPorta(stato, porta, adesso());
      if (!s || s.tipo !== "risposta" || s.hoRisposto) { conferma = null; avvisa(); return; }
      const valore = conferma;
      const id = porta;
      inCorso = true;
      errore = null;
      avvisa();
      const r = await Promise.resolve().then(() => svelamento.rispondi(id, valore)).catch(() => ({ ok: false, motivo: "rete" }));
      inCorso = false;
      if (porta !== id) return;
      if (r && r.ok) {
        conferma = null;
        if (r.stato) stato = r.stato;
        else await leggi();
        avvisa();
        return;
      }
      const motivo = r && r.motivo;
      // Le regole le dice il server: dopo un rifiuto si rilegge, così la schermata mostra la porta come la vede lui.
      if (["gia_risposto", "tempo_scaduto", "porta_chiusa", "non_svelata", "non_trovata"].includes(motivo)) {
        conferma = null;
        await leggi();
      }
      errore = (r && r.testo) || testoErroreSvelamento(motivo);
      avvisa();
    },
    mostraRicarica() {
      ricarica = !ricarica;
      avvisa();
    },
    async blocca() {
      if (inCorso || !porta) return;
      inCorso = true;
      errore = null;
      avvisa();
      const id = porta;
      const r = await svelamento.blocca(id).catch(() => ({ ok: false, motivo: "rete" }));
      inCorso = false;
      if (porta !== id) return;
      if (r && r.ok) {
        if (r.stato) stato = r.stato;
        else await leggi();
        avvisa();
        return;
      }
      const motivo = r && r.motivo;
      if (["crediti_insufficienti", "porta_chiusa", "porta_scaduta", "non_trovata"].includes(motivo)) {
        // Si rilegge: la schermata mostra «Ricarica» o la porta chiusa come la vede il server.
        await leggi();
        if (motivo === "crediti_insufficienti") ricarica = false;
        avvisa();
        return;
      }
      errore = (r && r.testo) || testoErroreSvelamento(motivo);
      avvisa();
    },
    async scegli(valore) {
      if (inCorso || !porta || !SCELTE.includes(valore)) return;
      const attuale = schermataPorta(stato, porta, adesso());
      if (!attuale || attuale.tipo !== "porta" || !attuale.scelta || attuale.scelta.attuale === valore) return;
      inCorso = true;
      errore = null;
      avvisa();
      const id = porta;
      const r = await svelamento.scegli(id, valore).catch(() => ({ ok: false, motivo: "rete" }));
      inCorso = false;
      if (porta !== id) return;
      if (r && r.ok) {
        if (r.stato) stato = r.stato;
        else await leggi();
        avvisa();
        return;
      }
      const motivo = r && r.motivo;
      if (["porta_chiusa", "porta_scaduta", "non_trovata"].includes(motivo)) {
        await leggi();
        return;
      }
      if (motivo === "gia_iniziato") await leggi();
      errore = (r && r.testo) || testoErroreSvelamento(motivo);
      avvisa();
    },
    // Passo 5b. Una sola funzione per «pronto» e «fasce»: stessa gestione delle risposte del server.
    pronto: () => invia((id) => svelamento.pronto(id)),
    mostraOrari() {
      orari = !orari;
      if (orari) {
        const q = schermataPorta(stato, porta, adesso())?.quando;
        const mie = q ? q.mie : [];
        bozza = [0, 1, 2].map((i) => mie[i] || "");
      }
      errore = null;
      avvisa();
    },
    impostaFascia(i, valore) {
      if (!Number.isInteger(i) || i < 0 || i >= MAX_FASCE) return;
      bozza[i] = typeof valore === "string" && ISO.test(valore) ? valore : "";
      errore = null;
      avvisa();
    },
    async inviaFasce() {
      const scelte = [...new Set(bozza.filter(Boolean))].sort();
      if (!scelte.length) {
        errore = TESTI.almenoUno;
        avvisa();
        return;
      }
      const ok = await invia((id) => svelamento.fasce(id, scelte));
      if (ok) orari = false;
      avvisa();
    },
    modello: () => ({
      aperta: porta !== null,
      carica,
      inCorso,
      errore,
      ricarica,
      orari,
      bozza: [...bozza],
      ingresso,
      conferma,
      puoEntrare: typeof creaVideo === "function",
      nome: nomeAltra(),
      segnala: segnala ? { ...segnala } : null,
      schermata: porta !== null ? schermataPorta(stato, porta, adesso()) : null,
    }),
  };
}

// La vista (h come in flusso.js). null se nessuna porta è aperta.
export function vistaPorta(h, ps, { torna = () => ps.chiudi() } = {}) {
  const m = ps.modello();
  if (!m.aperta) return null;
  const s = m.schermata;
  const parti = [];
  // Passo 7d-3b: con il video aperto la pagina mostra solo lo svelamento; finito, resta «Ecco <nome>.» con «Torna».
  const video = ps.video ? ps.video() : null;
  const fase = video ? video.modello().stato : "chiusa";
  if (video && fase !== "chiusa" && fase !== "uscita") {
    return h("section", { classe: "schermata porta-svelamento", "aria-labelledby": "porta-titolo" },
      h("h1", { id: "porta-titolo", classe: "nascosto" }, s && s.tipo === "porta" ? s.titolo : "Svelamento"),
      vistaSchermata(h, video),
      // Passo 8b-3a: a video finito, appena il server dà la porta svelata, sotto «Ecco <nome>.» c'è il sì/no.
      fase === "finito" && s && (s.tipo === "risposta" || s.tipo === "esito") ? vistaRisposta(h, ps, m, s) : null,
      VIDEO_ATTIVO.has(fase) ? null
        : h("div", { classe: "azioni" }, h("button", { classe: "bottone-secondario", type: "button", onclick: torna }, TESTI.torna)));
  }
  if (video && fase === "uscita") parti.push(vistaSchermata(h, video));
  if (m.carica && !s) parti.push(h("p", { classe: "nota", role: "status" }, "Un attimo…"));
  if (m.errore) {
    parti.push(h("p", { classe: "errore", role: "alert" }, m.errore),
      h("button", { classe: "link", type: "button", onclick: () => ps.riprova() }, "Riprova"));
  }
  if (s && (s.tipo === "chiusa" || s.tipo === "scaduta")) parti.push(h("p", { classe: "sottotitolo" }, s.testo));
  if (s && (s.tipo === "risposta" || s.tipo === "esito")) parti.push(vistaRisposta(h, ps, m, s));
  if (s && s.tipo === "porta") {
    const c = s.caparra;
    parti.push(
      h("p", { classe: "porta-chi" }, h("strong", {}, s.chi)),
      h("p", { classe: "nota", role: "timer" }, s.conto),
      h("p", { classe: "nota" }, s.saldo));
    if (c.tipo === "blocca") {
      parti.push(h("p", { id: "caparra-spiegazione" }, c.spiegazione),
        h("button", { classe: "bottone", type: "button", "aria-describedby": "caparra-spiegazione", disabled: m.inCorso,
          onclick: () => ps.blocca() }, m.inCorso ? "Un attimo…" : c.bottone));
    } else if (c.tipo === "ricarica") {
      parti.push(h("p", { id: "caparra-spiegazione" }, c.spiegazione),
        h("p", { classe: "errore", role: "status" }, c.testo),
        h("button", { classe: "bottone-secondario", type: "button", "aria-expanded": m.ricarica ? "true" : "false",
          "aria-controls": "ricarica-beta", onclick: () => ps.mostraRicarica() }, c.bottone),
        m.ricarica ? h("p", { classe: "nota", id: "ricarica-beta", role: "status" }, c.beta) : null);
    } else {
      parti.push(h("p", { role: "status" }, c.testo));
    }
    // Design v4 (#349, schermata 40): la scelta e l'orario nelle due schede di svelamento_come.js.
    parti.push(vistaCome(h, ps, m, s));
    const sala = ps.sala ? ps.sala() : null;
    if (s.momento && sala) {
      parti.push(sala.modello().stato === "chiusa"
        ? h("button", { classe: "bottone", type: "button", disabled: m.inCorso, onclick: () => ps.entraSala() }, TESTI_SALA.vai)
        : vistaSala(h, sala));
      if (sala.modello().stato === "anteprima" && m.puoEntrare) {
        parti.push(m.ingresso
          ? h("p", { role: "status" }, TESTI.aspetta.replace("<nome>", m.nome))
          : h("button", { classe: "bottone", type: "button", disabled: m.inCorso, onclick: () => ps.entra() }, TESTI.entra));
      }
    }
  }
  return h("section", { classe: "schermata porta-svelamento", "aria-labelledby": "porta-titolo" },
    h("h1", { id: "porta-titolo" }, s && s.tipo === "porta" ? s.titolo : TESTI.titoloSvelamento),
    parti,
    h("div", { classe: "azioni" }, h("button", { classe: "bottone-secondario", type: "button", onclick: torna }, TESTI.torna)));
}

// Passo 8b-3a: la domanda segreta e l'esito. Sì / No aprono una conferma con «Conferma» e «Annulla» (pulsanti veri,
// quindi da tastiera con Invio e Spazio); il fuoco va su «Conferma» quando si apre (portaCambiata in flusso.js).
function vistaRisposta(h, ps, m, s) {
  if (s.tipo === "esito") {
    return h("div", { classe: "esito-svelamento" },
      h("p", { classe: "porta-chi" }, h("strong", {}, s.chi)),
      h("p", { role: "status" }, s.testo));
  }
  const parti = [h("p", { classe: "porta-chi" }, h("strong", {}, s.chi))];
  if (s.hoRisposto) {
    parti.push(h("p", { role: "status" }, s.inAttesa || TESTI.giaRisposto));
  } else {
    if (s.conto) parti.push(h("p", { classe: "nota", role: "timer" }, s.conto));
    if (m.conferma) {
      parti.push(h("p", { id: "risposta-conferma", role: "status" }, m.conferma === "si" ? TESTI.confermaSi : TESTI.confermaNo),
        h("div", { classe: "azioni" },
          h("button", { classe: "bottone", type: "button", id: "risposta-conferma-bottone", "aria-describedby": "risposta-conferma",
            disabled: m.inCorso, onclick: () => ps.confermaRisposta() }, m.inCorso ? "Un attimo…" : TESTI.conferma),
          h("button", { classe: "bottone-secondario", type: "button", disabled: m.inCorso, onclick: () => ps.annullaRisposta() }, TESTI.annulla)));
    } else {
      parti.push(h("div", { classe: "azioni" },
        h("button", { classe: "bottone", type: "button", disabled: m.inCorso, onclick: () => ps.scegliRisposta("si") }, TESTI.si),
        h("button", { classe: "bottone", type: "button", disabled: m.inCorso, onclick: () => ps.scegliRisposta("no") }, TESTI.no)));
    }
  }
  return h("div", { classe: "risposta-svelamento", role: "group", "aria-labelledby": "risposta-titolo" },
    h("h2", { id: "risposta-titolo" }, s.domanda), parti);
}

