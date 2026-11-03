// Test della tabella delle province (D84 A). Nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVINCE, REGIONI, daSigla, provinciaDaZona, perProvincia, opzioniMenu, nomeProvincia } from "../worker/province.js";

test("107 province, sigle uniche, 20 regioni", () => {
  assert.equal(PROVINCE.length, 107);
  assert.equal(new Set(PROVINCE.map((p) => p[0])).size, 107);
  assert.equal(REGIONI.length, 20);
  assert.equal(opzioniMenu().length, 108);
  assert.equal(nomeProvincia("EE"), "Vivo all'estero");
});

test("dal menu: sigla → zona, città, provincia, regione; valori strani rifiutati", () => {
  assert.deepEqual(daSigla("MI"), { provincia: "MI", regione: "Lombardia", zona: "milano", citta: null });
  assert.deepEqual(daSigla("PD"), { provincia: "PD", regione: "Veneto", zona: "venezia-padova", citta: null });
  assert.deepEqual(daSigla("FC"), { provincia: "FC", regione: "Emilia-Romagna", zona: "altra-citta-italia", citta: "forli cesena" });
  assert.equal(daSigla("EE").zona, "estero");
  for (const v of ["mi", "XX", "", null, "RM;", "Roma"]) assert.equal(daSigla(v), null, String(v));
});

test("iscritti già in lista: provincia solo quando è sicura", () => {
  assert.equal(provinciaDaZona("milano", null), "MI");
  assert.equal(provinciaDaZona("cagliari", null), "CA");
  assert.equal(provinciaDaZona("estero", null), "EE");
  assert.equal(provinciaDaZona("venezia-padova", null), null);
  assert.equal(provinciaDaZona("brescia-bergamo", null), null);
  assert.equal(provinciaDaZona("altra-citta-italia", "lecce"), "LE");
  assert.equal(provinciaDaZona("altra-citta-italia", "l aquila"), "AQ");
  assert.equal(provinciaDaZona("altra-citta-italia", "monza"), "MB");
  assert.equal(provinciaDaZona("altra-citta-italia", "sanremo"), null);
  assert.equal(provinciaDaZona("altra-citta-italia", null), null);
  assert.equal(provinciaDaZona("non-indicata", null), null);
});

test("/conteggio: totali per regione e per provincia, sigle sconosciute ignorate, province sotto 10 in «altre»", async () => {
  const DB = { prepare: () => ({ all: async () => ({ results: [{ provincia: "RM", n: 12 }, { provincia: "LT", n: 1 }, { provincia: "EE", n: 2 }, { provincia: "ZZ", n: 9 }] }) }) };
  assert.deepEqual(await perProvincia({ DB }), { per_regione: { Lazio: 13, Estero: 2 }, per_provincia: { RM: 12, altre: 3 } });
  const rotto = { prepare: () => ({ all: async () => { throw new Error("no such column: provincia"); } }) };
  assert.deepEqual(await perProvincia({ DB: rotto }), { per_regione: {}, per_provincia: {} });
});
