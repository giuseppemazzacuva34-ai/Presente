// Il diario privato nella web app (issue #5, spec v1.1, passi 2 e 3; D51 A). Passo 7b della linea «sviluppatore-c».
// Testi della spec, controllo del testo e richieste dirette a Supabase con il token di chi scrive (regole per riga):
// il Worker non vede mai il diario. Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schermataDiario, controllaTesto, appunto, creaDiario, TESTI_DIARIO } from "../landing/app/moduli/diario.js";

const LEI = "11111111-2222-4333-8444-555555555555";
const BASE = "https://abcdefghijklmnop.supabase.co";
const INIZIO = "2026-11-12T19:30:00.000Z"; // giovedì 12 novembre, 20:30 di Roma

function rete(risposte) {
  const chiamate = [];
  const f = async (url, init = {}) => {
    chiamate.push({ url, ...init });
    const r = risposte.shift() ?? { status: 200, body: [] };
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  return { f, chiamate };
}
const diario = (f, token = async () => "tok") => creaDiario({ supabaseUrl: BASE, supabaseAnonKey: "anon", token, fetch: f });

test("schermata: i testi della spec con il nome, 1000 caratteri al massimo", () => {
  assert.deepEqual(schermataDiario("Giulia"), {
    titolo: "Il tuo diario su Giulia",
    suggerimento: "Cosa ti è rimasto di questa chiamata?",
    nota: "Lo leggi solo tu. Non lo usiamo per niente.",
    salva: "Salva",
    salta: "Salta",
    massimo: 1000,
  });
  assert.equal(schermataDiario("  ").titolo, "Il tuo diario su questa persona");
  assert.equal(TESTI_DIARIO.appunti, "I tuoi appunti");
});

test("testo: vuoto o solo spazi non si salva, oltre 1000 caratteri nemmeno; gli spazi ai lati si tolgono", () => {
  assert.deepEqual(controllaTesto("  Ride come mia nonna.  "), { ok: true, testo: "Ride come mia nonna." });
  assert.deepEqual(controllaTesto("   "), { ok: false, motivo: "vuoto" });
  assert.deepEqual(controllaTesto(null), { ok: false, motivo: "vuoto" });
  assert.deepEqual(controllaTesto("a".repeat(1000)), { ok: true, testo: "a".repeat(1000) });
  assert.deepEqual(controllaTesto("a".repeat(1001)), { ok: false, motivo: "lungo" });
});

test("appunto: data in ora di Roma, durata in minuti, testo", () => {
  assert.deepEqual(appunto({ chiamata_il: INIZIO, durata: 720, testo: "Il treno per Bari." }),
    { chiamataIl: INIZIO, data: "12 novembre", durata: "12 min", testo: "Il treno per Bari." });
  assert.equal(appunto({ chiamata_il: INIZIO, durata: 65, testo: "x" }).durata, "1 min");
  assert.equal(appunto({ chiamata_il: "boh", durata: 65, testo: "x" }), null);
});

test("senza token nessuna richiesta parte", async () => {
  const { f, chiamate } = rete([]);
  const d = diario(f, async () => null);
  assert.deepEqual(await d.appunti(LEI), { ok: false, motivo: "accesso" });
  assert.deepEqual(await d.salva({ con: LEI, chiamataIl: INIZIO, durata: 720, testo: "ciao" }), { ok: false, motivo: "accesso" });
  assert.equal(chiamate.length, 0);
});

test("appunti: legge solo le note su quella persona, dalla più recente, con il token di chi le ha scritte", async () => {
  const { f, chiamate } = rete([{ status: 200, body: [
    { chiamata_il: INIZIO, durata: 720, testo: "Il treno per Bari." },
    { chiamata_il: "2026-11-10T18:00:00Z", durata: 300, testo: "Prima chiamata." },
  ] }]);
  const r = await diario(f).appunti(LEI);
  assert.equal(r.ok, true);
  assert.deepEqual(r.appunti.map((a) => a.testo), ["Il treno per Bari.", "Prima chiamata."]);
  const { url, method, headers } = chiamate[0];
  assert.equal(method, "GET");
  assert.equal(url, `${BASE}/rest/v1/diario?select=chiamata_il,durata,testo&con=eq.${LEI}&order=chiamata_il.desc`);
  assert.equal(headers.authorization, "Bearer tok");
  assert.equal(headers.apikey, "anon");
});

test("appunti: id non valido → nessuna richiesta", async () => {
  const { f, chiamate } = rete([]);
  assert.deepEqual(await diario(f).appunti("1 or 1=1"), { ok: false, motivo: "non_valida" });
  assert.equal(chiamate.length, 0);
});

test("salva: manda solo persona, inizio, durata e testo (mai chi scrive: lo dice il token)", async () => {
  const { f, chiamate } = rete([{ status: 201 }]);
  assert.deepEqual(await diario(f).salva({ con: LEI, chiamataIl: INIZIO, durata: 720, testo: "  Ride.  " }), { ok: true });
  const { url, method, headers, body } = chiamate[0];
  assert.equal(method, "POST");
  assert.equal(url, `${BASE}/rest/v1/diario`);
  assert.equal(headers.prefer, "return=minimal");
  assert.deepEqual(JSON.parse(body), { con: LEI, chiamata_il: INIZIO, durata: 720, testo: "Ride." });
});

test("salva: testo vuoto o chiamata sotto i 60 secondi → nessuna richiesta", async () => {
  const { f, chiamate } = rete([]);
  assert.deepEqual(await diario(f).salva({ con: LEI, chiamataIl: INIZIO, durata: 720, testo: " " }), { ok: false, motivo: "vuoto" });
  assert.deepEqual(await diario(f).salva({ con: LEI, chiamataIl: INIZIO, durata: 59, testo: "x" }), { ok: false, motivo: "non_valida" });
  assert.equal(chiamate.length, 0);
});

test("salva: nota già scritta per quella chiamata → «gia_scritta»; rifiuto delle regole → «rifiutato»; rete giù → «rete»", async () => {
  assert.deepEqual(await diario(rete([{ status: 409 }]).f).salva({ con: LEI, chiamataIl: INIZIO, durata: 720, testo: "x" }),
    { ok: false, motivo: "gia_scritta" });
  assert.deepEqual(await diario(rete([{ status: 403 }]).f).salva({ con: LEI, chiamataIl: INIZIO, durata: 720, testo: "x" }),
    { ok: false, motivo: "rifiutato" });
  const giu = async () => { throw new Error("offline"); };
  assert.deepEqual(await diario(giu).salva({ con: LEI, chiamataIl: INIZIO, durata: 720, testo: "x" }), { ok: false, motivo: "rete" });
});

test("modifica e cancella: per la chiamata indicata, data scritta in modo sicuro nell'indirizzo", async () => {
  const { f, chiamate } = rete([{ status: 204 }, { status: 204 }]);
  const d = diario(f);
  assert.deepEqual(await d.modifica(INIZIO, " Nuovo testo "), { ok: true });
  assert.deepEqual(await d.cancella(INIZIO), { ok: true });
  const filtro = `chiamata_il=eq.${encodeURIComponent(INIZIO)}`;
  assert.equal(chiamate[0].method, "PATCH");
  assert.equal(chiamate[0].url, `${BASE}/rest/v1/diario?${filtro}`);
  assert.deepEqual(JSON.parse(chiamate[0].body), { testo: "Nuovo testo" });
  assert.equal(chiamate[1].method, "DELETE");
  assert.equal(chiamate[1].url, `${BASE}/rest/v1/diario?${filtro}`);
  assert.deepEqual(await d.cancella("non è una data"), { ok: false, motivo: "non_valida" });
});

test("il modulo non salva nulla sul telefono, non scrive nei log e non passa dal Worker", () => {
  const codice = readFileSync(new URL("../landing/app/moduli/diario.js", import.meta.url), "utf8");
  assert.doesNotMatch(codice, /localStorage|sessionStorage|indexedDB|caches\.|console\./);
  assert.doesNotMatch(codice, /\/app\/api\//);
});
