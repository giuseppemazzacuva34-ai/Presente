// Lavoro del lunedì (issue #3, terzo passo): dalle righe del database alle stanze. Solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chiaveCitta, etaAl, questionarioInVigore, persona, scadenzaIscrizione, coppieEscluse, preparaSettimana, PASSO_COMPLETO }
  from "../api/settimana.js";
import { compatibili, ammessiInsieme, coppia, oraDiRoma } from "../api/stanze.js";
import { DOMANDE, IMPORTANZA } from "../api/questionario.js";

const LUNEDI = oraDiRoma(2026, 11, 9, 9); // apertura della stanza del 9 novembre 2026
const ADESSO = new Date(LUNEDI.getTime() + 60000); // il lavoro gira alle 9:01

function casuale(seme) {
  let x = seme >>> 0;
  return () => ((x = Math.imul(x ^ (x >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296);
}
function risposteDiProva(r) {
  const risposte = {};
  for (const d of DOMANDE) {
    if (d.tipo === "multipla") {
      const scelte = new Set();
      while (scelte.size < d.min) scelte.add(Math.floor(r() * d.opzioni.length));
      risposte[d.n] = [...scelte];
    } else if (d.tipo === "scala") risposte[d.n] = d.min + Math.floor(r() * (d.max - d.min + 1));
    else risposte[d.n] = Math.floor(r() * d.opzioni.length);
  }
  const importanza = Object.fromEntries(["valori", "ritmi", "soldi", "famiglia", "conflitti", "tempo_libero"].map((t) => [t, 1 + Math.floor(r() * 3)]));
  return { versione: "v1", risposte, importanza };
}
function rigaDiProva(i, r, altro = {}) {
  const presento = r() < 0.5 ? "donna" : "uomo";
  const anni = 24 + Math.floor(r() * 16);
  const id = `u${String(i).padStart(3, "0")}`;
  return {
    profilo: { id, passo: PASSO_COMPLETO, nome: "Prova", data_nascita: `${2026 - anni}-01-15`, citta: ["Milano", "Roma", "Napoli", "Torino", "Bologna"][Math.floor(r() * 5)],
      paese: "IT", mi_presento_come: presento, ...altro.profilo },
    filtri: { cerco: presento === "donna" ? "uomini" : "donne", consenso_cerco_il: "2026-11-01T10:00:00Z", eta_min: 20, eta_max: 50,
      raggio: "italia", ...altro.filtri },
    questionario: [{ in_vigore_dal: "2026-11-02T08:00:00Z", ...risposteDiProva(r) }],
  };
}
function setDiProva(n, seme = 3) {
  const r = casuale(seme);
  return Array.from({ length: n }, (_, i) => rigaDiProva(i, r));
}
const tuttiIscritti = (righe) => new Map(righe.map((x) => [x.profilo.id, "2026-11-07T12:00:00Z"]));

test("città: maiuscole, accenti e spazi non contano", () => {
  assert.equal(chiaveCitta("  Reggio nell’Emilia "), "reggio nell'emilia");
  assert.equal(chiaveCitta("Forlì"), chiaveCitta("forli"));
  assert.equal(chiaveCitta(""), null);
});

test("età: anni compiuti al giorno di apertura, ora di Roma", () => {
  assert.equal(etaAl("2000-11-09", LUNEDI), 26, "compie gli anni proprio lunedì");
  assert.equal(etaAl("2000-11-10", LUNEDI), 25);
  assert.equal(etaAl("non-una-data", LUNEDI), null);
});

test("questionario: vale l'ultima versione già in vigore all'apertura", () => {
  const r = casuale(1);
  const vecchio = { in_vigore_dal: "2026-11-02T08:00:00Z", ...risposteDiProva(r) };
  const nuovo = { in_vigore_dal: "2026-11-09T08:00:00Z", ...risposteDiProva(r) };
  const futuro = { in_vigore_dal: "2026-11-16T08:00:00Z", ...risposteDiProva(r) };
  assert.deepEqual(questionarioInVigore([vecchio, futuro, nuovo], LUNEDI).risposte, nuovo.risposte);
  assert.equal(questionarioInVigore([futuro], LUNEDI), null, "una modifica della settimana non vale prima di lunedì prossimo");
});

test("profilo: entra solo se completo, maggiorenne, con filtri e questionario", () => {
  const r = casuale(2);
  const riga = rigaDiProva(1, r);
  const q = questionarioInVigore(riga.questionario, LUNEDI);
  const ok = persona({ ...riga, questionario: q }, LUNEDI);
  assert.equal(ok.id, "u001");
  assert.equal(ok.citta, riga.profilo.citta.toLowerCase());
  assert.equal(persona({ ...riga, profilo: { ...riga.profilo, passo: 10 }, questionario: q }, LUNEDI).motivo, "profilo_incompleto");
  assert.equal(persona({ ...riga, profilo: { ...riga.profilo, data_nascita: null }, questionario: q }, LUNEDI).motivo, "senza_data_nascita");
  assert.equal(persona({ ...riga, profilo: { ...riga.profilo, data_nascita: "2010-01-01" }, questionario: q }, LUNEDI).motivo, "senza_data_nascita");
  assert.equal(persona({ ...riga, filtri: { ...riga.filtri, consenso_cerco_il: null }, questionario: q }, LUNEDI).motivo, "filtri_incompleti");
  assert.equal(persona({ ...riga, questionario: { ...q, importanza: {} } }, LUNEDI).motivo, "questionario_incompleto");
  assert.ok(IMPORTANZA);
});

test("iscrizione alla stanza: entro domenica 23:59 ora di Roma", () => {
  const s = scadenzaIscrizione(LUNEDI);
  assert.equal(s.toISOString(), "2026-11-08T22:59:59.999Z");
  // cambio d'ora: lunedì 30 marzo 2026, domenica 29 marzo è già ora legale
  assert.equal(scadenzaIscrizione(oraDiRoma(2026, 3, 30, 9)).toISOString(), "2026-03-29T21:59:59.999Z");
});

test("coppie escluse: blocchi nei due versi e stanze delle ultime 4 settimane", () => {
  const esclusi = coppieEscluse({
    blocchi: [{ chi: "b", bloccato: "a" }],
    storico: [
      { stanza_id: "s1", utente_id: "c", apre_il: "2026-10-19T08:00:00Z" },
      { stanza_id: "s1", utente_id: "d", apre_il: "2026-10-19T08:00:00Z" },
      { stanza_id: "s0", utente_id: "e", apre_il: "2026-10-05T07:00:00Z" },
      { stanza_id: "s0", utente_id: "f", apre_il: "2026-10-05T07:00:00Z" },
    ],
  }, LUNEDI);
  assert.ok(esclusi.has(coppia("a", "b")));
  assert.ok(esclusi.has(coppia("d", "c")));
  assert.ok(!esclusi.has(coppia("e", "f")), "più di 4 settimane fa: possono ritrovarsi");
});

test("120 profili inventati: filtri reciproci rispettati, almeno 4 compatibili, 6–12 a stanza, prima stanza gratis", () => {
  const righe = setDiProva(120);
  const precedenti = new Map([["u000", 1], ["u001", 2]]);
  const esito = preparaSettimana({ righe, iscrizioni: tuttiIscritti(righe), stanzePrecedenti: precedenti, adesso: ADESSO });
  assert.equal(esito.apre_il, LUNEDI.toISOString());
  assert.equal(esito.chiude_il, oraDiRoma(2026, 11, 15, 21).toISOString());
  assert.ok(esito.stanze.length >= 5, `stanze formate: ${esito.stanze.length}`);
  const q = new Map(righe.map((x) => [x.profilo.id, persona({ ...x, questionario: questionarioInVigore(x.questionario, LUNEDI) }, LUNEDI)]));
  const visti = new Set();
  for (const s of esito.stanze) {
    assert.equal(s.tipo, "italia", "5 città con meno di 36 profili: tutti nella Stanza Italia");
    assert.ok(s.membri.length >= 6 && s.membri.length <= 12);
    for (const m of s.membri) {
      assert.ok(!visti.has(m.utente_id), "una persona, una stanza");
      visti.add(m.utente_id);
      const io = q.get(m.utente_id);
      const altri = s.membri.filter((x) => x.utente_id !== m.utente_id).map((x) => q.get(x.utente_id));
      assert.ok(altri.every((a) => ammessiInsieme(io, a)), "mai nessuno fuori dai filtri reciproci");
      assert.ok(altri.filter((a) => compatibili(io, a)).length >= 4, "almeno 4 compatibili");
      assert.equal(m.gratis, !precedenti.get(m.utente_id));
      assert.equal(m.crediti, precedenti.get(m.utente_id) ? 9 : 0);
    }
  }
  assert.equal(visti.size + esito.attesa.length, 120, "ognuno è in una stanza o in attesa con un motivo");
});

test("città con 36 profili completi: stanze della città; «solo la mia città» non entra mai nella Stanza Italia", () => {
  const r = casuale(9);
  const righe = Array.from({ length: 60 }, (_, i) => rigaDiProva(i, r, { profilo: { citta: "Milano" } }));
  righe.push(rigaDiProva(200, r, { profilo: { citta: "Bari" }, filtri: { raggio: "citta" } }));
  const esito = preparaSettimana({ righe, iscrizioni: tuttiIscritti(righe), adesso: ADESSO });
  assert.ok(esito.stanze.length > 0 && esito.stanze.every((s) => s.tipo === "citta" && s.citta === "milano"));
  const bari = esito.attesa.find((a) => a.utente_id === "u200");
  assert.deepEqual(bari, { utente_id: "u200", motivo: "citta_non_aperta", mancano: 35 });
  // Con il conteggio dei profili completi fornito dal database (anche chi non entra questa settimana).
  const conConteggio = preparaSettimana({ righe, iscrizioni: tuttiIscritti(righe), completiPerCitta: { Milano: 60, BARI: 30 }, adesso: ADESSO });
  assert.equal(conConteggio.attesa.find((a) => a.utente_id === "u200").mancano, 6);
});

test("chi non ha confermato entro domenica, o ha il profilo a metà, resta fuori con il motivo", () => {
  const righe = setDiProva(20, 5);
  const iscrizioni = tuttiIscritti(righe);
  iscrizioni.set("u000", "2026-11-09T07:30:00Z"); // lunedì mattina: troppo tardi
  iscrizioni.delete("u001");
  righe[2].profilo.passo = 7;
  const esito = preparaSettimana({ righe, iscrizioni, adesso: ADESSO });
  const motivo = (id) => esito.attesa.find((a) => a.utente_id === id)?.motivo;
  assert.equal(motivo("u000"), "non_iscritto");
  assert.equal(motivo("u001"), "non_iscritto");
  assert.equal(motivo("u002"), "profilo_incompleto");
});

test("bloccati e compagni delle ultime 4 settimane non si ritrovano nella stessa stanza", () => {
  const righe = setDiProva(120);
  const primo = preparaSettimana({ righe, iscrizioni: tuttiIscritti(righe), adesso: ADESSO });
  const storico = primo.stanze.flatMap((s, i) => s.membri.map((m) => ({ stanza_id: `s${i}`, utente_id: m.utente_id, apre_il: s.apre_il })));
  const dopo = new Date(ADESSO.getTime() + 7 * 86400000);
  const blocchi = [{ chi: "u010", bloccato: "u011" }];
  const secondo = preparaSettimana({ righe, iscrizioni: new Map(righe.map((x) => [x.profilo.id, "2026-11-14T12:00:00Z"])), storico, blocchi, adesso: dopo });
  const esclusi = coppieEscluse({ storico, blocchi }, new Date(secondo.apre_il));
  for (const s of secondo.stanze)
    for (const a of s.membri) for (const b of s.membri)
      if (a !== b) assert.ok(!esclusi.has(coppia(a.utente_id, b.utente_id)));
});

test("il diario non entra: nessuna funzione lo riceve né lo legge", async () => {
  const { readFile } = await import("node:fs/promises");
  const codice = await readFile(new URL("../api/settimana.js", import.meta.url), "utf8");
  assert.ok(!/diari/i.test(codice.replace(/\/\/.*$/gm, "")), "nessun riferimento al diario fuori dai commenti");
});
