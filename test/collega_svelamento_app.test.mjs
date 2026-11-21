// Issue #65, passo 7d-3b-2 (spec v1 del CPO, passo 6 e casi limite; D48 A): il video dello svelamento collegato alla
// web app. fabbricaSchermata unisce fotocamera, sfocatore, connessione e schermata per UNA porta; «Chiudi e segnala»
// apre il modulo della #7 contro l'altra persona (segnalaDaPorta). Browser finto, server finto, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fabbricaSchermata } from "../landing/app/moduli/schermata_svelamento.js";
import { segnalaDaPorta } from "../landing/app/moduli/svelamento.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ALTRA = "11111111-2222-4333-8444-555555555555";
const OFFERTA = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:1\r\n";
const attesa = () => new Promise((x) => setImmediate(x));

function browser({ negato = false } = {}) {
  const pcs = [];
  const traccia = (kind) => ({ kind, enabled: true, stop() {} });
  const camera = { getAudioTracks: () => [traccia("audio")], getVideoTracks: () => [traccia("video")], getTracks() { return [...this.getAudioTracks(), ...this.getVideoTracks()]; } };
  class PC {
    constructor() { this.connectionState = "new"; pcs.push(this); }
    addTransceiver() {}
    async createOffer() { return { type: "offer", sdp: OFFERTA }; }
    async setLocalDescription(d) { this.localDescription = d; }
    async setRemoteDescription(d) { this.remote = d; }
    close() { this.chiusa = true; }
  }
  const tela = () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }),
    captureStream: () => ({ getVideoTracks: () => [traccia("video")] }) });
  return {
    pcs, PC, creaTela: tela,
    getUserMedia: async () => { if (negato) { const e = new Error("no"); e.name = "NotAllowedError"; throw e; } return camera; },
  };
}

function server() {
  const azioni = [];
  return {
    azioni,
    pubblica: async (porta, offerta) => { azioni.push(["pubblica", porta, offerta.type]); return { ok: true, descrizione: { type: "answer", sdp: OFFERTA }, vista: { fase: "attesa", ora: Date.now() } }; },
    ricevi: async (porta) => { azioni.push(["ricevi", porta]); return { ok: false, motivo: "in_attesa" }; },
    conferma: async () => ({ ok: true, vista: null }),
    vistaVideo: async () => ({ ok: true, vista: { fase: "attesa", ora: Date.now() } }),
  };
}

function fabbrica(b, sv, eventi = []) {
  return fabbricaSchermata({ svelamento: sv, getUserMedia: b.getUserMedia, RTCPeerConnection: b.PC, MediaStream: null,
    creaTela: b.creaTela, sorgente: { srcObject: null, play: async () => {} }, schermo: { srcObject: null, play: async () => {} },
    nomeMio: () => "Luca", ogni: () => 1, ferma: () => {}, aggiorna: () => eventi.push("aggiorna") });
}

test("fabbrica: apre la schermata della porta, pubblica col proprio video e aspetta l'altra persona", async () => {
  const b = browser();
  const sv = server();
  const s = fabbrica(b, sv)(PORTA, { nome: "Giulia" });
  assert.equal(s.nome(), "Giulia");
  assert.match(s.filigrana(), /^Luca · /);
  await s.apri();
  assert.deepEqual(sv.azioni[0], ["pubblica", PORTA, "offer"]);
  assert.equal(s.modello().stato, "aspetta");
});

test("fabbrica: la connessione che cade porta la schermata in «La connessione è caduta.»", async () => {
  const b = browser();
  const s = fabbrica(b, server())(PORTA, { nome: "Giulia" });
  await s.apri();
  const pc = b.pcs.at(-1);
  pc.connectionState = "failed";
  pc.onconnectionstatechange();
  assert.equal(s.modello().stato, "caduta");
});

test("fabbrica: fotocamera negata → esce con «fotocamera» e lo dice alla porta", async () => {
  const motivi = [];
  const s = fabbrica(browser({ negato: true }), server())(PORTA, { nome: "Giulia", quandoEsci: (m) => motivi.push(m) });
  await s.apri();
  await attesa();
  assert.deepEqual(motivi, ["fotocamera"]);
  assert.equal(s.modello().stato, "uscita");
});

test("segnalaDaPorta: modulo della #7 con origine «chiudi_e_segnala», senza ora di chiamata; null senza persona valida", () => {
  assert.deepEqual(segnalaDaPorta({ contro: ALTRA, origine: "chiudi_e_segnala", nome: "Giulia" }),
    { segnala: { contro: ALTRA, origine: "chiudi_e_segnala", chiamataIl: null }, nome: "Giulia", schermo: { titolo: "Segnala" } });
  assert.equal(segnalaDaPorta(null), null);
  assert.equal(segnalaDaPorta({ contro: "x", origine: "chiudi_e_segnala" }), null);
});

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("avvio: la porta riceve la fabbrica del video, con uno schermo che suona e una sorgente muta fuori da #app", () => {
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /fabbricaSchermata\(\{/);
  assert.match(avvio, /video: fabbricaSchermata\(/);
  assert.match(avvio, /nomeMio: \(\) => nomeMio\(\)/);
  assert.match(avvio, /RTCPeerConnection: window\.RTCPeerConnection/);
  assert.match(avvio, /aggiorna: \(\) => portaCambiata\(\)/);
});

test("flusso: dopo «Chiudi e segnala» la pagina mostra il modulo della segnalazione e al ritorno chiude la porta", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /segnalaDaPorta\(portaSvelamento\.modello\(\)\.segnala\)/);
  assert.match(flusso, /portaSvelamento\.fineSegnala\(\)/);
  assert.match(flusso, /export const nomeMio = /);
  // Il modulo della segnalazione viene prima della schermata della porta.
  assert.ok(flusso.indexOf("schermoSegnalaPorta()") < flusso.indexOf("radice.replaceChildren(vistaPorta(h, portaSvelamento))"));
});
