// Svelamento (issue #65, passo 7a): Realtime con voce + video SOLO per lo svelamento dopo la porta. Le chiamate
// dalla stanza restano solo voce (test/realtime.test.mjs). Nessuna rete vera: un finto fetch risponde come l'API
// (https://developers.cloudflare.com/realtime/sfu/api/). Dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  soloSvelamento, svelamentoSessione, midDi, pubblicaSvelamento, riceviSvelamento, confermaSvelamento,
  TRACCIA, TRACCIA_VIDEO, pubblicaVoce, confermaRisposta,
} from "../api/realtime.js";

const APP = "0123456789abcdef0123456789abcdef";
const ENV = { REALTIME_APP_ID: APP, REALTIME_APP_SECRET: "segreto-di-prova-non-reale" };
const SESSIONE = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const ALTRA = "f0e1d2c3b4a5968778695a4b3c2d1e0f";

const TESTA = ["v=0", "o=- 1 2 IN IP4 127.0.0.1", "s=-", "t=0 0", ""].join("\r\n");
const sez = (tipo, mid, dir = "sendonly") => [`m=${tipo} 9 UDP/TLS/RTP/SAVPF ${tipo === "audio" ? 111 : 96}`, `a=mid:${mid}`, `a=${dir}`, ""].join("\r\n");
const PUBBLICA = TESTA + sez("audio", "0") + sez("video", "1");
const SOLO_AUDIO = TESTA + sez("audio", "0");
const DATI = "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=mid:9\r\n";
// Sessione completa: mia voce + mio video che partono, voce + video dell'altra persona che arrivano.
const SESSIONE_SDP = PUBBLICA + sez("audio", "2", "recvonly") + sez("video", "3", "recvonly");

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

test("soloSvelamento: esattamente una voce e un video, in qualunque ordine", () => {
  assert.equal(soloSvelamento(PUBBLICA), true);
  assert.equal(soloSvelamento(TESTA + sez("video", "0") + sez("audio", "1")), true);
});

test("soloSvelamento: rifiuta solo audio, due video, canali dati, SDP vuoti o troppo lunghi", () => {
  assert.equal(soloSvelamento(SOLO_AUDIO), false);
  assert.equal(soloSvelamento(TESTA + sez("video", "0")), false);
  assert.equal(soloSvelamento(PUBBLICA + sez("video", "2")), false); // seconda fotocamera
  assert.equal(soloSvelamento(PUBBLICA + DATI), false);
  assert.equal(soloSvelamento(""), false);
  assert.equal(soloSvelamento(null), false);
  assert.equal(soloSvelamento(PUBBLICA + "a=x:" + "y".repeat(40000)), false);
});

test("svelamentoSessione: da 2 a 6 sezioni audio/video, mai canali dati", () => {
  assert.equal(svelamentoSessione(PUBBLICA), true);
  assert.equal(svelamentoSessione(SESSIONE_SDP), true);
  assert.equal(svelamentoSessione(SESSIONE_SDP + sez("audio", "4", "inactive") + sez("video", "5", "inactive")), true);
  assert.equal(svelamentoSessione(SESSIONE_SDP + sez("audio", "4") + sez("video", "5") + sez("video", "6")), false);
  assert.equal(svelamentoSessione(SESSIONE_SDP + DATI), false);
  assert.equal(svelamentoSessione(SOLO_AUDIO), false);
  assert.equal(svelamentoSessione(""), false);
});

test("midDi: legge il mid della prima sezione del tipo chiesto", () => {
  assert.equal(midDi(PUBBLICA, "audio"), "0");
  assert.equal(midDi(PUBBLICA, "video"), "1");
  assert.equal(midDi(SOLO_AUDIO, "video"), null);
  assert.equal(midDi(TESTA + "m=video 9 X 96\r\na=mid:a b\r\n", "video"), null);
});

test("pubblicaSvelamento: pubblica «voce» e «video» con i loro mid e restituisce la risposta", async () => {
  const risposta = { type: "answer", sdp: PUBBLICA };
  const { f, chiamate } = finto([{ corpo: { sessionDescription: risposta, tracks: [{ mid: "0" }, { mid: "1" }] } }]);
  assert.deepEqual(await pubblicaSvelamento(ENV, SESSIONE, { type: "offer", sdp: PUBBLICA }, f), { ok: true, descrizione: risposta });
  assert.equal(chiamate[0].url, `https://rtc.live.cloudflare.com/v1/apps/${APP}/sessions/${SESSIONE}/tracks/new`);
  assert.deepEqual(chiamate[0].corpo.tracks, [
    { location: "local", mid: "0", trackName: TRACCIA },
    { location: "local", mid: "1", trackName: TRACCIA_VIDEO },
  ]);
  assert.equal(TRACCIA_VIDEO, "video");
});

test("pubblicaSvelamento: offerte sbagliate non arrivano mai a Cloudflare", async () => {
  const { f, chiamate } = finto([]);
  for (const o of [{ type: "offer", sdp: SOLO_AUDIO }, { type: "answer", sdp: PUBBLICA }, { type: "offer", sdp: PUBBLICA + DATI }]) {
    assert.deepEqual(await pubblicaSvelamento(ENV, SESSIONE, o, f), { ok: false, motivo: "svelamento" });
  }
  assert.deepEqual(await pubblicaSvelamento(ENV, "../x", { type: "offer", sdp: PUBBLICA }, f), { ok: false, motivo: "sessione" });
  assert.deepEqual(await pubblicaSvelamento({}, SESSIONE, { type: "offer", sdp: PUBBLICA }, f), { ok: false, motivo: "spento" });
  assert.equal(chiamate.length, 0);
});

test("pubblicaSvelamento: errore su una traccia o risposta senza video → «realtime»", async () => {
  const { f } = finto([{ corpo: { sessionDescription: { type: "answer", sdp: PUBBLICA }, tracks: [{ mid: "0" }, { mid: "1", errorCode: "x" }] } }]);
  assert.deepEqual(await pubblicaSvelamento(ENV, SESSIONE, { type: "offer", sdp: PUBBLICA }, f), { ok: false, motivo: "realtime" });
  const { f: f2 } = finto([{ corpo: { sessionDescription: { type: "answer", sdp: SOLO_AUDIO }, tracks: [{ mid: "0" }, { mid: "1" }] } }]);
  assert.deepEqual(await pubblicaSvelamento(ENV, SESSIONE, { type: "offer", sdp: PUBBLICA }, f2), { ok: false, motivo: "realtime" });
});

test("riceviSvelamento: chiede voce e video dell'altra sessione, restituisce l'offerta e i due mid", async () => {
  const offerta = { type: "offer", sdp: SESSIONE_SDP };
  const { f, chiamate } = finto([{ corpo: { requiresImmediateRenegotiation: true, sessionDescription: offerta,
    tracks: [{ mid: "2", sessionId: ALTRA, trackName: "voce" }, { mid: "3", sessionId: ALTRA, trackName: "video" }] } }]);
  assert.deepEqual(await riceviSvelamento(ENV, SESSIONE, ALTRA, f), { ok: true, descrizione: offerta, mids: ["2", "3"] });
  assert.deepEqual(chiamate[0].corpo, { tracks: [
    { location: "remote", sessionId: ALTRA, trackName: "voce" },
    { location: "remote", sessionId: ALTRA, trackName: "video" },
  ] });
});

test("riceviSvelamento: mai la propria sessione; offerte con canali dati o tracce in errore scartate", async () => {
  const { f, chiamate } = finto([]);
  assert.deepEqual(await riceviSvelamento(ENV, SESSIONE, SESSIONE, f), { ok: false, motivo: "sessione" });
  assert.equal(chiamate.length, 0);
  const { f: f2 } = finto([{ corpo: { sessionDescription: { type: "offer", sdp: SESSIONE_SDP + DATI }, tracks: [{ mid: "2" }, { mid: "3" }] } }]);
  assert.deepEqual(await riceviSvelamento(ENV, SESSIONE, ALTRA, f2), { ok: false, motivo: "realtime" });
  const { f: f3 } = finto([{ corpo: { sessionDescription: { type: "offer", sdp: SESSIONE_SDP }, tracks: [{ mid: "2" }] } }]);
  assert.deepEqual(await riceviSvelamento(ENV, SESSIONE, ALTRA, f3), { ok: false, motivo: "realtime" });
});

test("confermaSvelamento: PUT renegotiate con la risposta del telefono; mai canali dati", async () => {
  const { f, chiamate } = finto([{ corpo: {} }]);
  assert.deepEqual(await confermaSvelamento(ENV, SESSIONE, { type: "answer", sdp: SESSIONE_SDP }, f), { ok: true });
  assert.equal(chiamate[0].init.method, "PUT");
  assert.ok(chiamate[0].url.endsWith(`/sessions/${SESSIONE}/renegotiate`));
  const { f: f2, chiamate: c2 } = finto([]);
  assert.deepEqual(await confermaSvelamento(ENV, SESSIONE, { type: "answer", sdp: SESSIONE_SDP + DATI }, f2), { ok: false, motivo: "svelamento" });
  assert.equal(c2.length, 0);
});

test("le chiamate dalla stanza restano solo voce: il video dello svelamento non passa di lì", async () => {
  const { f, chiamate } = finto([]);
  assert.deepEqual(await pubblicaVoce(ENV, SESSIONE, { type: "offer", sdp: PUBBLICA }, f), { ok: false, motivo: "solo_voce" });
  assert.deepEqual(await confermaRisposta(ENV, SESSIONE, { type: "answer", sdp: SESSIONE_SDP }, f), { ok: false, motivo: "solo_voce" });
  assert.equal(chiamate.length, 0);
});
