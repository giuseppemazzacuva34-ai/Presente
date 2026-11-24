// Issue #380 spec v1 punto 2 (passo 3): cerchio ed elenco della stanza divisi tra uomini e donne (schermata 19).
// - Uomini nella metà sinistra, donne nella destra, posti in proporzione e a distanza uguale dentro ogni metà.
// - Non binari o senza risposta: in basso al centro, tra le due metà.
// - Stanza di un solo genere: cerchio intero, senza divisione né etichette «Uomini · N» / «Donne · N».
// - Elenco: «Uomini · N», «Donne · N», «Altre persone · N»; dentro ogni gruppo l'ordine dei suggerimenti di oggi.
// - Chi guarda è nella sua metà con «(tu)» (in cima alla sua metà) e non è nell'elenco.
// Le posizioni sono coordinate in un riquadro 190×190 (centro 95,95, raggio 82): l'app le disegna in SVG, perché la
// CSP vieta gli stili scritti negli attributi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { disponiStanza, vistaCerchioStanza, CERCHIO } from "../landing/app/moduli/stanza_viva.js";

// Angolo in gradi, in senso orario partendo dall'alto (0 = ore 12, 90 = ore 3, 180 = ore 6, 270 = ore 9).
const angoloEsatto = ({ x, y }) => (((Math.atan2(x - CERCHIO.centro, CERCHIO.centro - y) * 180) / Math.PI) + 360) % 360;
const angolo = (p) => Math.round(angoloEsatto(p) * 10) / 10;
const gente = (n, presento, da = 0) => Array.from({ length: n }, (_, i) => ({ id: `${presento}-${da + i}`, presento }));
const passi = (angoli) => angoli.slice(1).map((a, i) => Math.round(Math.abs(a - angoli[i]) * 10) / 10);
const delGruppo = (d, g) => d.posti.filter((p) => p.gruppo === g);

test("6 + 6 vista da una donna: donne a destra (tu in cima), uomini a sinistra, ogni 30°", () => {
  const io = { id: "io", presento: "donna" };
  const d = disponiStanza([...gente(6, "uomo"), ...gente(5, "donna")], io);
  assert.equal(d.diviso, true);
  assert.equal(d.posti.length, 12);
  const donne = delGruppo(d, "donne").map(angolo);
  const uomini = delGruppo(d, "uomini").map(angolo);
  assert.deepEqual(donne, [15, 45, 75, 105, 135, 165]);
  assert.deepEqual(uomini, [345, 315, 285, 255, 225, 195]);
  assert.ok(delGruppo(d, "donne").every((p) => p.x > CERCHIO.centro));
  assert.ok(delGruppo(d, "uomini").every((p) => p.x < CERCHIO.centro));
  const tu = d.posti.filter((p) => p.tu);
  assert.equal(tu.length, 1);
  assert.equal(tu[0].id, "io");
  assert.equal(angolo(tu[0]), 15);
});

test("8 donne + 4 uomini: 8 posti a destra e 4 a sinistra, a distanza uguale dentro ogni metà", () => {
  const d = disponiStanza([...gente(4, "uomo"), ...gente(7, "donna")], { id: "io", presento: "donna" });
  const donne = delGruppo(d, "donne").map(angoloEsatto);
  const uomini = delGruppo(d, "uomini").map(angoloEsatto);
  assert.equal(donne.length, 8);
  assert.equal(uomini.length, 4);
  assert.ok(donne.every((a) => a > 0 && a < 180));
  assert.ok(uomini.every((a) => a > 180 && a < 360));
  assert.deepEqual([...new Set(passi(donne))], [22.5]);
  assert.deepEqual([...new Set(passi(uomini))], [45]);
});

test("uomo che guarda: «tu» in cima alla metà sinistra", () => {
  const d = disponiStanza([...gente(5, "uomo"), ...gente(6, "donna")], { id: "io", presento: "uomo" });
  const tu = d.posti.find((p) => p.tu);
  assert.equal(tu.gruppo, "uomini");
  assert.equal(angolo(tu), 345);
});

test("12 dello stesso genere: cerchio intero, nessuna divisione, posti ogni 30°", () => {
  const d = disponiStanza(gente(11, "donna"), { id: "io", presento: "donna" });
  assert.equal(d.diviso, false);
  assert.deepEqual(d.posti.map(angolo), [15, 45, 75, 105, 135, 165, 195, 225, 255, 285, 315, 345]);
  assert.equal(d.posti[0].tu, true);
  assert.deepEqual(d.elenco.map((g) => g.titolo), [null]);
  assert.equal(d.elenco[0].persone.length, 11);
});

test("5 + 5 + 2 altre persone: le altre in basso al centro, simmetriche, tutti a 30° di distanza", () => {
  const altre = [{ id: "nb", presento: "non_binario" }, { id: "md", presento: "mi_descrivo" }];
  const d = disponiStanza([...gente(5, "uomo"), ...gente(4, "donna"), ...altre], { id: "io", presento: "donna" });
  assert.equal(d.diviso, true);
  assert.deepEqual(delGruppo(d, "altre").map(angolo), [165, 195]);
  assert.ok(delGruppo(d, "altre").every((p) => p.y > CERCHIO.centro));
  assert.deepEqual(delGruppo(d, "donne").map(angolo), [15, 45, 75, 105, 135]);
  assert.deepEqual(delGruppo(d, "uomini").map(angolo), [345, 315, 285, 255, 225]);
});

test("chi si presenta in altro modo, valori sconosciuti o mancanti finiscono tra le altre persone", () => {
  const strani = [{ id: "a", presento: "<b>" }, { id: "b" }, { id: "c", presento: "" }];
  const d = disponiStanza([...gente(3, "uomo"), ...gente(3, "donna"), ...strani], { id: "io", presento: "non_binario" });
  const altre = delGruppo(d, "altre");
  assert.deepEqual(altre.map((p) => p.id), ["io", "a", "b", "c"]);
  assert.equal(altre[0].tu, true);
});

test("elenco: Uomini · N, Donne · N, Altre persone · N, senza chi guarda e nell'ordine dei suggerimenti", () => {
  const persone = [
    { id: "d1", presento: "donna" }, { id: "u1", presento: "uomo" }, { id: "x1", presento: "non_binario" },
    { id: "u2", presento: "uomo" }, { id: "d2", presento: "donna" },
  ];
  const d = disponiStanza(persone, { id: "io", presento: "donna" });
  assert.deepEqual(d.elenco.map((g) => g.titolo), ["Uomini · 2", "Donne · 2", "Altre persone · 1"]);
  assert.deepEqual(d.elenco.map((g) => g.persone.map((p) => p.id)), [["u1", "u2"], ["d1", "d2"], ["x1"]]);
  assert.ok(d.elenco.every((g) => g.persone.every((p) => p.id !== "io")));
});

test("elenco senza altre persone: nessun gruppo vuoto; un solo genere con altre: solo «Altre persone · N» ha il titolo", () => {
  const a = disponiStanza([...gente(2, "uomo"), ...gente(2, "donna")], { id: "io", presento: "uomo" });
  assert.deepEqual(a.elenco.map((g) => g.titolo), ["Uomini · 2", "Donne · 2"]);
  const b = disponiStanza([...gente(4, "donna"), { id: "x", presento: "non_binario" }], { id: "io", presento: "donna" });
  assert.equal(b.diviso, false);
  assert.deepEqual(b.elenco.map((g) => g.titolo), [null, "Altre persone · 1"]);
});

test("la stessa persona due volte, o chi guarda dentro l'elenco, conta una volta sola", () => {
  const d = disponiStanza([{ id: "u", presento: "uomo" }, { id: "u", presento: "uomo" }, { id: "io", presento: "donna" }],
    { id: "io", presento: "donna" });
  assert.equal(d.posti.length, 2);
  assert.deepEqual(d.elenco.map((g) => g.titolo), ["Uomini · 1"]);
});

// ── Vista: SVG con i posti, etichette e asse solo se divisa; stato sempre anche a parole (WCAG 1.4.1). ──
const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testi = (n) => (typeof n === "string" ? [n] : n && n.f ? n.f.flatMap(testi) : []);
const trova = (n, pred) => (!n || typeof n !== "object" ? [] : [...(pred(n) ? [n] : []), ...(n.f || []).flatMap((x) => trova(x, pred))]);

test("vista divisa: svg con 12 cerchi, asse, etichette Uomini/Donne e descrizione a parole", () => {
  const d = disponiStanza([...gente(6, "uomo"), ...gente(5, "donna")], { id: "io", presento: "donna" });
  const v = vistaCerchioStanza(h, d);
  assert.equal(v.a.classe, "cerchio-stanza");
  assert.equal(v.a.role, "img");
  assert.equal(v.a["aria-label"], "La tua stanza: 6 uomini a sinistra, 6 donne a destra. Il tuo posto è a destra.");
  const svg = trova(v, (n) => n.tag === "svg");
  assert.equal(svg.length, 1);
  assert.equal(svg[0].a.viewBox, "0 0 190 190");
  assert.equal(svg[0].a["aria-hidden"], "true");
  const cerchi = trova(v, (n) => n.tag === "circle");
  assert.equal(cerchi.length, 12);
  assert.ok(cerchi.every((c) => /^\d+(\.\d)?$/.test(c.a.cx) && /^\d+(\.\d)?$/.test(c.a.cy)));
  assert.deepEqual(cerchi.filter((c) => /\btu\b/.test(c.a.class)).length, 1);
  assert.equal(trova(v, (n) => n.tag === "line" && n.a.class === "asse").length, 1);
  assert.deepEqual(testi(v), ["Uomini", "Donne"]);
  // Nessun attributo style (CSP dell'app: style-src 'self').
  assert.equal(trova(v, (n) => "style" in n.a).length, 0);
});

test("vista con altre persone e di un solo genere: descrizioni e niente asse né etichette quando non è divisa", () => {
  const a = disponiStanza([...gente(5, "uomo"), ...gente(4, "donna"), { id: "x", presento: "non_binario" }, { id: "y" }], { id: "io", presento: "donna" });
  assert.equal(vistaCerchioStanza(h, a).a["aria-label"],
    "La tua stanza: 5 uomini a sinistra, 5 donne a destra, 2 altre persone in basso. Il tuo posto è a destra.");
  const b = disponiStanza(gente(11, "uomo"), { id: "io", presento: "uomo" });
  const v = vistaCerchioStanza(h, b);
  assert.equal(v.a["aria-label"], "La tua stanza: 12 persone in cerchio. Il tuo posto è in alto.");
  assert.equal(trova(v, (n) => n.tag === "line").length, 0);
  assert.deepEqual(testi(v), []);
  const c = disponiStanza(gente(5, "uomo"), { id: "io", presento: "non_binario" });
  assert.equal(vistaCerchioStanza(h, c).a["aria-label"], "La tua stanza: 6 persone in cerchio. Il tuo posto è in alto.");
});

test("lo stato di ogni posto diventa una classe (on, ch); sconosciuti e non in linea restano senza", () => {
  const d = disponiStanza([{ id: "u1", presento: "uomo" }, { id: "u2", presento: "uomo" }, { id: "d1", presento: "donna" }], { id: "io", presento: "donna" });
  const v = vistaCerchioStanza(h, d, { stati: { u1: "online", u2: "in_chiamata", d1: "<script>" } });
  const classi = Object.fromEntries(trova(v, (n) => n.tag === "circle").map((c) => [c.a["data-id"] ?? "?", c.a.class]));
  assert.equal(classi.u1, "p on");
  assert.equal(classi.u2, "p ch");
  assert.equal(classi.d1, "p");
});

test("lo stile dei posti SVG è nel CSS dell'app e il modulo è nella cache del service worker", () => {
  const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
  assert.match(css, /\.cerchio-stanza svg \.p\s*\{/);
  assert.match(css, /\.cerchio-stanza svg \.p\.tu\s*\{/);
  assert.match(css, /\.cerchio-stanza svg \.p\.ch\s*\{/);
  assert.match(css, /prefers-reduced-motion[\s\S]*\.cerchio-stanza svg \.p\.on/);
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /"\/app\/moduli\/stanza_viva\.js"/);
});

test("h() dell'app crea gli elementi SVG nello spazio dei nomi giusto", () => {
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.match(flusso, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg"/);
});
