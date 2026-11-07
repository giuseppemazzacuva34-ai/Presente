// «La tua zona» nella web app (issue #3, spec v1.2 del CPO, D121 A): testo sotto la provincia nel profilo e scelta
// del raggio «Solo la mia zona · <area>». La mappa è UNA sola (landing/app/moduli/aree.js), la usano anche i calcoli
// del server (api/aree.js): così telefono e server non possono mai dire due zone diverse. Nessun dato vero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as app from "../landing/app/moduli/aree.js";
import * as server from "../api/aree.js";
import { PROVINCE, ESTERO } from "../worker/province.js";

test("una sola mappa: il server usa le stesse aree dell'app", () => {
  assert.equal(server.AREE, app.AREE);
  for (const [sigla] of [...PROVINCE, [ESTERO], [""], ["XX"]]) {
    assert.deepEqual(app.areaDi(sigla), server.areaDi(sigla), sigla);
    assert.equal(app.testoZona(sigla), server.testoZona(sigla), sigla);
  }
});

test("profilo: «La tua zona» con le province dell'area; da sola senza parentesi; estero niente", () => {
  assert.equal(app.testoZona("MB"), "La tua zona: Milano e dintorni (Milano, Monza e Brianza, Lodi, Pavia, Como, Varese, Lecco)");
  assert.equal(app.testoZona("NO"), "La tua zona: Novara");
  assert.equal(app.testoZona(ESTERO), null);
  assert.equal(app.testoZona(""), null);
});

test("raggio: «Solo la mia zona · <area>»; senza area solo «Solo la mia zona»", () => {
  assert.equal(app.etichettaRaggio("LT"), "Solo la mia zona · Roma e dintorni");
  assert.equal(app.etichettaRaggio("NO"), "Solo la mia zona · Novara");
  assert.equal(app.etichettaRaggio(ESTERO), "Solo la mia zona");
  assert.equal(app.etichettaRaggio(""), "Solo la mia zona");
});

test("la web app mostra la zona e non parla più di «Solo la mia provincia»", () => {
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.ok(!flusso.includes("Solo la mia provincia"));
  assert.match(flusso, /etichettaRaggio\(stato\.provincia\)/);
  assert.match(flusso, /testoZona\(stato\.provincia\)/);
  assert.match(flusso, /\["italia", "Anche altre città"\]/);
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"/app/moduli/aree.js"'), "il service worker tiene anche aree.js");
});
