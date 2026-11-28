// Design v4 (issue #349, schermata 20 «Fissa una chiamata»; D149 A; linea A del CTO): la schermata come il design.
// Titolo serif 34px con «con <nome>.» corsivo rosso; GIORNO e ORA piccoli e spaziati; giorni e ore su una griglia
// di 3 caselle uguali e rettangolari; messaggio nel riquadro scuro in corsivo (l'etichetta resta per il lettore di
// schermo ma non si vede); ANNULLA e PROPONI in fondo allo schermo. Nessun cambio di regole o di richieste.
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

test("schermata alta quanto il telefono, pulsanti in fondo", () => {
  assert.match(regola(".app .fissa-chiamata"), /display:\s*flex[^;]*;[^}]*flex-direction:\s*column[^}]*min-height:\s*calc\(100dvh - 140px\)/);
  assert.match(regola(".app .fissa-chiamata .azioni"), /margin-top:\s*auto/);
  assert.ok(!/\n\.fissa-chiamata \.azioni \{/.test(css), "il vecchio piede flex non scavalca più il piede comune 1 : 1,7");
});

test("titolo come le altre schermate v4: serif 34px, «con <nome>.» corsivo rosso", () => {
  assert.match(regola(".app .fissa-chiamata h1"), /font-size:\s*34px/);
  assert.match(regola(".app .fissa-chiamata h1 em"), /font-style:\s*italic[^}]*color:\s*#E8432B/);
});

test("giorni e ore: griglia di 3 caselle uguali, rettangolari, alte almeno 44px", () => {
  assert.match(regola(".app .fissa-chiamata .scelte"), /display:\s*grid[^}]*grid-template-columns:\s*repeat\(3, 1fr\)/);
  const s = regola(".app .fissa-chiamata .scelte .scelta");
  assert.match(s, /border-radius:\s*12px/);
  assert.match(s, /min-height:\s*44px/);
  assert.match(s, /width:\s*100%/);
});

test("GIORNO e ORA piccoli, grigi e spaziati come il design", () => {
  const e = regola(".app .fissa-chiamata .etichetta");
  assert.match(e, /font-size:\s*10\.5px/);
  assert.match(e, /letter-spacing:\s*0\.2em/);
  assert.match(e, /color:\s*#A8A29A/);
});

test("messaggio: riquadro scuro in corsivo, etichetta solo per il lettore di schermo", () => {
  const t = regola(".app .fissa-chiamata textarea");
  assert.match(t, /border-radius:\s*16px/);
  assert.match(t, /background:\s*#1A171C/);
  assert.match(t, /font-style:\s*italic/);
  assert.ok(flusso.includes('h("label", { for: "fissa-messaggio", classe: "solo-lettore" }, TESTI_FISSA.messaggio)'),
    "l'etichetta c'è ancora (accessibilità) ma non si vede");
});

test("il service worker cambia versione", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(!sw.includes('"presente-app-85"'), "versione della cache aumentata");
});
