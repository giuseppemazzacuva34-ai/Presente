// D155 = A (decisa da Giuseppe il 26/11): l'orientamento della schermata 05 si vede ma NON si salva mai.
// Serve solo a precompilare «Voglio incontrare» nella 06; le stanze dedicate si formano da «chi sei» + «chi vuoi
// incontrare». Issue #471, criterio 12 (ramo A): nessuna colonna, nessun campo, niente nei log.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { profiloDaStato, filtriDaStato } from "../landing/app/moduli/salvataggio.js";
import { ORIENTAMENTI } from "../landing/app/moduli/orientamento.js";

const radice = new URL("../", import.meta.url);
const leggi = (p) => readFileSync(new URL(p, radice), "utf8");
const elenca = (cartella, estensione) =>
  readdirSync(new URL(cartella, radice)).filter((f) => f.endsWith(estensione)).map((f) => `${cartella}/${f}`);

// Toglie i commenti SQL («-- …» e /* … */) e le stringhe tra apici (es. i testi di «comment on»).
export function sqlSenzaCommenti(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").replace(/'(?:[^']|'')*'/g, "''");
}
// Toglie i commenti JavaScript (// … e /* … */) senza toccare le stringhe con «//» dentro (es. gli indirizzi https://).
export function jsSenzaCommenti(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

test("prova del controllo: una colonna con l'orientamento verrebbe trovata", () => {
  const finta = "alter table public.profili add column orientamento text[]; -- orientamento solo nel commento";
  assert.match(sqlSenzaCommenti(finta), /orientament/i);
  assert.doesNotMatch(sqlSenzaCommenti("-- orientamento\ncomment on column x is 'può rivelare l''orientamento';"), /orientament/i);
});

test("criterio 12 (D155 = A): nessuna migrazione crea una colonna o un campo per l'orientamento", () => {
  const migrazioni = elenca("supabase/migrations", ".sql");
  assert.ok(migrazioni.length > 0, "nessuna migrazione trovata");
  for (const m of migrazioni) assert.doesNotMatch(sqlSenzaCommenti(leggi(m)), /orientament|sessualit/i, m);
});

test("D155 = A: il Worker e le API non leggono né scrivono l'orientamento", () => {
  for (const f of [...elenca("worker", ".js"), ...elenca("api", ".js")]) {
    assert.doesNotMatch(jsSenzaCommenti(leggi(f)), /orientament/i, f);
  }
});

test("D155 = A: con tutte le etichette scelte, il profilo e i filtri mandati al database non le contengono", () => {
  const stato = {
    nome: "Prova", provincia: "LE", provinciaLista: null, miPresento: "uomo", miDescrivo: "",
    orientamento: ORIENTAMENTI.map(([v]) => v), orientamentoTesto: "parola-segreta-di-prova",
    cerco: ["uomini"], consensoCerco: true, etaMin: 25, etaMax: 40, raggio: "zona", cosaCerco: null, figli: null, fumo: null,
  };
  const inviato = JSON.stringify({ profilo: profiloDaStato(stato), filtri: filtriDaStato(stato) });
  assert.doesNotMatch(inviato, /orientament|parola-segreta-di-prova/i);
  for (const [v] of ORIENTAMENTI) assert.ok(!inviato.includes(`"${v}"`), `l'etichetta «${v}» finirebbe nel database`);
  assert.deepEqual(filtriDaStato(stato).cerco, ["uomini"], "«Voglio incontrare» invece si salva (con il consenso)");
});

test("D155 = A: nella 06 resta il consenso di oggi, al singolare (il testo del ramo B non c'è)", () => {
  const flusso = leggi("landing/app/moduli/flusso.js");
  assert.match(flusso, /Questo dato può rivelare il mio orientamento\. Acconsento che venga usato solo per comporre le stanze\./);
  assert.doesNotMatch(flusso, /Questi dati possono rivelare il mio orientamento/);
});

test("D155 = A: l'orientamento non finisce nella memoria del telefono né nei log della pagina", () => {
  for (const f of elenca("landing/app/moduli", ".js")) {
    const codice = jsSenzaCommenti(leggi(f));
    for (const riga of codice.split("\n").filter((r) => /orientament/i.test(r))) {
      assert.doesNotMatch(riga, /localStorage|sessionStorage|indexedDB|console\.|fetch\(|sendBeacon/, `${f}: ${riga.trim()}`);
    }
  }
});
