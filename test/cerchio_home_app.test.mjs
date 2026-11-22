// Design v4 (issue #349, schermata 16 «La home»; prototipo cerchio([])): sotto il conto alla rovescia il cerchio
// dei 12 posti della stanza, uomini a sinistra e donne a destra, con «tu» in rosso dalla tua parte (donna in alto a
// destra, uomo in alto a sinistra). Nessun dato di altre persone: solo il proprio «mi presento come».
// Per «non binario» e «preferisco descrivermi» il cerchio non c'è finché il CPO non dice come disporre la stanza.
// Le posizioni stanno nel CSS (classi k0…k11): la CSP dell'app vieta gli stili scritti negli attributi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vistaCerchioHome, TESTI_SETTIMANA } from "../landing/app/moduli/settimana_home.js";

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testi = (n) => (typeof n === "string" ? [n] : n && n.f ? n.f.flatMap(testi) : []);
const trova = (n, pred) => (!n || typeof n !== "object" ? [] : [...(pred(n) ? [n] : []), ...(n.f || []).flatMap((x) => trova(x, pred))]);
const posti = (v) => trova(v, (n) => n.tag === "i" && /\bp\b/.test(n.a.classe || ""));

test("donna: 12 posti, «tu» in alto a destra (k0), etichette Uomini a sinistra e Donne a destra", () => {
  const v = vistaCerchioHome(h, "donna");
  assert.equal(v.a.classe, "cerchio");
  assert.equal(v.a.role, "img");
  assert.equal(v.a["aria-label"], TESTI_SETTIMANA.cerchioDonna);
  const p = posti(v);
  assert.equal(p.length, 12);
  assert.deepEqual(p.map((x) => x.a.classe.match(/k(\d+)/)[1]).map(Number), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(p.filter((x) => /\btu\b/.test(x.a.classe)).map((x) => x.a.classe), ["p k0 tu"]);
  assert.deepEqual(testi(v), ["Uomini", "Donne"]);
  const et = trova(v, (n) => /\bet\b/.test(n.a.classe || ""));
  assert.deepEqual(et.map((x) => x.a.classe), ["et sx", "et dx"]);
  assert.ok(trova(v, (n) => n.a.classe === "asse").length === 1);
});

test("uomo: «tu» in alto a sinistra (k11)", () => {
  const p = posti(vistaCerchioHome(h, "uomo"));
  assert.deepEqual(p.filter((x) => /\btu\b/.test(x.a.classe)).map((x) => x.a.classe), ["p k11 tu"]);
  assert.equal(vistaCerchioHome(h, "uomo").a["aria-label"], TESTI_SETTIMANA.cerchioUomo);
});

test("non binario, preferisco descrivermi o dato mancante: niente cerchio (aspetta il CPO)", () => {
  for (const x of ["non_binario", "mi_descrivo", "", undefined, "<b>"]) assert.equal(vistaCerchioHome(h, x), null);
});

test("stili: cerchio 190 px, posti k0…k11 con le posizioni del prototipo, niente stili negli attributi", () => {
  const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
  assert.match(css, /\.cerchio\s*\{[^}]*width:\s*190px[^}]*height:\s*190px/);
  assert.match(css, /\.cerchio \.p\.k0\s*\{\s*left:\s*116\.2px;\s*top:\s*15\.8px;\s*\}/);
  assert.match(css, /\.cerchio \.p\.k6\s*\{\s*left:\s*73\.8px;\s*top:\s*174\.2px;\s*\}/);
  assert.match(css, /\.cerchio \.p\.k11\s*\{\s*left:\s*73\.8px;\s*top:\s*15\.8px;\s*\}/);
  assert.match(css, /\.cerchio \.p\.tu\s*\{[^}]*#E8432B/i);
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.ok(flusso.includes("vistaCerchioHome(h, stato.miPresento)"));
});
