// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 13a della linea «sviluppatore-c»:
// il modulo del pannello del Filo (le sue stanze, i nomi di battesimo, quando può registrare, il numero delle porte,
// il caricamento del vocale). Parla solo con GET /app/api/filo e POST /app/api/filo/vocale. Rete finta, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { finestraVocale, vociPannelloFilo, controllaVocale, testoErrorePannelloFilo, creaPannelloFilo }
  from "../landing/app/moduli/filo_pannello.js";
import { PERCORSO_FILO } from "../worker/filo_api.js";
import { PERCORSO_FILO_VOCALE } from "../worker/filo_vocale_api.js";

const S1 = "11111111-2222-4333-8444-555555555555";
// Settimana dal lunedì 30/11/2026 9:00 (ora di Roma, UTC+1) a lunedì 7/12 9:00.
const STANZA = { id: S1, nome: "Stanza di prova", apreIl: "2026-11-30T08:00:00Z", chiudeIl: "2026-12-07T08:00:00Z",
  nomi: ["Anna", "Luca", "Sara"], porte: null };
const alle = (iso) => new Date(iso);

test("finestra: lunedì dalle 00:30 alle 8:45 si registra e si rifà il vocale del lunedì (max 90 s)", () => {
  const f = finestraVocale(STANZA, alle("2026-11-29T23:30:00Z")); // lunedì 00:30 a Roma
  assert.equal(f.tipo, "lunedi");
  assert.equal(f.massimo, 90);
  assert.equal(f.nota, "Vocale del lunedì: puoi rifarlo fino alle 8:45.");
  assert.equal(finestraVocale(STANZA, alle("2026-11-30T07:44:00Z")).tipo, "lunedi"); // 8:44
});

test("finestra: lunedì dalle 8:45 alle 13:00 solo se manca, dopo le 13:00 niente", () => {
  const f = finestraVocale(STANZA, alle("2026-11-30T07:46:00Z")); // 8:46
  assert.equal(f.tipo, "lunedi");
  assert.equal(f.nota, "Dopo le 8:45 il vocale del lunedì non si cambia. Se manca, puoi caricarlo fino alle 13:00.");
  assert.equal(finestraVocale(STANZA, alle("2026-11-30T12:00:00Z")).tipo, null); // 13:00
  assert.equal(finestraVocale(STANZA, alle("2026-11-29T23:29:00Z")).tipo, null); // lunedì 00:29
});

test("finestra: da sabato 9:00 a domenica 20:00 il vocale della domenica (max 60 s, senza il numero)", () => {
  assert.equal(finestraVocale(STANZA, alle("2026-12-05T07:59:00Z")).tipo, null); // sabato 8:59
  const f = finestraVocale(STANZA, alle("2026-12-05T08:00:00Z")); // sabato 9:00
  assert.equal(f.tipo, "domenica");
  assert.equal(f.massimo, 60);
  assert.equal(f.nota, "Vocale della domenica: puoi rifarlo fino alle 20:00 di domenica. Non dire il numero delle porte: lo mostra l'app alle 21:00.");
  assert.equal(finestraVocale(STANZA, alle("2026-12-06T18:59:00Z")).tipo, "domenica"); // domenica 19:59
  assert.equal(finestraVocale(STANZA, alle("2026-12-06T19:00:00Z")).tipo, null); // domenica 20:00
});

test("finestra: in mezzo alla settimana nessun vocale, con la prossima finestra scritta", () => {
  const f = finestraVocale(STANZA, alle("2026-12-02T10:00:00Z")); // mercoledì
  assert.equal(f.tipo, null);
  assert.equal(f.massimo, 0);
  assert.equal(f.nota, "Il vocale della domenica si registra da sabato alle 9:00 a domenica alle 20:00.");
});

test("finestra: la domenica del cambio d'ora resta alle 20:00 di Roma", () => {
  // Settimana 22/3/2027 - 29/3/2027: domenica 28/3 alle 3:00 l'ora passa a UTC+2.
  const s = { ...STANZA, apreIl: "2027-03-22T08:00:00Z", chiudeIl: "2027-03-29T07:00:00Z" };
  assert.equal(finestraVocale(s, alle("2027-03-28T17:59:00Z")).tipo, "domenica"); // 19:59 di Roma
  assert.equal(finestraVocale(s, alle("2027-03-28T18:00:00Z")).tipo, null); // 20:00 di Roma
});

test("finestra: dati strani → nessun vocale", () => {
  assert.equal(finestraVocale(null, alle("2026-11-30T07:00:00Z")).tipo, null);
  assert.equal(finestraVocale({ ...STANZA, apreIl: "boh" }, alle("2026-11-30T07:00:00Z")).tipo, null);
});

test("voci: titolo, periodo in ora di Roma, nomi di battesimo e regole; porte solo come numero", () => {
  const [v] = vociPannelloFilo({ ok: true, regole: "Le regole: x", stanze: [STANZA] }, alle("2026-11-30T07:00:00Z"));
  assert.equal(v.id, S1);
  assert.equal(v.titolo, "Stanza di prova");
  assert.equal(v.periodo, "dal 30 nov alle 09:00 al 7 dic alle 09:00");
  assert.deepEqual(v.nomi, ["Anna", "Luca", "Sara"]);
  assert.equal(v.persone, "3 persone");
  assert.equal(v.porte, "");
  assert.equal(v.finestra.tipo, "lunedi");
  const [p] = vociPannelloFilo({ stanze: [{ ...STANZA, porte: 3 }] }, alle("2026-12-06T20:30:00Z"));
  assert.equal(p.porte, "Porte aperte nella stanza: 3");
  const [z] = vociPannelloFilo({ stanze: [{ ...STANZA, porte: 0, nomi: ["Anna"] }] }, alle("2026-12-06T20:30:00Z"));
  assert.equal(z.porte, "Porte aperte nella stanza: 0");
  assert.equal(z.persone, "1 persona");
});

test("voci: righe senza id valido o con nomi non testo scartate; nessun campo in più passa", () => {
  const voci = vociPannelloFilo({ stanze: [{ id: "x" }, { ...STANZA, nomi: ["Anna", 3, "", "  Luca "], email: "a@b.it" }] },
    alle("2026-12-02T10:00:00Z"));
  assert.equal(voci.length, 1);
  assert.deepEqual(voci[0].nomi, ["Anna", "Luca"]);
  assert.equal("email" in voci[0], false);
  assert.deepEqual(vociPannelloFilo(null), []);
});

test("controllo prima di caricare: durata 10..90 (lunedì) / 10..60 (domenica), testo 1..900", () => {
  assert.equal(controllaVocale({ tipo: "lunedi", secondi: 9.4, testo: "Ciao" }), "breve");
  assert.equal(controllaVocale({ tipo: "lunedi", secondi: 10, testo: "Ciao" }), null);
  assert.equal(controllaVocale({ tipo: "lunedi", secondi: 90.4, testo: "Ciao" }), null);
  assert.equal(controllaVocale({ tipo: "domenica", secondi: 61, testo: "Ciao" }), "durata");
  assert.equal(controllaVocale({ tipo: "domenica", secondi: 30, testo: "   " }), "testo");
  assert.equal(controllaVocale({ tipo: "domenica", secondi: 30, testo: "é".repeat(901) }), "testo_lungo");
  assert.equal(controllaVocale({ tipo: "domenica", secondi: 30, testo: "é".repeat(900) }), null);
  assert.equal(controllaVocale({ tipo: "martedi", secondi: 30, testo: "Ciao" }), "dati");
});

test("errori: testi chiari per ogni motivo, uno generico per il resto", () => {
  assert.equal(testoErrorePannelloFilo("fuori_orario"), "Ora questo vocale non si può caricare: controlla gli orari sotto il nome della stanza.");
  assert.equal(testoErrorePannelloFilo("non_filo"), "Non segui più questa stanza.");
  assert.equal(testoErrorePannelloFilo("breve"), "Il vocale deve durare almeno 10 secondi.");
  assert.equal(testoErrorePannelloFilo("testo"), "Scrivi il testo del vocale: serve a chi non può ascoltare.");
  assert.equal(testoErrorePannelloFilo("qualcosa"), "Qualcosa non ha funzionato. Riprova tra poco.");
});

function reteFinta(risposte) {
  const chiamate = [];
  const f = async (url, init = {}) => {
    chiamate.push({ url, init });
    const r = risposte.shift();
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.corpo), { status: r.stato ?? 200, headers: { "content-type": "application/json" } });
  };
  return { f, chiamate };
}

test("rete: stanze() chiede GET /app/api/filo col token", async () => {
  const { f, chiamate } = reteFinta([{ corpo: { ok: true, regole: "R", stanze: [STANZA] } }]);
  const p = creaPannelloFilo({ token: () => "tok-123", fetch: f });
  const r = await p.stanze();
  assert.equal(r.ok, true);
  assert.equal(r.regole, "R");
  assert.equal(r.stanze.length, 1);
  assert.equal(chiamate[0].url, PERCORSO_FILO);
  assert.equal(chiamate[0].init.method, "GET");
  assert.equal(chiamate[0].init.headers.authorization, "Bearer tok-123");
});

test("rete: senza token niente rete; 401, 404, 429 e rete giù diventano motivi", async () => {
  const vuota = reteFinta([]);
  assert.deepEqual(await creaPannelloFilo({ token: () => null, fetch: vuota.f }).stanze(), { ok: false, motivo: "accesso" });
  assert.equal(vuota.chiamate.length, 0);
  for (const [stato, motivo] of [[401, "accesso"], [404, "spento"], [429, "troppe"], [503, "riprova"]]) {
    const { f } = reteFinta([{ stato, corpo: { ok: false, motivo: "riprova" } }]);
    assert.deepEqual(await creaPannelloFilo({ token: () => "t", fetch: f }).stanze(), { ok: false, motivo });
  }
  const giu = reteFinta([new TypeError("rete")]);
  assert.deepEqual(await creaPannelloFilo({ token: () => "t", fetch: giu.f }).stanze(), { ok: false, motivo: "rete" });
});

test("rete: carica() manda il modulo multipart con durata intera e testo pulito", async () => {
  const { f, chiamate } = reteFinta([{ corpo: { ok: true, tipo: "lunedi", durata: 42 } }]);
  const p = creaPannelloFilo({ token: () => "t", fetch: f });
  const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm;codecs=opus" });
  const r = await p.carica({ stanza: S1, tipo: "lunedi", secondi: 41.6, testo: "  Ciao a tutti  ", audio });
  assert.deepEqual(r, { ok: true, tipo: "lunedi", durata: 42 });
  const { url, init } = chiamate[0];
  assert.equal(url, PERCORSO_FILO_VOCALE);
  assert.equal(init.method, "POST");
  assert.ok(init.body instanceof FormData);
  assert.equal(init.body.get("stanza"), S1);
  assert.equal(init.body.get("tipo"), "lunedi");
  assert.equal(init.body.get("durata"), "42");
  assert.equal(init.body.get("testo"), "Ciao a tutti");
  assert.equal(init.body.get("audio").size, 3);
  assert.equal("content-type" in init.headers, false); // il confine del multipart lo mette il browser
});

test("rete: carica() rifiuta prima della rete i dati sbagliati e legge i motivi del server", async () => {
  const vuota = reteFinta([]);
  const p0 = creaPannelloFilo({ token: () => "t", fetch: vuota.f });
  const audio = new Blob([new Uint8Array([1])], { type: "audio/webm" });
  assert.deepEqual(await p0.carica({ stanza: S1, tipo: "lunedi", secondi: 5, testo: "x", audio }), { ok: false, motivo: "breve" });
  assert.deepEqual(await p0.carica({ stanza: "x", tipo: "lunedi", secondi: 20, testo: "x", audio }), { ok: false, motivo: "dati" });
  assert.deepEqual(await p0.carica({ stanza: S1, tipo: "lunedi", secondi: 20, testo: "x", audio: null }), { ok: false, motivo: "dati" });
  assert.equal(vuota.chiamate.length, 0);
  for (const [stato, motivo, atteso] of [[409, "fuori_orario", "fuori_orario"], [403, "non_filo", "non_filo"],
    [413, "troppo_grande", "troppo_grande"], [409, "inventato", "riprova"]]) {
    const { f } = reteFinta([{ stato, corpo: { ok: false, motivo } }]);
    const p = creaPannelloFilo({ token: () => "t", fetch: f });
    assert.deepEqual(await p.carica({ stanza: S1, tipo: "lunedi", secondi: 20, testo: "x", audio }), { ok: false, motivo: atteso });
  }
});
