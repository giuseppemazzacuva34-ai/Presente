// Test di sicurezza del Worker della lista d'attesa (nessuna libreria da installare).
// Uso: node scripts/test_worker.mjs
// Controlla che /iscrizione: resti chiusa finché ISCRIZIONI_APERTE non vale "si", rifiuti i moduli inviati da altri siti,
// rispetti il limite di frequenza, scriva nel database solo con parametri e non riveli dettagli quando qualcosa va storto.
import { readFileSync, readdirSync } from "node:fs";
import { iscrizione } from "../worker/iscrizione.js";

let errori = 0;
function verifica(condizione, descrizione) {
  if (condizione) {
    console.log("OK   " + descrizione);
  } else {
    console.log("ERRORE " + descrizione);
    errori++;
  }
}

function databaseFinto({ rompi = false } = {}) {
  const query = [];
  return {
    query,
    prepare(sql) {
      const voce = { sql, valori: [] };
      query.push(voce);
      return {
        bind(...valori) { voce.valori = valori; return this; },
        async run() { if (rompi) throw new Error("D1_ERROR: dettaglio interno segreto"); return {}; },
      };
    },
  };
}

function modulo(campi = {}, intestazioni = {}) {
  const dati = new URLSearchParams({ email: "prova@example.com", zona: "isola", maggiorenne: "si", consenso: "si", ...campi });
  return new Request("https://presente.example/iscrizione", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...intestazioni },
    body: dati.toString(),
  });
}

const aperte = (extra = {}) => ({ ISCRIZIONI_APERTE: "si", DB: databaseFinto(), ...extra });

// 1. Iscrizioni chiuse
{
  const env = { ISCRIZIONI_APERTE: "no", DB: databaseFinto() };
  const r = await iscrizione(modulo(), env);
  verifica(r.status === 503 && env.DB.query.length === 0, "iscrizioni chiuse: nessuna scrittura nel database");
}

// 2. Iscrizione valida dal nostro sito
{
  const env = aperte();
  const r = await iscrizione(modulo({}, { origin: "https://presente.example" }), env);
  verifica(r.status === 303, "iscrizione valida: rimanda alla pagina di conferma");
  const insert = env.DB.query.find((q) => q.sql.startsWith("INSERT"));
  verifica(insert && !insert.sql.includes("prova@example.com") && insert.valori.includes("prova@example.com"),
    "l'email arriva al database come parametro, non dentro il testo della query");
}

// 3. Modulo inviato da un altro sito
{
  const env = aperte();
  const r = await iscrizione(modulo({}, { origin: "https://sito-cattivo.example" }), env);
  verifica(r.status === 403 && env.DB.query.length === 0, "modulo da un altro sito: rifiutato, nessuna scrittura");
}

// 4. Limite di frequenza
{
  const chiavi = [];
  const env = aperte({ LIMITE_ISCRIZIONI: { async limit({ key }) { chiavi.push(key); return { success: false }; } } });
  const r = await iscrizione(modulo({}, { "cf-connecting-ip": "203.0.113.7" }), env);
  verifica(r.status === 429 && env.DB.query.length === 0, "troppi tentativi: risposta 429, nessuna scrittura");
}

// 5. Dati non validi e campo trappola
{
  const env = aperte();
  const r = await iscrizione(modulo({ email: "non-una-email", zona: "'; DROP TABLE iscrizioni; --" }), env);
  verifica(r.status === 400 && env.DB.query.length === 0, "dati non validi: rifiutati prima del database");
  const env2 = aperte();
  const r2 = await iscrizione(modulo({ "campo-trappola": "bot" }), env2);
  verifica(r2.status === 303 && env2.DB.query.length === 0, "campo trappola compilato: nessuna scrittura");
}

// 6. Errore del database: messaggio generico, nessun dettaglio interno
{
  const env = aperte({ DB: databaseFinto({ rompi: true }) });
  const erroreOriginale = console.error;
  const log = [];
  console.error = (...a) => log.push(a.join(" "));
  const r = await iscrizione(modulo(), env);
  console.error = erroreOriginale;
  const testo = await r.text();
  verifica(r.status === 500 && !testo.includes("D1_ERROR") && !testo.includes("segreto"), "errore del database: nessun dettaglio interno nella pagina");
  verifica(!log.join(" ").includes("prova@example.com"), "errore del database: l'email non finisce nei log");
}

// 7. Nessuna query costruita incollando testo nel codice del Worker
{
  for (const nome of readdirSync(new URL("../worker/", import.meta.url))) {
    const codice = readFileSync(new URL("../worker/" + nome, import.meta.url), "utf8");
    const sospette = codice.match(/prepare\(\s*(`[^`]*\$\{|[^)]*["'`]\s*\+)/g);
    verifica(!sospette, `worker/${nome}: query solo con parametri (prepare + bind)`);
  }
}

if (errori) {
  console.log(`\n${errori} controlli non superati.`);
  process.exit(1);
}
console.log("\nTutti i controlli di sicurezza del Worker sono superati.");
