// «Il profilo» (schermata 23 del design v4, issue #349; linea «sviluppatore-b», passo 2: aggancio).
// Il cerchio in alto a destra apre il profilo; crediti e regali letti dal server all'apertura; «Modifica il profilo» e
// «Elimina il mio account» escono dalla home. Rete finta, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaSchermoProfilo, collegaCerchio } from "../landing/app/moduli/profilo.js";

const leggiFile = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const attesa = () => new Promise((r) => setTimeout(r, 0));

function prepara({ coin = { ok: true, saldo: 145, primaStanzaUsata: true }, regali = { ok: true, vista: { totale: { rosa: 12, spumante: 4, fiori: 1 } } } } = {}) {
  let disegni = 0;
  const letture = { coin: 0, regali: 0 };
  const s = creaSchermoProfilo({
    coin: { saldo: async () => { letture.coin++; if (coin === "lancia") throw new Error("giù"); return coin; } },
    storico: { leggi: async () => { letture.regali++; if (regali === "lancia") throw new Error("giù"); return regali; } },
    disegna: () => { disegni++; },
  });
  return { s, letture, disegni: () => disegni };
}

test("chiuso all'inizio; apri: subito aperto senza numeri, poi saldo e somma dei regali dal server", async () => {
  const p = prepara();
  assert.equal(p.s.aperto(), false);
  const fatto = p.s.apri();
  assert.equal(p.s.aperto(), true);
  assert.deepEqual(p.s.dati(), { saldo: null, regali: null });
  await fatto;
  assert.deepEqual(p.s.dati(), { saldo: 145, regali: 17 });
  assert.deepEqual(p.letture, { coin: 1, regali: 1 });
  assert.ok(p.disegni() >= 2);
});

test("se il server non risponde i numeri restano vuoti (mai inventati) e il profilo resta aperto", async () => {
  const p = prepara({ coin: "lancia", regali: { ok: false, motivo: "rete" } });
  await p.s.apri();
  assert.deepEqual(p.s.dati(), { saldo: null, regali: null });
  assert.equal(p.s.aperto(), true);
  const q = prepara({ coin: { ok: true, saldo: -1 }, regali: "lancia" });
  await q.s.apri();
  assert.deepEqual(q.s.dati(), { saldo: null, regali: null });
});

test("chiudi: torna chiuso e una lettura arrivata dopo non riapre né ridisegna con numeri vecchi", async () => {
  const p = prepara();
  const fatto = p.s.apri();
  p.s.chiudi();
  assert.equal(p.s.aperto(), false);
  await fatto;
  assert.equal(p.s.aperto(), false);
  assert.deepEqual(p.s.dati(), { saldo: null, regali: null });
});

test("senza lettori (anteprima) apri non chiama la rete", async () => {
  let disegni = 0;
  const s = creaSchermoProfilo({ disegna: () => { disegni++; } });
  await s.apri();
  assert.equal(s.aperto(), true);
  assert.deepEqual(s.dati(), { saldo: null, regali: null });
  await attesa();
  assert.ok(disegni >= 1);
});

function finto() {
  const b = { hidden: true, textContent: "", onclick: null };
  return { b, doc: { getElementById: (id) => (id === "apri-profilo" ? b : null) } };
}

test("cerchio: con nome e azione mostra l'iniziale e apre il profilo; senza, resta nascosto", () => {
  const { b, doc } = finto();
  let aperture = 0;
  collegaCerchio(doc, { nome: " giulia ", apri: () => { aperture++; } });
  assert.equal(b.hidden, false);
  assert.equal(b.textContent, "G");
  b.onclick();
  assert.equal(aperture, 1);
  collegaCerchio(doc, { nome: "", apri: () => {} });
  assert.equal(b.hidden, true);
  assert.equal(b.onclick, null);
  collegaCerchio(doc, { nome: "Giulia", apri: null });
  assert.equal(b.hidden, true);
  collegaCerchio({ getElementById: () => null }, { nome: "Giulia", apri: () => {} }); // senza testata non si rompe
});

test("flusso: profilo a tutta pagina dopo i regali; cerchio solo nella home; Modifica ed Elimina solo nel profilo", () => {
  const f = leggiFile("../landing/app/moduli/flusso.js");
  assert.match(f, /import \{ creaSchermoProfilo, collegaCerchio, statoProfilo, vistaProfilo \} from "\.\/profilo\.js";/);
  assert.match(f, /schermoProfilo = telefono && opzioni\.coinProfilo \? creaSchermoProfilo\(\{ coin: opzioni\.coinProfilo, storico: opzioni\.storicoRegali, disegna: \(\) => disegna\(\) \}\) : null;/);
  const iRegali = f.indexOf("if (regaliProfilo && regaliProfilo.aperto())");
  const iProfilo = f.indexOf("if (schermoProfilo && schermoProfilo.aperto())");
  assert.ok(iRegali > 0 && iProfilo > iRegali, "«Torna al profilo» dai regali deve riportare al profilo");
  assert.match(f, /collegaCerchio\(document, \{ nome: nomeMio\(\), apri: profiloApribile\(\) \? \(\) => schermoProfilo\.apri\(\) : null \}\);/);
  // Il cerchio apre il profilo solo nella home completa e mai durante una chiamata.
  assert.match(f, /function profiloApribile\(\) \{\n  if \(!schermoProfilo \|\| PASSI\[stato\.passo\]\.id !== "fatto"\) return false;\n  try \{ return !telefono \|\| telefono\.modello\(\)\.schermo\.tipo === "nessuna"; \} catch \{ return false; \}/);
  assert.match(f, /risposte: daQui\("risposte"\), foto: daQui\("foto"\), preferenze: daQui\("cerchi"\),/);
  // Nella home restano «Modifica»/«Elimina» solo se il profilo non c'è (anteprima).
  assert.match(f, /archivio && !schermoProfilo\s*\n?\s*\? \[h\("button", \{ classe: "bottone-secondario", type: "button", onclick: \(\) => vai\(4\) \}, "Modifica il profilo"\)/);
});

test("avvio: coinProfilo col token di chi usa l'app; service worker con profilo.js e versione nuova", () => {
  const avvio = leggiFile("../landing/app/avvio.js");
  assert.match(avvio, /const coinProfilo = creaCoinServer\(\{ token: \(\) => accesso\.token\(\), fetch: window\.fetch\.bind\(window\) \}\);/);
  assert.match(avvio, /return \{[^}]*\bcoinProfilo\b[^}]*\};/);
  const sw = leggiFile("../landing/app/sw.js");
  assert.ok(sw.includes('"/app/moduli/profilo.js"'));
  assert.ok(!sw.includes('"presente-app-54"'));
});

test("home: «I tuoi regali» resta solo nel profilo quando il profilo c'è (niente link doppi)", () => {
  const f = leggiFile("../landing/app/moduli/flusso.js");
  assert.match(f, /regaliProfilo && !schermoProfilo \? h\("button", \{ classe: "link", type: "button", onclick: \(\) => regaliProfilo\.apri\(\) \}, TESTI_REGALI_PROFILO\.link\) : null/);
  // Dal profilo la riga «Regali ricevuti» apre ancora la stessa schermata.
  assert.match(f, /regali: regaliProfilo \? \(\) => regaliProfilo\.apri\(\) : null,/);
  const sw = leggiFile("../landing/app/sw.js");
  assert.ok(!sw.includes('"presente-app-55"'), "service worker con versione nuova");
});
