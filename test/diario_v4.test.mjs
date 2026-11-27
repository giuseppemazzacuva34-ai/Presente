// Design v4 (#349, D149), schermata 32 «Il diario» (linea C): occhiello «Il tuo diario · <nome>», la domanda come
// titolo serif, campo scuro con il testo in corsivo serif, nota piccola, «Salta» e «Salva» in 3D sulla stessa riga
// in fondo (1 : 1,7 come il piede del prototipo). Valori dal prototipo docs/design/v4 (#n22, .app h2/.campo/.piede).
// Tutto finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schermataDiario } from "../landing/app/moduli/diario.js";

const leggi = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

test("schermataDiario: occhiello «Il tuo diario · <nome>», senza nome solo «Il tuo diario»; niente più titolo vecchio", () => {
  assert.equal(schermataDiario("Marco").occhiello, "Il tuo diario · Marco");
  assert.equal(schermataDiario(undefined).occhiello, "Il tuo diario");
  assert.equal(schermataDiario("Marco").titolo, undefined);
});

test("schermo: occhiello, domanda come h1, campo legato al titolo, nota, Salta prima di Salva", () => {
  const f = leggi("../landing/app/moduli/flusso.js");
  const blocco = f.slice(f.indexOf('sc.tipo === "diario") {'), f.indexOf('sc.tipo === "dopo_fine") {'));
  assert.match(blocco, /h\("p", \{ classe: "passo" \}, sc\.occhiello\)/);
  assert.match(blocco, /h\("h1", \{ id: "domanda-diario" \}, sc\.suggerimento\)/);
  assert.match(blocco, /"aria-labelledby": "domanda-diario"/);
  assert.doesNotMatch(blocco, /h\("label"/, "la domanda non è più ripetuta in un'etichetta");
  assert.ok(blocco.indexOf("sc.salta") < blocco.indexOf("sc.salva"), "Salta a sinistra, Salva a destra");
});

test("stile: piede 1fr 1.7fr allineato, campo scuro in serif corsivo, titolo serif 31px", () => {
  const css = leggi("../landing/app/app.css");
  assert.match(css, /\.chiamata:has\(\.azioni-diario\) \.azioni-diario \{[^}]*grid-template-columns: 1fr 1\.7fr;[^}]*align-items: stretch;/);
  assert.match(css, /\.chiamata:has\(\.azioni-diario\) #testo-diario \{[^}]*background: #1A171D;[^}]*font-style: italic;/);
  assert.match(css, /\.chiamata:has\(\.azioni-diario\) h1 \{[^}]*font-size: 31px;/);
  assert.doesNotMatch(leggi("../landing/app/sw.js"), /const VERSIONE = "presente-app-75";/);
});
