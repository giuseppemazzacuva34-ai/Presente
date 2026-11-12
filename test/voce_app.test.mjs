// Voce nel browser (issue #4, passo 3c-2): microfono solo audio e collegamento WebRTC a Cloudflare Realtime.
// Browser finto: nessun microfono vero, nessuna rete, nessun audio. Le chiamate non si registrano: il modulo non
// deve mai usare MediaRecorder né salvare l'audio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaVoce, collegaVoce, motivoMicrofono, offertaSoloVoce, ICE } from "../landing/app/moduli/voce.js";

const SDP_VOCE = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=sendonly\r\n";
const SDP_DUE_VOCI = SDP_VOCE + "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:1\r\na=recvonly\r\n";

function browserFinto({ negato = null } = {}) {
  const log = { connessioni: [], richieste: [], tracceFermate: 0 };
  const traccia = { kind: "audio", enabled: true, stop() { log.tracceFermate++; } };
  const flusso = { getTracks: () => [traccia], getAudioTracks: () => [traccia] };
  class PC {
    constructor(config) {
      this.config = config; this.transceivers = []; this.locale = null; this.remota = null; this.chiusa = false;
      this.connectionState = "new"; log.connessioni.push(this);
    }
    addTransceiver(t, o) { this.transceivers.push({ t, o }); }
    async createOffer() { return { type: "offer", sdp: SDP_VOCE }; }
    async createAnswer() { return { type: "answer", sdp: SDP_DUE_VOCI.replace("a=recvonly", "a=recvonly") }; }
    async setLocalDescription(d) { this.locale = d; }
    get localDescription() { return this.locale; }
    async setRemoteDescription(d) { this.remota = d; }
    close() { this.chiusa = true; this.connectionState = "closed"; }
    stato(s) { this.connectionState = s; this.onconnectionstatechange?.(); }
    arriva() { this.ontrack?.({ track: { kind: "audio" }, streams: [{ id: "voce-altra" }] }); }
  }
  const getUserMedia = async (vincoli) => {
    log.richieste.push(vincoli);
    if (negato) { const e = new Error("no"); e.name = negato; throw e; }
    return flusso;
  };
  const altoparlante = { srcObject: null, played: 0, play() { this.played++; return Promise.resolve(); } };
  return { log, traccia, getUserMedia, RTCPeerConnection: PC, altoparlante };
}

test("parti: chiede SOLO il microfono (mai la fotocamera) e crea un'offerta di una sola voce", async () => {
  const b = browserFinto();
  const voce = creaVoce(b);
  const r = await voce.parti();
  assert.deepEqual(r, { ok: true, offerta: SDP_VOCE });
  assert.equal(b.log.richieste.length, 1);
  assert.equal(b.log.richieste[0].video, false);
  assert.equal(typeof b.log.richieste[0].audio, "object");
  const pc = b.log.connessioni[0];
  assert.deepEqual(pc.config.iceServers, ICE);
  assert.equal(pc.config.bundlePolicy, "max-bundle");
  assert.equal(pc.transceivers.length, 1);
  assert.equal(pc.transceivers[0].o.direction, "sendonly");
});

test("parti: microfono negato o assente → motivo chiaro, nessuna connessione aperta", async () => {
  for (const [nome, motivo] of [["NotAllowedError", "microfono_negato"], ["NotFoundError", "microfono_assente"], ["Boh", "microfono"]]) {
    const b = browserFinto({ negato: nome });
    const r = await creaVoce(b).parti();
    assert.deepEqual(r, { ok: false, motivo });
    assert.equal(b.log.connessioni.length, 0);
  }
  assert.equal(motivoMicrofono({ name: "SecurityError" }), "microfono_negato");
  const senza = creaVoce({ ...browserFinto(), getUserMedia: undefined });
  assert.deepEqual(await senza.parti(), { ok: false, motivo: "microfono_assente" });
});

test("risposta e ascolto: la voce dell'altra persona va all'altoparlante; risposta solo audio", async () => {
  const b = browserFinto();
  const voce = creaVoce(b);
  await voce.parti();
  assert.deepEqual(await voce.risposta(SDP_VOCE), { ok: true });
  const pc = b.log.connessioni[0];
  assert.deepEqual(pc.remota, { type: "answer", sdp: SDP_VOCE });
  const r = await voce.ascolta(SDP_DUE_VOCI);
  assert.equal(r.ok, true);
  assert.equal(typeof r.risposta, "string");
  assert.deepEqual(pc.remota, { type: "offer", sdp: SDP_DUE_VOCI });
  pc.arriva();
  assert.deepEqual(b.altoparlante.srcObject, { id: "voce-altra" });
  assert.equal(b.altoparlante.played, 1);
});

test("solo voce: un SDP con video o canali dati viene rifiutato prima di toccare la connessione", async () => {
  assert.equal(offertaSoloVoce(SDP_VOCE), true);
  assert.equal(offertaSoloVoce(SDP_DUE_VOCI), true);
  assert.equal(offertaSoloVoce(SDP_VOCE + "m=video 9 UDP/TLS/RTP/SAVPF 96\r\n"), false);
  assert.equal(offertaSoloVoce(SDP_VOCE + "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n"), false);
  assert.equal(offertaSoloVoce("v=0\r\n"), false);
  assert.equal(offertaSoloVoce(42), false);
  const b = browserFinto();
  const voce = creaVoce(b);
  await voce.parti();
  const pc = b.log.connessioni[0];
  assert.deepEqual(await voce.ascolta(SDP_VOCE + "m=video 9 UDP/TLS/RTP/SAVPF 96\r\n"), { ok: false, motivo: "solo_voce" });
  assert.deepEqual(await voce.risposta("m=video 9 x\r\n"), { ok: false, motivo: "solo_voce" });
  assert.equal(pc.remota, null);
});

test("muto e chiudi: muto spegne la traccia; chiudi ferma il microfono e la connessione", async () => {
  const b = browserFinto();
  const voce = creaVoce(b);
  await voce.parti();
  voce.muto(true);
  assert.equal(b.traccia.enabled, false);
  voce.muto(false);
  assert.equal(b.traccia.enabled, true);
  voce.chiudi();
  assert.equal(b.log.tracceFermate, 1);
  assert.equal(b.log.connessioni[0].chiusa, true);
  assert.equal(b.altoparlante.srcObject, null);
  voce.chiudi(); // due volte non rompe nulla
});

test("caduta: connessione «failed» o «disconnected» avvisa una volta; riparti usa lo stesso microfono", async () => {
  const b = browserFinto();
  const cadute = [];
  const voce = creaVoce({ ...b, quandoCade: () => cadute.push(1) });
  await voce.parti();
  const pc = b.log.connessioni[0];
  pc.stato("connected");
  pc.stato("disconnected");
  pc.stato("failed");
  assert.equal(cadute.length, 1);
  const r = await voce.riparti();
  assert.equal(r.ok, true);
  assert.equal(b.log.richieste.length, 1); // niente seconda richiesta del microfono
  assert.equal(pc.chiusa, true);
  assert.equal(b.log.connessioni.length, 2);
  b.log.connessioni[1].stato("failed");
  assert.equal(cadute.length, 2);
});

test("collegaVoce: chiama, rispondi, ascolta e riconnetti parlano con il server nell'ordine giusto", async () => {
  const b = browserFinto();
  const voce = creaVoce(b);
  const passi = [];
  const server = {
    apri: async (verso, offerta) => { passi.push(["apri", verso, offerta === SDP_VOCE]); return { ok: true, descrizione: SDP_VOCE, vista: { stato: "squilla" } }; },
    rispondi: async (offerta) => { passi.push(["rispondi", offerta === SDP_VOCE]); return { ok: true, descrizione: SDP_VOCE, vista: { stato: "in_corso" } }; },
    ascolta: async () => { passi.push(["ascolta"]); return { ok: true, descrizione: SDP_DUE_VOCI, vista: { stato: "in_corso" } }; },
    conferma: async (risposta) => { passi.push(["conferma", typeof risposta]); return { ok: true, vista: { stato: "in_corso" } }; },
    rientro: async (offerta) => { passi.push(["rientro", offerta === SDP_VOCE]); return { ok: true, descrizione: SDP_VOCE, vista: { stato: "in_corso" } }; },
    caduta: async () => { passi.push(["caduta"]); return { ok: true, vista: null }; },
    chiudi: async () => { passi.push(["chiudi"]); return { ok: true, vista: null }; },
  };
  const c = collegaVoce({ chiamata: server, voce });
  assert.deepEqual(await c.chiama("id-altra"), { ok: true, vista: { stato: "squilla" } });
  assert.deepEqual(await c.ascolta(), { ok: true, vista: { stato: "in_corso" } });
  assert.deepEqual(await c.riconnetti(), { ok: true, vista: { stato: "in_corso" } });
  assert.deepEqual(passi, [["apri", "id-altra", true], ["ascolta"], ["conferma", "string"], ["rientro", true]]);
  const r2 = collegaVoce({ chiamata: server, voce: creaVoce(browserFinto()) });
  assert.deepEqual(await r2.rispondi(), { ok: true, vista: { stato: "in_corso" } });
});

test("collegaVoce: se il server dice no, il microfono si spegne e il motivo arriva all'app", async () => {
  const b = browserFinto();
  const voce = creaVoce(b);
  const c = collegaVoce({ chiamata: { apri: async () => ({ ok: false, motivo: "fascia" }) }, voce });
  assert.deepEqual(await c.chiama("x"), { ok: false, motivo: "fascia" });
  assert.equal(b.log.tracceFermate, 1);
  const neg = collegaVoce({ chiamata: { apri: async () => assert.fail("non deve chiamare il server") }, voce: creaVoce(browserFinto({ negato: "NotAllowedError" })) });
  assert.deepEqual(await neg.chiama("x"), { ok: false, motivo: "microfono_negato" });
});

test("il modulo non registra: niente MediaRecorder, niente salvataggi dell'audio, niente fotocamera", () => {
  const codice = readFileSync(new URL("../landing/app/moduli/voce.js", import.meta.url), "utf8");
  for (const vietato of ["MediaRecorder", "localStorage", "indexedDB", "AudioWorklet", "video: true", "getDisplayMedia"]) {
    assert.equal(codice.includes(vietato), false, vietato);
  }
});
