// «Ricarica» del profilo (schermata 23) apre la schermata 13 «I tuoi crediti» (#349, linea «sviluppatore-b», passo 3;
// spec #331 v1.1 punto 5). In beta «Paga» resta spento nella 13: nessun pagamento. Rete finta, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { statoProfilo, vistaProfilo, creaSchermoProfilo } from "../landing/app/moduli/profilo.js";

const leggiFile = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (typeof n === "string" ? n : n.f.map(testo).join(""));
const tutti = (n, pred, out = []) => { if (typeof n === "object") { if (pred(n)) out.push(n); n.f.forEach((x) => tutti(x, pred, out)); } return out; };
const ricarica = (v) => tutti(v, (x) => x.tag === "button" && testo(x) === "Ricarica")[0];
const fn = () => {};
const PIENO = { nome: "Giulia", eta: 33, citta: "Milano", voce: null, saldo: 145, regali: 17, inStanza: false };

test("vista: con l'azione ricarica il pulsante è acceso e la chiama", () => {
  let n = 0;
  const v = vistaProfilo(h, statoProfilo(PIENO), { torna: fn, ricarica: () => { n++; } });
  const b = ricarica(v);
  assert.equal(b.a.disabled, false);
  b.a.onclick();
  assert.equal(n, 1);
});

test("vista: senza l'azione ricarica il pulsante resta spento (nessun pulsante morto acceso)", () => {
  const b = ricarica(vistaProfilo(h, statoProfilo(PIENO), { torna: fn }));
  assert.equal(b.a.disabled, true);
  assert.equal(b.a.onclick, undefined);
});

test("schermo: ricorda se la prima stanza in regalo è già usata (dal server), altrimenti null", async () => {
  const s = creaSchermoProfilo({ coin: { saldo: async () => ({ ok: true, saldo: 40, primaStanzaUsata: false }) } });
  assert.equal(s.primaStanzaUsata(), null);
  await s.apri();
  assert.equal(s.primaStanzaUsata(), false);
  s.chiudi();
  assert.equal(s.primaStanzaUsata(), null);
  const t = creaSchermoProfilo({ coin: { saldo: async () => ({ ok: true, saldo: 40, primaStanzaUsata: "sì" }) } });
  await t.apri();
  assert.equal(t.primaStanzaUsata(), null);
});

test("flusso: «Ricarica» del profilo apre la 13 sopra il profilo, una volta sola, col saldo del server", () => {
  const f = leggiFile("../landing/app/moduli/flusso.js");
  assert.match(f, /import \{ apriTuoiCoin \} from "\.\/tuoi_coin\.js";/);
  assert.match(f, /import \{ schermataTuoiCoin \} from "\.\/saldo_coin\.js";/);
  assert.match(f, /ricarica: d\.saldo === null \? null : \(\) => apriCreditiDalProfilo\(d\.saldo\),/);
  assert.match(f, /function apriCreditiDalProfilo\(saldo\) \{\n  if \(document\.querySelector\("\.tuoi-coin"\)\) return;/);
  // Se non sappiamo se la prima stanza è stata usata, niente frase del regalo (mai promesse non vere).
  assert.match(f, /schermataTuoiCoin\(saldo, \{ primaStanzaUsata: schermoProfilo\.primaStanzaUsata\(\) !== false \}\)/);
  assert.match(f, /\{ principale: document\.getElementById\("app"\) \}/);
});

test("service worker con versione nuova", () => {
  assert.ok(!leggiFile("../landing/app/sw.js").includes('"presente-app-59"'));
});
