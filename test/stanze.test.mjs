// Stanze della settimana (issue #3, spec v1 e v1.1). Solo profili inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STANZA, compatibili, ammessiInsieme, coppia, componi, gruppi, cittaAperte, mancanoPerCitta, settimanaStanza, oraDiRoma, costoStanza, suggerimenti }
  from "../api/stanze.js";

// Generatore deterministico (nessun Math.random: il test dà sempre lo stesso risultato).
function casuale(seme) {
  let x = seme >>> 0;
  return () => ((x = Math.imul(x ^ (x >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296);
}
function profiliDiProva(n, seme = 7) {
  const r = casuale(seme);
  const scegli = (v) => v[Math.floor(r() * v.length)];
  return Array.from({ length: n }, (_, i) => {
    const presento = r() < 0.47 ? "donna" : r() < 0.94 ? "uomo" : "non_binario";
    const eta = 22 + Math.floor(r() * 25);
    return {
      id: `p${String(i).padStart(3, "0")}`, eta, presento, paese: r() < 0.95 ? "IT" : "FR",
      citta: scegli(["milano", "roma", "napoli", "torino", "bologna"]),
      cerco: presento === "non_binario" ? "tutti" : r() < 0.88 ? (presento === "donna" ? "uomini" : "donne") : scegli(["donne", "uomini", "tutti"]),
      eta_min: Math.max(18, eta - 4 - Math.floor(r() * 6)), eta_max: eta + 4 + Math.floor(r() * 8),
      raggio: r() < 0.15 ? "citta" : r() < 0.95 ? "italia" : "estero",
    };
  });
}

test("filtri reciproci: genere, età e raggio valgono nei due versi", () => {
  const a = { id: "a", eta: 30, presento: "donna", paese: "IT", citta: "milano", cerco: "uomini", eta_min: 28, eta_max: 40, raggio: "italia" };
  const b = { id: "b", eta: 33, presento: "uomo", paese: "IT", citta: "roma", cerco: "donne", eta_min: 25, eta_max: 35, raggio: "italia" };
  assert.equal(compatibili(a, b), true);
  assert.equal(compatibili(a, { ...b, eta_max: 29 }), false, "A troppo grande per B");
  assert.equal(compatibili(a, { ...b, raggio: "citta" }), false, "B vuole solo la sua città");
  assert.equal(compatibili(a, { ...b, cerco: "uomini" }), false);
  assert.equal(compatibili(a, { ...b, paese: "FR" }), false, "A ha raggio Italia");
  assert.equal(compatibili({ ...a, raggio: "estero" }, { ...b, paese: "FR", raggio: "estero" }), true);
  assert.equal(compatibili(a, { ...b, presento: "non_binario" }), false, "«uomini» non include non binario");
  assert.equal(compatibili(a, b, new Set([coppia("b", "a")])), false, "bloccati o già insieme nelle ultime 4 settimane");
  const a2 = { ...a, id: "a2" };
  assert.equal(ammessiInsieme(a, a2), true, "due donne che cercano uomini possono stare nella stessa stanza");
  assert.equal(ammessiInsieme(a, { ...b, eta: 50 }), false, "un uomo fuori dall'età di A non entra nella sua stanza");
  assert.equal(ammessiInsieme(a, a2, new Set([coppia("a", "a2")])), false);
});

test("100 profili: nessuna coppia fuori dai filtri reciproci, almeno 4 compatibili a testa, 6–12 per stanza", () => {
  for (const seme of [1, 7, 42]) {
    const persone = profiliDiProva(100, seme);
    const perId = new Map(persone.map((p) => [p.id, p]));
    const { stanze, inAttesa } = componi(persone);
    assert.ok(stanze.length >= 1, `seme ${seme}: almeno una stanza`);
    const viste = new Set();
    for (const s of stanze) {
      assert.ok(s.length >= STANZA.minimo && s.length <= STANZA.massimo);
      for (const x of s) for (const y of s) if (x < y) assert.ok(ammessiInsieme(perId.get(x), perId.get(y)), `${x} e ${y} fuori dai filtri`);
      for (const id of s) {
        assert.ok(!viste.has(id), "una persona = una stanza");
        viste.add(id);
        const comp = s.filter((o) => compatibili(perId.get(id), perId.get(o))).length;
        assert.ok(comp >= STANZA.compatibiliMinimi, `${id} ha solo ${comp} compatibili`);
      }
    }
    assert.equal(viste.size + inAttesa.length, 100);
  }
});

test("chi è stato in stanza insieme o si è bloccato non si ritrova insieme", () => {
  const persone = profiliDiProva(100, 3);
  const prima = componi(persone);
  const esclusi = new Set();
  for (const s of prima.stanze) for (const a of s) for (const b of s) if (a < b) esclusi.add(coppia(a, b));
  const dopo = componi(persone, { esclusi });
  for (const s of dopo.stanze) for (const a of s) for (const b of s) if (a < b) assert.ok(!esclusi.has(coppia(a, b)));
});

test("l'affinità decide a parità di legami", () => {
  const persone = profiliDiProva(60, 11);
  const r1 = componi(persone, { affinitaDi: () => 50 });
  const r2 = componi(persone, { affinitaDi: (a, b) => (a.citta === b.citta ? 90 : 10) });
  assert.notDeepEqual(r1.stanze, r2.stanze);
});

test("Stanza Italia: «solo la mia città» non ci entra mai senza toccare «Sì, allarga il raggio»", () => {
  const persone = profiliDiProva(100, 5);
  const g = gruppi(persone, new Set());
  assert.ok(g.italia.every((p) => p.raggio !== "citta"));
  assert.ok(g.attesa_citta.every((p) => p.raggio === "citta"));
  const tanti = Array.from({ length: 36 }, (_, i) => ({ id: `m${i}`, paese: "IT", citta: "milano", raggio: "citta" }));
  assert.deepEqual([...cittaAperte(tanti)], ["milano"]);
  assert.equal(gruppi(tanti)["citta:milano"].length, 36);
  assert.equal(cittaAperte(tanti.slice(1)).size, 0);
  assert.equal(mancanoPerCitta(29), 7);
  assert.equal(mancanoPerCitta(40), 0);
});

test("apre lunedì 9:00 e chiude domenica 21:00 ora di Roma, anche col cambio d'ora", () => {
  const s = settimanaStanza(new Date("2026-11-04T12:00:00Z"));
  assert.equal(s.apre.toISOString(), "2026-11-02T08:00:00.000Z");
  assert.equal(s.chiude.toISOString(), "2026-11-08T20:00:00.000Z");
  assert.equal(s.aperta, true);
  // Domenica 25/10/2026 alle 3 si torna all'ora solare: la settimana 19–25 ottobre apre in CEST e chiude in CET.
  const o = settimanaStanza(new Date("2026-10-21T10:00:00Z"));
  assert.equal(o.apre.toISOString(), "2026-10-19T07:00:00.000Z");
  assert.equal(o.chiude.toISOString(), "2026-10-25T20:00:00.000Z");
  // Ora legale: 29/3/2027.
  const p = settimanaStanza(new Date("2027-03-24T10:00:00Z"));
  assert.equal(p.apre.toISOString(), "2027-03-22T08:00:00.000Z");
  assert.equal(p.chiude.toISOString(), "2027-03-28T19:00:00.000Z");
  // Domenica dopo le 21: è già la settimana dopo (non ancora aperta).
  const d = settimanaStanza(new Date("2026-11-08T20:30:00Z"));
  assert.equal(d.apre.toISOString(), "2026-11-09T08:00:00.000Z");
  assert.equal(d.aperta, false);
  assert.equal(oraDiRoma(2026, 7, 1, 9).toISOString(), "2026-07-01T07:00:00.000Z");
});

test("crediti: prima stanza gratis, poi 9 solo se la stanza si forma", () => {
  assert.equal(costoStanza(0, true), 0);
  assert.equal(costoStanza(1, true), 9);
  assert.equal(costoStanza(3, false), 0);
});

test("suggerimenti: il sì reciproco fa salire, 3 chiamate escludono, il diario non conta", () => {
  const altri = [
    { id: "b", affinita: 80, chiamate: 1, richiamerei: {} },
    { id: "c", affinita: 60, chiamate: 1, richiamerei: {} },
    { id: "d", affinita: 70, chiamate: 3, richiamerei: {} },
    { id: "e", affinita: 40, chiamate: 0, richiamerei: {} },
  ];
  assert.deepEqual(suggerimenti(altri, "2026-11-10"), ["b", "c"]);
  const dopo = altri.map((a) => (a.id === "e" ? { ...a, richiamerei: { mio: true, suo: true } } : a));
  assert.deepEqual(suggerimenti(dopo, "2026-11-10"), ["b", "e"]);
  const conDiario = dopo.map((a) => ({ ...a, diario: "nota privata molto lunga" }));
  assert.deepEqual(suggerimenti(conDiario, "2026-11-10"), suggerimenti(dopo, "2026-11-10"));
  const mioNo = altri.map((a) => (a.id === "b" ? { ...a, richiamerei: { mio: false } } : a));
  assert.ok(!suggerimenti(mioNo, "2026-11-10").includes("b"));
  const suoNo = altri.map((a) => (a.id === "b" ? { ...a, richiamerei: { suo: false } } : a));
  assert.ok(suggerimenti(suoNo, "2026-11-10").includes("b"), "il no dell'altro non si indovina");
});
