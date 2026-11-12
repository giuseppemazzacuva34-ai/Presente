// Chiamate solo voce (issue #4, passo 3a): collegamento a Cloudflare Realtime dal server. Nessuna rete vera: un finto
// fetch registra le richieste e risponde come l'API (https://developers.cloudflare.com/realtime/sfu/api/). Dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  soloAudio, soloVoceSessione, midAudio, nuovaSessione, pubblicaVoce, riceviVoce, confermaRisposta, chiudiVoce, TRACCIA,
} from "../api/realtime.js";

const APP = "0123456789abcdef0123456789abcdef";
const SEGRETO = "segreto-di-prova-non-reale";
const ENV = { REALTIME_APP_ID: APP, REALTIME_APP_SECRET: SEGRETO };
const SESSIONE = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const ALTRA = "f0e1d2c3b4a5968778695a4b3c2d1e0f";

const AUDIO = ["v=0", "o=- 1 2 IN IP4 127.0.0.1", "s=-", "t=0 0", "m=audio 9 UDP/TLS/RTP/SAVPF 111", "c=IN IP4 0.0.0.0",
  "a=mid:0", "a=sendonly", "a=rtpmap:111 opus/48000/2", ""].join("\r\n");
const CON_VIDEO = AUDIO + ["m=video 9 UDP/TLS/RTP/SAVPF 96", "a=mid:1", "a=sendonly", ""].join("\r\n");
const CON_DATI = AUDIO + ["m=application 9 UDP/DTLS/SCTP webrtc-datachannel", "a=mid:1", ""].join("\r\n");

function finto(risposte) {
  const chiamate = [];
  const f = async (url, init = {}) => {
    chiamate.push({ url, init, corpo: init.body ? JSON.parse(init.body) : null });
    const r = risposte.shift();
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.corpo ?? {}), { status: r.stato ?? 200 });
  };
  return { f, chiamate };
}

test("soloAudio: accetta un'offerta con solo audio", () => {
  assert.equal(soloAudio(AUDIO), true);
});

test("soloAudio: rifiuta video, canali dati, SDP vuoti o troppo lunghi", () => {
  assert.equal(soloAudio(CON_VIDEO), false);
  assert.equal(soloAudio(CON_DATI), false);
  assert.equal(soloAudio(""), false);
  assert.equal(soloAudio("v=0\r\n"), false); // nessuna sezione audio
  assert.equal(soloAudio(AUDIO + "a=x:" + "y".repeat(40000)), false);
  assert.equal(soloAudio(null), false);
});

test("soloAudio: una sola sezione audio (un microfono)", () => {
  const due = AUDIO + ["m=audio 9 UDP/TLS/RTP/SAVPF 111", "a=mid:1", ""].join("\r\n");
  assert.equal(soloAudio(due), false);
});

test("midAudio: legge il mid della sezione audio", () => {
  assert.equal(midAudio(AUDIO), "0");
  assert.equal(midAudio("v=0\r\nm=audio 9 X 111\r\n"), null);
});

test("nuovaSessione: POST a sessions/new con la chiave segreta, restituisce solo l'id", async () => {
  const { f, chiamate } = finto([{ stato: 201, corpo: { sessionId: SESSIONE, sessionDescription: null } }]);
  assert.deepEqual(await nuovaSessione(ENV, f), { ok: true, sessione: SESSIONE });
  assert.equal(chiamate[0].url, `https://rtc.live.cloudflare.com/v1/apps/${APP}/sessions/new`);
  assert.equal(chiamate[0].init.method, "POST");
  assert.equal(chiamate[0].init.headers.authorization, `Bearer ${SEGRETO}`);
});

test("nuovaSessione: senza chiavi non chiama nessuno", async () => {
  const { f, chiamate } = finto([]);
  assert.deepEqual(await nuovaSessione({}, f), { ok: false, motivo: "spento" });
  assert.deepEqual(await nuovaSessione({ REALTIME_APP_ID: "../x", REALTIME_APP_SECRET: "s" }, f), { ok: false, motivo: "spento" });
  assert.equal(chiamate.length, 0);
});

test("nuovaSessione: errori e risposte strane diventano «realtime», mai dettagli", async () => {
  for (const r of [{ stato: 500, corpo: { errorDescription: "interno" } }, { stato: 200, corpo: { sessionId: "../x" } },
    new Error("rete")]) {
    const { f } = finto([r]);
    assert.deepEqual(await nuovaSessione(ENV, f), { ok: false, motivo: "realtime" });
  }
});

test("pubblicaVoce: pubblica la traccia «voce» con il mid dell'audio e restituisce la risposta", async () => {
  const risposta = { type: "answer", sdp: AUDIO };
  const { f, chiamate } = finto([{ corpo: { sessionDescription: risposta, tracks: [{ mid: "0", trackName: TRACCIA }] } }]);
  const r = await pubblicaVoce(ENV, SESSIONE, { type: "offer", sdp: AUDIO }, f);
  assert.deepEqual(r, { ok: true, descrizione: risposta });
  assert.equal(chiamate[0].url, `https://rtc.live.cloudflare.com/v1/apps/${APP}/sessions/${SESSIONE}/tracks/new`);
  assert.deepEqual(chiamate[0].corpo.tracks, [{ location: "local", mid: "0", trackName: "voce" }]);
});

test("pubblicaVoce: un'offerta con video non arriva mai a Cloudflare", async () => {
  const { f, chiamate } = finto([]);
  assert.deepEqual(await pubblicaVoce(ENV, SESSIONE, { type: "offer", sdp: CON_VIDEO }, f), { ok: false, motivo: "solo_voce" });
  assert.deepEqual(await pubblicaVoce(ENV, SESSIONE, { type: "answer", sdp: AUDIO }, f), { ok: false, motivo: "solo_voce" });
  assert.equal(chiamate.length, 0);
});

test("pubblicaVoce: sessione non valida → nessuna richiesta", async () => {
  const { f, chiamate } = finto([]);
  assert.deepEqual(await pubblicaVoce(ENV, "../../apps", { type: "offer", sdp: AUDIO }, f), { ok: false, motivo: "sessione" });
  assert.equal(chiamate.length, 0);
});

test("pubblicaVoce: errore sulla traccia → «realtime»", async () => {
  const { f } = finto([{ corpo: { sessionDescription: { type: "answer", sdp: AUDIO },
    tracks: [{ mid: "0", errorCode: "invalid_request", errorDescription: "x" }] } }]);
  assert.deepEqual(await pubblicaVoce(ENV, SESSIONE, { type: "offer", sdp: AUDIO }, f), { ok: false, motivo: "realtime" });
});

test("riceviVoce: chiede la «voce» dell'altra sessione e restituisce l'offerta da completare", async () => {
  const offerta = { type: "offer", sdp: AUDIO };
  const { f, chiamate } = finto([{ corpo: { requiresImmediateRenegotiation: true, sessionDescription: offerta,
    tracks: [{ mid: "0", sessionId: ALTRA, trackName: "voce" }] } }]);
  assert.deepEqual(await riceviVoce(ENV, SESSIONE, ALTRA, f), { ok: true, descrizione: offerta, mid: "0" });
  assert.deepEqual(chiamate[0].corpo, { tracks: [{ location: "remote", sessionId: ALTRA, trackName: "voce" }] });
});

test("riceviVoce: mai la propria sessione, mai id strani", async () => {
  const { f, chiamate } = finto([]);
  assert.deepEqual(await riceviVoce(ENV, SESSIONE, SESSIONE, f), { ok: false, motivo: "sessione" });
  assert.deepEqual(await riceviVoce(ENV, SESSIONE, "x/y", f), { ok: false, motivo: "sessione" });
  assert.equal(chiamate.length, 0);
});

test("riceviVoce: se Cloudflare offre video, si scarta", async () => {
  const { f } = finto([{ corpo: { sessionDescription: { type: "offer", sdp: CON_VIDEO }, tracks: [{ mid: "0" }] } }]);
  assert.deepEqual(await riceviVoce(ENV, SESSIONE, ALTRA, f), { ok: false, motivo: "realtime" });
});

test("confermaRisposta: manda la risposta del telefono con PUT renegotiate, solo audio", async () => {
  const { f, chiamate } = finto([{ corpo: {} }]);
  assert.deepEqual(await confermaRisposta(ENV, SESSIONE, { type: "answer", sdp: AUDIO }, f), { ok: true });
  assert.equal(chiamate[0].init.method, "PUT");
  assert.ok(chiamate[0].url.endsWith(`/sessions/${SESSIONE}/renegotiate`));
  const { f: f2, chiamate: c2 } = finto([]);
  assert.deepEqual(await confermaRisposta(ENV, SESSIONE, { type: "answer", sdp: CON_VIDEO }, f2), { ok: false, motivo: "solo_voce" });
  assert.equal(c2.length, 0);
});

test("chiudiVoce: chiude le tracce senza chiedere nulla al telefono (force)", async () => {
  const { f, chiamate } = finto([{ corpo: { tracks: [{ mid: "0" }, { mid: "1" }] } }]);
  assert.deepEqual(await chiudiVoce(ENV, SESSIONE, ["0", "1"], f), { ok: true });
  assert.equal(chiamate[0].init.method, "PUT");
  assert.ok(chiamate[0].url.endsWith("/tracks/close"));
  assert.deepEqual(chiamate[0].corpo, { tracks: [{ mid: "0" }, { mid: "1" }], force: true });
});

test("chiudiVoce: traccia già chiusa va bene, errore interno no", async () => {
  const { f } = finto([{ corpo: { tracks: [{ mid: "0", errorCode: "close_track_error" }] } }]);
  assert.deepEqual(await chiudiVoce(ENV, SESSIONE, ["0"], f), { ok: true });
  const { f: f2 } = finto([{ corpo: { tracks: [{ mid: "0", errorCode: "internal_error" }] } }]);
  assert.deepEqual(await chiudiVoce(ENV, SESSIONE, ["0"], f2), { ok: false, motivo: "realtime" });
});

test("chiudiVoce: niente da chiudere → nessuna richiesta", async () => {
  const { f, chiamate } = finto([]);
  assert.deepEqual(await chiudiVoce(ENV, SESSIONE, [], f), { ok: true });
  assert.deepEqual(await chiudiVoce(ENV, SESSIONE, ["a b"], f), { ok: false, motivo: "mid" });
  assert.equal(chiamate.length, 0);
});

test("Cloudflare che non risponde: si smette di aspettare", async () => {
  const lento = () => new Promise(() => {});
  const inizio = Date.now();
  assert.deepEqual(await nuovaSessione({ ...ENV, REALTIME_ATTESA_MS: "50" }, lento), { ok: false, motivo: "realtime" });
  assert.ok(Date.now() - inizio < 1000);
});

// Correzione (3c): ricevere la voce sulla STESSA sessione (un PeerConnection per sessione, docs Cloudflare
// «Negotiation»: una sessione = un PeerConnection) vuol dire che offerta di Cloudflare e risposta del telefono
// descrivono tutto il collegamento: la mia voce che parte + quella che arriva = 2 sezioni audio (di più dopo un rientro).
const DUE_AUDIO = AUDIO + ["m=audio 9 UDP/TLS/RTP/SAVPF 111", "a=mid:1", "a=recvonly", "a=rtpmap:111 opus/48000/2", ""].join("\r\n");
const CINQUE_AUDIO = DUE_AUDIO + [2, 3, 4].map((i) => `m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:${i}\r\na=recvonly\r\n`).join("");

test("soloVoceSessione: da 1 a 4 sezioni, tutte audio; mai video, canali dati o SDP strani", () => {
  assert.equal(soloVoceSessione(AUDIO), true);
  assert.equal(soloVoceSessione(DUE_AUDIO), true);
  assert.equal(soloVoceSessione(CINQUE_AUDIO), false);
  assert.equal(soloVoceSessione(CON_VIDEO), false);
  assert.equal(soloVoceSessione(DUE_AUDIO + "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:2\r\n"), false);
  assert.equal(soloVoceSessione(CON_DATI), false);
  assert.equal(soloVoceSessione("v=0\r\n"), false);
  assert.equal(soloVoceSessione(""), false);
  assert.equal(soloVoceSessione(null), false);
  assert.equal(soloVoceSessione(DUE_AUDIO + "a=x:" + "y".repeat(40000)), false);
  // L'offerta per pubblicare resta di UNA sola voce.
  assert.equal(soloAudio(DUE_AUDIO), false);
});

test("riceviVoce: accetta l'offerta di Cloudflare con la mia voce e quella dell'altra persona", async () => {
  const offerta = { type: "offer", sdp: DUE_AUDIO };
  const { f } = finto([{ corpo: { requiresImmediateRenegotiation: true, sessionDescription: offerta,
    tracks: [{ mid: "1", sessionId: ALTRA, trackName: "voce" }] } }]);
  assert.deepEqual(await riceviVoce(ENV, SESSIONE, ALTRA, f), { ok: true, descrizione: offerta, mid: "1" });
});

test("confermaRisposta: accetta la risposta del telefono con due sezioni audio, mai con video", async () => {
  const { f } = finto([{ corpo: {} }]);
  assert.deepEqual(await confermaRisposta(ENV, SESSIONE, { type: "answer", sdp: DUE_AUDIO }, f), { ok: true });
  const { f: f2, chiamate } = finto([]);
  assert.deepEqual(await confermaRisposta(ENV, SESSIONE, { type: "answer", sdp: DUE_AUDIO + "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:2\r\n" }, f2),
    { ok: false, motivo: "solo_voce" });
  assert.equal(chiamate.length, 0);
});
