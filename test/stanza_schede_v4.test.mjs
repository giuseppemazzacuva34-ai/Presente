// Design v4 (issue #349, schermata 19 «La stanza», prototipo #n14; D149 A; linea A del CTO), primo passo: le schede
// delle persone come nel design. Una riga per persona, senza riquadro, con una linea sottile sotto: a sinistra nome
// e stato, a destra CHIAMA/FISSA (3D scuro) e DAI UNA CHIAVE (3D rosso) sulla stessa riga. «Manda un regalo» e «⋯»
// (segnala, blocca) restano, piccoli, nella riga sotto. Gli altri stati della scheda (frase data, appunti, menu
// aperto) vanno a tutta larghezza sotto, come prima. Nomi inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vistaSchedaChiave } from "../landing/app/moduli/chiavi_stanza.js";

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const trova = (n, pred) => (!n || typeof n !== "object" ? [] : [...(pred(n) ? [n] : []), ...(n.f || []).flatMap((x) => trova(x, pred))]);
const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");

test("«Dai una chiave» nella scheda è il pulsante rosso (bottone), come nel design 19", () => {
  const ks = { scheda: () => ({ dai: "Dai una chiave" }), apriDai: () => {} };
  const v = vistaSchedaChiave(h, ks, "p1", "Marco");
  const b = trova(v, (n) => n.tag === "button");
  assert.equal(b.length, 1);
  assert.equal(b[0].a.classe, "bottone");
  assert.equal(b[0].a["aria-label"], "Dai una chiave a Marco");
});

test("con la chiave già data restano i link «Modifica la frase» e «Riprendi la chiave»", () => {
  const ks = { scheda: () => ({ segno: "Hai dato una chiave", modifica: "Modifica la frase", riprendi: "Riprendi la chiave" }), apriFrase: () => {}, apriRiprendi: () => {} };
  const b = trova(vistaSchedaChiave(h, ks, "p1", "Marco"), (n) => n.tag === "button");
  assert.deepEqual(b.map((x) => x.a.classe), ["link", "link"]);
});

test("stili: la scheda è una griglia senza riquadro, con la linea sotto", () => {
  assert.match(css, /\.tua-stanza \.compagno\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto auto/);
  assert.match(css, /\.tua-stanza \.compagno\s*\{[^}]*border:\s*0[^}]*border-bottom:\s*1px solid/);
  assert.match(css, /\.tua-stanza \.compagno > \*\s*\{\s*grid-column:\s*1 \/ -1;\s*\}/);
});

test("stili: nome e stato a sinistra, Chiama/Fissa e Dai una chiave a destra sulla prima riga", () => {
  assert.match(css, /\.tua-stanza \.compagno > div:first-child\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1/);
  assert.match(css, /\.tua-stanza \.compagno > \.bottone-secondario\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1/);
  assert.match(css, /\.tua-stanza \.compagno > \.chiave-scheda:has\(> \.bottone:only-child\)\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1/);
});

test("stili: «Manda un regalo» e «⋯» piccoli nella seconda riga, «⋯» a destra e grande almeno 44 px", () => {
  assert.match(css, /\.tua-stanza \.compagno > \.regali-scheda\s*\{[^}]*grid-row:\s*2/);
  assert.match(css, /\.tua-stanza \.compagno > button\.link\[aria-expanded\]\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*2;[^}]*justify-self:\s*end/);
  assert.match(css, /\.compagno > button\[aria-expanded\]\s*\{\s*min-width:\s*44px;\s*min-height:\s*44px;/);
});

test("il service worker cambia versione (schede della stanza)", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(!sw.includes('"presente-app-79"'), "versione della cache aumentata");
});
