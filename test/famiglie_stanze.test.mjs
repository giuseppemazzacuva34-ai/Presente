// Issue #471 (spec v1 del CPO, parte C): stanze dedicate. Il lavoro del lunedì divide le persone in famiglie
// (mista, dedicata uomini, dedicata donne, aperta) prima di comporre. Solo persone inventate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compatibili, generiCercati, famigliaPropria, assegnaFamiglie, gruppiPerFamiglia, componi } from "../api/stanze.js";
import { preparaSettimana, PASSO_COMPLETO } from "../api/settimana.js";
import { oraDiRoma } from "../api/stanze.js";
import { DOMANDE } from "../api/questionario.js";

let n = 0;
const p = (presento, cerco, altro = {}) => ({
  id: `p${String(++n).padStart(4, "0")}`, eta: 30, presento, zona: "milano", citta: "milano", paese: "IT",
  cerco, eta_min: 18, eta_max: 60, raggio: "italia", stanzePrecedenti: 0, ...altro,
});
const molti = (k, ...a) => Array.from({ length: k }, () => p(...a));

test("«Voglio incontrare» a più scelte: elenco o testo di prima, «tutti» = tutte e tre", () => {
  assert.deepEqual([...generiCercati(["donne", "non_binari"])].sort(), ["donna", "mi_descrivo", "non_binario"]);
  assert.deepEqual([...generiCercati("tutti")].sort(), ["donna", "mi_descrivo", "non_binario", "uomo"]);
  assert.deepEqual([...generiCercati("uomini")], ["uomo"]);
  assert.equal(generiCercati(null).size, 0);
  // Compatibilità con l'elenco: uomo che vuole incontrare uomini e non binari, persona non binaria che cerca tutti.
  assert.equal(compatibili(p("uomo", ["uomini", "non_binari"]), p("non_binario", ["donne", "uomini", "non_binari"])), true);
  assert.equal(compatibili(p("uomo", ["donne"]), p("non_binario", ["donne", "uomini", "non_binari"])), false);
});

test("famiglia propria: mista, dedicata uomini, dedicata donne, aperta; più scelte = ponte (null)", () => {
  assert.equal(famigliaPropria(p("uomo", "donne")), "mista");
  assert.equal(famigliaPropria(p("donna", ["uomini"])), "mista");
  assert.equal(famigliaPropria(p("uomo", ["uomini"])), "uomini");
  assert.equal(famigliaPropria(p("donna", "donne")), "donne");
  assert.equal(famigliaPropria(p("non_binario", ["non_binari"])), "aperta");
  assert.equal(famigliaPropria(p("donna", ["donne", "uomini"])), null);
  assert.equal(famigliaPropria(p("uomo", "tutti")), null);
});

test("criterio 6: 20 uomini→uomini, 20 donne→uomini, 20 uomini→donne: stanze di soli uomini→uomini, mai in stanze miste", () => {
  const mm = molti(20, "uomo", ["uomini"]), wm = molti(20, "donna", ["uomini"]), mw = molti(20, "uomo", ["donne"]);
  const persone = [...mm, ...wm, ...mw];
  const fam = assegnaFamiglie(persone);
  const g = gruppiPerFamiglia(persone, fam, { conto: {} });
  assert.ok(g["italia:uomini"]?.length === 20);
  const idMM = new Set(mm.map((x) => x.id));
  let dedicate = 0;
  for (const [chiave, gruppo] of Object.entries(g)) {
    if (chiave === "attesa_citta") continue;
    for (const stanza of componi(gruppo).stanze) {
      const quanti = stanza.filter((id) => idMM.has(id)).length;
      assert.ok(quanti === 0 || quanti === stanza.length, `${chiave}: uomini→uomini insieme ad altri`);
      if (quanti) dedicate++;
    }
  }
  assert.ok(dedicate >= 1, "almeno una stanza di soli uomini che cercano uomini");
});

test("criterio 7: persona bisessuale con 5 compatibili nella mista e 8 nella dedicata entra nella dedicata", () => {
  const bi = p("donna", ["donne", "uomini"]);
  const miste = molti(5, "uomo", ["donne"]);
  const dedicate = molti(8, "donna", ["donne"]);
  const fam = assegnaFamiglie([bi, ...miste, ...dedicate]);
  assert.equal(fam.get(bi.id), "donne");
  // E al contrario: più compatibili nella mista → mista.
  const bi2 = p("donna", ["donne", "uomini"]);
  const fam2 = assegnaFamiglie([bi2, ...molti(9, "uomo", ["donne"]), ...molti(3, "donna", ["donne"])]);
  assert.equal(fam2.get(bi2.id), "mista");
});

test("ponte a parità di compatibili: va nella famiglia con meno persone", () => {
  const bi = p("donna", ["donne", "uomini"]);
  // 4 uomini→donne compatibili + 6 donne→uomini (non compatibili con lei) nella mista; 4 donne→donne nella dedicata.
  const fam = assegnaFamiglie([bi, ...molti(4, "uomo", ["donne"]), ...molti(6, "donna", ["uomini"]), ...molti(4, "donna", ["donne"])]);
  assert.equal(fam.get(bi.id), "donne");
});

test("criterio 8: area con 36 uomini→uomini e 0 donne: si accende la stanza d'area dedicata, la mista no", () => {
  const mm = molti(36, "uomo", ["uomini"], { zona: "bologna", citta: "bologna" });
  const mw = molti(10, "uomo", ["donne"], { zona: "bologna", citta: "bologna" });
  const persone = [...mm, ...mw];
  const g = gruppiPerFamiglia(persone, assegnaFamiglie(persone));
  assert.equal(g["citta:bologna:uomini"]?.length, 36);
  assert.equal(g["citta:bologna"], undefined);
  assert.equal(g.italia?.length, 10, "la mista va nella Stanza Italia");
});

test("una famiglia dedicata sotto 36 nell'area: chi ha «Solo la mia zona» resta in attesa, gli altri nella Stanza Italia dedicata", () => {
  const vicini = molti(10, "donna", ["donne"], { zona: "bari", citta: "bari", raggio: "citta" });
  const lontane = molti(10, "donna", ["donne"], { zona: "bari", citta: "bari", raggio: "italia" });
  const persone = [...vicini, ...lontane];
  const g = gruppiPerFamiglia(persone, assegnaFamiglie(persone));
  assert.equal(g.attesa_citta.length, 10);
  assert.equal(g["italia:donne"].length, 10);
});

test("criterio 9: 5 donne→donne in tutta Italia: nessuna stanza, restano in attesa", () => {
  const persone = molti(5, "donna", ["donne"]);
  const g = gruppiPerFamiglia(persone, assegnaFamiglie(persone));
  const { stanze, inAttesa } = componi(g["italia:donne"]);
  assert.equal(stanze.length, 0);
  assert.equal(inAttesa.length, 5);
});

// ── Lavoro del lunedì completo: righe del database → stanze; la famiglia non finisce mai nelle righe scritte. ──
const LUNEDI = oraDiRoma(2026, 11, 30, 9);
const risposte = () => Object.fromEntries(DOMANDE.map((d) => [d.n, d.tipo === "multipla" ? Array.from({ length: d.min }, (_, i) => i) : d.tipo === "scala" ? d.min : 0]));
let k = 0;
function riga(presento, cerco, altro = {}) {
  const id = `r${String(++k).padStart(4, "0")}`;
  return {
    profilo: { id, passo: PASSO_COMPLETO, nome: "Prova", data_nascita: "1995-01-15", citta: "Milano", provincia: "MI", paese: "IT", mi_presento_come: presento },
    filtri: { cerco, consenso_cerco_il: "2026-11-20T10:00:00Z", eta_min: 18, eta_max: 60, raggio: "italia", ...altro },
    questionario: [{ in_vigore_dal: "2026-11-02T08:00:00Z", versione: "v1", risposte: risposte(),
      importanza: { valori: 2, ritmi: 2, soldi: 2, famiglia: 2, conflitti: 2, tempo_libero: 2 } }],
  };
}

test("preparaSettimana: stanze dedicate separate, righe senza famiglia né «cerco»", () => {
  const righe = [...Array.from({ length: 12 }, () => riga("uomo", ["uomini"])),
    ...Array.from({ length: 10 }, () => riga("donna", "uomini")), ...Array.from({ length: 10 }, () => riga("uomo", "donne"))];
  const iscrizioni = new Map(righe.map((r) => [r.profilo.id, "2026-11-28T12:00:00Z"]));
  const s = preparaSettimana({ righe, iscrizioni, adesso: new Date(LUNEDI.getTime() + 60000) });
  const mm = new Set(righe.slice(0, 12).map((r) => r.profilo.id));
  assert.ok(s.stanze.length >= 2);
  for (const st of s.stanze) {
    const q = st.membri.filter((m) => mm.has(m.utente_id)).length;
    assert.ok(q === 0 || q === st.membri.length);
    assert.equal(st.tipo, "italia");
    assert.equal(st.citta, null);
    const testo = JSON.stringify(st);
    for (const vietato of ["famiglia", "cerco", "uomini", "donne", "dedicata", "mista"]) assert.ok(!testo.includes(vietato), vietato);
  }
});

test("preparaSettimana, criterio 8: 36 uomini→uomini a Bologna accendono la stanza d'area dedicata anche se il conteggio dell'area (mista) non basta", () => {
  const mm = Array.from({ length: 36 }, () => riga("uomo", ["uomini"]));
  for (const r of mm) r.profilo.provincia = "BO";
  const soloZona = Array.from({ length: 3 }, () => riga("uomo", ["uomini"], { raggio: "citta" }));
  for (const r of soloZona) r.profilo.provincia = "PA"; // Palermo: dedicata con 3 persone, non accesa
  const righe = [...mm, ...soloZona];
  const iscrizioni = new Map(righe.map((r) => [r.profilo.id, "2026-11-28T12:00:00Z"]));
  const s = preparaSettimana({ righe, iscrizioni, completiPerZona: { bologna: { totale: 36, donne: 0 } }, adesso: new Date(LUNEDI.getTime() + 60000) });
  assert.ok(s.stanze.length >= 3);
  for (const st of s.stanze) { assert.equal(st.tipo, "citta"); assert.equal(st.citta, "bologna"); }
  const attese = s.attesa.filter((a) => a.motivo === "citta_non_aperta");
  assert.equal(attese.length, 3);
  for (const a of attese) assert.deepEqual(a.mancano, { persone: 33, donne: 0 });
});

test("«Voglio incontrare» vuoto (elenco senza scelte) = filtri incompleti, come senza «cerco»", () => {
  const r = riga("donna", []);
  const s = preparaSettimana({ righe: [r], iscrizioni: new Map([[r.profilo.id, "2026-11-28T12:00:00Z"]]), adesso: new Date(LUNEDI.getTime() + 60000) });
  assert.deepEqual(s.attesa, [{ utente_id: r.profilo.id, motivo: "filtri_incompleti" }]);
});
