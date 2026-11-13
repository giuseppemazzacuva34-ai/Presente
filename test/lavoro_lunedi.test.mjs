// Lavoro del lunedì (issue #3): dalla lettura del database alla scrittura delle stanze. Database finto, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eseguiLunedi, alleNoveDiLunedi } from "../scripts/lavoro_lunedi.mjs";
import { oraDiRoma } from "../api/stanze.js";
import { DOMANDE } from "../api/questionario.js";

const LUNEDI = oraDiRoma(2026, 11, 9, 9);
const ALLE_9_05 = new Date(LUNEDI.getTime() + 5 * 60000);

function questionario(i) {
  const risposte = {};
  for (const d of DOMANDE) risposte[d.n] = d.tipo === "multipla" ? [...Array(d.min).keys()] : d.tipo === "scala" ? d.min + (i % 2) : i % d.opzioni.length;
  const importanza = Object.fromEntries(["valori", "ritmi", "soldi", "famiglia", "conflitti", "tempo_libero"].map((t) => [t, 2]));
  return [{ versione: "v1", in_vigore_dal: "2026-11-02T08:00:00Z", risposte, importanza }];
}
// 16 persone inventate (8 donne che cercano uomini, 8 uomini che cercano donne), tutte con conferma: una Stanza Italia.
function databaseFinto({ righe = 16, giaFatta = false } = {}) {
  const chiamate = [];
  const persone = Array.from({ length: righe }, (_, i) => {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const donna = i % 2 === 0;
    return {
      profilo: { id, passo: 11, nome: "Prova", data_nascita: "1990-05-05", citta: "Roma", provincia: "RM", paese: "IT",
        mi_presento_come: donna ? "donna" : "uomo" },
      filtri: { cerco: donna ? "uomini" : "donne", consenso_cerco_il: "2026-11-01T10:00:00Z", eta_min: 25, eta_max: 50, raggio: "italia" },
      questionario: questionario(i),
    };
  });
  const rpc = async (nome, argomenti) => {
    chiamate.push({ nome, argomenti });
    if (nome === "righe_settimana") return {
      righe: persone,
      iscrizioni: Object.fromEntries(persone.map((p) => [p.profilo.id, "2026-11-08T10:00:00Z"])),
      stanze_precedenti: { [persone[1].profilo.id]: 2 },
      storico: [],
    };
    if (nome === "pulisci_stanze_chiuse") return { carte_viste: 4, richiameresti: 3 };
    if (nome === "conteggi_aree") return [{ codice: "roma", nome: "Roma e dintorni", totale: 16, donne: 8 }];
    if (nome === "scrivi_settimana") return giaFatta ? { gia_fatta: true, stanze: 0, membri: 0 }
      : { gia_fatta: false, stanze: argomenti.dati.stanze.length, membri: argomenti.dati.stanze.reduce((s, x) => s + x.membri.length, 0) };
    throw new Error(`funzione inattesa ${nome}`);
  };
  return { rpc, chiamate, persone };
}

test("spento finché ACCESSO_APP non vale «si»: nessuna chiamata al database", async () => {
  const db = databaseFinto();
  const esito = await eseguiLunedi({ rpc: db.rpc, adesso: ALLE_9_05, accessoApp: "no", modo: "automatico" });
  assert.equal(esito.esito, "spento");
  assert.equal(db.chiamate.length, 0);
});

test("in automatico gira solo lunedì tra le 9:00 e le 9:59 di Roma (giusto anche col cambio d'ora)", async () => {
  assert.equal(alleNoveDiLunedi(ALLE_9_05), true);
  assert.equal(alleNoveDiLunedi(new Date(LUNEDI.getTime() - 55 * 60000)), false); // 8:05
  assert.equal(alleNoveDiLunedi(new Date(LUNEDI.getTime() + 65 * 60000)), false); // 10:05
  assert.equal(alleNoveDiLunedi(new Date(oraDiRoma(2027, 4, 5, 9, 5))), true); // lunedì d'estate (7:05 UTC)
  assert.equal(alleNoveDiLunedi(new Date(oraDiRoma(2026, 11, 10, 9, 5))), false); // martedì
  const db = databaseFinto();
  const esito = await eseguiLunedi({ rpc: db.rpc, adesso: new Date(LUNEDI.getTime() + 65 * 60000), accessoApp: "si", modo: "automatico" });
  assert.equal(esito.esito, "fuori_orario");
  assert.equal(db.chiamate.length, 0);
});

test("lunedì alle 9:05: legge le righe dell'apertura, conta le aree dal database e scrive le stanze", async () => {
  const db = databaseFinto();
  const esito = await eseguiLunedi({ rpc: db.rpc, adesso: ALLE_9_05, accessoApp: "si", modo: "automatico" });
  assert.deepEqual(db.chiamate.map((c) => c.nome), ["righe_settimana", "conteggi_aree", "pulisci_stanze_chiuse", "scrivi_settimana"]);
  assert.deepEqual(esito.pulizia, { carte_viste: 4, richiameresti: 3 }); // solo numeri: carte viste e «La richiameresti?» delle stanze chiuse
  assert.equal(db.chiamate[0].argomenti.apre, LUNEDI.toISOString());
  const dati = db.chiamate[3].argomenti.dati;
  assert.equal(dati.apre_il, LUNEDI.toISOString());
  assert.ok(dati.stanze.length >= 1);
  for (const s of dati.stanze) {
    assert.equal(s.tipo, "italia"); // Roma ha 16 profili: non è accesa
    assert.ok(s.membri.length >= 6 && s.membri.length <= 12);
    for (const m of s.membri) assert.deepEqual(Object.keys(m).sort(), ["gratis", "utente_id"]);
  }
  const tutti = dati.stanze.flatMap((s) => s.membri);
  const secondo = tutti.find((m) => m.utente_id === db.persone[1].profilo.id);
  if (secondo) assert.equal(secondo.gratis, false); // ha già fatto 2 stanze
  assert.equal(esito.esito, "scritto");
  assert.equal(esito.stanze, dati.stanze.length);
  assert.equal(esito.membri, tutti.length);
});

test("modo prova: calcola ma non scrive nulla", async () => {
  const db = databaseFinto();
  const esito = await eseguiLunedi({ rpc: db.rpc, adesso: new Date(LUNEDI.getTime() - 3 * 86400000), accessoApp: "si", modo: "prova" });
  assert.equal(esito.esito, "prova");
  assert.ok(!db.chiamate.some((c) => c.nome === "scrivi_settimana" || c.nome === "pulisci_stanze_chiuse"));
  assert.ok(esito.stanze >= 1);
});

test("seconda esecuzione nella stessa settimana: il database dice «già fatta» e il riassunto lo riporta", async () => {
  const db = databaseFinto({ giaFatta: true });
  const esito = await eseguiLunedi({ rpc: db.rpc, adesso: ALLE_9_05, accessoApp: "si", modo: "automatico" });
  assert.equal(esito.esito, "gia_fatta");
});

test("il riassunto ha solo numeri: nessun id, nome o data di nascita", async () => {
  const db = databaseFinto({ righe: 15 });
  const esito = await eseguiLunedi({ rpc: db.rpc, adesso: ALLE_9_05, accessoApp: "si", modo: "automatico" });
  const testo = JSON.stringify(esito);
  assert.ok(!/00000000-0000-4000/.test(testo), testo);
  assert.ok(!/Prova|1990-05-05/.test(testo), testo);
  for (const v of Object.values(esito.attesa)) assert.equal(typeof v, "number");
});

test("legge ACCESSO_APP da wrangler.jsonc (oggi «no»: il lavoro resta spento)", async () => {
  const { readFileSync } = await import("node:fs");
  const { accessoDaWrangler } = await import("../scripts/lavoro_lunedi.mjs");
  assert.equal(accessoDaWrangler('"vars": { "ACCESSO_APP": "si" }'), "si");
  assert.equal(accessoDaWrangler("{}"), "no");
  assert.equal(accessoDaWrangler(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")), "no");
});
