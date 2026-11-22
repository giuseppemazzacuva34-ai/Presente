// «Manda un regalo» nella scheda di una persona della stanza aperta, e «Ti ha mandato: …» che vede solo chi riceve
// (issue #331, spec v1 del CPO parte C, passo 1 e «Cosa vede chi riceve»). Passo 8b della linea «sviluppatore-c».
// Rete e documento finti: nessun dato reale, nessun servizio esterno.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaRegali } from "../landing/app/moduli/regali.js";
import { creaRegaliStanza, vistaRegaliScheda } from "../landing/app/moduli/regali_stanza.js";

const LEI = "11111111-2222-4333-8444-555555555555";
const LUI = "66666666-7777-4888-9999-000000000000";
const attesa = () => new Promise((r) => setTimeout(r, 0));
const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (typeof n === "string" ? n : n.f.map(testo).join(""));
const bottone = (v) => v.f.find((x) => typeof x === "object" && x.tag === "button");

function rete(risposte) {
  const chiamate = [];
  const f = async (url, init = {}) => {
    chiamate.push({ url, ...init });
    const r = typeof risposte === "function" ? risposte(url) : risposte.shift() ?? { status: 200, body: { ok: true } };
    if (r.errore) throw new Error("rete");
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  return { f, chiamate };
}

test("ricevutiDa: chiede al Worker i regali ricevuti da una persona, col token, e dà il testo della scheda", async () => {
  const { f, chiamate } = rete([{ status: 200, body: { ok: true, ricevuti: [{ regalo: "rosa", quanti: 1 }], testo: "Ti ha mandato: 1 rosa" } }]);
  const r = await creaRegali({ token: () => "tok", fetch: f }).ricevutiDa(LEI);
  assert.deepEqual(r, { ok: true, testo: "Ti ha mandato: 1 rosa" });
  assert.equal(chiamate[0].url, `/app/api/regali?da=${LEI}`);
  assert.equal(chiamate[0].method, "GET");
  assert.equal(chiamate[0].headers.authorization, "Bearer tok");
});

test("ricevutiDa: senza regali nessun testo; errore o rete giù → ok false, mai un testo inventato", async () => {
  const c = (risp) => creaRegali({ token: () => "tok", fetch: rete([risp]).f });
  assert.deepEqual(await c({ status: 200, body: { ok: true, ricevuti: [], testo: null } }).ricevutiDa(LEI), { ok: true, testo: null });
  assert.equal((await c({ status: 500, body: {} }).ricevutiDa(LEI)).ok, false);
  assert.equal((await c({ errore: true }).ricevutiDa(LEI)).ok, false);
  assert.equal((await creaRegali({ token: () => "tok", fetch: rete([]).f }).ricevutiDa("")).ok, false, "senza persona niente richiesta");
});

function finti({ ricevuti = {}, saldo = 145 } = {}) {
  const chiesti = [];
  return {
    chiesti,
    async ricevutiDa(id) { chiesti.push(id); return { ok: true, testo: ricevuti[id] ?? null }; },
    async avvisi() { return { ok: true, saldo, avvisi: [] }; },
    async manda() { return { ok: true, saldo: saldo - 5 }; },
  };
}

test("prepara: una lettura per persona e una sola volta per la stessa stanza; poi ridisegna", async () => {
  const regali = finti({ ricevuti: { [LEI]: "Ti ha mandato: 1 rosa, 1 bicchiere di spumante" } });
  let ridisegni = 0;
  const rs = creaRegaliStanza({ regali, contenitore: {}, aggiorna: () => { ridisegni++; } });
  rs.prepara([LEI, LUI]);
  rs.prepara([LUI, LEI]);
  await attesa();
  assert.deepEqual(regali.chiesti.sort(), [LEI, LUI].sort());
  assert.ok(ridisegni >= 1);
  assert.equal(rs.testoDi(LEI), "Ti ha mandato: 1 rosa, 1 bicchiere di spumante");
  assert.equal(rs.testoDi(LUI), null);
});

test("vista: pulsante «Manda un regalo» con nome accessibile; «Ti ha mandato» solo se ci sono regali", async () => {
  const rs = creaRegaliStanza({ regali: finti({ ricevuti: { [LEI]: "Ti ha mandato: 1 rosa" } }), contenitore: {} });
  await rs.prepara([LEI, LUI]);
  const v = vistaRegaliScheda(h, rs, LEI, "Giulia");
  assert.match(testo(v), /Ti ha mandato: 1 rosa/);
  const b = bottone(v);
  assert.equal(testo(b), "Manda un regalo");
  assert.equal(b.a.type, "button");
  assert.equal(b.a["aria-label"], "Manda un regalo a Giulia");
  assert.equal(b.a["aria-haspopup"], "dialog");
  assert.equal(b.a.id, `regalo-${LEI}`);
  const w = vistaRegaliScheda(h, rs, LUI, "Marco");
  assert.doesNotMatch(testo(w), /Ti ha mandato/);
  assert.equal(testo(bottone(w)), "Manda un regalo");
});

test("tocco: apre il foglio con persona, nome e saldo del server; un secondo tocco non apre un secondo foglio", async () => {
  const aperture = [];
  const contenitore = { ownerDocument: { getElementById: () => null } };
  const regali = finti({ saldo: 145 });
  const rs = creaRegaliStanza({ regali, contenitore, apri: (c, o) => { aperture.push({ c, o }); return { chiudi() {} }; } });
  const b = bottone(vistaRegaliScheda(h, rs, LEI, "Giulia"));
  b.a.onclick();
  b.a.onclick();
  await attesa();
  assert.equal(aperture.length, 1);
  assert.equal(aperture[0].c, contenitore);
  assert.equal(aperture[0].o.a, LEI);
  assert.equal(aperture[0].o.nome, "Giulia");
  assert.equal(aperture[0].o.saldo, 145);
  assert.equal(aperture[0].o.inChiamata, false);
  assert.equal(aperture[0].o.regali, regali);
});

test("saldo non letto: il foglio si apre lo stesso senza saldo (il server ricontrolla tutto)", async () => {
  const aperture = [];
  const regali = { ...finti(), async avvisi() { return { ok: false, motivo: "rete" }; } };
  const rs = creaRegaliStanza({ regali, contenitore: { ownerDocument: { getElementById: () => null } }, apri: (c, o) => { aperture.push(o); return { chiudi() {} }; } });
  bottone(vistaRegaliScheda(h, rs, LEI, "Giulia")).a.onclick();
  await attesa();
  assert.equal(aperture.length, 1);
  assert.equal(aperture[0].saldo, null);
});

test("dopo il regalo: nuovo saldo a chi lo mostra; alla chiusura il fuoco torna su «Manda un regalo» e si può riaprire", async () => {
  const aperture = [];
  const focati = [];
  const doc = { getElementById: (id) => ({ focus: () => focati.push(id) }) };
  const saldi = [];
  const rs = creaRegaliStanza({ regali: finti(), contenitore: { ownerDocument: doc }, alSaldo: (s) => saldi.push(s),
    apri: (c, o) => { aperture.push(o); return { chiudi() {} }; } });
  const b = bottone(vistaRegaliScheda(h, rs, LEI, "Giulia"));
  b.a.onclick();
  await attesa();
  aperture[0].alRegalo(140);
  assert.deepEqual(saldi, [140]);
  aperture[0].alChiudi();
  assert.deepEqual(focati, [`regalo-${LEI}`]);
  b.a.onclick();
  await attesa();
  assert.equal(aperture.length, 2);
});

// ---- aggancio nella home (flusso.js) e in avvio.js: solo aggiunte, solo nella stanza aperta ----
import { readFileSync } from "node:fs";
const leggiFile = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("flusso: «Manda un regalo» nelle schede della stanza aperta, mai nella stanza chiusa", () => {
  const flusso = leggiFile("../landing/app/moduli/flusso.js");
  assert.match(flusso, /import \{ vistaRegaliScheda \} from "\.\/regali_stanza\.js";/);
  assert.match(flusso, /regaliStanza = \(telefono && opzioni\.regali\) \|\| null;/);
  const blocco = flusso.slice(flusso.indexOf("function bloccoTuaStanza"), flusso.indexOf("function schermoChiamata"));
  const chiusa = blocco.slice(blocco.indexOf('st.stato === "pronta" && st.chiusa) {'), blocco.indexOf('} else if (st.stato === "pronta") {'));
  const aperta = blocco.slice(blocco.indexOf('} else if (st.stato === "pronta") {'), blocco.indexOf('} else if (st.stato === "vuota")'));
  assert.doesNotMatch(chiusa, /vistaRegaliScheda/);
  assert.match(aperta, /regaliStanza \? vistaRegaliScheda\(h, regaliStanza, p\.id, nomeScheda\(p\)\) : null/);
  assert.match(blocco, /if \(regaliStanza && st\.stato === "pronta" && !st\.chiusa\) regaliStanza\.prepara\(st\.persone\.map\(\(p\) => p\.id\)\);/);
  assert.match(flusso, /export function regaliCambiati\(\) \{/);
});

test("avvio: regali col token di chi usa l'app, foglio fuori da <main id=\"app\">", () => {
  const avvio = leggiFile("../landing/app/avvio.js");
  assert.match(avvio, /import \{ creaRegali \} from "\/app\/moduli\/regali\.js";/);
  assert.match(avvio, /import \{ creaRegaliStanza \} from "\/app\/moduli\/regali_stanza\.js";/);
  assert.match(avvio, /creaRegaliStanza\(\{ regali: creaRegali\(\{ token: \(\) => accesso\.token\(\), fetch: window\.fetch\.bind\(window\) \}\),\s+contenitore: document\.querySelector\("\.pagina\.app"\)/);
  assert.match(avvio, /aggiorna: \(\) => regaliCambiati\(\)/);
  assert.match(avvio, /return \{[^}]*\bregali\b[^}]*\};/);
});

test("service worker: versione nuova e moduli dei regali nella cache", () => {
  const sw = leggiFile("../landing/app/sw.js");
  assert.ok(!sw.includes('"presente-app-39"'));
  for (const m of ["regali.js", "regali_stanza.js"]) assert.ok(sw.includes(`"/app/moduli/${m}"`), m);
});
