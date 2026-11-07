// Aree vaste (issue #3, spec v1.2 del CPO del 6/11, D121 A): mappa province → area, accensione a 36 profili con almeno
// il 40% di donne, contatore «mancano N» e testo della zona. Solo calcoli, nessun dato vero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AREE, areaDi, accesa, mancano, testoZona, testoContatore, conteggiPerArea } from "../api/aree.js";
import { PROVINCE, ESTERO } from "../worker/province.js";

test("ogni provincia italiana (107) appartiene a esattamente un'area", () => {
  assert.equal(PROVINCE.length, 107);
  for (const [sigla] of PROVINCE) {
    const dentro = AREE.filter((a) => a.province.includes(sigla));
    assert.ok(dentro.length <= 1, `${sigla} in più aree`);
    const a = areaDi(sigla);
    assert.ok(a && a.codice && a.nome, `${sigla} senza area`);
    assert.ok(a.province.includes(sigla));
  }
  // nessuna sigla inventata nella mappa
  const sigle = new Set(PROVINCE.map((p) => p[0]));
  for (const a of AREE) for (const s of a.province) assert.ok(sigle.has(s), `${s} non è una provincia`);
});

test("mappa iniziale di progetto/aree-vaste: 9 aree, stessa regione, province non elencate da sole", () => {
  assert.equal(AREE.length, 9);
  assert.deepEqual(areaDi("MB"), areaDi("MI"));
  assert.equal(areaDi("MI").codice, "milano");
  assert.equal(areaDi("MI").nome, "Milano e dintorni");
  assert.equal(areaDi("LT").codice, "roma");
  assert.equal(areaDi("PD").codice, "venezia-padova");
  const regione = new Map(PROVINCE.map(([s, , r]) => [s, r]));
  for (const a of AREE) assert.equal(new Set(a.province.map((s) => regione.get(s))).size, 1, `${a.codice}: regioni diverse`);
  assert.notEqual(areaDi("NO").codice, "milano", "Novara (Piemonte) resta fuori da Milano");
  assert.deepEqual(areaDi("LE"), { codice: "le", nome: "Lecce", province: ["LE"] });
  assert.deepEqual(areaDi("RE"), { codice: "re", nome: "Reggio Emilia", province: ["RE"] });
  assert.equal(areaDi(ESTERO), null, "dall'estero nessuna area");
  assert.equal(areaDi("XX"), null);
  assert.equal(areaDi(undefined), null);
});

test("accensione: 36 profili e 14 donne (38,9%) no; 15 (41,7%) sì; 35 profili no", () => {
  assert.equal(accesa({ totale: 36, donne: 14 }), false);
  assert.equal(accesa({ totale: 36, donne: 15 }), true);
  assert.equal(accesa({ totale: 35, donne: 20 }), false);
  assert.equal(accesa({ totale: 50, donne: 20 }), true, "40% esatto basta");
  assert.equal(accesa({ totale: 50, donne: 19 }), false);
  assert.equal(accesa({}), false);
});

test("contatore: mancano persone, mancano donne, entrambi (si mostra il numero più alto)", () => {
  // persone = quanti mancano a 36; donne = il minimo di donne in più che da sole accendono l'area.
  // mancano persone: 29 profili, 15 donne → 7 persone (bastano 7 persone qualsiasi; 7 donne accenderebbero lo stesso)
  assert.deepEqual(mancano({ totale: 29, donne: 15 }), { persone: 7, donne: 7 });
  // mancano solo donne: 40 profili, 13 donne
  const soloDonne = mancano({ totale: 40, donne: 13 });
  assert.equal(soloDonne.persone, 0);
  assert.ok(accesa({ totale: 40 + soloDonne.donne, donne: 13 + soloDonne.donne }));
  assert.ok(!accesa({ totale: 39 + soloDonne.donne, donne: 12 + soloDonne.donne }), "il numero è il minimo");
  // entrambi: 30 profili, 5 donne → servono più donne che persone
  const entrambi = mancano({ totale: 30, donne: 5 });
  assert.equal(entrambi.persone, 6);
  assert.ok(entrambi.donne > entrambi.persone);
  assert.ok(accesa({ totale: 30 + entrambi.donne, donne: 5 + entrambi.donne }));
  // area già accesa: zero e zero, mai negativi
  assert.deepEqual(mancano({ totale: 80, donne: 40 }), { persone: 0, donne: 0 });
  assert.deepEqual(mancano({}), { persone: 36, donne: 36 });

  const milano = areaDi("MI");
  assert.equal(testoContatore(milano, { totale: 29, donne: 15 }),
    "Milano e dintorni: mancano 7 persone per aprire le stanze della tua zona. Intanto entri nella Stanza Italia.");
  assert.equal(testoContatore(milano, { totale: 40, donne: 13 }),
    `Milano e dintorni: ci siete quasi. Servono ancora ${soloDonne.donne} donne per aprire le stanze. Invita un'amica.`);
  assert.equal(testoContatore(milano, { totale: 30, donne: 5 }),
    `Milano e dintorni: ci siete quasi. Servono ancora ${entrambi.donne} donne per aprire le stanze. Invita un'amica.`);
  assert.equal(testoContatore(milano, { totale: 35, donne: 20 }),
    "Milano e dintorni: manca 1 persona per aprire le stanze della tua zona. Intanto entri nella Stanza Italia.");
  assert.equal(testoContatore(milano, { totale: 39, donne: 15 }),
    "Milano e dintorni: ci siete quasi. Serve ancora 1 donna per aprire le stanze. Invita un'amica.");
  assert.equal(testoContatore(milano, { totale: 36, donne: 15 }), null, "area accesa: nessun contatore");
});

test("testo della zona sotto la provincia", () => {
  assert.equal(testoZona("MB"),
    "La tua zona: Milano e dintorni (Milano, Monza e Brianza, Lodi, Pavia, Como, Varese, Lecco)");
  assert.equal(testoZona("LE"), "La tua zona: Lecce");
  assert.equal(testoZona(ESTERO), null);
});

test("conteggi per area dai profili completi: solo totale e donne; non binario conta nei 36 ma non nel 40%", () => {
  const profili = [
    { provincia: "MI", presento: "donna" }, { provincia: "MB", presento: "uomo" }, { provincia: "LO", presento: "non_binario" },
    { provincia: "LE", presento: "mi_descrivo" }, { provincia: ESTERO, presento: "donna" }, { provincia: null, presento: "donna" },
  ];
  assert.deepEqual(conteggiPerArea(profili), { milano: { totale: 3, donne: 1 }, le: { totale: 1, donne: 0 } });
});
