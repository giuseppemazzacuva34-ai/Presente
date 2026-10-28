// Test di sicurezza del Worker della lista d'attesa (nessuna libreria da installare).
// Uso: node scripts/test_worker.mjs
// Controlla che /iscrizione: resti chiusa finché ISCRIZIONI_APERTE non vale "si", rifiuti i moduli inviati da altri siti,
// rispetti il limite di frequenza, scriva nel database solo con parametri e non riveli dettagli quando qualcosa va storto.
import { readFileSync, readdirSync } from "node:fs";
import { iscrizione } from "../worker/iscrizione.js";
import worker from "../worker/index.js";
import { conteggio } from "../worker/conteggio.js";
import { pulisciCodice } from "../worker/invito.js";

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
  const dati = new URLSearchParams({ email: "prova@example.com", zona: "milano", maggiorenne: "si", consenso: "si", ...campi });
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

// 8. Intestazioni di sicurezza anche sulle risposte generate dal Worker
{
  const env = { ISCRIZIONI_APERTE: "no", DB: null, ASSETS: { fetch: () => new Response("") } };
  for (const [metodo, percorso] of [["POST", "/iscrizione"], ["GET", "/iscrizione"], ["GET", "/conteggio"]]) {
    const r = await worker.fetch(new Request("https://presente.example" + percorso, { method: metodo }), env);
    const csp = r.headers.get("content-security-policy") || "";
    verifica(csp.includes("script-src 'none'") && csp.includes("frame-ancestors 'none'") && r.headers.get("x-content-type-options") === "nosniff",
      `${metodo} ${percorso}: intestazioni di sicurezza presenti`);
  }
}

// 9. Link d'invito dei creator: /?invito=CODICE precompila il campo, ripulito e senza possibilità di iniettare HTML
{
  const home = readFileSync(new URL("../landing/index.html", import.meta.url), "utf8");
  const assets = { fetch: async () => new Response(home, { headers: { "content-type": "text/html; charset=utf-8", etag: "x" } }) };
  const env = { ASSETS: assets };
  const apri = async (q) => (await worker.fetch(new Request("https://presente.example/" + q), env));
  const r = await apri("?invito=silvia26");
  const t = await r.text();
  verifica(t.includes('name="invito" value="SILVIA26"') && r.headers.get("cache-control") === "private, no-store",
    "?invito=silvia26: campo precompilato con SILVIA26, pagina non in cache condivisa");
  const csp = r.headers.get("content-security-policy") || "";
  verifica(csp.includes("script-src 'none'"), "home con invito: intestazioni di sicurezza presenti");
  const cattivo = await (await apri('?invito=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E')).text();
  verifica(!cattivo.includes("<script>alert") && cattivo.includes('value="SCRIPTALERT1SCRIPT"'),
    "?invito con HTML: solo lettere e numeri entrano nella pagina");
  verifica(pulisciCodice("A".repeat(30)).length === 20 && pulisciCodice("  ") === "" && pulisciCodice(null) === "",
    "codice invito: massimo 20 caratteri, vuoto se non resta nulla");
  const senza = await (await apri("")).text();
  verifica(senza === home, "home senza invito: pagina identica all'originale");
  const vuoto = await (await apri("?invito=%21%21")).text();
  verifica(vuoto === home, "?invito senza lettere né numeri: pagina identica all'originale");
}

// 10. /conteggio: iscritti per codice dei creator, solo codici configurati, mai email né nomi liberi
{
  const righe = [{ invito: "SILVIA26", n: 3 }, { invito: "silvia 26", n: 1 }, { invito: "Marco Rossi", n: 2 }];
  const DB = {
    prepare(sql) {
      return {
        async first() { return 6; },
        async all() { return { results: sql.includes("GROUP BY invito") ? righe : [{ zona: "milano", n: 6 }] }; },
      };
    },
  };
  const dati = await (await conteggio({ DB, CODICI_INVITO: "SILVIA26, nevada" })).json();
  verifica(dati.per_codice.SILVIA26 === 4 && dati.per_codice.NEVADA === 0 && Object.keys(dati.per_codice).length === 2,
    "/conteggio per_codice: conta i codici configurati (anche scritti a mano) e nient'altro");
  const testo = JSON.stringify(dati);
  verifica(!testo.includes("Marco") && !testo.includes("@"), "/conteggio: nessun nome libero e nessuna email");
  const vuoti = await (await conteggio({ DB })).json();
  verifica(JSON.stringify(vuoti.per_codice) === "{}", "/conteggio senza codici configurati: per_codice vuoto");
}

if (errori) {
  console.log(`\n${errori} controlli non superati.`);
  process.exit(1);
}
console.log("\nTutti i controlli di sicurezza del Worker sono superati.");
