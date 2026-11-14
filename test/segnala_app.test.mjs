// Modulo di segnalazione nella web app (issue #7, spec v1.1 punti 2-3, passo 5a della linea «sviluppatore-b»).
// Il telefono manda solo persona, motivo, origine, racconto e casella: chi segnala lo dice il token.
// Al telefono tornano solo ore e pericolo. Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MOTIVI_MODULO, moduloSegnala, corpoSegnala, confermaSegnala, testoErroreSegnala, creaSegnala } from "../landing/app/moduli/segnala.js";
import { MOTIVI_DAL_TELEFONO } from "../api/segnala.js";

const LEI = "11111111-2222-4333-8444-555555555555";

test("i 9 motivi della spec, in ordine, sono tutti accettati dal server", () => {
  assert.deepEqual(MOTIVI_MODULO.map(([v]) => v), ["contatti_prima_porta", "insulti", "contenuti_sessuali", "minacce_pericolo",
    "sembra_minorenne", "profilo_falso", "soldi", "diffusione_immagini", "altro"]);
  assert.equal(MOTIVI_MODULO[0][1], "Ha chiesto numero, cognome o social prima della porta");
  assert.equal(MOTIVI_MODULO[3][1], "Minacce, o mi sono sentita/o in pericolo");
  for (const [v] of MOTIVI_MODULO) assert.ok(MOTIVI_DAL_TELEFONO.includes(v), v);
});

test("modulo: casella «Blocca anche» spuntata; dopo «Chiudi e segnala» non si può togliere", () => {
  const dopo = moduloSegnala({ contro: LEI, origine: "dopo_chiamata", chiamataIl: null }, "Giulia");
  assert.equal(dopo.titolo, "Cosa è successo?");
  assert.equal(dopo.casella, "Blocca anche Giulia");
  assert.equal(dopo.bloccoFisso, false);
  assert.equal(dopo.anonimato, "Giulia non saprà chi l'ha segnalato.");
  assert.equal(dopo.massimo, 1000);
  const chiudi = moduloSegnala({ contro: LEI, origine: "chiudi_e_segnala", chiamataIl: null }, "Giulia");
  assert.equal(chiudi.bloccoFisso, true);
  assert.match(chiudi.casella, /Giulia/);
  // Senza nome non compare mai un id.
  assert.equal(moduloSegnala({ contro: LEI, origine: "dopo_chiamata" }, "").casella, "Blocca anche questa persona");
});

test("corpo: solo i campi del server, blocco forzato dopo «Chiudi e segnala», niente «da»", () => {
  const s = { contro: LEI, origine: "dopo_chiamata", chiamataIl: "2026-11-13T18:00:00Z" };
  assert.deepEqual(corpoSegnala(s, { motivo: "insulti", testo: "  ciao  ", blocca: false }),
    { ok: true, corpo: { contro: LEI, motivo: "insulti", origine: "dopo_chiamata", testo: "ciao", blocca: false, chiamataIl: "2026-11-13T18:00:00Z" } });
  const c = corpoSegnala({ contro: LEI, origine: "chiudi_e_segnala", chiamataIl: null }, { motivo: "altro", testo: "", blocca: false });
  assert.equal(c.corpo.blocca, true);
  assert.equal("chiamataIl" in c.corpo, false);
  assert.equal("da" in c.corpo, false);
});

test("corpo: motivo da scegliere, racconto oltre 1000 caratteri, motivo inventato", () => {
  const s = { contro: LEI, origine: "dopo_chiamata", chiamataIl: null };
  assert.deepEqual(corpoSegnala(s, { motivo: "", testo: "", blocca: true }), { ok: false, errore: "Scegli cosa è successo." });
  assert.equal(corpoSegnala(s, { motivo: "insulti", testo: "a".repeat(1001), blocca: true }).ok, false);
  assert.equal(corpoSegnala(s, { motivo: "sono_in_difficolta", testo: "", blocca: true }).ok, false);
  assert.equal(corpoSegnala(null, { motivo: "insulti" }).ok, false);
});

test("conferma: ore della revisione e, per il pericolo, il 112", () => {
  const p = confermaSegnala({ ore: 1, pericolo: true }, "Giulia");
  assert.equal(p.testo, "Grazie. Una persona di Presente la leggerà entro 1 ora. Giulia non saprà chi l'ha segnalato.");
  assert.equal(p.pericolo, "Se sei in pericolo ora, chiama il 112.");
  assert.equal(p.telefono, "tel:112");
  const n = confermaSegnala({ ore: 24, pericolo: false }, "Giulia");
  assert.match(n.testo, /entro 24 ore\./);
  assert.equal(n.pericolo, null);
  assert.match(confermaSegnala({ ore: 72, pericolo: false }, "").testo, /entro 72 ore\. Questa persona non saprà/);
});

test("errori: testi chiari, mai codici", () => {
  assert.equal(testoErroreSegnala("rete"), "Sei senza connessione. Riprova tra poco.");
  assert.equal(testoErroreSegnala("persona"), "Non riusciamo a collegare questa persona. Torna alla stanza e riprova.");
  assert.equal(testoErroreSegnala("boh"), "Non è andata. Riprova tra poco.");
});

function finto(stato, dati) {
  const viste = [];
  const f = async (url, o = {}) => {
    viste.push({ url, metodo: o.method, headers: o.headers || {}, corpo: o.body ? JSON.parse(o.body) : null });
    if (stato === "rete") throw new TypeError("rete assente");
    return new Response(JSON.stringify(dati), { status: stato });
  };
  return { f, viste };
}

test("invia: POST /app/api/segnala con il token e il corpo preparato", async () => {
  const s = finto(200, { ok: true, ore: 1, pericolo: true, altro: "ignorato" });
  const r = await creaSegnala({ token: async () => "tok", fetch: s.f }).invia({ contro: LEI, motivo: "minacce_pericolo", origine: "dopo_chiamata", testo: "", blocca: true });
  assert.deepEqual(r, { ok: true, ore: 1, pericolo: true });
  assert.equal(s.viste[0].url, "/app/api/segnala");
  assert.equal(s.viste[0].metodo, "POST");
  assert.equal(s.viste[0].headers.authorization, "Bearer tok");
  assert.equal(s.viste[0].corpo.motivo, "minacce_pericolo");
});

test("invia: senza token, rete giù, 400, 429, 503, risposta strana", async () => {
  const crea = (s) => creaSegnala({ token: async () => "tok", fetch: s.f });
  assert.deepEqual(await creaSegnala({ token: async () => null, fetch: finto(200, {}).f }).invia({}), { ok: false, motivo: "accesso" });
  assert.deepEqual(await crea(finto("rete")).invia({}), { ok: false, motivo: "rete" });
  assert.deepEqual(await crea(finto(400, { ok: false, motivo: "dati" })).invia({}), { ok: false, motivo: "dati" });
  assert.deepEqual(await crea(finto(429, {})).invia({}), { ok: false, motivo: "troppe" });
  assert.deepEqual(await crea(finto(503, { ok: false, motivo: "riprova" })).invia({}), { ok: false, motivo: "riprova" });
  assert.deepEqual(await crea(finto(200, { ok: false, motivo: "persona" })).invia({}), { ok: false, motivo: "persona" });
  assert.deepEqual(await crea(finto(200, { ok: true, ore: "x" })).invia({}), { ok: false, motivo: "riprova" });
});

test("la schermata «segnala» usa il modulo vero (niente più testo provvisorio) e l'avvio lo collega", () => {
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  const avvio = readFileSync(new URL("../landing/app/avvio.js", import.meta.url), "utf8");
  assert.ok(!flusso.includes("Il modulo per segnalare arriva con il prossimo aggiornamento"));
  assert.match(flusso, /moduloSegnala\(/);
  assert.match(flusso, /segnalatore\.invia\(/);
  assert.match(avvio, /creaSegnala\(/);
});

test("il service worker tiene anche segnala.js e la versione cambia", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"/app/moduli/segnala.js"'));
  assert.ok(!sw.includes('"presente-app-15"'));
});

test("il modulo non salva nulla sul telefono e non scrive nei log", () => {
  const codice = readFileSync(new URL("../landing/app/moduli/segnala.js", import.meta.url), "utf8");
  assert.ok(!/console\.|localStorage|sessionStorage|indexedDB/i.test(codice.replace(/\/\/.*$/gm, "")));
});
