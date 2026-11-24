// «I tuoi regali» dal profilo (schermata 28 del design v4, issue #349; linea «sviluppatore-b», passo 4).
// Pannello che apre la schermata dal profilo, la legge e torna indietro; aggancio minimo in flusso.js, avvio.js e sw.js.
// Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaSchermoRegali, TESTI_STORICO } from "../landing/app/moduli/storico_regali.js";

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (typeof n === "string" ? n : n.f.map(testo).join(""));
const tutti = (n, pred, out = []) => { if (typeof n === "object") { if (pred(n)) out.push(n); n.f.forEach((x) => tutti(x, pred, out)); } return out; };
const leggiFile = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const VISTA = { titolo: "Hai ricevuto 2 regali.", totale: { rosa: 2, spumante: 0, fiori: 0 }, attuale: null, passate: null };
const attesa = () => new Promise((r) => setTimeout(r, 0));

function prepara(risposta) {
  let disegni = 0;
  let letture = 0;
  const storico = { leggi: async () => { letture++; if (risposta === "lancia") throw new Error("giù"); return risposta; } };
  const s = creaSchermoRegali({ storico, disegna: () => { disegni++; }, errore: (m) => `errore:${m}` });
  return { s, disegni: () => disegni, letture: () => letture };
}

test("testo del link nel profilo: «I tuoi regali»", () => {
  assert.equal(TESTI_STORICO.link, "I tuoi regali");
});

test("chiuso all'inizio; apri: subito «Un attimo…», poi la vista letta dal server", async () => {
  const p = prepara({ ok: true, vista: VISTA });
  assert.equal(p.s.aperto(), false);
  const fatto = p.s.apri();
  assert.equal(p.s.aperto(), true);
  const prima = p.s.schermo(h);
  assert.equal(prima.tag, "section");
  assert.equal(prima.a["aria-label"], "I tuoi regali");
  assert.match(testo(prima), /Un attimo…/);
  await fatto;
  assert.equal(p.letture(), 1);
  assert.ok(p.disegni() >= 2);
  assert.match(testo(p.s.schermo(h)), /Hai ricevuto2 regali\./);
});

test("errore di lettura o rete giù: messaggio dal flusso e «Torna al profilo»", async () => {
  for (const [r, atteso] of [[{ ok: false, motivo: "accesso" }, "errore:accesso"], ["lancia", "errore:rete"]]) {
    const p = prepara(r);
    await p.s.apri();
    const v = p.s.schermo(h);
    assert.match(testo(v), new RegExp(atteso));
    const b = tutti(v, (x) => x.tag === "button");
    assert.equal(b.length, 1);
    assert.equal(testo(b[0]), "Torna al profilo");
  }
});

test("«Torna al profilo» chiude e ridisegna; una risposta arrivata dopo la chiusura non riapre", async () => {
  let libera;
  let disegni = 0;
  const storico = { leggi: () => new Promise((r) => { libera = r; }) };
  const s = creaSchermoRegali({ storico, disegna: () => { disegni++; }, errore: () => "x" });
  const fatto = s.apri();
  const b = tutti(s.schermo(h), (x) => x.tag === "button")[0];
  b.a.onclick();
  assert.equal(s.aperto(), false);
  const dopoChiusura = disegni;
  await attesa();
  libera({ ok: true, vista: VISTA });
  await fatto;
  await attesa();
  assert.equal(s.aperto(), false);
  assert.equal(disegni, dopoChiusura);
});

test("flusso: link «I tuoi regali» nel profilo e schermata a tutta pagina, solo con il telefono acceso", () => {
  const flusso = leggiFile("../landing/app/moduli/flusso.js");
  assert.match(flusso, /import \{ creaSchermoRegali, TESTI_STORICO as TESTI_REGALI_PROFILO \} from "\.\/storico_regali\.js";/);
  assert.match(flusso, /regaliProfilo = telefono && opzioni\.storicoRegali \? creaSchermoRegali\(\{ storico: opzioni\.storicoRegali, disegna: \(\) => disegna\(\),/);
  assert.match(flusso, /if \(regaliProfilo && regaliProfilo\.aperto\(\)\) \{ radice\.replaceChildren\(regaliProfilo\.schermo\(h\)\); return; \}/);
  assert.match(flusso, /regaliProfilo(?: && !schermoProfilo)? \? h\("button", \{ classe: "link", type: "button", onclick: \(\) => regaliProfilo\.apri\(\) \}, TESTI_REGALI_PROFILO\.link\) : null/);
});

test("avvio: lettura col token di chi usa l'app e passata al flusso come storicoRegali", () => {
  const avvio = leggiFile("../landing/app/avvio.js");
  assert.match(avvio, /import \{ creaStoricoRegali \} from "\/app\/moduli\/storico_regali\.js";/);
  assert.match(avvio, /const storicoRegali = creaStoricoRegali\(\{ token: \(\) => accesso\.token\(\), fetch: window\.fetch\.bind\(window\) \}\);/);
  assert.match(avvio, /return \{[^}]*\bstoricoRegali\b[^}]*\};/);
});

test("service worker: storico_regali.js nella cache e versione nuova", () => {
  const sw = leggiFile("../landing/app/sw.js");
  assert.ok(sw.includes('"/app/moduli/storico_regali.js"'));
  assert.ok(!sw.includes('"presente-app-46"'));
});
