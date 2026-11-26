// «Esci» nel profilo (schermata 23, #349, linea B): richiesta diretta di Giuseppe del 26/11. Pulsante secondario 3D
// sopra «Elimina il mio account»; chiude la sessione e riporta al Benvenuto. Nessuna conferma in più. Nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { statoProfilo, vistaProfilo, TESTI_PROFILO } from "../landing/app/moduli/profilo.js";

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (typeof n === "string" ? n : n.f.map(testo).join(""));
const tutti = (n, pred, out = []) => { if (typeof n === "object") { if (pred(n)) out.push(n); n.f.forEach((x) => tutti(x, pred, out)); } return out; };
const pulsanti = (n) => tutti(n, (x) => x.tag === "button");
const fn = () => {};
const S = statoProfilo({ nome: "Giulia", eta: 33, citta: "Milano" });
const AZ = { risposte: fn, regali: fn, foto: fn, preferenze: fn, elimina: fn, torna: fn };

test("testo del pulsante: «Esci»", () => {
  assert.equal(TESTI_PROFILO.esci, "Esci");
});

test("«Esci» è un pulsante secondario 3D, subito sopra «Elimina il mio account»", () => {
  let chiamato = 0;
  const v = vistaProfilo(h, S, { ...AZ, esci: () => { chiamato++; } });
  const b = pulsanti(v);
  const i = b.findIndex((x) => testo(x) === "Esci");
  const j = b.findIndex((x) => testo(x) === "Elimina il mio account");
  assert.ok(i >= 0, "manca «Esci»");
  assert.equal(j, i + 1, "«Esci» deve stare subito sopra «Elimina il mio account»");
  assert.equal(b[i].a.classe, "bottone-secondario");
  assert.equal(b[i].a.type, "button");
  b[i].a.onclick();
  assert.equal(chiamato, 1, "un clic, una uscita: nessuna conferma in più");
});

test("senza l'azione «Esci» (anteprima senza account) il pulsante non c'è", () => {
  const v = vistaProfilo(h, S, AZ);
  assert.ok(!pulsanti(v).some((x) => testo(x) === "Esci"));
});
