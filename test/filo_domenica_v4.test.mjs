// Design v4 (#349, D149), schermata 36 «Il Filo · le porte aperte» (linea C): tutto centrato, occhiello piccolo
// maiuscolo, attacco in serif corsivo, il numero grande rosso sopra la frase, la riga rossa in corsivo dentro il
// titolo (come «<em>» del prototipo), nota piccola, scheda del vocale con bordo rosso e cerchio «!» vuoto, pulsante
// in fondo. Valori dal prototipo docs/design/v4 (#madrina-domenica: .passo, .big-n, .madr, .app h2, .nota).
// I testi restano quelli della spec #360 (D151 A). Tutto finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaFiloDomenica, vistaFiloDomenica } from "../landing/app/moduli/filo_domenica.js";

const leggi = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };

const conPorte = (numero) => {
  const f = async (p) => ({ ok: true, status: 200, json: async () => (String(p).includes("/porte")
    ? { ok: true, porte: { numero } } : { ok: false }) });
  return creaFiloDomenica({ token: () => "tok", fetch: f });
};

test("titolo: numero, frase e riga rossa in corsivo («em») nello stesso h2, la riga rossa dopo un a capo", async () => {
  const fd = conPorte(3);
  await fd.prepara();
  const v = vistaFiloDomenica(h, fd);
  const h2 = tutti(v, (x) => x.tag === "h2")[0];
  assert.equal(testo(h2), "3 porte si sono aperte.Ora scopri se una è la tua.");
  const em = tutti(h2, (x) => x.tag === "em");
  assert.equal(em.length, 1);
  assert.equal(em[0].a.classe, "filo-riga-rossa");
  assert.equal(tutti(h2, (x) => x.tag === "br").length, 1);
  assert.equal(tutti(v, (x) => x.tag === "p" && (x.a.classe || "").includes("filo-riga-rossa")).length, 0, "niente più riga rossa in un paragrafo a parte");
});

test("zero porte: nel titolo solo la frase, niente «em» né a capo", async () => {
  const fd = conPorte(0);
  await fd.prepara();
  const h2 = tutti(vistaFiloDomenica(h, fd), (x) => x.tag === "h2")[0];
  assert.equal(testo(h2), "Questa settimana nessuna porta si è aperta.");
  assert.equal(tutti(h2, (x) => x.tag === "em" || x.tag === "br").length, 0);
});

test("stile: centrato, numero grande serif rosso su una riga sua, riga rossa in corsivo, scheda con bordo rosso, pulsante in fondo", () => {
  const css = leggi("../landing/app/app.css");
  assert.match(css, /\.app \.filo-domenica \{[^}]*flex-direction: column;[^}]*text-align: center;/);
  assert.match(css, /\.app \.filo-domenica \.passo \{[^}]*text-transform: uppercase;/);
  assert.match(css, /\.app \.filo-domenica \.filo-attacco \{[^}]*font-style: italic;/);
  assert.match(css, /\.app \.filo-domenica \.filo-numero \{[^}]*display: block;[^}]*font-size: 92px;/);
  assert.match(css, /\.app \.filo-domenica h2 \{[^}]*font-size: 28px;/);
  assert.match(css, /\.app \.filo-domenica \.filo-riga-rossa \{[^}]*font-style: italic;/);
  assert.match(css, /\.app \.filo-domenica \.filo-scheda \{[^}]*border: 1px solid #E8432B;/);
  assert.match(css, /\.app \.filo-domenica \.bottone \{[^}]*margin-top: auto;/);
  assert.doesNotMatch(leggi("../landing/app/sw.js"), /const VERSIONE = "presente-app-76";/);
});
