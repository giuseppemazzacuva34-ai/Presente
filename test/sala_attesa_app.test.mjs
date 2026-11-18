// Issue #65, passo 6b (spec v1 del CPO, passo 5 «Sala d'attesa», passo 7 e casi limite sulla fotocamera; D48 A).
// Prima di entrare: avviso da confermare, poi anteprima della propria fotocamera, solo frontale, sfocata. Se lo
// svelamento sarà con le foto (tipo dal server, passo 6a) la fotocamera non si accende mai. Fotocamera negata o assente:
// «Non vediamo la tua fotocamera.» con «Riprova» e «Passa alle foto». h finto, fotocamera finta, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_SALA, VINCOLI_SALA, creaSalaAttesa, vistaSala } from "../landing/app/moduli/sala_attesa.js";
import { schermataPorta, creaPortaSvelamento, vistaPorta } from "../landing/app/moduli/svelamento.js";

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" && n.f ? n.f.map(testo).join("") : typeof n === "object" ? "" : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object" && n.f) { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];
const bottoni = (n) => tutti(n, (x) => x.tag === "button").map(testo);

function fotocameraFinta({ errore = null, conAudio = false } = {}) {
  const chiamate = [];
  const tracce = [];
  const traccia = (kind) => { const t = { kind, ferma: false, stop() { this.ferma = true; } }; tracce.push(t); return t; };
  const getUserMedia = async (vincoli) => {
    chiamate.push(vincoli);
    if (errore) { const e = new Error("no"); e.name = errore; throw e; }
    const lista = [traccia("video"), ...(conAudio ? [traccia("audio")] : [])];
    return { getTracks: () => lista, getAudioTracks: () => lista.filter((t) => t.kind === "audio") };
  };
  return { getUserMedia, chiamate, tracce };
}
const schermoFinto = () => ({ srcObject: null });

test("vincoli: solo video dalla fotocamera frontale, niente microfono in sala d'attesa", () => {
  assert.deepEqual(VINCOLI_SALA, { audio: false, video: { facingMode: "user" } });
});

test("video: prima l'avviso da confermare, la fotocamera non si accende prima del «Ho capito»", async () => {
  const cam = fotocameraFinta();
  const sala = creaSalaAttesa({ getUserMedia: cam.getUserMedia, schermo: schermoFinto() });
  sala.apri({ tipo: "video" });
  assert.equal(sala.modello().stato, "avviso");
  assert.equal(cam.chiamate.length, 0);
  const v = vistaSala(h, sala);
  assert.match(testo(v), /Lo svelamento non viene registrato\. Non fare screenshot: sul video compare il tuo nome\. Rispetta le regole della community\./);
  assert.ok(bottone(v, TESTI_SALA.capito));
});

test("dopo «Ho capito»: anteprima sfocata della propria fotocamera, senza pulsante per cambiarla", async () => {
  const cam = fotocameraFinta();
  const schermo = schermoFinto();
  const sala = creaSalaAttesa({ getUserMedia: cam.getUserMedia, schermo });
  sala.apri({ tipo: "video" });
  await sala.conferma();
  assert.equal(sala.modello().stato, "anteprima");
  assert.deepEqual(cam.chiamate, [VINCOLI_SALA]);
  assert.ok(schermo.srcObject);
  const v = vistaSala(h, sala);
  assert.ok(tutti(v, (x) => x === schermo || (x.f && x.f.includes(schermo))).length, "lo schermo è nella vista");
  assert.match(testo(v), new RegExp(TESTI_SALA.anteprima));
  assert.ok(!bottoni(v).some((b) => /cambia|gira|posteriore/i.test(b)), "nessun cambio di fotocamera");
});

test("se il browser dà anche l'audio, la traccia audio si ferma subito", async () => {
  const cam = fotocameraFinta({ conAudio: true });
  const sala = creaSalaAttesa({ getUserMedia: cam.getUserMedia, schermo: schermoFinto() });
  sala.apri({ tipo: "video" });
  await sala.conferma();
  assert.equal(cam.tracce.find((t) => t.kind === "audio").ferma, true);
  assert.equal(cam.tracce.find((t) => t.kind === "video").ferma, false);
});

test("foto: la fotocamera non si accende mai, nemmeno con «Ho capito»", async () => {
  const cam = fotocameraFinta();
  const sala = creaSalaAttesa({ getUserMedia: cam.getUserMedia, schermo: schermoFinto() });
  sala.apri({ tipo: "foto" });
  assert.equal(sala.modello().stato, "foto");
  await sala.conferma();
  assert.equal(cam.chiamate.length, 0);
  assert.match(testo(vistaSala(h, sala)), /Lo svelamento sarà con le foto\./);
});

test("tipo sconosciuto o assente: niente sala e niente fotocamera", async () => {
  const cam = fotocameraFinta();
  const sala = creaSalaAttesa({ getUserMedia: cam.getUserMedia, schermo: schermoFinto() });
  for (const tipo of [null, undefined, "strano"]) {
    sala.apri({ tipo });
    await sala.conferma();
    assert.equal(sala.modello().stato, "chiusa");
  }
  assert.equal(cam.chiamate.length, 0);
});

test("fotocamera negata o assente: «Non vediamo la tua fotocamera.» con «Riprova» e «Passa alle foto»", async () => {
  for (const errore of ["NotAllowedError", "NotFoundError", "OverconstrainedError"]) {
    const cam = fotocameraFinta({ errore });
    const sala = creaSalaAttesa({ getUserMedia: cam.getUserMedia, schermo: schermoFinto() });
    sala.apri({ tipo: "video" });
    await sala.conferma();
    assert.equal(sala.modello().stato, "senza_fotocamera", errore);
    const v = vistaSala(h, sala);
    assert.match(testo(v), /Non vediamo la tua fotocamera\./);
    assert.ok(bottone(v, TESTI_SALA.riprova) && bottone(v, TESTI_SALA.passaFoto));
  }
  const sala = creaSalaAttesa({ getUserMedia: undefined, schermo: schermoFinto() });
  sala.apri({ tipo: "video" });
  await sala.conferma();
  assert.equal(sala.modello().stato, "senza_fotocamera");
});

test("«Riprova» richiede di nuovo la fotocamera", async () => {
  let nega = true;
  const cam = fotocameraFinta();
  const getUserMedia = async (v) => { if (nega) { nega = false; const e = new Error(); e.name = "NotAllowedError"; throw e; } return cam.getUserMedia(v); };
  const sala = creaSalaAttesa({ getUserMedia, schermo: schermoFinto() });
  sala.apri({ tipo: "video" });
  await sala.conferma();
  assert.equal(sala.modello().stato, "senza_fotocamera");
  await sala.riprova();
  assert.equal(sala.modello().stato, "anteprima");
});

test("«Passa alle foto»: ferma la fotocamera, sceglie le foto sul server e mostra il testo delle foto", async () => {
  const cam = fotocameraFinta();
  const schermo = schermoFinto();
  const scelte = [];
  const sala = creaSalaAttesa({ getUserMedia: cam.getUserMedia, schermo, passaAlleFoto: async () => { scelte.push("foto"); return { ok: true }; } });
  sala.apri({ tipo: "video" });
  await sala.conferma();
  await sala.passaFoto();
  assert.deepEqual(scelte, ["foto"]);
  assert.ok(cam.tracce.every((t) => t.ferma));
  assert.equal(schermo.srcObject, null);
  assert.equal(sala.modello().stato, "foto");
});

test("«Passa alle foto» rifiutato dal server: resta senza fotocamera e mostra l'errore", async () => {
  const cam = fotocameraFinta({ errore: "NotAllowedError" });
  const sala = creaSalaAttesa({ getUserMedia: cam.getUserMedia, schermo: schermoFinto(),
    passaAlleFoto: async () => ({ ok: false, testo: "Lo svelamento è già iniziato: la scelta non si può più cambiare." }) });
  sala.apri({ tipo: "video" });
  await sala.conferma();
  await sala.passaFoto();
  assert.equal(sala.modello().stato, "senza_fotocamera");
  assert.match(testo(vistaSala(h, sala)), /già iniziato/);
});

test("se il tipo diventa «foto» mentre l'anteprima è accesa, la fotocamera si spegne", async () => {
  const cam = fotocameraFinta();
  const sala = creaSalaAttesa({ getUserMedia: cam.getUserMedia, schermo: schermoFinto() });
  sala.apri({ tipo: "video" });
  await sala.conferma();
  sala.aggiornaTipo("foto");
  assert.ok(cam.tracce.every((t) => t.ferma));
  assert.equal(sala.modello().stato, "foto");
});

test("chiudi: ferma la fotocamera; una risposta arrivata dopo la chiusura viene fermata subito", async () => {
  const cam = fotocameraFinta();
  const schermo = schermoFinto();
  let rilascia;
  const lenta = (v) => new Promise((ok) => { rilascia = () => ok(cam.getUserMedia(v)); });
  const sala = creaSalaAttesa({ getUserMedia: lenta, schermo });
  sala.apri({ tipo: "video" });
  const p = sala.conferma();
  sala.chiudi();
  rilascia();
  await p;
  assert.equal(sala.modello().stato, "chiusa");
  assert.ok(cam.tracce.length && cam.tracce.every((t) => t.ferma));
  assert.equal(schermo.srcObject, null);
});

// --- Nella schermata della porta ------------------------------------------------------------------------------------
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ADESSO = new Date("2026-11-16T09:40:00Z");
const porta = (extra = {}) => ({ porta: PORTA, con: "11111111-2222-4333-8444-555555555555", nome: "Giulia", eta: 31,
  aperta_il: "2026-11-15T20:00:00Z", scade_il: "2026-11-17T20:00:00Z", mia_caparra: true, sua_caparra: true, aspetta: null,
  mia_scelta: "video", mie_fasce: [], fascia_fissata: null, mio_pronto: true, suo_pronto: true,
  pronto_scade_il: "2026-11-16T09:44:00Z", pronta: null, momento: false, tipo: null, ...extra });
const stato = (p) => ({ saldo: 0, caparra: 10, beta: true, porte: [p] });

test("schermata della porta: «momento» e «tipo» solo come li dà il server", () => {
  assert.deepEqual(pick(schermataPorta(stato(porta({ momento: true, tipo: "foto" })), PORTA, ADESSO)), { momento: true, tipo: "foto" });
  assert.deepEqual(pick(schermataPorta(stato(porta({ momento: "si", tipo: "video" })), PORTA, ADESSO)), { momento: false, tipo: null });
  assert.deepEqual(pick(schermataPorta(stato(porta({ momento: true, tipo: "strano" })), PORTA, ADESSO)), { momento: true, tipo: null });
});
function pick(s) { return { momento: s.momento, tipo: s.tipoSvelamento }; }

function svelamentoFinto(...letture) {
  const scelte = [];
  return {
    scelte,
    leggi: async () => ({ ok: true, stato: letture.length > 1 ? letture.shift() : letture[0] }),
    scegli: async (id, valore) => { scelte.push([id, valore]); return { ok: true, esito: "salvata", stato: null }; },
  };
}

test("porta: «Vai alla sala d'attesa» solo nel momento; apre la sala col tipo appena riletto dal server", async () => {
  const cam = fotocameraFinta();
  const sv = svelamentoFinto(stato(porta()), stato(porta({ momento: true, tipo: "video" })));
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => ADESSO,
    sala: (passaAlleFoto) => creaSalaAttesa({ getUserMedia: cam.getUserMedia, schermo: schermoFinto(), passaAlleFoto }) });
  await ps.apri(PORTA);
  assert.equal(bottone(vistaPorta(h, ps), TESTI_SALA.vai), undefined);
  await ps.riprova();
  assert.ok(bottone(vistaPorta(h, ps), TESTI_SALA.vai));
  await ps.entraSala();
  const v = vistaPorta(h, ps);
  assert.ok(bottone(v, TESTI_SALA.capito));
  assert.equal(cam.chiamate.length, 0);
});

test("porta: «Passa alle foto» dalla sala sceglie «foto» per questa porta; «Torna alla stanza» spegne la fotocamera", async () => {
  const cam = fotocameraFinta({ errore: "NotAllowedError" });
  const sv = svelamentoFinto(stato(porta({ momento: true, tipo: "video" })));
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => ADESSO,
    sala: (passaAlleFoto) => creaSalaAttesa({ getUserMedia: cam.getUserMedia, schermo: schermoFinto(), passaAlleFoto }) });
  await ps.apri(PORTA);
  await ps.entraSala();
  await ps.sala().conferma();
  await ps.sala().passaFoto();
  assert.deepEqual(sv.scelte, [[PORTA, "foto"]]);

  const cam2 = fotocameraFinta();
  const ps2 = creaPortaSvelamento({ svelamento: svelamentoFinto(stato(porta({ momento: true, tipo: "video" }))), adesso: () => ADESSO,
    sala: (passaAlleFoto) => creaSalaAttesa({ getUserMedia: cam2.getUserMedia, schermo: schermoFinto(), passaAlleFoto }) });
  await ps2.apri(PORTA);
  await ps2.entraSala();
  await ps2.sala().conferma();
  ps2.chiudi();
  assert.ok(cam2.tracce.every((t) => t.ferma));
});

// --- Collegamento nella web app ---------------------------------------------------------------------------------------
import { readFileSync } from "node:fs";
const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("il service worker tiene il modulo, l'avvio crea la sala con la fotocamera e uno schermo muto fuori da #app", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.match(sw, /"\/app\/moduli\/sala_attesa\.js"/);
  assert.ok(!sw.includes('"presente-app-36"'), "versione della cache aumentata");
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /creaSalaAttesa\(/);
  assert.match(avvio, /sala: \(passaAlleFoto, aggiorna\) => creaSalaAttesa\(/);
  assert.match(avvio, /schermo\.muted = true/);
  assert.match(avvio, /setAttribute\("playsinline", ""\)/);
});

test("lo stile sfoca l'anteprima e la specchia, senza nuove risorse esterne", () => {
  const css = leggi("../landing/app/app.css");
  assert.match(css, /\.anteprima-sfocata video \{[^}]*filter: blur\(/);
  assert.doesNotMatch(css, /@import|https?:\/\//);
});
