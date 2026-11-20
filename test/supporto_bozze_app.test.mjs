// Bozze dell'agente nel pannello di chi risponde (issue #10, parte B v1/v1.1 del CPO; D122 B; passo 7 linea «sviluppatore-c»).
// «Invia così · Modifica e invia · Scarta e scrivo io»; «Da gestire da Giuseppe» è solo una nota interna (mai da
// inviare); una bozza non toccata dopo 36 ore dà l'avviso. Rete finta, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vociSupporto, unisciBozze, creaSupportoOperatore, testoErroreOperatore } from "../landing/app/moduli/supporto_operatore.js";
import { PERCORSO_BOZZE, PERCORSO_SCARTA } from "../worker/supporto_operatore_api.js";

const ADESSO = new Date("2026-11-20T12:00:00Z");
const A = "11111111-2222-4333-8444-555555555555";
const B = "66666666-7777-4888-9999-000000000000";
const msg = (id, extra = {}) => ({ id, email: "chi@example.invalid", categoria: "crediti", testo: "Testo di prova",
  creatoIl: "2026-11-20T08:00:00Z", stato: "inviato", sicurezza: false, ...extra });
const bozza = (id, extra = {}) => ({ id, testo: "Ciao! Il team di Presente", fonte: "FAQ n. 9", conIstruzioni: false,
  creataIl: "2026-11-20T09:00:00Z", ...extra });

test("unisciBozze: ogni messaggio senza risposta riceve la sua bozza, gli altri niente", () => {
  const voci = unisciBozze(vociSupporto([msg(A), msg(B, { stato: "risposto" })], ADESSO), [bozza(A), bozza(B)], ADESSO);
  const a = voci.find((v) => v.id === A), b = voci.find((v) => v.id === B);
  assert.deepEqual(a.bozza, { testo: "Ciao! Il team di Presente", fonte: "FAQ n. 9", istruzioni: false, daGestire: false, ferma: false });
  assert.equal(b.bozza, null);
});

test("unisciBozze: «Da gestire da Giuseppe» è una nota interna, «testo con istruzioni» segnalato", () => {
  const [v] = unisciBozze(vociSupporto([msg(A)], ADESSO),
    [bozza(A, { testo: "Da gestire da Giuseppe: ricorso.", fonte: "nessuna", conIstruzioni: true })], ADESSO);
  assert.equal(v.bozza.daGestire, true);
  assert.equal(v.bozza.istruzioni, true);
});

test("unisciBozze: bozza non toccata da più di 36 ore → avviso (orologio simulato)", () => {
  const voci = vociSupporto([msg(A)], ADESSO);
  assert.equal(unisciBozze(voci, [bozza(A)], new Date("2026-11-21T20:59:00Z"))[0].bozza.ferma, false);
  assert.equal(unisciBozze(voci, [bozza(A)], new Date("2026-11-21T21:01:00Z"))[0].bozza.ferma, true);
});

test("unisciBozze: dati strani o assenti non rompono la coda", () => {
  const voci = vociSupporto([msg(A)], ADESSO);
  assert.equal(unisciBozze(voci, null, ADESSO)[0].bozza, null);
  assert.equal(unisciBozze(voci, [null, { id: A, testo: 3 }], ADESSO)[0].bozza, null);
});

test("client: bozze() e scarta(id) parlano solo con /bozze e /scarta, col token", async () => {
  const viste = [];
  const f = async (url, o) => {
    viste.push({ url, metodo: o.method, auth: o.headers.authorization, corpo: o.body ? JSON.parse(o.body) : null });
    if (url === PERCORSO_BOZZE) return Response.json({ ok: true, bozze: [bozza(A)] });
    if (url === PERCORSO_SCARTA) return Response.json({ ok: false, motivo: "gia_tolta" });
    return new Response("{}", { status: 404 });
  };
  const p = creaSupportoOperatore({ token: async () => "tok", fetch: f });
  assert.deepEqual(await p.bozze(), { ok: true, bozze: [bozza(A)] });
  assert.deepEqual(await p.scarta(A), { ok: false, motivo: "gia_tolta" });
  assert.deepEqual(await p.scarta("x"), { ok: false, motivo: "dati" });
  assert.deepEqual(viste.map((v) => [v.url, v.metodo, v.auth]), [[PERCORSO_BOZZE, "GET", "Bearer tok"], [PERCORSO_SCARTA, "POST", "Bearer tok"]]);
  assert.deepEqual(viste[1].corpo, { id: A });
  assert.match(testoErroreOperatore("gia_tolta"), /bozza/i);
});

test("pagina: pulsanti della spec, nota interna senza «Invia così», avviso delle 36 ore", () => {
  const avvio = readFileSync(new URL("../landing/app/supporto_avvio.js", import.meta.url), "utf8");
  for (const t of ["Invia così", "Modifica e invia", "Scarta e scrivo io", "testo con istruzioni"]) assert.ok(avvio.includes(t), t);
  assert.match(avvio, /bozza\.daGestire \? null/, "su «Da gestire da Giuseppe» niente «Invia così»");
  assert.match(avvio, /bozza\.ferma/);
  assert.match(avvio, /p\.bozze\(\)/);
});
