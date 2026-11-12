// Voce nel browser (issue #4, passo 3c-2): microfono SOLO audio e collegamento WebRTC a Cloudflare Realtime.
//
// - Si chiede solo il microfono (video: false), con cancellazione dell'eco e riduzione del rumore del browser.
// - Una sola connessione (RTCPeerConnection) per chiamata: prima si pubblica la propria voce (sendonly), poi sulla
//   stessa connessione si riceve quella dell'altra persona (offerta di Cloudflare con più sezioni, tutte audio).
// - Qualunque descrizione con video o canali dati viene rifiutata prima di toccare la connessione (solo voce).
// - Le chiamate NON si registrano: nessun registratore, niente salvataggi; la voce va solo all'altoparlante.
// - Nessun dato personale qui: solo SDP verso il nostro Worker (che parla con Cloudflare) e stati della connessione.
//
// Le dipendenze del browser si passano da fuori (nei test sono finte): getUserMedia, RTCPeerConnection, altoparlante
// (un elemento <audio>), quandoCade (avviso «connessione persa», che l'app gira a /caduta).

// Server STUN di Cloudflare Realtime (lo stesso fornitore delle chiamate): serve solo a trovare la strada di rete.
export const ICE = [{ urls: "stun:stun.cloudflare.com:3478" }];

const VINCOLI = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };

export function motivoMicrofono(errore) {
  const nome = errore && errore.name;
  if (nome === "NotAllowedError" || nome === "SecurityError") return "microfono_negato";
  if (nome === "NotFoundError" || nome === "OverconstrainedError") return "microfono_assente";
  return "microfono";
}

// Vero solo se la descrizione ha almeno una sezione e TUTTE le sezioni («m=») sono audio.
export function offertaSoloVoce(sdp) {
  if (typeof sdp !== "string" || sdp.length > 20000) return false;
  const sezioni = sdp.split(/\r?\n/).filter((riga) => riga.startsWith("m="));
  return sezioni.length > 0 && sezioni.every((riga) => riga.startsWith("m=audio "));
}

export function creaVoce({ getUserMedia, RTCPeerConnection: PC, altoparlante = null, quandoCade = () => {} } = {}) {
  let flusso = null;
  let pc = null;

  function nuovaConnessione() {
    const questa = new PC({ iceServers: ICE, bundlePolicy: "max-bundle" });
    let caduta = false;
    questa.onconnectionstatechange = () => {
      if (questa !== pc || caduta) return;
      if (questa.connectionState === "failed" || questa.connectionState === "disconnected") {
        caduta = true;
        quandoCade();
      }
    };
    questa.ontrack = (evento) => {
      if (!altoparlante || evento.track?.kind !== "audio") return;
      altoparlante.srcObject = evento.streams?.[0] ?? null;
      Promise.resolve(altoparlante.play?.()).catch(() => {});
    };
    for (const traccia of flusso.getAudioTracks()) questa.addTransceiver(traccia, { direction: "sendonly" });
    return questa;
  }

  async function offerta() {
    pc = nuovaConnessione();
    try {
      await pc.setLocalDescription(await pc.createOffer());
      const sdp = pc.localDescription?.sdp;
      if (!offertaSoloVoce(sdp)) return { ok: false, motivo: "solo_voce" };
      return { ok: true, offerta: sdp };
    } catch {
      return { ok: false, motivo: "riprova" };
    }
  }

  function chiudiConnessione() {
    if (pc) { try { pc.close(); } catch { /* già chiusa */ } }
    pc = null;
  }

  return {
    // Accende il microfono e prepara la propria voce. → { ok, offerta } | { ok: false, motivo }
    async parti() {
      if (typeof getUserMedia !== "function" || typeof PC !== "function") return { ok: false, motivo: "microfono_assente" };
      if (!flusso) {
        try {
          flusso = await getUserMedia(VINCOLI);
        } catch (errore) {
          return { ok: false, motivo: motivoMicrofono(errore) };
        }
      }
      return offerta();
    },
    // Risposta di Cloudflare alla propria offerta.
    async risposta(sdp) {
      if (!offertaSoloVoce(sdp)) return { ok: false, motivo: "solo_voce" };
      if (!pc) return { ok: false, motivo: "riprova" };
      try {
        await pc.setRemoteDescription({ type: "answer", sdp });
        return { ok: true };
      } catch {
        return { ok: false, motivo: "riprova" };
      }
    },
    // Offerta di Cloudflare per ricevere la voce dell'altra persona → { ok, risposta } da mandare a /conferma.
    async ascolta(sdp) {
      if (!offertaSoloVoce(sdp)) return { ok: false, motivo: "solo_voce" };
      if (!pc) return { ok: false, motivo: "riprova" };
      try {
        await pc.setRemoteDescription({ type: "offer", sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        const risposta = pc.localDescription?.sdp;
        if (!offertaSoloVoce(risposta)) return { ok: false, motivo: "solo_voce" };
        return { ok: true, risposta };
      } catch {
        return { ok: false, motivo: "riprova" };
      }
    },
    // «Riconnetti»: connessione nuova con lo stesso microfono (non lo richiede di nuovo).
    async riparti() {
      if (!flusso) return this.parti();
      chiudiConnessione();
      return offerta();
    },
    muto(spento) {
      for (const traccia of flusso?.getAudioTracks() ?? []) traccia.enabled = !spento;
    },
    // Fine chiamata: microfono spento (sparisce l'indicatore del browser), connessione chiusa, altoparlante muto.
    chiudi() {
      chiudiConnessione();
      for (const traccia of flusso?.getTracks() ?? []) { try { traccia.stop(); } catch { /* già ferma */ } }
      flusso = null;
      if (altoparlante) altoparlante.srcObject = null;
    },
  };
}

// Unisce la voce alle richieste del server (creaChiamata di moduli/chiamata.js). Ogni funzione → { ok, vista } o
// { ok: false, motivo }; quando il server dice no, il microfono si spegne subito.
export function collegaVoce({ chiamata, voce }) {
  async function pubblica(invia) {
    const mia = await voce.parti();
    if (!mia.ok) { voce.chiudi(); return mia; }
    const r = await invia(mia.offerta);
    if (!r.ok) { voce.chiudi(); return { ok: false, motivo: r.motivo }; }
    const fatto = await voce.risposta(r.descrizione);
    if (!fatto.ok) { voce.chiudi(); return fatto; }
    return { ok: true, vista: r.vista ?? null };
  }

  return {
    chiama: (verso) => pubblica((offerta) => chiamata.apri(verso, offerta)),
    rispondi: () => pubblica((offerta) => chiamata.rispondi(offerta)),
    // Quando la vista dice che l'altra persona è in linea: si riceve la sua voce sulla stessa connessione.
    async ascolta() {
      const r = await chiamata.ascolta();
      if (!r.ok) return { ok: false, motivo: r.motivo };
      const mia = await voce.ascolta(r.descrizione);
      if (!mia.ok) return mia;
      const c = await chiamata.conferma(mia.risposta);
      return c.ok ? { ok: true, vista: c.vista ?? null } : { ok: false, motivo: c.motivo };
    },
    async riconnetti() {
      const mia = await voce.riparti();
      if (!mia.ok) return mia;
      const r = await chiamata.rientro(mia.offerta);
      if (!r.ok) return { ok: false, motivo: r.motivo };
      const fatto = await voce.risposta(r.descrizione);
      return fatto.ok ? { ok: true, vista: r.vista ?? null } : fatto;
    },
    async chiudi(segnala = false) {
      voce.chiudi();
      return chiamata.chiudi(segnala);
    },
  };
}
