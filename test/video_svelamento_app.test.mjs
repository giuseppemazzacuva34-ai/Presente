// Svelamento (issue #65, passo 7d-1; D48 A, spec v1 del CPO, passo 6): il video nel telefono.
// Si provano con browser finti: fotocamera frontale + microfono, video in uscita sfocato dal telefono nei primi
// secondi, solo una voce e un video in uscita, timer dei 10 secondi sull'ora del server, filigrana con il nome di chi
// guarda. Nessuna rete vera, nessun Cloudflare, solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VINCOLI_VIDEO, offertaSvelamentoTelefono, ricezioneSvelamento, scalaSfocatura, tempoSvelamento, filigrana,
  creaSfocatore, creaVideoSvelamento, collegaVideo, TESTI_VIDEO,
} from "../landing/app/moduli/video_svelamento.js";
import { creaSvelamento } from "../landing/app/moduli/svelamento.js";

const OFFERTA = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:1\r\n";
const RICEZIONE = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:2\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:3\r\n";
const SOLO_VOCE = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\n";
const CON_DATI = OFFERTA + "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=mid:2\r\n";
const DUE_VIDEO = OFFERTA + "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:2\r\n";
const PORTA = "11111111-2222-4333-8444-555555555555";

test("vincoli: solo fotocamera frontale, con microfono", () => {
  assert.equal(VINCOLI_VIDEO.video.facingMode, "user");
  assert.ok(VINCOLI_VIDEO.audio);
  assert.ok(Object.isFrozen(VINCOLI_VIDEO));
});

test("offerta del telefono: esattamente una voce e un video, niente canali dati", () => {
  assert.equal(offertaSvelamentoTelefono(OFFERTA), true);
  assert.equal(offertaSvelamentoTelefono(SOLO_VOCE), false);
  assert.equal(offertaSvelamentoTelefono(CON_DATI), false);
  assert.equal(offertaSvelamentoTelefono(DUE_VIDEO), false);
  assert.equal(offertaSvelamentoTelefono(null), false);
  assert.equal(ricezioneSvelamento(RICEZIONE), true);
  assert.equal(ricezioneSvelamento(CON_DATI), false);
  assert.equal(ricezioneSvelamento(SOLO_VOCE), false);
});

test("sfocatura: molto sfocato finché il server non dà l'inizio, poi nitido in 3 secondi", () => {
  const min = scalaSfocatura(null, 0);
  assert.ok(min > 0 && min <= 0.05);
  const inizio = 100_000;
  const nitidoDal = inizio + 3000;
  assert.equal(scalaSfocatura({ inizio, nitidoDal }, inizio - 5000), min);
  assert.equal(scalaSfocatura({ inizio, nitidoDal }, inizio), min);
  const meta = scalaSfocatura({ inizio, nitidoDal }, inizio + 1500);
  assert.ok(meta > min && meta < 1);
  assert.ok(scalaSfocatura({ inizio, nitidoDal }, inizio + 2500) > meta);
  assert.equal(scalaSfocatura({ inizio, nitidoDal }, nitidoDal), 1);
  assert.equal(scalaSfocatura({ inizio, nitidoDal }, nitidoDal + 5000), 1);
  assert.equal(scalaSfocatura({ inizio: "x", nitidoDal: null }, 1e12), min);
});

test("tempo: secondi sull'ora del server, sfocato fino a nitidoDal, finito a 10 secondi", () => {
  const vista = { fase: "in_corso", inizio: 50_000, nitidoDal: 53_000, fine: 60_000, ora: 50_000 };
  // Il telefono è 2 minuti avanti: conta l'ora del server.
  const t = tempoSvelamento(vista, 50_000 + 120_000, 120_000);
  assert.deepEqual(t, { fase: "in_corso", secondi: 10, sfocato: true, finito: false });
  assert.deepEqual(tempoSvelamento(vista, 54_500 + 120_000, 120_000), { fase: "in_corso", secondi: 6, sfocato: false, finito: false });
  assert.deepEqual(tempoSvelamento(vista, 60_000 + 120_000, 120_000), { fase: "finito", secondi: 0, sfocato: false, finito: true });
  assert.deepEqual(tempoSvelamento({ fase: "attesa", ora: 1 }, 5, 0), { fase: "attesa", secondi: 10, sfocato: true, finito: false });
  assert.deepEqual(tempoSvelamento({ fase: "finito" }, 5, 0), { fase: "finito", secondi: 0, sfocato: false, finito: true });
  assert.equal(tempoSvelamento(null, 5, 0).fase, "attesa");
});

test("filigrana: nome di chi guarda e data italiana", () => {
  assert.equal(filigrana("Giulia", new Date(Date.UTC(2026, 10, 22, 20, 30))), "Giulia · 22/11/2026");
  assert.equal(filigrana("  ", new Date(Date.UTC(2026, 10, 22, 23, 30))), "Presente! · 23/11/2026");
  assert.equal(filigrana("Lu<b>", new Date(Date.UTC(2026, 0, 2))), "Lu<b> · 02/01/2026");
});

// Tela finta: registra le dimensioni di ogni disegno.
function finteTele() {
  const disegni = [];
  const tela = (nome) => {
    const c = { nome, width: 0, height: 0 };
    c.getContext = () => ({
      imageSmoothingEnabled: false,
      drawImage(src, x, y, w, h) { disegni.push({ su: nome, w, h, liscio: this.imageSmoothingEnabled }); },
    });
    c.captureStream = (fps) => ({ fps, getVideoTracks: () => [{ kind: "video", stop() { c.ferma = true; } }], getTracks() { return this.getVideoTracks(); } });
    return c;
  };
  return { disegni, creaTela: (() => { let n = 0; return () => tela(n++ ? "uscita" : "piccola"); })() };
}

test("sfocatore: disegna piccolo e ingrandisce (sfocato), poi a piena grandezza; si ferma", () => {
  const { disegni, creaTela } = finteTele();
  let ora = 0;
  let giro = null;
  const s = creaSfocatore({ creaTela, adesso: () => ora, ogni: (fn) => { giro = fn; return 7; }, ferma: (id) => { assert.equal(id, 7); giro = null; } });
  const sorgente = { videoWidth: 640, videoHeight: 480 };
  const traccia = s.avvia(sorgente);
  assert.equal(traccia.kind, "video");
  giro();
  const piccolo = disegni.find((d) => d.su === "piccola");
  assert.ok(piccolo.w <= 32, "nei primi istanti l'immagine è molto rimpicciolita");
  assert.ok(disegni.some((d) => d.su === "uscita" && d.w === 640 && d.liscio === true));
  disegni.length = 0;
  s.nitido({ inizio: 0, nitidoDal: 3000 });
  ora = 3000;
  giro();
  assert.ok(disegni.every((d) => d.su === "uscita" && d.w === 640), "da nitidoDal si disegna a piena grandezza");
  s.ferma();
  assert.equal(giro, null);
});

// Browser finto per la connessione.
function finto({ negato = false, sdpOfferta = OFFERTA, sdpRisposta = RICEZIONE } = {}) {
  const fermate = [];
  const traccia = (kind) => ({ kind, enabled: true, stop() { fermate.push(kind); } });
  const flusso = { a: traccia("audio"), v: traccia("video") };
  const camera = {
    getAudioTracks: () => [flusso.a], getVideoTracks: () => [flusso.v], getTracks: () => [flusso.a, flusso.v],
  };
  const chiesti = [];
  const pcs = [];
  class PC {
    constructor(conf) { this.conf = conf; this.trans = []; this.chiusa = false; pcs.push(this); }
    addTransceiver(t, o) { this.trans.push({ kind: t.kind, dir: o.direction }); }
    async createOffer() { return { type: "offer", sdp: sdpOfferta }; }
    async createAnswer() { return { type: "answer", sdp: sdpRisposta }; }
    async setLocalDescription(d) { this.localDescription = d; }
    async setRemoteDescription(d) { this.remote = d; }
    close() { this.chiusa = true; }
  }
  const usciteFerme = [];
  const sfocatore = {
    avvia: () => ({ kind: "video", enabled: true, stop() { usciteFerme.push("uscita"); } }),
    nitido: (v) => { sfocatore.vista = v; },
    ferma: () => { usciteFerme.push("sfocatore"); },
  };
  const schermo = { srcObject: "x", play: async () => {} };
  return {
    fermate, chiesti, pcs, usciteFerme, sfocatore, schermo, camera,
    getUserMedia: async (v) => { chiesti.push(v); if (negato) { const e = new Error("no"); e.name = "NotAllowedError"; throw e; } return camera; },
    PC,
  };
}

test("video: voce e video sfocato in uscita (sendonly), mai la fotocamera grezza", async () => {
  const b = finto();
  const v = creaVideoSvelamento({ getUserMedia: b.getUserMedia, RTCPeerConnection: b.PC, sfocatore: b.sfocatore, schermo: b.schermo });
  const r = await v.parti();
  assert.deepEqual(r, { ok: true, offerta: { type: "offer", sdp: OFFERTA } });
  assert.deepEqual(b.chiesti, [VINCOLI_VIDEO]);
  assert.deepEqual(b.pcs[0].trans, [{ kind: "audio", dir: "sendonly" }, { kind: "video", dir: "sendonly" }]);
  assert.deepEqual((await v.risposta({ type: "answer", sdp: OFFERTA })), { ok: true });
  const a = await v.ricevi({ type: "offer", sdp: RICEZIONE });
  assert.deepEqual(a, { ok: true, risposta: { type: "answer", sdp: RICEZIONE } });
});

test("video: rifiuta descrizioni con canali dati o senza video prima di toccare la connessione", async () => {
  const b = finto({ sdpOfferta: CON_DATI });
  const v = creaVideoSvelamento({ getUserMedia: b.getUserMedia, RTCPeerConnection: b.PC, sfocatore: b.sfocatore, schermo: b.schermo });
  assert.equal((await v.parti()).motivo, "svelamento");
  const b2 = finto();
  const v2 = creaVideoSvelamento({ getUserMedia: b2.getUserMedia, RTCPeerConnection: b2.PC, sfocatore: b2.sfocatore, schermo: b2.schermo });
  await v2.parti();
  assert.equal((await v2.ricevi({ type: "offer", sdp: CON_DATI })).motivo, "svelamento");
  assert.equal(b2.pcs[0].remote, undefined);
});

test("video: fotocamera negata → motivo «fotocamera_negata», nessuna connessione", async () => {
  const b = finto({ negato: true });
  const v = creaVideoSvelamento({ getUserMedia: b.getUserMedia, RTCPeerConnection: b.PC, sfocatore: b.sfocatore, schermo: b.schermo });
  assert.deepEqual(await v.parti(), { ok: false, motivo: "fotocamera_negata" });
  assert.equal(b.pcs.length, 0);
});

test("video: microfono on/off, chiudi spegne tutto e svuota lo schermo", async () => {
  const b = finto();
  const v = creaVideoSvelamento({ getUserMedia: b.getUserMedia, RTCPeerConnection: b.PC, sfocatore: b.sfocatore, schermo: b.schermo });
  await v.parti();
  v.muto(true);
  assert.equal(b.camera.getAudioTracks()[0].enabled, false);
  v.muto(false);
  assert.equal(b.camera.getAudioTracks()[0].enabled, true);
  v.nitido({ inizio: 1, nitidoDal: 2 });
  assert.deepEqual(b.sfocatore.vista, { inizio: 1, nitidoDal: 2 });
  v.chiudi();
  assert.deepEqual(b.fermate.sort(), ["audio", "video"]);
  assert.ok(b.usciteFerme.includes("sfocatore") && b.usciteFerme.includes("uscita"));
  assert.equal(b.pcs[0].chiusa, true);
  assert.equal(b.schermo.srcObject, null);
});

test("video: «Riprova» apre una connessione nuova con la stessa fotocamera", async () => {
  const b = finto();
  const v = creaVideoSvelamento({ getUserMedia: b.getUserMedia, RTCPeerConnection: b.PC, sfocatore: b.sfocatore, schermo: b.schermo });
  await v.parti();
  const r = await v.riparti();
  assert.equal(r.ok, true);
  assert.equal(b.chiesti.length, 1);
  assert.equal(b.pcs.length, 2);
  assert.equal(b.pcs[0].chiusa, true);
});

// Client delle richieste: fetch finto che risponde come il Worker.
function server(risposte) {
  const chiamate = [];
  const f = async (url, o) => {
    const corpo = JSON.parse(o.body);
    chiamate.push(corpo);
    const r = risposte[corpo.azione];
    return { status: 200, json: async () => (typeof r === "function" ? r(corpo) : r) };
  };
  return { f, chiamate };
}

test("client: entra, pubblica, ricevi, conferma, vista verso /app/api/svelamento", async () => {
  const vista = { fase: "attesa", ora: 1 };
  const s = server({
    entra: { ok: true, esito: "iniziato", tipo: "video" },
    pubblica: { ok: true, descrizione: { type: "answer", sdp: OFFERTA }, vista },
    ricevi: { ok: true, descrizione: { type: "offer", sdp: RICEZIONE }, vista },
    conferma: { ok: true, vista },
    vista: { ok: true, vista },
  });
  const sv = creaSvelamento({ token: () => "t", fetch: s.f });
  assert.deepEqual(await sv.entra(PORTA), { ok: true, esito: "iniziato", tipo: "video" });
  assert.deepEqual(await sv.pubblica(PORTA, { type: "offer", sdp: OFFERTA }), { ok: true, descrizione: { type: "answer", sdp: OFFERTA }, vista });
  assert.equal((await sv.ricevi(PORTA)).descrizione.type, "offer");
  assert.deepEqual(await sv.conferma(PORTA, { type: "answer", sdp: RICEZIONE }), { ok: true, vista });
  assert.deepEqual(await sv.vistaVideo(PORTA), { ok: true, vista });
  assert.deepEqual(s.chiamate.map((c) => c.azione), ["entra", "pubblica", "ricevi", "conferma", "vista"]);
  assert.ok(s.chiamate.every((c) => c.porta === PORTA && !("persona" in c)));
  assert.equal((await sv.entra("non-uuid")).ok, false);
});

test("collega: pubblica → risposta di Cloudflare; ricevi → conferma; se il server dice no la fotocamera si spegne", async () => {
  const b = finto();
  const v = creaVideoSvelamento({ getUserMedia: b.getUserMedia, RTCPeerConnection: b.PC, sfocatore: b.sfocatore, schermo: b.schermo });
  const vista = { fase: "attesa", ora: 1 };
  const s = server({
    pubblica: { ok: true, descrizione: { type: "answer", sdp: OFFERTA }, vista },
    ricevi: { ok: true, descrizione: { type: "offer", sdp: RICEZIONE }, vista },
    conferma: { ok: true, vista: { fase: "in_corso", inizio: 5, nitidoDal: 3005, fine: 10005, ora: 5 } },
  });
  const c = collegaVideo({ svelamento: creaSvelamento({ token: () => "t", fetch: s.f }), video: v, porta: PORTA });
  assert.deepEqual(await c.pubblica(), { ok: true, vista });
  const r = await c.ricevi();
  assert.equal(r.ok, true);
  assert.equal(r.vista.fase, "in_corso");
  assert.deepEqual(b.sfocatore.vista, r.vista, "lo sfocatore segue l'inizio dato dal server");

  const b2 = finto();
  const v2 = creaVideoSvelamento({ getUserMedia: b2.getUserMedia, RTCPeerConnection: b2.PC, sfocatore: b2.sfocatore, schermo: b2.schermo });
  const s2 = server({ pubblica: { ok: false, motivo: "non_iniziato" } });
  const c2 = collegaVideo({ svelamento: creaSvelamento({ token: () => "t", fetch: s2.f }), video: v2, porta: PORTA });
  assert.equal((await c2.pubblica()).ok, false);
  assert.deepEqual(b2.fermate.sort(), ["audio", "video"]);
});

test("testi: quelli della spec", () => {
  assert.equal(TESTI_VIDEO.aspetta, "Aspettiamo <nome>…");
  assert.equal(TESTI_VIDEO.ecco, "Ecco <nome>.");
  assert.equal(TESTI_VIDEO.caduta, "La connessione è caduta.");
  assert.equal(TESTI_VIDEO.chiudiSegnala, "Chiudi e segnala");
});

test("testi uguali a quelli del server", async () => {
  const { TESTI_SVELAMENTO } = await import("../api/svelamento.js");
  for (const k of ["aspetta", "ecco", "caduta"]) assert.equal(TESTI_VIDEO[k], TESTI_SVELAMENTO[k]);
});
