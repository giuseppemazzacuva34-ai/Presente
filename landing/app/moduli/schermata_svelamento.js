// Schermata del video dello svelamento (issue #65, passo 7d-2; D48 A, spec v1 del CPO, passo 6 e casi limite).
// Linea del CTO.
//
// Usa collegaVideo (video_svelamento.js) per UNA porta, già entrata («iniziato» con tipo «video», passo 6c):
// - all'apertura pubblica voce + video (sfocato dal telefono); poi «Aspettiamo <nome>…» e si prova a ricevere
//   l'altra persona; ricevuta, si legge la «vista» del server. Al massimo una lettura al secondo, una alla volta.
// - Il timer dei 10 secondi parte SOLO quando il server dà l'inizio (entrambi i video ricevuti) e conta sull'ora del
//   server. A 10 secondi il telefono chiude da solo, anche se il server non risponde: «Ecco <nome>.».
// - Sul video dell'altra persona, in filigrana: il nome di CHI GUARDA + data (testo, mai HTML), in movimento lento.
// - Pulsanti: microfono on/off e «Chiudi e segnala» (rosso). Niente cambio fotocamera, niente pulsante per allungare.
// - «Chiudi e segnala» chiude fotocamera, microfono e connessione SUBITO (senza attendere nulla), poi apre la
//   segnalazione (quandoSegnala, #7). Blocco e caparre li fa il server (passo 7d-3a: azione «chiudi_e_segnala»).
// - Caduta prima dei 10 secondi: «La connessione è caduta.» + «Riprova» per 2 minuti, al massimo 3 volte; il timer
//   riparte da 10 con lo sfocato iniziale (lo azzera il server). Poi si torna a scegliere quando (quandoEsci).
//   Caduta dopo i 10 secondi: lo svelamento è valido (come la fine).
// Niente registrazioni, niente immagini, niente salvataggi: la schermata tiene solo stato in memoria.
// Le dipendenze arrivano da fuori (orologio, giro, video), così si prova tutto con node --test.

import { TESTI_VIDEO, tempoSvelamento, filigrana, creaSfocatore, creaVideoSvelamento, collegaVideo } from "./video_svelamento.js";

export const TESTI_SCHERMATA = Object.freeze({
  ...TESTI_VIDEO,
  // Provvisori, da rivedere con «contenuti».
  titolo: "Svelamento",
  collego: "Un attimo…",
  chiusa: "Lo svelamento si è chiuso.",
  interrotto: "Lo svelamento si è interrotto. Scegli un altro momento.",
});

export const RIPROVA_MS = 2 * 60_000; // «Riprova» per 2 minuti (spec, casi limite)
export const MAX_RIPROVE = 3;         // massimo 3 tentativi, poi si torna al passo 4
const GIRO_MS = 250;                  // il timer si ridisegna 4 volte al secondo
const LEGGI_MS = 1000;                // al server al massimo una lettura al secondo
const RICEVI_DI_NUOVO = 5;            // in attesa da 5 letture dopo aver ricevuto: si riceve di nuovo (Riprova dell'altra)
const PASSEGGERI = new Set(["riprova", "in_attesa", "nessuna", "troppe"]);
const ATTIVI = new Set(["collego", "aspetta", "in_corso", "caduta"]);

const numero = (x) => typeof x === "number" && Number.isFinite(x);
const conNome = (testo, nome) => testo.replace("<nome>", typeof nome === "string" && nome.trim() ? nome.trim() : "l'altra persona");

export function creaSchermataSvelamento({
  collega, nome = "", nomeMio = "", schermo = null,
  adesso = () => Date.now(), ogni = (fn, ms) => setInterval(fn, ms), ferma: fermaGiro = (id) => clearInterval(id),
  leggiOgni = LEGGI_MS, aggiorna = () => {},
  quandoFinito = () => {}, quandoSegnala = () => {}, quandoEsci = () => {},
} = {}) {
  let stato = "chiusa"; // chiusa | collego | aspetta | in_corso | caduta | finito | segnalata | uscita
  let turno = 0;        // cambia a ogni apertura e chiusura: una risposta arrivata tardi non riapre nulla
  let giro = null;
  let vista = null;
  let scarto = 0;       // orologio del telefono − orologio del server
  let ricevuto = false;
  let attese = 0;
  let inVolo = false;
  let ultima = 0;
  let cadutaIl = 0;
  let riprove = 0;
  let muto = false;
  let testo = null;
  let tempo = { secondi: 10, sfocato: true };

  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare lo svelamento */ } };
  const chiama = (fn, ...a) => { try { fn(...a); } catch { /* chi ascolta non deve fermare lo svelamento */ } };

  function fermaTutto() {
    if (giro !== null) fermaGiro(giro);
    giro = null;
    turno++;
    try { collega.chiudi(); } catch { /* già chiuso */ }
  }

  function segui(v) {
    if (!v || typeof v !== "object") return;
    vista = v;
    if (numero(v.ora)) scarto = adesso() - v.ora;
  }

  function finisci() {
    if (!ATTIVI.has(stato)) return;
    fermaTutto();
    stato = "finito";
    tempo = { secondi: 0, sfocato: false };
    avvisa();
    chiama(quandoFinito);
  }

  function esci(motivo, t = null) {
    if (!ATTIVI.has(stato)) return;
    fermaTutto();
    stato = "uscita";
    testo = t;
    avvisa();
    chiama(quandoEsci, motivo);
  }

  // Dopo «ricevi» o «vista»: tempo, fine, oppure di nuovo in attesa (l'altra persona ha fatto «Riprova»).
  function ricalcola() {
    if (stato !== "aspetta" && stato !== "in_corso") return;
    const t = tempoSvelamento(vista, adesso(), scarto);
    if (t.finito) return finisci();
    if (t.fase === "in_corso") {
      stato = "in_corso";
      attese = 0;
    } else {
      if (stato === "in_corso") ricevuto = false; // inizio azzerato dal server: si riceve di nuovo
      stato = "aspetta";
    }
    tempo = { secondi: t.secondi, sfocato: t.sfocato };
  }

  function risposta(r) {
    // L'altra persona ha chiuso con «Chiudi e segnala» (passo 7d-3a): si esce, mai «Ecco <nome>.».
    if (r && r.ok && r.vista && r.vista.fase === "interrotto") { esci("interrotto"); return false; }
    if (r && r.ok) { segui(r.vista); return true; }
    const motivo = String((r && r.motivo) || "riprova");
    if (PASSEGGERI.has(motivo)) return false;
    if (motivo === "finito" && vista && numero(vista.inizio)) { finisci(); return false; }
    esci(motivo, (r && typeof r.testo === "string" && r.testo) || TESTI_SCHERMATA.interrotto);
    return false;
  }

  async function leggi() {
    const mio = turno;
    inVolo = true;
    ultima = adesso();
    let r;
    try {
      r = ricevuto ? await collega.vista() : await collega.ricevi();
    } catch {
      r = { ok: false, motivo: "riprova" };
    }
    inVolo = false;
    if (mio !== turno || (stato !== "aspetta" && stato !== "in_corso")) return;
    const prima = ricevuto;
    if (risposta(r) && !prima) {
      ricevuto = true;
      attese = 0;
    } else if (prima && r && r.ok && (!vista || vista.fase === "attesa") && stato === "aspetta" && ++attese >= RICEVI_DI_NUOVO) {
      ricevuto = false;
      attese = 0;
    }
  }

  async function passo() {
    if (stato === "caduta") {
      if (adesso() - cadutaIl > RIPROVA_MS) esci("tempo");
      return;
    }
    if (stato !== "aspetta" && stato !== "in_corso") return;
    if (!inVolo && adesso() - ultima >= leggiOgni) await leggi();
    ricalcola();
    avvisa();
  }

  // Esito di «pubblica» o «riprova».
  function dopoPubblica(r) {
    if (r && r.ok) {
      segui(r.vista);
      ricevuto = false;
      attese = 0;
      ultima = adesso();
      stato = "aspetta";
      ricalcola();
      avvisa();
      return;
    }
    const motivo = String((r && r.motivo) || "riprova");
    if (motivo.startsWith("fotocamera")) return esci("fotocamera");
    if (PASSEGGERI.has(motivo) || motivo === "svelamento") {
      stato = "caduta";
      avvisa();
      return;
    }
    esci(motivo, (r && typeof r.testo === "string" && r.testo) || TESTI_SCHERMATA.interrotto);
  }

  return {
    async apri() {
      if (ATTIVI.has(stato)) return;
      turno++;
      const mio = turno;
      stato = "collego";
      vista = null;
      scarto = 0;
      ricevuto = false;
      riprove = 0;
      muto = false;
      testo = null;
      tempo = { secondi: 10, sfocato: true };
      cadutaIl = adesso();
      giro = ogni(passo, GIRO_MS);
      avvisa();
      let r;
      try { r = await collega.pubblica(); } catch { r = { ok: false, motivo: "riprova" }; }
      if (mio !== turno || stato !== "collego") return;
      dopoPubblica(r);
    },
    // La connessione è caduta (quandoCade del video).
    cade() {
      if (!ATTIVI.has(stato) || stato === "caduta") return;
      if (vista && vista.fase === "in_corso" && numero(vista.fine) && adesso() - scarto >= vista.fine) return finisci();
      if (riprove >= MAX_RIPROVE) return esci("tentativi");
      stato = "caduta";
      cadutaIl = adesso();
      tempo = { secondi: 10, sfocato: true };
      avvisa();
    },
    async riprova() {
      if (stato !== "caduta" || riprove >= MAX_RIPROVE) return;
      if (adesso() - cadutaIl > RIPROVA_MS) return esci("tempo");
      riprove++;
      const mio = turno;
      stato = "collego";
      vista = null;
      ricevuto = false;
      tempo = { secondi: 10, sfocato: true };
      avvisa();
      let r;
      try { r = await collega.riprova(); } catch { r = { ok: false, motivo: "riprova" }; }
      if (mio !== turno || stato !== "collego") return;
      dopoPubblica(r);
    },
    microfono() {
      if (!ATTIVI.has(stato)) return;
      muto = !muto;
      try { collega.muto(muto); } catch { /* microfono già spento */ }
      avvisa();
    },
    // Chiude SUBITO (niente attese prima della chiusura), poi apre la segnalazione.
    chiudiESegnala() {
      if (!ATTIVI.has(stato)) return;
      fermaTutto();
      stato = "segnalata";
      avvisa();
      chiama(quandoSegnala);
    },
    // Uscita dalla pagina: si spegne tutto, senza eventi.
    chiudi() {
      if (stato === "chiusa") return;
      if (ATTIVI.has(stato)) fermaTutto();
      stato = "chiusa";
      avvisa();
    },
    passo,
    modello: () => ({ stato, secondi: tempo.secondi, sfocato: tempo.sfocato, muto, riprove, testo }),
    schermo: () => schermo,
    nome: () => nome,
    filigrana: () => filigrana(nomeMio, new Date(adesso())),
  };
}

const secondi = (n) => (n === 1 ? "1 secondo" : TESTI_SCHERMATA.secondi.replace("<n>", String(n)));

// La vista (h come in flusso.js). null se la schermata è chiusa. Lo schermo è sempre lo stesso <video>.
export function vistaSchermata(h, s) {
  const m = s.modello();
  if (m.stato === "chiusa") return null;
  const nome = s.nome();
  const parti = [];
  if (ATTIVI.has(m.stato)) {
    parti.push(h("div", { classe: "schermo-svelamento" }, s.schermo(),
      h("div", { classe: "filigrana", "aria-hidden": "true" }, s.filigrana())));
    if (m.stato === "collego") parti.push(h("p", { classe: "nota", role: "status" }, TESTI_SCHERMATA.collego));
    if (m.stato === "aspetta") parti.push(h("p", { role: "status" }, conNome(TESTI_SCHERMATA.aspetta, nome)));
    if (m.stato === "in_corso") parti.push(h("p", { classe: "timer-svelamento", role: "timer", "aria-live": "off" }, secondi(m.secondi)));
    if (m.stato === "caduta") {
      parti.push(h("p", { classe: "errore", role: "alert" }, TESTI_SCHERMATA.caduta),
        h("button", { classe: "bottone", type: "button", onclick: () => s.riprova() }, TESTI_SCHERMATA.riprova));
    }
    parti.push(h("div", { classe: "pulsanti-svelamento" },
      h("button", { classe: "bottone-secondario", type: "button", onclick: () => s.microfono() },
        m.muto ? TESTI_SCHERMATA.microfonoSpento : TESTI_SCHERMATA.microfonoAcceso),
      h("button", { classe: "bottone bottone-rosso", type: "button", onclick: () => s.chiudiESegnala() }, TESTI_SCHERMATA.chiudiSegnala)));
  }
  if (m.stato === "finito") parti.push(h("p", { classe: "ecco", role: "status" }, conNome(TESTI_SCHERMATA.ecco, nome)));
  if (m.stato === "segnalata") parti.push(h("p", { role: "status" }, TESTI_SCHERMATA.chiusa));
  if (m.stato === "uscita") parti.push(h("p", { classe: "errore", role: "alert" }, m.testo || TESTI_SCHERMATA.interrotto));
  return h("div", { classe: "svelamento-video", role: "group", "aria-labelledby": "svelamento-titolo" },
    h("h2", { id: "svelamento-titolo" }, TESTI_SCHERMATA.titolo), parti);
}

// Passo 7d-3b-2: la fabbrica che la porta (creaPortaSvelamento, opzione «video») chiama solo dopo «iniziato» + «video».
// Ogni porta ha il suo sfocatore, la sua connessione e la sua schermata; sorgente (muta, nascosta) e schermo (dove si
// vede e si sente l'altra persona) sono sempre gli stessi elementi <video>. nomeMio() dà il nome di chi guarda per la
// filigrana. Niente registrazioni, niente immagini salvate.
export function fabbricaSchermata({
  svelamento, getUserMedia, RTCPeerConnection, MediaStream = null, creaTela, sorgente = null, schermo = null,
  nomeMio = () => "", aggiorna = () => {}, ogni, ferma,
} = {}) {
  const tempi = { ...(ogni ? { ogni } : {}), ...(ferma ? { ferma } : {}) };
  return (porta, { nome = "", quandoFinito = () => {}, quandoSegnala = () => {}, quandoEsci = () => {} } = {}) => {
    let s = null;
    const sfocatore = creaSfocatore({ creaTela, ...tempi });
    const video = creaVideoSvelamento({ getUserMedia, RTCPeerConnection, MediaStream, sfocatore, sorgente, schermo,
      quandoCade: () => { if (s) s.cade(); } });
    let mio = "";
    try { mio = String(nomeMio() || ""); } catch { mio = ""; }
    s = creaSchermataSvelamento({ collega: collegaVideo({ svelamento, video, porta }), nome, nomeMio: mio, schermo,
      aggiorna, quandoFinito, quandoSegnala, quandoEsci, ...tempi });
    return s;
  };
}
