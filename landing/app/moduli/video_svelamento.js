// Svelamento video nel telefono (issue #65, passo 7d-1; D48 A, spec v1 del CPO, passo 6 e casi limite). Linea del CTO.
//
// - Fotocamera SOLO frontale (facingMode «user») e microfono: si conoscono già le voci. Nessun pulsante per cambiare
//   fotocamera, nessun registratore, niente salvataggi, nessuna immagine tenuta: tutto va solo a Cloudflare Realtime
//   tramite il nostro Worker (/app/api/svelamento, azioni «pubblica», «ricevi», «conferma», «vista»).
// - La sfocatura dei primi secondi la applica il telefono di CHI TRASMETTE (come dice api/realtime.js): la fotocamera
//   grezza non entra mai nella connessione. Si disegna l'immagine in piccolo e la si ingrandisce (sfocata), su una tela
//   da cui esce il video; funziona anche dove la tela non ha il filtro «blur» (Safari). Finché il server non dà l'inizio
//   dei 10 secondi il video resta molto sfocato; dall'inizio torna nitido in 3 secondi (nitidoDal del server).
// - Timer e sfocatura usano l'ora del server («ora» nella vista), non quella del telefono.
// - Una sola connessione: prima si pubblicano voce + video (sendonly, esattamente una sezione audio e una video, niente
//   canali dati), poi sulla stessa si ricevono voce e video dell'altra persona.
// Le dipendenze del browser arrivano da fuori (nei test sono finte), così si prova tutto con node --test.

import { ICE } from "./voce.js";

export const VINCOLI_VIDEO = Object.freeze({
  audio: Object.freeze({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }),
  video: Object.freeze({ facingMode: "user", width: Object.freeze({ ideal: 640 }), height: Object.freeze({ ideal: 480 }) }),
});

// Testi della spec (passo 6, casi limite); gli stessi di api/svelamento.js (TESTI_SVELAMENTO).
export const TESTI_VIDEO = Object.freeze({
  aspetta: "Aspettiamo <nome>…",
  ecco: "Ecco <nome>.",
  caduta: "La connessione è caduta.",
  chiudiSegnala: "Chiudi e segnala",
  riprova: "Riprova",
  // Provvisori, da rivedere con «contenuti».
  microfonoSpento: "Accendi il microfono",
  microfonoAcceso: "Spegni il microfono",
  secondi: "<n> secondi",
});

const DURATA_S = 10;
const SDP_MASSIMO = 20000;
// Quanto si rimpicciolisce l'immagine all'inizio: 1/32 = volto non riconoscibile.
export const SFOCATURA_MINIMA = 1 / 32;

function sezioni(sdp) {
  if (typeof sdp !== "string" || !sdp || sdp.length > SDP_MASSIMO) return null;
  return sdp.split(/\r?\n/).filter((r) => r.startsWith("m=")).map((r) => r.slice(2).split(" ")[0]);
}

// Offerta del telefono (e risposta di Cloudflare): esattamente una voce e un video.
export function offertaSvelamentoTelefono(sdp) {
  const m = sezioni(sdp);
  return !!m && m.length === 2 && m.includes("audio") && m.includes("video");
}

// Sessione intera (dopo «ricevi»): da 2 a 6 sezioni, solo audio o video, almeno una di ciascuno.
export function ricezioneSvelamento(sdp) {
  const m = sezioni(sdp);
  return !!m && m.length >= 2 && m.length <= 6 && m.every((x) => x === "audio" || x === "video")
    && m.includes("audio") && m.includes("video");
}

const numero = (x) => typeof x === "number" && Number.isFinite(x);

// Quanto è grande l'immagine disegnata (1 = nitida) all'ora del server «adesso». Senza inizio: molto sfocata.
// Dall'inizio a nitidoDal la scala cresce in modo esponenziale (lo sfocato cala in modo uniforme all'occhio).
export function scalaSfocatura(vista, adesso) {
  if (!vista || !numero(vista.inizio) || !numero(vista.nitidoDal) || !numero(adesso)) return SFOCATURA_MINIMA;
  if (adesso >= vista.nitidoDal) return 1;
  if (adesso <= vista.inizio || vista.nitidoDal <= vista.inizio) return SFOCATURA_MINIMA;
  const p = (adesso - vista.inizio) / (vista.nitidoDal - vista.inizio);
  return Math.min(1, SFOCATURA_MINIMA ** (1 - p));
}

// Cosa mostra il timer. scarto = orologio del telefono − orologio del server (dalla vista: adesso − vista.ora).
export function tempoSvelamento(vista, adesso, scarto = 0) {
  const attesa = { fase: "attesa", secondi: DURATA_S, sfocato: true, finito: false };
  const finito = { fase: "finito", secondi: 0, sfocato: false, finito: true };
  if (!vista || typeof vista !== "object") return attesa;
  if (vista.fase === "finito") return finito;
  if (vista.fase !== "in_corso" || !numero(vista.fine) || !numero(vista.nitidoDal)) return attesa;
  const server = adesso - (numero(scarto) ? scarto : 0);
  if (server >= vista.fine) return finito;
  const secondi = Math.min(DURATA_S, Math.max(0, Math.ceil((vista.fine - server) / 1000)));
  return { fase: "in_corso", secondi, sfocato: server < vista.nitidoDal, finito: false };
}

const DATA = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric" });
// Filigrana sul video dell'altra persona: nome di chi guarda + data (ora italiana). Solo testo, mai HTML.
export function filigrana(nome, data = new Date()) {
  const n = typeof nome === "string" && nome.trim() ? nome.trim().slice(0, 20) : "Presente!";
  return `${n} · ${DATA.format(data)}`;
}

// La tela che sfoca: disegna la fotocamera in piccolo e la ingrandisce, ogni 1/fps secondi, e ne fa uscire il video.
// nitido(vista) dà l'inizio del server (null = di nuovo molto sfocato, per «Riprova»).
export function creaSfocatore({
  creaTela, adesso = () => Date.now(), ogni = (fn, ms) => setInterval(fn, ms), ferma: fermaGiro = (id) => clearInterval(id), fps = 24,
}) {
  let giro = null;
  let traccia = null;
  let vista = null;
  let scarto = 0;
  return {
    avvia(sorgente) {
      const piccola = creaTela();
      const uscita = creaTela();
      const cp = piccola.getContext("2d");
      const cu = uscita.getContext("2d");
      const disegna = () => {
        try {
          const w = sorgente && sorgente.videoWidth > 0 ? sorgente.videoWidth : 640;
          const h = sorgente && sorgente.videoHeight > 0 ? sorgente.videoHeight : 480;
          if (uscita.width !== w) uscita.width = w;
          if (uscita.height !== h) uscita.height = h;
          const scala = scalaSfocatura(vista, adesso() - scarto);
          if (scala >= 1) {
            cu.drawImage(sorgente, 0, 0, w, h);
            return;
          }
          const pw = Math.max(1, Math.round(w * scala));
          const ph = Math.max(1, Math.round(h * scala));
          if (piccola.width !== pw) piccola.width = pw;
          if (piccola.height !== ph) piccola.height = ph;
          cp.drawImage(sorgente, 0, 0, pw, ph);
          cu.imageSmoothingEnabled = true;
          cu.drawImage(piccola, 0, 0, w, h);
        } catch { /* fotocamera non ancora pronta: si riprova al giro dopo */ }
      };
      giro = ogni(disegna, Math.round(1000 / fps));
      traccia = uscita.captureStream(fps).getVideoTracks()[0];
      return traccia;
    },
    nitido(v) {
      vista = v && typeof v === "object" ? v : null;
      if (vista && numero(vista.ora)) scarto = adesso() - vista.ora;
    },
    ferma() {
      if (giro !== null) fermaGiro(giro);
      giro = null;
      if (traccia) { try { traccia.stop(); } catch { /* già ferma */ } }
      traccia = null;
    },
  };
}

export function motivoFotocamera(errore) {
  const nome = errore && errore.name;
  if (nome === "NotAllowedError" || nome === "SecurityError") return "fotocamera_negata";
  if (nome === "NotFoundError" || nome === "OverconstrainedError") return "fotocamera_assente";
  return "fotocamera";
}

// La connessione dello svelamento. sorgente: un <video> nascosto (muto) dove gira la fotocamera, letto dallo sfocatore;
// schermo: il <video> dove si vede e si sente l'altra persona.
export function creaVideoSvelamento({
  getUserMedia, RTCPeerConnection: PC, MediaStream: MS = null, sfocatore, sorgente = null, schermo = null, quandoCade = () => {},
} = {}) {
  let flusso = null;
  let uscita = null;
  let pc = null;
  let remoto = null;

  function mostra(evento) {
    if (!schermo || !evento || !evento.track) return;
    if (typeof MS === "function") {
      if (!remoto) remoto = new MS();
      remoto.addTrack(evento.track);
      schermo.srcObject = remoto;
    } else if (evento.streams && evento.streams[0]) {
      schermo.srcObject = evento.streams[0];
    }
    Promise.resolve(schermo.play && schermo.play()).catch(() => {});
  }

  function chiudiConnessione() {
    if (pc) { try { pc.close(); } catch { /* già chiusa */ } }
    pc = null;
    remoto = null;
    if (schermo) schermo.srcObject = null;
  }

  async function offerta() {
    const questa = new PC({ iceServers: ICE, bundlePolicy: "max-bundle" });
    pc = questa;
    let caduta = false;
    questa.onconnectionstatechange = () => {
      if (questa !== pc || caduta) return;
      if (questa.connectionState === "failed" || questa.connectionState === "disconnected") {
        caduta = true;
        quandoCade();
      }
    };
    questa.ontrack = (evento) => { if (questa === pc) mostra(evento); };
    for (const t of flusso.getAudioTracks()) questa.addTransceiver(t, { direction: "sendonly" });
    questa.addTransceiver(uscita, { direction: "sendonly" });
    try {
      await questa.setLocalDescription(await questa.createOffer());
      const sdp = questa.localDescription && questa.localDescription.sdp;
      if (!offertaSvelamentoTelefono(sdp)) return { ok: false, motivo: "svelamento" };
      return { ok: true, offerta: { type: "offer", sdp } };
    } catch {
      return { ok: false, motivo: "riprova" };
    }
  }

  return {
    // Accende fotocamera frontale e microfono, prepara il video sfocato. → { ok, offerta } | { ok: false, motivo }
    async parti() {
      if (typeof getUserMedia !== "function" || typeof PC !== "function" || !sfocatore) return { ok: false, motivo: "fotocamera_assente" };
      if (!flusso) {
        try {
          flusso = await getUserMedia(VINCOLI_VIDEO);
        } catch (e) {
          return { ok: false, motivo: motivoFotocamera(e) };
        }
        if (sorgente) {
          sorgente.muted = true;
          sorgente.srcObject = flusso;
          Promise.resolve(sorgente.play && sorgente.play()).catch(() => {});
        }
        uscita = sfocatore.avvia(sorgente);
      }
      return offerta();
    },
    // Risposta di Cloudflare alla propria offerta.
    async risposta(d) {
      if (!d || d.type !== "answer" || !offertaSvelamentoTelefono(d.sdp)) return { ok: false, motivo: "svelamento" };
      if (!pc) return { ok: false, motivo: "riprova" };
      try {
        await pc.setRemoteDescription({ type: "answer", sdp: d.sdp });
        return { ok: true };
      } catch {
        return { ok: false, motivo: "riprova" };
      }
    },
    // Offerta di Cloudflare per ricevere voce e video dell'altra persona → { ok, risposta } da mandare a «conferma».
    async ricevi(d) {
      if (!d || d.type !== "offer" || !ricezioneSvelamento(d.sdp)) return { ok: false, motivo: "svelamento" };
      if (!pc) return { ok: false, motivo: "riprova" };
      try {
        await pc.setRemoteDescription({ type: "offer", sdp: d.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        const sdp = pc.localDescription && pc.localDescription.sdp;
        if (!ricezioneSvelamento(sdp)) return { ok: false, motivo: "svelamento" };
        return { ok: true, risposta: { type: "answer", sdp } };
      } catch {
        return { ok: false, motivo: "riprova" };
      }
    },
    // «Riprova»: connessione nuova, stessa fotocamera; si torna molto sfocati finché il server non ridà l'inizio.
    async riparti() {
      if (!flusso) return this.parti();
      chiudiConnessione();
      sfocatore.nitido(null);
      return offerta();
    },
    nitido(vista) { sfocatore.nitido(vista); },
    muto(spento) {
      for (const t of (flusso && flusso.getAudioTracks()) || []) t.enabled = !spento;
    },
    // Fine: fotocamera e microfono spenti (sparisce l'indicatore del browser), tela ferma, connessione chiusa.
    chiudi() {
      chiudiConnessione();
      if (sfocatore) sfocatore.ferma();
      if (uscita) { try { uscita.stop(); } catch { /* già ferma */ } }
      uscita = null;
      for (const t of (flusso && flusso.getTracks()) || []) { try { t.stop(); } catch { /* già ferma */ } }
      flusso = null;
      if (sorgente) sorgente.srcObject = null;
    },
  };
}

// Unisce il video alle richieste del Worker (creaSvelamento di svelamento.js) per UNA porta. Ogni funzione →
// { ok, vista } o { ok: false, motivo, testo? }; quando il server dice no a «pubblica», fotocamera e microfono si
// spengono subito.
export function collegaVideo({ svelamento, video, porta }) {
  const no = (r) => (r && r.testo ? { ok: false, motivo: r.motivo, testo: r.testo } : { ok: false, motivo: (r && r.motivo) || "riprova" });
  const segui = (vista) => { if (vista) video.nitido(vista); return vista ?? null; };
  async function pubblicaCon(mia) {
    if (!mia.ok) { video.chiudi(); return mia; }
    const r = await svelamento.pubblica(porta, mia.offerta);
    if (!r.ok) { video.chiudi(); return no(r); }
    const fatto = await video.risposta(r.descrizione);
    if (!fatto.ok) { video.chiudi(); return fatto; }
    return { ok: true, vista: segui(r.vista) };
  }
  return {
    pubblica: async () => pubblicaCon(await video.parti()),
    // Quando l'altra persona ha pubblicato: si ricevono la sua voce e il suo video sulla stessa connessione.
    async ricevi() {
      const r = await svelamento.ricevi(porta);
      if (!r.ok) return no(r);
      const mia = await video.ricevi(r.descrizione);
      if (!mia.ok) return mia;
      const c = await svelamento.conferma(porta, mia.risposta);
      return c.ok ? { ok: true, vista: segui(c.vista) } : no(c);
    },
    riprova: async () => pubblicaCon(await video.riparti()),
    // Passo 8b-3b: la connessione è caduta; il server ferma il timer (si torna molto sfocati con la sua vista).
    async caduta() {
      const r = await svelamento.cadutaVideo(porta);
      return r.ok ? { ok: true, vista: segui(r.vista) } : no(r);
    },
    async vista() {
      const r = await svelamento.vistaVideo(porta);
      return r.ok ? { ok: true, vista: segui(r.vista) } : no(r);
    },
    muto(spento) { video.muto(spento); },
    chiudi() { video.chiudi(); },
  };
}
