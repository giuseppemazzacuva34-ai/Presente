// Design v4 (issue #349, schermata 37 «La porta»; D149 A; linea A del CTO): la sera con le porte aperte la porta è la
// prima schermata della home, alta quanto il telefono, e la scena (sagoma, luce, ante) passa anche dietro la testata
// (saldo, logo, profilo) come nel design. La settimana e «La tua stanza» restano sotto. Senza porte niente cambia.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
const regola = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `manca la regola ${sel}`);
  return m[2];
};

test("flusso: con le porte la sera va in cima alla home e non si ripete in «La tua stanza»", () => {
  assert.match(flusso, /function seraInCima\(\) \{\s*return seraConPorte\(\);\s*\}/);
  assert.match(flusso, /seraInCima\(\) \? null : bloccoSera\(\)/, "in «La tua stanza» solo quando non è in cima");
  assert.match(flusso, /seraInCima\(\) \? h\("div", \{ classe: "sera-in-cima" \}, bloccoSera\(\)\) : null/, "in cima alla home");
  // La schermata 36 del Filo e l'animazione restano dentro lo stesso blocco (stessa espressione di prima).
  assert.match(flusso, /vistaSeraFilo\(h, filoDomenica, chiaviStanza, \(\) => vistaSera\(h, chiaviStanza, \{ svelamento \}\)\)/);
});

test("la prima porta riempie lo schermo e la scena sale dietro la testata", () => {
  const p = regola(".app .sera-in-cima .chiavi-sera > .porta-v4:first-child");
  assert.match(p, /min-height:\s*calc\(100dvh - 112px\)/);
  assert.match(p, /overflow-x:\s*clip/);
  assert.match(p, /overflow-y:\s*visible/);
  assert.match(regola(".app .sera-in-cima .chiavi-sera > .porta-v4:first-child > .porta-v4-scena"), /top:\s*-112px/);
});

test("la testata resta sopra la scena, trasparente", () => {
  const t = regola(".pagina.app:has(.sera-in-cima .porta-v4) > .testata");
  assert.match(t, /position:\s*relative/);
  assert.match(t, /z-index:\s*1/);
  assert.match(t, /background:\s*transparent/);
});

test("il service worker cambia versione", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(!sw.includes('"presente-app-86"'), "versione della cache aumentata");
});

// Regressione (#545 + #530, segnalata dalla linea C il 28/11): alle 21 la stanza è chiusa, quindi la home usa
// homePrimaDellaStanza; anche lì, con le porte, la sera deve stare in cima, sopra la settimana.
test("con la stanza chiusa (home prima della stanza) la sera con le porte resta in cima", () => {
  const corpo = flusso.match(/function homePrimaDellaStanza\(corpo, dopo\) \{([\s\S]*?)\n\}/);
  assert.ok(corpo, "manca homePrimaDellaStanza");
  const f = corpo[1];
  const sera = f.indexOf('seraInCima() ? h("div", { classe: "sera-in-cima" }, bloccoSera()) : null');
  const settimana = f.indexOf("vistaSettimanaHome(");
  assert.ok(sera >= 0, "la sera manca nella home prima della stanza");
  assert.ok(sera < settimana, "la sera va sopra la settimana");
});

test("con la porta in cima il piede di «Ci sarò lunedì» non resta attaccato sopra la porta", () => {
  assert.match(regola(".app .home-prima:has(> .sera-in-cima .porta-v4) > .azioni-home"), /position:\s*static/);
});
