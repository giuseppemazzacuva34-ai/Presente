// Svelamento, passo 8b-3b (issue #65, D48 A, spec v1 del CPO, casi limite; linea «sviluppatore»): quando la connessione
// cade prima dei 10 secondi il telefono lo dice al server («caduta»), così il server ferma il timer e non conta lo
// svelamento come finito. Se la richiesta non passa (rete giù) il telefono riprova al giro dopo, una alla volta.
// Se il server dice «quando» (terzo avvio) si torna a scegliere quando; se dice «finito» lo svelamento vale.
// Browser e server finti, nessuna rete vera, solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaSchermataSvelamento, TESTI_SCHERMATA } from "../landing/app/moduli/schermata_svelamento.js";
import { collegaVideo } from "../landing/app/moduli/video_svelamento.js";
import { creaSvelamento } from "../landing/app/moduli/svelamento.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const INIZIO = 1_000_000;
const VISTA_ATTESA = { fase: "attesa", ora: INIZIO };
const inCorso = (inizio) => ({ fase: "in_corso", ora: inizio, inizio, nitidoDal: inizio + 3000, fine: inizio + 10_000 });

function finto() {
  const chiamate = [];
  const code = { pubblica: [], ricevi: [], vista: [], riprova: [], caduta: [] };
  const fissa = {
    pubblica: { ok: true, vista: VISTA_ATTESA },
    ricevi: { ok: true, vista: VISTA_ATTESA },
    vista: { ok: true, vista: VISTA_ATTESA },
    riprova: { ok: true, vista: VISTA_ATTESA },
    caduta: { ok: true, vista: VISTA_ATTESA },
  };
  const r = (nome) => async () => {
    chiamate.push(nome);
    const x = code[nome].length ? code[nome].shift() : fissa[nome];
    return typeof x === "function" ? x() : x;
  };
  const collega = {
    pubblica: r("pubblica"), ricevi: r("ricevi"), vista: r("vista"), riprova: r("riprova"), caduta: r("caduta"),
    chiudi() { chiamate.push("chiudi"); },
    muto() {},
  };
  return { collega, chiamate, code, fissa };
}

async function inCorsoA4s() {
  const f = finto();
  let ora = INIZIO;
  let giro = null;
  const eventi = [];
  const s = creaSchermataSvelamento({
    collega: f.collega, nome: "Marta", nomeMio: "Luca",
    adesso: () => ora, ogni: (fn) => { giro = fn; return 1; }, ferma: () => { giro = null; }, leggiOgni: 0,
    quandoFinito: () => eventi.push("finito"), quandoEsci: (m) => eventi.push(`esci:${m}`),
  });
  const passa = async (ms) => { ora += ms; if (giro) await giro(); await new Promise((x) => setImmediate(x)); };
  await s.apri();
  await passa(1000); // ricevuta l'altra persona
  f.fissa.vista = { ok: true, vista: inCorso(ora) };
  await passa(4000);
  assert.equal(s.modello().stato, "in_corso");
  return { s, f, eventi, passa };
}
const conta = (f, nome) => f.chiamate.filter((c) => c === nome).length;
const attesa = () => new Promise((x) => setImmediate(x));

test("caduta a 4 s: il telefono lo dice subito al server, una volta sola", async () => {
  const t = await inCorsoA4s();
  t.s.cade();
  await attesa();
  assert.equal(conta(t.f, "caduta"), 1);
  assert.equal(t.s.modello().stato, "caduta");
  await t.passa(1000);
  await t.passa(1000);
  assert.equal(conta(t.f, "caduta"), 1, "detta e ricevuta: non si ripete");
});

test("caduta che non arriva al server (rete giù): si riprova al giro dopo, finché il server non la riceve", async () => {
  const t = await inCorsoA4s();
  t.f.code.caduta.push({ ok: false, motivo: "riprova" }, { ok: false, motivo: "riprova" });
  t.s.cade();
  await attesa();
  await t.passa(1000);
  await t.passa(1000);
  await t.passa(1000);
  assert.equal(conta(t.f, "caduta"), 3);
  assert.equal(t.s.modello().stato, "caduta");
  assert.ok(t.s.modello().stato === "caduta");
});

test("il server dice «quando» (caduta al terzo avvio): si torna a scegliere quando", async () => {
  const t = await inCorsoA4s();
  t.f.code.caduta.push({ ok: false, motivo: "quando" });
  t.s.cade();
  await attesa();
  assert.equal(t.s.modello().stato, "uscita");
  assert.deepEqual(t.eventi, ["esci:tentativi"]);
});

test("il server dice «finito» (caduta arrivata dopo i 10 secondi): lo svelamento vale, «Ecco <nome>.»", async () => {
  const t = await inCorsoA4s();
  t.f.code.caduta.push({ ok: false, motivo: "finito" });
  t.s.cade();
  await attesa();
  assert.equal(t.s.modello().stato, "finito");
  assert.deepEqual(t.eventi, ["finito"]);
});

test("«Riprova» dopo la caduta detta: il timer riparte da 10, sfocato; nessuna caduta in più", async () => {
  const t = await inCorsoA4s();
  t.s.cade();
  await attesa();
  await t.s.riprova();
  assert.equal(t.s.modello().stato, "aspetta");
  assert.equal(t.s.modello().secondi, 10);
  assert.equal(t.s.modello().sfocato, true);
  await t.passa(1000);
  assert.equal(conta(t.f, "caduta"), 1);
  assert.equal(TESTI_SCHERMATA.caduta, "La connessione è caduta.");
});

test("collegaVideo.caduta: chiede al server e torna molto sfocati con la vista nuova", async () => {
  const nitidi = [];
  const video = { nitido: (v) => nitidi.push(v), chiudi() {} };
  const svelamento = { cadutaVideo: async (p) => (p === PORTA ? { ok: true, vista: VISTA_ATTESA } : { ok: false, motivo: "non_trovata" }) };
  const c = collegaVideo({ svelamento, video, porta: PORTA });
  assert.deepEqual(await c.caduta(), { ok: true, vista: VISTA_ATTESA });
  assert.deepEqual(nitidi, [VISTA_ATTESA]);
  const no = collegaVideo({ svelamento: { cadutaVideo: async () => ({ ok: false, motivo: "quando" }) }, video, porta: PORTA });
  assert.deepEqual(await no.caduta(), { ok: false, motivo: "quando" });
});

test("client: «caduta» va a /app/api/svelamento con la porta e senza persona", async () => {
  const chiamate = [];
  const f = async (url, o) => {
    chiamate.push({ url, corpo: JSON.parse(o.body) });
    return { status: 200, json: async () => ({ ok: true, vista: VISTA_ATTESA }) };
  };
  const sv = creaSvelamento({ token: () => "t", fetch: f });
  assert.deepEqual(await sv.cadutaVideo(PORTA), { ok: true, vista: VISTA_ATTESA });
  assert.deepEqual(chiamate.map((c) => c.corpo), [{ azione: "caduta", porta: PORTA }]);
  assert.equal((await sv.cadutaVideo("non-uuid")).ok, false);
  assert.equal(chiamate.length, 1);
});
