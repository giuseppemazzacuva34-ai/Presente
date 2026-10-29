// Test di sicurezza del Worker della lista d'attesa (nessuna libreria da installare).
// Uso: node scripts/test_worker.mjs
// Controlla che /iscrizione: resti chiusa finché ISCRIZIONI_APERTE non vale "si", rifiuti i moduli inviati da altri siti,
// rispetti il limite di frequenza, scriva nel database solo con parametri e non riveli dettagli quando qualcosa va storto.
import { readFileSync, readdirSync } from "node:fs";
import { iscrizione } from "../worker/iscrizione.js";
import worker from "../worker/index.js";
import { conteggio } from "../worker/conteggio.js";
import { pulisciCodice } from "../worker/invito.js";
import { perCanale } from "../worker/canale.js";

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

// 11. Link per canale (D26): /da/<canale> conta la visita, la home aggiunge il campo nascosto,
//     l'iscrizione conta 1 per canale senza scrivere il canale nella riga dell'iscritto.
{
  const contatoriFinti = ({ nuova = true, rompi = false } = {}) => {
    const query = [];
    return {
      query,
      prepare(sql) {
        const voce = { sql, valori: [] };
        query.push(voce);
        return {
          bind(...valori) { voce.valori = valori; return this; },
          async run() {
            if (rompi && sql.includes("_canale")) throw new Error("D1_ERROR");
            return { meta: { changes: sql.startsWith("INSERT INTO iscrizioni ") && !nuova ? 0 : 1 } };
          },
        };
      },
    };
  };
  const home = readFileSync(new URL("../landing/index.html", import.meta.url), "utf8");
  const ASSETS = { fetch: async () => new Response(home, { headers: { "content-type": "text/html; charset=utf-8" } }) };

  const env = { DB: contatoriFinti(), ASSETS };
  const r = await worker.fetch(new Request("https://presente.example/da/instagram"), env);
  verifica(r.status === 302 && r.headers.get("location") === "https://presente.example/?da=instagram" && r.headers.get("cache-control") === "no-store",
    "/da/instagram: rimanda a /?da=instagram, senza cache");
  const visita = env.DB.query.find((q) => q.sql.startsWith("INSERT INTO visite_canale"));
  verifica(visita && visita.valori[0] === "instagram" && visita.valori.length === 2, "/da/instagram: +1 nella tabella visite_canale (solo canale e giorno)");
  verifica((r.headers.get("content-security-policy") || "").includes("script-src 'none'"), "/da/instagram: intestazioni di sicurezza presenti");

  for (const percorso of ["/da/xyz", "/da", "/da/", "/da/instagram/altro", "/da/Instagram%22"]) {
    const env2 = { DB: contatoriFinti(), ASSETS };
    const r2 = await worker.fetch(new Request("https://presente.example" + percorso), env2);
    verifica(r2.status === 404 && env2.DB.query.length === 0, `${percorso}: 404, nessun conteggio`);
  }
  const post = await worker.fetch(new Request("https://presente.example/da/instagram", { method: "POST" }), { DB: contatoriFinti(), ASSETS });
  verifica(post.status === 404, "/da/instagram con POST: 404");

  const creator = await worker.fetch(new Request("https://presente.example/da/creator?invito=silvia26"), { DB: contatoriFinti(), ASSETS });
  verifica(creator.headers.get("location") === "https://presente.example/?da=creator&invito=SILVIA26", "/da/creator?invito=: porta con sé il codice ripulito");

  const pagina = await (await worker.fetch(new Request("https://presente.example/?da=tiktok"), { ASSETS })).text();
  verifica(pagina.includes('<input type="hidden" name="canale" value="tiktok">'), "/?da=tiktok: campo nascosto canale nel modulo");
  const cattiva = await (await worker.fetch(new Request("https://presente.example/?da=%22%3E%3Cb%3E"), { ASSETS })).text();
  verifica(cattiva === home, "/?da= fuori elenco: pagina identica all'originale");
  const entrambi = await (await worker.fetch(new Request("https://presente.example/?da=creator&invito=nevada"), { ASSETS })).text();
  verifica(entrambi.includes('name="invito" value="NEVADA"') && entrambi.includes('name="canale" value="creator"'), "/?da=creator&invito=: canale e codice insieme");

  const env3 = { ISCRIZIONI_APERTE: "si", DB: contatoriFinti() };
  const r3 = await iscrizione(modulo({ canale: "instagram" }), env3);
  const riga = env3.DB.query.find((q) => q.sql.startsWith("INSERT INTO iscrizioni "));
  const piu = env3.DB.query.find((q) => q.sql.startsWith("INSERT INTO iscrizioni_canale"));
  verifica(r3.status === 303 && piu && piu.valori[0] === "instagram", "iscrizione da /da/instagram: +1 in iscrizioni_canale");
  verifica(riga && !riga.sql.includes("canale") && !riga.valori.includes("instagram"), "iscrizione: il canale NON entra nella riga dell'iscritto");

  const env4 = { ISCRIZIONI_APERTE: "si", DB: contatoriFinti({ nuova: false }) };
  await iscrizione(modulo({ canale: "instagram" }), env4);
  verifica(!env4.DB.query.some((q) => q.sql.startsWith("INSERT INTO iscrizioni_canale")), "email già in lista: non conta una seconda volta");

  const env5 = { ISCRIZIONI_APERTE: "si", DB: contatoriFinti() };
  await iscrizione(modulo({ canale: "sito-cattivo" }), env5);
  verifica(!env5.DB.query.some((q) => q.sql.includes("_canale")), "canale fuori elenco: nessun contatore");

  const env6 = { ISCRIZIONI_APERTE: "si", DB: contatoriFinti({ rompi: true }) };
  const erroreOriginale = console.error;
  console.error = () => {};
  const r6 = await iscrizione(modulo({ canale: "meta" }), env6);
  console.error = erroreOriginale;
  verifica(r6.status === 303, "contatore rotto: l'iscrizione va comunque a buon fine");

  const DB = { prepare(sql) { return { async all() { return { results: sql.includes("visite_canale") ? [{ canale: "instagram", n: 5 }, { canale: "altro", n: 9 }] : [{ canale: "instagram", n: 1 }] }; } }; } };
  const numeri = await perCanale({ DB });
  verifica(numeri.instagram.visite === 5 && numeri.instagram.iscrizioni === 1 && numeri.meta.visite === 0 && !numeri.altro,
    "/conteggio per_canale: visite e iscrizioni per i soli canali dell'elenco");
}

if (errori) {
  console.log(`\n${errori} controlli non superati.`);
  process.exit(1);
}
console.log("\nTutti i controlli di sicurezza del Worker sono superati.");
