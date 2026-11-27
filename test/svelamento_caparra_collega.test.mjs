// Design v4 (#349), schermata 39 «Lo svelamento»: collegamento nell'app (passo 2, ok del CTO in plancia il 26/11).
// Linea «sviluppatore-c». vistaPorta mostra la 39 (svelamento_caparra.js) finché la propria caparra non è bloccata;
// schermataPorta passa scadeIl (scade_il del server) per il timer «hh:mm»; il modulo è nella copia offline (sw.js).
// Con un errore (lettura o blocco) la 39 mostra il testo e «Riprova». h finto, rete finta, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schermataPorta, creaPortaSvelamento, vistaPorta } from "../landing/app/moduli/svelamento.js";
import { TESTI_SVELAMENTO } from "../api/svelamento.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LEI = "11111111-2222-4333-8444-555555555555";
const SCADE = "2026-11-17T20:00:00Z";
const LUNEDI = new Date("2026-11-16T09:30:00Z");
const porta = (extra = {}) => ({ porta: PORTA, con: LEI, nome: "Giulia", eta: 31, aperta_il: "2026-11-15T20:00:00Z",
  scade_il: SCADE, mia_caparra: false, sua_caparra: false, aspetta: null, ...extra });
const stato = (porte = [porta()], saldo = 120) => ({ saldo, caparra: 100, beta: true,
  testi: { blocca: TESTI_SVELAMENTO.blocca, spiegazione: TESTI_SVELAMENTO.spiegazioneCaparra, beta: TESTI_SVELAMENTO.beta }, porte });

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];
const v4 = (v) => String(v && v.a.classe || "").split(" ").includes("svelamento-v4");

function svelamentoFinto(...letture) {
  const chiamate = [];
  const risposte = {};
  return {
    chiamate, risposte,
    leggi: async () => { chiamate.push("leggi"); return letture.length > 1 ? letture.shift() : letture[0]; },
    blocca: async (p) => { chiamate.push(["blocca", p]); return risposte.blocca; },
  };
}
async function aperta(st = stato(), ...altre) {
  const sv = svelamentoFinto({ ok: true, stato: st }, ...altre);
  const ps = creaPortaSvelamento({ svelamento: sv, adesso: () => LUNEDI });
  await ps.apri(PORTA);
  return { sv, ps };
}

test("schermataPorta passa scadeIl (scade_il del server) per il timer della 39", () => {
  assert.equal(schermataPorta(stato(), PORTA, LUNEDI).scadeIl, SCADE);
});

test("prima della propria caparra la porta è la schermata 39: occhiello, timer «hh:mm», «Blocca 100 crediti»", async () => {
  const { sv, ps } = await aperta();
  const v = vistaPorta(h, ps);
  assert.ok(v4(v), "sezione svelamento-v4");
  assert.ok(testo(v).includes("Svelamento · Giulia, 31"));
  assert.equal(testo(tutti(v, (x) => x.a.role === "timer")[0]), "34:30");
  const b = bottone(v, "Blocca 100 crediti");
  await b.a.onclick();
  assert.deepEqual(sv.chiamate.at(-1), ["blocca", PORTA]);
});

test("«Più tardi» torna indietro come «Torna alla stanza» (ps.chiudi o la funzione passata)", async () => {
  const { ps } = await aperta();
  let tornato = 0;
  bottone(vistaPorta(h, ps, { torna: () => { tornato += 1; } }), "Più tardi").a.onclick();
  assert.equal(tornato, 1);
  bottone(vistaPorta(h, ps), "Più tardi").a.onclick();
  assert.equal(ps.modello().aperta, false, "senza torna: ps.chiudi()");
});

test("con pochi crediti la 39 mostra «Ti mancano N crediti» e «Ricarica», senza bloccare", async () => {
  const { sv, ps } = await aperta(stato([porta()], 93));
  const v = vistaPorta(h, ps);
  assert.ok(v4(v));
  assert.ok(testo(v).includes("Ti mancano 7 crediti"));
  assert.equal(bottone(v, "Blocca 100 crediti"), undefined);
  bottone(v, "Ricarica").a.onclick();
  assert.ok(testo(vistaPorta(h, ps)).includes(TESTI_SVELAMENTO.beta));
  assert.ok(!sv.chiamate.some((c) => Array.isArray(c)));
});

test("dopo la propria caparra la 39 sparisce e resta il percorso di prima (attesa, scelta, orario)", async () => {
  const { sv, ps } = await aperta();
  sv.risposte.blocca = { ok: true, esito: "bloccata", stato: stato([porta({ mia_caparra: true })], 20) };
  await ps.blocca();
  const v = vistaPorta(h, ps);
  assert.ok(!v4(v));
  assert.equal(bottone(v, "Più tardi"), undefined);
  assert.ok(bottone(v, "Torna alla stanza"));
});

test("errore nel blocco: la 39 mostra il testo e «Riprova» rilegge lo stato", async () => {
  const { sv, ps } = await aperta();
  sv.risposte.blocca = { ok: false, motivo: "rete", testo: "Sei senza connessione. Riprova tra poco." };
  await ps.blocca();
  const v = vistaPorta(h, ps);
  assert.ok(v4(v));
  const errore = tutti(v, (x) => x.a.role === "alert")[0];
  assert.equal(testo(errore), "Sei senza connessione. Riprova tra poco.");
  const letture = sv.chiamate.filter((c) => c === "leggi").length;
  await bottone(v, "Riprova").a.onclick();
  assert.equal(sv.chiamate.filter((c) => c === "leggi").length, letture + 1);
});

test("copia offline: svelamento_caparra.js in sw.js e cache nuova (presente-app-70)", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes("\"/app/moduli/svelamento_caparra.js\""));
  assert.ok(sw.includes("const VERSIONE = \"presente-app-70\""));
});
