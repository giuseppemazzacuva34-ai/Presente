// Chiamate solo voce (issue #4, passo 3a): il server parla con Cloudflare Realtime (SFU).
// API: https://developers.cloudflare.com/realtime/sfu/api/ — base https://rtc.live.cloudflare.com/v1, chiave segreta
// solo qui (secret REALTIME_APP_ID / REALTIME_APP_SECRET del Worker, mai nel telefono, mai nei log).
//
// Regole che questo file fa rispettare, qualunque cosa mandi il telefono:
// - SOLO VOCE: un'offerta o una risposta con video, canali dati o più di un microfono non arriva mai a Cloudflare
//   (docs/architettura.md, «Audio e video sulla stessa base»: nelle chiamate dalla stanza niente tracce video).
// - Nessuna registrazione: Realtime inoltra e basta; qui non si salva nulla e non si scrive mai l'SDP nei log.
// - Ogni persona ha una sessione e pubblica una sola traccia, sempre chiamata «voce».
// - Gli errori tornano come motivo breve («spento», «solo_voce», «sessione», «mid», «realtime»), mai dettagli interni.
// Nessuna regola di chi può chiamare chi: quelle sono in api/chiamate.js e le applica il Worker prima di arrivare qui.

export const TRACCIA = "voce";
const BASE = "https://rtc.live.cloudflare.com/v1/apps/";
const APP_ID = /^[0-9a-f]{32}$/;
const SESSIONE = /^[A-Za-z0-9_-]{8,128}$/;
const MID = /^[A-Za-z0-9_-]{1,32}$/;
const SDP_MASSIMO = 20000; // un'offerta solo audio ne usa 2-6 mila
const ATTESA_MS = 5000;

const no = (motivo) => ({ ok: false, motivo });

function sezioni(sdp) {
  return sdp.split(/\r?\n/).filter((r) => r.startsWith("m=")).map((r) => r.slice(2).split(" ")[0]);
}

// true solo se l'SDP ha esattamente una sezione e quella sezione è audio.
export function soloAudio(sdp) {
  if (typeof sdp !== "string" || !sdp || sdp.length > SDP_MASSIMO) return false;
  const m = sezioni(sdp);
  return m.length === 1 && m[0] === "audio";
}

// Per ricevere la voce sulla STESSA sessione (una sessione = un PeerConnection, docs Cloudflare «Negotiation»): l'offerta
// di Cloudflare e la risposta del telefono descrivono tutto il collegamento, cioè la mia voce che parte più quella
// che arriva (e dopo un rientro dell'altra persona una sezione in più, chiusa). Da 1 a 4 sezioni, TUTTE audio.
export const SEZIONI_MASSIME = 4;
export function soloVoceSessione(sdp) {
  if (typeof sdp !== "string" || !sdp || sdp.length > SDP_MASSIMO) return false;
  const m = sezioni(sdp);
  return m.length >= 1 && m.length <= SEZIONI_MASSIME && m.every((x) => x === "audio");
}

// mid della sezione audio (a=mid:…), null se manca o non è valido.
export function midAudio(sdp) {
  if (typeof sdp !== "string") return null;
  let dentro = false;
  for (const riga of sdp.split(/\r?\n/)) {
    if (riga.startsWith("m=")) dentro = riga.startsWith("m=audio ");
    else if (dentro && riga.startsWith("a=mid:")) {
      const mid = riga.slice(6).trim();
      return MID.test(mid) ? mid : null;
    }
  }
  return null;
}

const descrizioneValida = (d, tipo) => !!d && typeof d === "object" && d.type === tipo && soloAudio(d.sdp);
const descrizioneSessione = (d, tipo) => !!d && typeof d === "object" && d.type === tipo && soloVoceSessione(d.sdp);

function chiavi(env) {
  const app = String(env?.REALTIME_APP_ID || "").trim();
  const segreto = String(env?.REALTIME_APP_SECRET || "").trim();
  return APP_ID.test(app) && segreto ? { app, segreto } : null;
}

// Una richiesta all'API con tempo massimo. Restituisce il corpo JSON, oppure null per qualunque problema.
async function chiedi(env, f, metodo, percorso, corpo) {
  const k = chiavi(env);
  if (!k) return null;
  const ms = Number(env.REALTIME_ATTESA_MS) > 0 ? Number(env.REALTIME_ATTESA_MS) : ATTESA_MS;
  let timer;
  try {
    const r = await Promise.race([
      f(BASE + k.app + percorso, {
        method: metodo,
        headers: { authorization: `Bearer ${k.segreto}`, "content-type": "application/json" },
        ...(corpo ? { body: JSON.stringify(corpo) } : {}),
      }),
      new Promise((_, rifiuta) => { timer = setTimeout(() => rifiuta(new Error("tempo scaduto")), ms); }),
    ]);
    if (!r.ok) {
      console.error("realtime: risposta", r.status); // solo il codice, mai il corpo
      return null;
    }
    return await r.json();
  } catch (e) {
    console.error("realtime: errore", e && e.name);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Nuova sessione (una per persona e per chiamata).
export async function nuovaSessione(env, f = fetch) {
  if (!chiavi(env)) return no("spento");
  const r = await chiedi(env, f, "POST", "/sessions/new");
  const id = r && r.sessionId;
  return typeof id === "string" && SESSIONE.test(id) ? { ok: true, sessione: id } : no("realtime");
}

const traccieConErrore = (r) => !Array.isArray(r.tracks) || r.tracks.some((t) => !t || t.errorCode);

// Il telefono pubblica il suo microfono: offerta → risposta di Cloudflare da passare al telefono.
export async function pubblicaVoce(env, sessione, offerta, f = fetch) {
  if (!chiavi(env)) return no("spento");
  if (typeof sessione !== "string" || !SESSIONE.test(sessione)) return no("sessione");
  if (!descrizioneValida(offerta, "offer")) return no("solo_voce");
  const mid = midAudio(offerta.sdp);
  if (!mid) return no("solo_voce");
  const r = await chiedi(env, f, "POST", `/sessions/${sessione}/tracks/new`, {
    sessionDescription: { type: "offer", sdp: offerta.sdp },
    tracks: [{ location: "local", mid, trackName: TRACCIA }],
  });
  if (!r || traccieConErrore(r) || !descrizioneValida(r.sessionDescription, "answer")) return no("realtime");
  return { ok: true, descrizione: { type: "answer", sdp: r.sessionDescription.sdp } };
}

// Il telefono riceve la voce dell'altra persona: Cloudflare manda un'offerta che il telefono completa (confermaRisposta).
export async function riceviVoce(env, sessione, sessioneAltra, f = fetch) {
  if (!chiavi(env)) return no("spento");
  if (![sessione, sessioneAltra].every((s) => typeof s === "string" && SESSIONE.test(s)) || sessione === sessioneAltra) {
    return no("sessione");
  }
  const r = await chiedi(env, f, "POST", `/sessions/${sessione}/tracks/new`, {
    tracks: [{ location: "remote", sessionId: sessioneAltra, trackName: TRACCIA }],
  });
  if (!r || traccieConErrore(r) || !descrizioneSessione(r.sessionDescription, "offer")) return no("realtime");
  const mid = r.tracks[0] && r.tracks[0].mid;
  if (typeof mid !== "string" || !MID.test(mid)) return no("realtime");
  return { ok: true, descrizione: { type: "offer", sdp: r.sessionDescription.sdp }, mid };
}

// Risposta del telefono all'offerta di riceviVoce.
export async function confermaRisposta(env, sessione, risposta, f = fetch) {
  if (!chiavi(env)) return no("spento");
  if (typeof sessione !== "string" || !SESSIONE.test(sessione)) return no("sessione");
  if (!descrizioneSessione(risposta, "answer")) return no("solo_voce");
  const r = await chiedi(env, f, "PUT", `/sessions/${sessione}/renegotiate`, {
    sessionDescription: { type: "answer", sdp: risposta.sdp },
  });
  return r ? { ok: true } : no("realtime");
}

// Fine chiamata (15:00, «Chiudi», «Chiudi e segnala»): il server chiude le tracce senza aspettare il telefono.
// Una traccia già chiusa (close_track_error) va bene; ogni altro errore no, così il Worker può riprovare.
export async function chiudiVoce(env, sessione, mids, f = fetch) {
  if (!chiavi(env)) return no("spento");
  if (typeof sessione !== "string" || !SESSIONE.test(sessione)) return no("sessione");
  if (!Array.isArray(mids) || mids.length > 4 || !mids.every((m) => typeof m === "string" && MID.test(m))) return no("mid");
  if (!mids.length) return { ok: true };
  const r = await chiedi(env, f, "PUT", `/sessions/${sessione}/tracks/close`, {
    tracks: mids.map((mid) => ({ mid })), force: true,
  });
  if (!r || !Array.isArray(r.tracks)) return no("realtime");
  return r.tracks.every((t) => t && (!t.errorCode || t.errorCode === "close_track_error")) ? { ok: true } : no("realtime");
}

// ── Svelamento dopo la porta (issue #65, passo 7a; D48 A) ─────────────────────────────────────────────────────────
// Unico caso con il video: 10 secondi tra i due della porta. Le regole su chi può entrare e quando restano al database
// (entra_svelamento) e al Worker; qui solo la forma: chi pubblica manda ESATTAMENTE una voce e un video (una sola
// fotocamera, nessun canale dati), con i nomi fissi «voce» e «video». Le funzioni delle chiamate qui sopra continuano
// a rifiutare qualunque video. La sfocatura dei primi secondi la applica il telefono di chi trasmette, prima che il
// video parta (docs/architettura.md); Realtime inoltra e basta: nessuna registrazione, nessuna immagine salvata.
export const TRACCIA_VIDEO = "video";
export const SEZIONI_SVELAMENTO = 6; // mia voce + mio video, voce + video dell'altra persona, 2 chiuse dopo un «Riprova»

// true solo se l'SDP ha esattamente due sezioni: una audio e una video.
export function soloSvelamento(sdp) {
  if (typeof sdp !== "string" || !sdp || sdp.length > SDP_MASSIMO) return false;
  const m = sezioni(sdp);
  return m.length === 2 && m.includes("audio") && m.includes("video");
}

// Sessione intera dello svelamento: da 2 a 6 sezioni, solo audio o video, almeno una di ciascuno.
export function svelamentoSessione(sdp) {
  if (typeof sdp !== "string" || !sdp || sdp.length > SDP_MASSIMO) return false;
  const m = sezioni(sdp);
  return m.length >= 2 && m.length <= SEZIONI_SVELAMENTO && m.every((x) => x === "audio" || x === "video")
    && m.includes("audio") && m.includes("video");
}

// mid della prima sezione del tipo chiesto («audio» o «video»), null se manca o non è valido.
export function midDi(sdp, tipo) {
  if (typeof sdp !== "string") return null;
  let dentro = false;
  for (const riga of sdp.split(/\r?\n/)) {
    if (riga.startsWith("m=")) dentro = riga.startsWith(`m=${tipo} `);
    else if (dentro && riga.startsWith("a=mid:")) {
      const mid = riga.slice(6).trim();
      return MID.test(mid) ? mid : null;
    }
  }
  return null;
}

const descrizioneSvelamento = (d, tipo, sessione) =>
  !!d && typeof d === "object" && d.type === tipo && (sessione ? svelamentoSessione(d.sdp) : soloSvelamento(d.sdp));

// Il telefono pubblica voce e fotocamera frontale (già sfocata dal telefono nei primi secondi).
export async function pubblicaSvelamento(env, sessione, offerta, f = fetch) {
  if (!chiavi(env)) return no("spento");
  if (typeof sessione !== "string" || !SESSIONE.test(sessione)) return no("sessione");
  if (!descrizioneSvelamento(offerta, "offer")) return no("svelamento");
  const voce = midDi(offerta.sdp, "audio");
  const video = midDi(offerta.sdp, "video");
  if (!voce || !video || voce === video) return no("svelamento");
  const r = await chiedi(env, f, "POST", `/sessions/${sessione}/tracks/new`, {
    sessionDescription: { type: "offer", sdp: offerta.sdp },
    tracks: [
      { location: "local", mid: voce, trackName: TRACCIA },
      { location: "local", mid: video, trackName: TRACCIA_VIDEO },
    ],
  });
  if (!r || traccieConErrore(r) || !descrizioneSvelamento(r.sessionDescription, "answer")) return no("realtime");
  return { ok: true, descrizione: { type: "answer", sdp: r.sessionDescription.sdp } };
}

// Il telefono riceve voce e video dell'altra persona della porta (offerta di Cloudflare da completare).
export async function riceviSvelamento(env, sessione, sessioneAltra, f = fetch) {
  if (!chiavi(env)) return no("spento");
  if (![sessione, sessioneAltra].every((s) => typeof s === "string" && SESSIONE.test(s)) || sessione === sessioneAltra) {
    return no("sessione");
  }
  const r = await chiedi(env, f, "POST", `/sessions/${sessione}/tracks/new`, {
    tracks: [
      { location: "remote", sessionId: sessioneAltra, trackName: TRACCIA },
      { location: "remote", sessionId: sessioneAltra, trackName: TRACCIA_VIDEO },
    ],
  });
  if (!r || traccieConErrore(r) || r.tracks.length !== 2 || !descrizioneSvelamento(r.sessionDescription, "offer", true)) {
    return no("realtime");
  }
  const mids = r.tracks.map((t) => t.mid);
  if (!mids.every((m) => typeof m === "string" && MID.test(m))) return no("realtime");
  return { ok: true, descrizione: { type: "offer", sdp: r.sessionDescription.sdp }, mids };
}

// Risposta del telefono all'offerta di riceviSvelamento.
export async function confermaSvelamento(env, sessione, risposta, f = fetch) {
  if (!chiavi(env)) return no("spento");
  if (typeof sessione !== "string" || !SESSIONE.test(sessione)) return no("sessione");
  if (!descrizioneSvelamento(risposta, "answer", true)) return no("svelamento");
  const r = await chiedi(env, f, "PUT", `/sessions/${sessione}/renegotiate`, {
    sessionDescription: { type: "answer", sdp: risposta.sdp },
  });
  return r ? { ok: true } : no("realtime");
}
