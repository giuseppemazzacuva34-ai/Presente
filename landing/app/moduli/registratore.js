// Registrazione della voce nel browser (passi 7 e 8 della #2).
// Stop automatico al limite, minimo 5 secondi, avviso se la registrazione è troppo silenziosa.
// Nell'anteprima l'audio resta solo nel telefono (in memoria) e sparisce quando si chiude la pagina.

const FORMATI = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];
export const MINIMO_SECONDI = 5;

export function registrazioneSupportata() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

// Livello della voce da 0 a 1 (media quadratica dei campioni, amplificata: la voce parlata sta tra 0,01 e 0,2).
export function livelloVoce(campioni) {
  if (!campioni || !campioni.length) return 0;
  let somma = 0;
  for (const v of campioni) somma += v * v;
  return Math.min(1, Math.sqrt(somma / campioni.length) * 6);
}

// Altezza dell'onda grande (design v4, schermata 07) per un livello: in silenzio bassa ma visibile, con voce piena 1.
export function scalaOnda(livello) {
  const l = Math.max(0, Math.min(1, Number(livello) || 0));
  return Math.round((0.15 + 0.85 * Math.min(1, l * 2.5)) * 100) / 100;
}

// Avvia una registrazione. onTick(secondi, livello) a ogni decimo di secondo (livello: vedi livelloVoce). Restituisce { ferma(), finita: Promise<esito> }.
// esito: { blob, url, secondi } oppure { errore: "breve" | "silenzio" | "negato" | "non_supportato" | "altro" }.
export async function registra(massimoSecondi, onTick) {
  if (!registrazioneSupportata()) return { ferma() {}, finita: Promise.resolve({ errore: "non_supportato" }) };
  let flusso;
  try {
    flusso = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    const negato = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
    return { ferma() {}, finita: Promise.resolve({ errore: negato ? "negato" : "altro" }) };
  }
  const tipo = FORMATI.find((f) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(f)) || "";
  const registratore = new MediaRecorder(flusso, tipo ? { mimeType: tipo, audioBitsPerSecond: 32000 } : undefined);
  const pezzi = [];
  registratore.ondataavailable = (e) => { if (e.data && e.data.size) pezzi.push(e.data); };

  // Misura del volume, per riconoscere una registrazione muta.
  let contesto, analizzatore, picco = 0;
  try {
    contesto = new (window.AudioContext || window.webkitAudioContext)();
    analizzatore = contesto.createAnalyser();
    analizzatore.fftSize = 512;
    contesto.createMediaStreamSource(flusso).connect(analizzatore);
  } catch { analizzatore = null; }
  const campioni = analizzatore ? new Float32Array(analizzatore.fftSize) : null;

  const inizio = performance.now();
  let timer;
  const finita = new Promise((risolvi) => {
    registratore.onstop = () => {
      clearInterval(timer);
      flusso.getTracks().forEach((t) => t.stop());
      if (contesto) contesto.close().catch(() => {});
      const secondi = Math.min(massimoSecondi, (performance.now() - inizio) / 1000);
      if (secondi < MINIMO_SECONDI) return risolvi({ errore: "breve", secondi });
      if (analizzatore && picco < 0.02) return risolvi({ errore: "silenzio", secondi });
      const blob = new Blob(pezzi, { type: registratore.mimeType || tipo || "audio/webm" });
      risolvi({ blob, url: URL.createObjectURL(blob), secondi });
    };
  });
  timer = setInterval(() => {
    const secondi = (performance.now() - inizio) / 1000;
    let livello = 0;
    if (analizzatore) {
      analizzatore.getFloatTimeDomainData(campioni);
      for (const v of campioni) picco = Math.max(picco, Math.abs(v));
      livello = livelloVoce(campioni);
    }
    onTick && onTick(Math.min(secondi, massimoSecondi), livello);
    if (secondi >= massimoSecondi && registratore.state === "recording") registratore.stop();
  }, 100);
  registratore.start(250);
  return { ferma() { if (registratore.state === "recording") registratore.stop(); }, finita };
}
