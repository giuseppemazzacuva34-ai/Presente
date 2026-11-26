// Parità grafica dell'iscrizione con le schermate v4 (D149, 26/11: l'app deve essere identica al design).
// Confronto immagine contro immagine di /app/prova.html (400x867) con docs/design/v4/schermate/01-12 (ramo design/app-v4):
// 1) durante l'iscrizione niente pillola dei crediti né cerchio del profilo (nel design non ci sono);
// 2) la schermata riempie il telefono e i pulsanti stanno in fondo, sempre nello stesso punto;
// 3) la barra rossa parte già piena per il passo 1 (passo n di 10 = n/10);
// 4) l'etichetta sta dentro il riquadro del campo (email, nome, provincia);
// 5) benvenuto: «Informativa privacy · Regole della stanza» subito sopra «ENTRA».
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
const regola = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = [...css.matchAll(new RegExp(`(^|\\n)${esc} \\{([^}]*)\\}`, "g"))];
  assert.ok(m.length, `manca ${sel}`);
  return m.map((x) => x[2]).join(";");
};
const corpo = (inizio, fine) => flusso.slice(flusso.indexOf(inizio), flusso.indexOf(fine, flusso.indexOf(inizio)));

test("durante l'iscrizione la pagina lo sa (classe in-iscrizione), fuori no", () => {
  const d = corpo("function disegna() {", "\n}\n");
  assert.match(d, /document\.body\.classList\.toggle\("in-iscrizione", inIscrizione\(\)\)/);
  const f = corpo("function inIscrizione() {", "\n}\n");
  assert.match(f, /PASSI\[stato\.passo\]\.id !== "fatto"/);
  assert.match(f, /!cambio\.daProfilo/);
});

test("in iscrizione niente saldo dei crediti né cerchio del profilo", () => {
  assert.match(regola("body.in-iscrizione .saldo-coin, body.in-iscrizione .icona-profilo"), /display: none !important/);
});

test("in iscrizione la schermata riempie il telefono e i pulsanti vanno in fondo", () => {
  assert.match(regola("body.in-iscrizione #app"), /min-height: calc\(100dvh - \d+px\)/);
  assert.match(regola("body.in-iscrizione #app"), /display: flex/);
  const s = regola("body.in-iscrizione #app > .schermata");
  assert.match(s, /flex: 1/);
  assert.match(s, /display: flex/);
  assert.match(s, /flex-direction: column/);
  assert.match(regola("body.in-iscrizione #app > .schermata > .azioni"), /margin-top: auto/);
});

test("barra: passo n di 10 riempie n/10 (al passo 1 già un tratto rosso)", () => {
  const b = corpo("function barra() {", "\n}\n");
  assert.match(b, /const totale = PASSI\.length - 1;/);
  assert.match(b, /\(stato\.passo \/ totale\) \* 100/);
  assert.match(b, /Passo \$\{stato\.passo\} di \$\{totale\}/);
  assert.match(b, /"aria-valuemax": String\(totale\), "aria-valuenow": String\(stato\.passo\)/);
});

test("etichetta dentro il riquadro: email, nome di battesimo, provincia", () => {
  assert.match(flusso, /function campoDentro\(id, etichetta, campo\) \{\n  return h\("div", \{ classe: "campo-dentro" \}, h\("label", \{ for: id \}, etichetta\), campo\);/);
  assert.match(corpo("  email() {", "  eta() {"), /campoDentro\("email", "Email", campo\)/);
  assert.match(flusso, /campoDentro\("email", "Email", campo\), errore\(email\.errore\)/, "anche con l'accesso vero");
  const c = corpo("  chi() {", "  cerchi() {");
  assert.match(c, /campoDentro\("nome", "Nome di battesimo", h\("input", \{ id: "nome"/);
  assert.match(c, /campoDentro\("provincia", "Provincia", campoProvincia\)/);
  // La spiegazione resta per il lettore di schermo, nascosta alla vista come nel design.
  assert.match(c, /h\("p", \{ classe: "solo-lettore", id: "provincia-aiuto" \}/);
  const box = regola(".app .campo-dentro");
  for (const r of [/background-color: #1A171D/, /border: 1px solid rgba\(242, 237, 228, 0\.3\)/, /border-radius: 12px/]) assert.match(box, r);
  assert.match(regola(".app .campo-dentro label"), /font-size: 12px/);
  assert.match(regola(".app .corpo .campo-dentro input"), /border: 0/);
  assert.match(regola(".app .campo-dentro:focus-within"), /outline: 2px solid #F2EDE4/);
  assert.match(regola(".solo-lettore"), /clip: rect\(0 0 0 0\)/);
});

test("benvenuto: «Informativa privacy · Regole della stanza» sopra «ENTRA», niente «(in arrivo)»", () => {
  const b = corpo("  benvenuto() {", "  email() {");
  assert.match(b, /"Informativa privacy"\), " · Regole della stanza"\),\n\s+h\("div", \{ classe: "azioni" \}/);
  assert.doesNotMatch(b, /in arrivo/);
  assert.match(regola(".benvenuto-v4 .nota"), /margin: auto 0 0/);
  assert.match(regola("body.in-iscrizione #app > .benvenuto-v4 > .azioni"), /margin-top: 0/);
  // Onda e titolo al centro dello spazio libero, come nel design.
  assert.match(regola(".benvenuto-v4 .onda-grande"), /margin-top: auto/);
});

test("cache dell'app rinnovata (nuovo app.css e flusso.js anche offline)", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.doesNotMatch(sw, /const VERSIONE = "presente-app-67";/);
});
