// Design v4 (#349, D149), schermata 24 «La chiamata · Squilla»: sopra il titolo «Chiamata N di 3 con <nome>»,
// titolo «Stai chiamando» con il nome sotto in rosso corsivo, onda che pulsa, «Squilla… N s», CHIUDI in fondo.
// N è la chiamata che sta squillando: quelle già fatte con questa persona nella settimana (dal server, stessa regola
// del limite di 3) + 1, mai oltre 3. Tutto finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { schermata } from "../landing/app/moduli/chiamata.js";
import { creaTelefono } from "../landing/app/moduli/telefono.js";
import { readFileSync } from "node:fs";

const leggi = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const SQUILLA = { fase: "squilla", io: "chiama", altra: ID2, squillo: 4 };

test("squillo in uscita: occhiello «Chiamata N di 3 con <nome>» e nome a parte", () => {
  const sc = schermata(SQUILLA, { nomeAltra: "Marco", giaFatte: 1 });
  assert.equal(sc.tipo, "squillo_in_uscita");
  assert.equal(sc.occhiello, "Chiamata 2 di 3 con Marco");
  assert.equal(sc.nome, "Marco");
  assert.equal(sc.testo, "Squilla… 4 s");
  assert.deepEqual(sc.pulsanti, ["chiudi"]);
});

test("squillo in uscita: prima chiamata se il server non dice niente; numeri strani riportati tra 1 e 3", () => {
  assert.equal(schermata(SQUILLA, { nomeAltra: "Marco" }).occhiello, "Chiamata 1 di 3 con Marco");
  assert.equal(schermata(SQUILLA, { nomeAltra: "Marco", giaFatte: -2 }).occhiello, "Chiamata 1 di 3 con Marco");
  assert.equal(schermata(SQUILLA, { nomeAltra: "Marco", giaFatte: 2.5 }).occhiello, "Chiamata 1 di 3 con Marco");
  assert.equal(schermata(SQUILLA, { nomeAltra: "Marco", giaFatte: 9 }).occhiello, "Chiamata 3 di 3 con Marco");
});

test("squillo in uscita senza nome: niente «con», mai «undefined»", () => {
  const sc = schermata(SQUILLA, { giaFatte: 0 });
  assert.equal(sc.occhiello, "Chiamata 1 di 3");
  assert.equal(sc.nome, "");
  assert.ok(!JSON.stringify(sc).includes("undefined"));
});

test("squillo in arrivo: nessun occhiello (il design 24 è solo per chi chiama)", () => {
  const sc = schermata({ ...SQUILLA, io: "riceve" }, { nomeAltra: "Marco", giaFatte: 1 });
  assert.equal(sc.tipo, "squillo_in_arrivo");
  assert.equal(sc.occhiello, undefined);
});

const telefono = () => creaTelefono({
  compagni: { leggi: async () => ({ ok: true, persone: [{ id: ID1, nome: "Giulia", eta: 34, citta: "Torino" }, { id: ID2, nome: "Marco", eta: 38, citta: "Asti" }] }) },
  linea: { chiama: async (id) => ({ ok: true, vista: { fase: "squilla", io: "chiama", altra: id, squillo: 30 } }) },
  chiamata: { pulsanti: async () => ({ ok: true, pulsanti: [], chiamate: [{ id: ID2, n: 1 }] }) },
  voce: { muto: () => {}, chiudi: () => {} },
  subito: () => {},
});

test("telefono: lo squillo usa le chiamate già fatte con quella persona (dal server)", async () => {
  const t = telefono();
  await t.caricaPersone();
  await t.chiama(ID2);
  assert.equal(t.modello().schermo.occhiello, "Chiamata 2 di 3 con Marco");
});

test("telefono: con chi non ho ancora chiamato lo squillo è la chiamata 1 di 3", async () => {
  const t = telefono();
  await t.caricaPersone();
  await t.chiama(ID1);
  assert.equal(t.modello().schermo.occhiello, "Chiamata 1 di 3 con Giulia");
});

test("schermo: occhiello, nome in <em>, onda grande, CHIUDI rosso in fondo; classe squillo-uscita", () => {
  const f = leggi("../landing/app/moduli/flusso.js");
  const blocco = f.slice(f.indexOf('sc.tipo === "squillo_in_uscita") {'), f.indexOf('sc.tipo === "in_corso") {'));
  assert.match(blocco, /h\("p", \{ classe: "passo" \}, sc\.occhiello\)/);
  assert.match(blocco, /h\("em", \{\}, sc\.nome\)/);
  assert.match(blocco, /ondaGrande\(\)/);
  assert.match(blocco, /bottone\("Chiudi", \(\) => t\.chiudi\(false\), \{ classe: "bottone" \}\)/);
  assert.doesNotMatch(blocco, /role: "status"/, "il conto di ogni secondo non va letto ad alta voce");
  assert.match(f, /" squillo-uscita"/);
});

test("stile: nome rosso corsivo sotto, onda ferma con meno movimento (regola comune), cache nuova", () => {
  const css = leggi("../landing/app/app.css");
  assert.match(css, /\.chiamata\.squillo-uscita h1 em \{ display: block; font-style: italic; color: #E8432B; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.onda-grande span \{ animation: none; \} \}/);
  assert.doesNotMatch(leggi("../landing/app/sw.js"), /const VERSIONE = "presente-app-73";/);
});
