// Test di sicurezza del Worker della lista d'attesa (nessuna libreria da installare).
// Uso: node scripts/test_worker.mjs
// Controlla che /iscrizione: resti chiusa finché ISCRIZIONI_APERTE non vale "si", rifiuti i moduli inviati da altri siti,
// rispetti il limite di frequenza, scriva nel database solo con parametri e non riveli dettagli quando qualcosa va storto.
import { readFileSync, readdirSync } from "node:fs";
import { iscrizione, perEsiti, perRisposte, MINIMO_CERCHI } from "../worker/iscrizione.js";
import worker from "../worker/index.js";
import { conteggio, invitiPersonali, codiceNelCampo, raggruppaCittaPiccole } from "../worker/conteggio.js";
import { pulisciCodice, generaCodice, cittaDelLink, linkPersonale, CODICE_PERSONALE } from "../worker/invito.js";
import { perCanale } from "../worker/canale.js";
import { perVisite, etichetteUtm, etichettePixel } from "../worker/visite.js";
import { grazieConCitta, htmlMancano, INIZIO_INVITO, FINE_INVITO, conPasso2 } from "../worker/grazie.js";
import { completa, impronta, ZONA_NON_INDICATA } from "../worker/iscrizione.js";
import { TITOLI, sceltaTitolo } from "../worker/invito.js";
import { numeriPubblici, conNumeri, svuotaMemoria, htmlClassifica, SEGNAPOSTO_POSTI, SEGNAPOSTO_CONTATORE, SEGNAPOSTO_CLASSIFICA } from "../worker/numeri.js";
import { normalizzaCitta, nomeCitta, chiaveCitta, perCitta } from "../worker/citta.js";

// User agent di un telefono vero (browser interno di Instagram): le richieste senza user agent contano come automatiche.
const TELEFONO = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0";

let errori = 0;
function verifica(condizione, descrizione) {
  if (condizione) {
    console.log("OK   " + descrizione);
  } else {
    console.log("ERRORE " + descrizione);
    errori++;
  }
}

// Dal 30/10 ogni tentativo conta il proprio esito (tabella esiti_iscrizione, solo giorno + nome dell'esito):
// "nessuna scrittura" significa nessuna query fuori da quella tabella e un solo esito, quello atteso.
function soloEsito(env, esito) {
  const q = env.DB.query;
  const fuori = q.filter((x) => !x.sql.includes("esiti_iscrizione"));
  const conta = q.filter((x) => x.sql.startsWith("INSERT INTO esiti_iscrizione"));
  return fuori.length === 0 && conta.length === 1 && conta[0].valori.length === 2 && conta[0].valori[1] === esito;
}

function databaseFinto({ rompi = false, nuove = false } = {}) {
  const query = [];
  return {
    query,
    prepare(sql) {
      const voce = { sql, valori: [] };
      query.push(voce);
      return {
        bind(...valori) { voce.valori = valori; return this; },
        async run() { if (rompi) throw new Error("D1_ERROR: dettaglio interno segreto"); return nuove ? { meta: { changes: 1 } } : {}; },
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
  verifica(r.status === 503 && soloEsito(env, "chiuse"), "iscrizioni chiuse: nessuna scrittura nel database");
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
  verifica(r.status === 403 && soloEsito(env, "altro_sito"), "modulo da un altro sito: rifiutato, nessuna scrittura");
}

// 4. Limite di frequenza
{
  const chiavi = [];
  const env = aperte({ LIMITE_ISCRIZIONI: { async limit({ key }) { chiavi.push(key); return { success: false }; } } });
  const r = await iscrizione(modulo({}, { "cf-connecting-ip": "203.0.113.7" }), env);
  verifica(r.status === 429 && soloEsito(env, "troppi_tentativi"), "troppi tentativi: risposta 429, nessuna scrittura");
}

// 5. Dati non validi e campo trappola
{
  const env = aperte();
  const r = await iscrizione(modulo({ email: "non-una-email", zona: "'; DROP TABLE iscrizioni; --" }), env);
  verifica(r.status === 400 && soloEsito(env, "dati_mancanti"), "dati non validi: rifiutati prima del database");
  const env2 = aperte();
  const r2 = await iscrizione(modulo({ "campo-trappola": "bot" }), env2);
  verifica(r2.status === 303 && soloEsito(env2, "trappola"), "campo trappola compilato: nessuna scrittura");
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
  const r = await worker.fetch(new Request("https://presente.example/da/instagram", { headers: { "user-agent": TELEFONO } }), env);
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
  verifica(/^https:\/\/presente\.example\/grazie\?da=instagram&citta=milano&c=[A-HJ-NP-Z2-9]{6}$/.test(r3.headers.get("location")), "iscrizione con canale: va a /grazie?da=instagram (il contatore conta /grazie per sorgente) con la città e il codice personale");

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

// 12. Contatore delle visite (D43): "/" e "/grazie" per giorno e utm, solo totali, nessun IP né cookie.
{
  const contatoriFintiVisite = () => {
    const query = [];
    return { query, prepare(sql) { const v = { sql, valori: [] }; query.push(v); return { bind(...x) { v.valori = x; return this; }, async run() { return { meta: { changes: 1 } }; } }; } };
  };
  const dbVisite = () => {
    const query = [];
    return { query, prepare(sql) { const v = { sql, valori: [] }; query.push(v); return { bind(...x) { v.valori = x; return this; }, async run() { return { meta: { changes: 1 } }; } }; } };
  };
  const home = readFileSync(new URL("../landing/index.html", import.meta.url), "utf8");
  const ASSETS = { fetch: async () => new Response(home, { headers: { "content-type": "text/html; charset=utf-8" } }) };
  const apri = async (percorso, env, init = {}) => {
    const headers = { "user-agent": TELEFONO, ...(init.headers || {}) };
    const r = await worker.fetch(new Request("https://presente.example" + percorso, { ...init, headers }), env);
    return { r, conta: env.DB.query.filter((q) => q.sql.startsWith("INSERT INTO visite_pagina")) };
  };

  {
    const env = { DB: dbVisite(), ASSETS, CAMPAGNE_UTM: "lista_traffico" };
    const { r, conta } = await apri("/", env, { headers: { "cf-connecting-ip": "203.0.113.7", cookie: "x=1", "user-agent": "Mozilla/5.0 Prova/1.0" } });
    verifica(r.status === 200 && conta.length === 1 && conta[0].valori[0] === "home" && conta[0].valori[2] === "" && conta[0].valori[3] === "",
      "visita a /: +1 per home e giorno, senza utm");
    const tutto = JSON.stringify(env.DB.query);
    verifica(!tutto.includes("203.0.113.7") && !tutto.includes("Prova/1.0") && !tutto.includes("x=1"), "visita: nessun IP, cookie o user agent nel database");
    verifica(conta[0].valori.length === 4 && /^\d{4}-\d{2}-\d{2}$/.test(conta[0].valori[1]), "visita: si salvano solo pagina, giorno, sorgente, campagna");
    verifica((r.headers.get("content-security-policy") || "").includes("script-src 'none'"), "home: CSP con script-src 'none'");
  }
  {
    const env = { DB: dbVisite(), ASSETS, CAMPAGNE_UTM: "lista_traffico" };
    const { r, conta } = await apri("/?utm_source=meta&utm_campaign=lista_traffico&fbclid=abc", env);
    verifica(conta[0].valori[2] === "meta" && conta[0].valori[3] === "lista_traffico", "sponsorizzata Meta: conta sorgente meta e campagna lista_traffico");
    const t = await r.text();
    verifica(t.includes('name="canale" value="meta"'), "utm_source=meta: il modulo porta il canale meta (iscrizioni contate in per_canale)");
    verifica(!JSON.stringify(env.DB.query).includes("abc"), "fbclid e altri parametri non vengono salvati");
  }
  {
    const e = etichetteUtm(new URLSearchParams("utm_source=%3Cscript%3E&utm_campaign=inventata123"), { CAMPAGNE_UTM: "lista_traffico" });
    verifica(e.sorgente === "altro" && e.campagna === "altro", "utm sconosciuti: diventano «altro» (il database non si riempie di valori inventati)");
  }
  {
    const env = { DB: dbVisite(), ASSETS };
    const g = await apri("/grazie", env);
    verifica(g.conta.length === 1 && g.conta[0].valori[0] === "grazie", "visita a /grazie: +1 per grazie");
    const altre = { DB: dbVisite(), ASSETS };
    await apri("/privacy", altre); await apri("/", altre, { method: "HEAD" }); await apri("/conteggio", altre);
    verifica(altre.DB.query.filter((q) => q.sql.startsWith("INSERT INTO visite_pagina")).length === 0, "altre pagine, HEAD e /conteggio: non contano");
  }
  {
    // Anteprime dei link, robot e prefetch: non contano come persone (riga "automatiche"), il browser di Instagram e Facebook sì.
    const casi = [
      ["facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", {}],
      ["Facebot", {}],
      ["meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)", {}],
      ["WhatsApp/2.23.20.0", {}],
      ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", {}],
      ["curl/8.5.0", {}],
      ["", {}],
    ];
    for (const [ua, extra] of casi) {
      const env = { DB: dbVisite(), ASSETS };
      const { conta } = await apri("/?utm_source=meta", env, { headers: { "user-agent": ua, ...extra } });
      verifica(conta.length === 1 && conta[0].valori[0] === "automatiche", `automatica non contata come persona: ${ua || "(senza user agent)"} ${JSON.stringify(extra)}`);
      verifica(!JSON.stringify(env.DB.query).includes(ua || "§"), "automatiche: lo user agent non viene salvato");
    }
    // Precaricamenti da un telefono vero (inserzioni Meta): riga "precaricate", né persone né robot.
    for (const extra of [{ "x-purpose": "preview" }, { "sec-purpose": "prefetch;prerender" }, { purpose: "prefetch" }]) {
      const env = { DB: dbVisite(), ASSETS };
      const { conta } = await apri("/?utm_source=meta&utm_campaign=lista_traffico", env, { headers: { "user-agent": TELEFONO, ...extra } });
      verifica(conta.length === 1 && conta[0].valori[0] === "precaricate" && conta[0].valori[2] === "meta",
        `telefono che precarica ${JSON.stringify(extra)}: conta in precaricate con la sorgente`);
    }
    {
      const env = { DB: dbVisite(), ASSETS };
      const { conta } = await apri("/", env, { headers: { "user-agent": "facebookexternalhit/1.1", "x-purpose": "preview" } });
      verifica(conta[0].valori[0] === "automatiche", "robot di Meta che precarica: resta automatica");
    }
    for (const ua of [TELEFONO, "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 [FBAN/EMA;FBLC/it_IT;FBAV/480.0.0.0;]"]) {
      const env = { DB: dbVisite(), ASSETS };
      const { conta } = await apri("/", env, { headers: { "user-agent": ua } });
      verifica(conta.length === 1 && conta[0].valori[0] === "home", "browser interno di Instagram/Facebook: è una persona, conta in home");
    }
    const anteprimaDa = { DB: contatoriFintiVisite(), ASSETS };
    const rd = await worker.fetch(new Request("https://presente.example/da/meta", { headers: { "user-agent": "facebookexternalhit/1.1" } }), anteprimaDa);
    verifica(rd.status === 302 && anteprimaDa.DB.query.filter((q) => q.sql.startsWith("INSERT INTO visite_canale")).length === 0,
      "/da/meta aperto dall'anteprima di Meta: rimanda ma non conta la visita");
  }
  {
    // /grazie con ?da=<canale>: conta per giorno e sorgente; il modulo con canale porta lì.
    const env = { DB: dbVisite(), ASSETS };
    const g = await apri("/grazie?da=meta", env);
    verifica(g.conta[0].valori[0] === "grazie" && g.conta[0].valori[2] === "meta", "/grazie?da=meta: conta grazie con sorgente meta");
    const s = await apri("/grazie?da=inventato", { DB: dbVisite(), ASSETS });
    verifica(s.conta[0].valori[2] === "", "/grazie con canale sconosciuto: nessuna sorgente");
  }
  {
    const rotto = { prepare() { return { bind() { return this; }, async run() { throw new Error("D1_ERROR"); } }; } };
    const erroreOriginale = console.error; console.error = () => {};
    const r = await worker.fetch(new Request("https://presente.example/"), { DB: rotto, ASSETS });
    console.error = erroreOriginale;
    verifica(r.status === 200, "contatore rotto: la home si apre comunque");
    const senzaDb = await worker.fetch(new Request("https://presente.example/"), { ASSETS });
    verifica(senzaDb.status === 200, "senza database (anteprime): la home si apre e non conta");
  }
  {
    const attese = [];
    const env = { DB: dbVisite(), ASSETS };
    await worker.fetch(new Request("https://presente.example/"), env, { waitUntil: (p) => attese.push(p) });
    verifica(attese.length === 1, "con ctx.waitUntil il conteggio avviene in sottofondo");
  }
  {
    const righe = [
      { pagina: "home", giorno: "2026-10-29", sorgente: "", campagna: "", n: 10 },
      { pagina: "home", giorno: "2026-10-29", sorgente: "meta", campagna: "lista_traffico", n: 7 },
      { pagina: "grazie", giorno: "2026-10-29", sorgente: "", campagna: "", n: 2 },
      { pagina: "strana", giorno: "2026-10-29", sorgente: "", campagna: "", n: 99 },
      { pagina: "automatiche", giorno: "2026-10-29", sorgente: "meta", campagna: "", n: 120 },
    ];
    const DB = { prepare() { return { async all() { return { results: righe }; } }; } };
    const v = await perVisite({ DB });
    verifica(v.home === 17 && v.grazie === 2 && v.automatiche === 120 && v.per_giorno["2026-10-29"].home === 17 && v.per_utm["meta/lista_traffico"].home === 7,
      "/conteggio visite: totali, per giorno e per utm");
  }
}

// Misura vera (D79 A, punto 1): /p.gif conta «home-persona» / «grazie-persona» solo per i browser veri.
{
  const db = () => {
    const query = [];
    return { query, prepare(sql) { const v = { sql, valori: [] }; query.push(v); return { bind(...x) { v.valori = x; return this; }, async run() { return { meta: { changes: 1 } }; } }; } };
  };
  const apri = async (percorso, ua, extra = {}, env = { DB: db(), CAMPAGNE_UTM: "lista_traffico" }) => {
    const r = await worker.fetch(new Request("https://presente.example" + percorso, { headers: { "user-agent": ua, ...extra } }), env);
    return { r, conta: env.DB.query.filter((q) => q.sql.startsWith("INSERT INTO visite_pagina")), env };
  };
  {
    const { r, conta, env } = await apri("/p.gif?pg=home", TELEFONO, {
      referer: "https://presente.example/?utm_source=meta&utm_campaign=lista_traffico&fbclid=XYZ", "cf-connecting-ip": "203.0.113.9" });
    const corpo = new Uint8Array(await r.arrayBuffer());
    verifica(r.status === 200 && r.headers.get("content-type") === "image/gif" && corpo.length === 42 && corpo[0] === 0x47,
      "/p.gif: risponde con una GIF 1×1");
    verifica((r.headers.get("cache-control") || "").includes("no-store"), "/p.gif: mai in cache (ogni pagina caricata conta)");
    verifica(conta.length === 1 && conta[0].valori[0] === "home-persona" && conta[0].valori[2] === "meta" && conta[0].valori[3] === "lista_traffico",
      "/p.gif?pg=home da un telefono: +1 home-persona con sorgente e campagna lette dal Referer");
    const tutto = JSON.stringify(env.DB.query);
    verifica(!tutto.includes("XYZ") && !tutto.includes("203.0.113.9") && !tutto.includes("iPhone"), "/p.gif: nessun IP, user agent o altro parametro salvato");
  }
  {
    const { conta } = await apri("/p.gif?pg=grazie", TELEFONO, { referer: "https://presente.example/grazie?da=instagram&citta=milano" });
    verifica(conta.length === 1 && conta[0].valori[0] === "grazie-persona" && conta[0].valori[2] === "instagram",
      "/p.gif?pg=grazie: +1 grazie-persona con il canale di ?da=");
  }
  for (const ua of ["facebookexternalhit/1.1", "python-requests/2.31", "curl/8.5.0", "Wget/1.21", "node", "Go-http-client/2.0",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0)", "SomeCrawler/1.0", "Mozilla/5.0 Spider", "Mozilla/5.0 (Preview)", ""]) {
    const { r, conta } = await apri("/p.gif?pg=home", ua);
    verifica(r.status === 200 && conta.length === 0, `/p.gif da «${ua || "(vuoto)"}»: GIF sì, nessun conteggio`);
  }
  {
    const pref = await apri("/p.gif?pg=home", TELEFONO, { "sec-purpose": "prefetch" });
    const strana = await apri("/p.gif?pg=privacy", TELEFONO);
    const fuori = await apri("/p.gif?pg=home", TELEFONO, { referer: "https://altro.example/?utm_source=meta" });
    verifica(pref.conta.length === 0 && strana.conta.length === 0, "/p.gif: precaricamenti e pagine fuori elenco non contano");
    verifica(fuori.conta.length === 1 && fuori.conta[0].valori[2] === "", "/p.gif: Referer di un altro sito ignorato (nessuna sorgente)");
    const e = etichettePixel(new Request("https://presente.example/p.gif", { headers: { referer: "https://presente.example/?utm_source=%3Cb%3E&utm_campaign=x" } }), { CAMPAGNE_UTM: "lista_traffico" });
    verifica(e.sorgente === "altro" && e.campagna === "altro", "/p.gif: utm sconosciuti dal Referer diventano «altro»");
  }
  {
    const righe = [
      { pagina: "home", giorno: "2026-11-01", sorgente: "", campagna: "", n: 30 },
      { pagina: "home-persona", giorno: "2026-11-01", sorgente: "", campagna: "", n: 12 },
      { pagina: "home-persona", giorno: "2026-11-01", sorgente: "meta", campagna: "lista_traffico", n: 5 },
      { pagina: "grazie-persona", giorno: "2026-11-01", sorgente: "", campagna: "", n: 1 },
    ];
    const v = await perVisite({ DB: { prepare: () => ({ all: async () => ({ results: righe }) }) } });
    verifica(v.home === 30 && v.home_persona === 17 && v.grazie_persona === 1 && v.per_giorno["2026-11-01"].home_persona === 17
      && v.per_utm["meta/lista_traffico"].home_persona === 5, "/conteggio visite: home_persona e grazie_persona, per giorno e per utm");
  }
  for (const f of ["index.html", "grazie.html"]) {
    const t = readFileSync(new URL("../landing/" + f, import.meta.url), "utf8");
    verifica(t.includes(`src="/p.gif?pg=${f === "index.html" ? "home" : "grazie"}"`), `landing/${f}: contiene l'immagine della misura vera`);
  }
}

// Web app installabile (Fase 2, #1): servita sotto /app/ con intestazioni proprie, la landing resta senza script.
{
  const landingCsp = "default-src 'self'; script-src 'none'";
  const ASSETS = { fetch: async (r) => new Response("<!doctype html>", { headers: { "content-type": "text/html", "content-security-policy": landingCsp } }) };
  const r = await worker.fetch(new Request("https://presente.example/app/"), { ASSETS });
  const csp = r.headers.get("content-security-policy") || "";
  verifica(r.status === 200 && csp.includes("script-src 'self'") && !csp.includes("'unsafe-inline'") && !csp.includes("'unsafe-eval'"),
    "/app/: script solo dal nostro dominio, niente codice in linea");
  verifica(csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'"), "/app/: non si può incorniciare in altri siti");
  verifica((r.headers.get("permissions-policy") || "").includes("microphone=(self)"), "/app/: microfono ammesso solo per il nostro sito");
  verifica(r.headers.get("x-robots-tag") === "noindex" && r.headers.get("cache-control") === "no-cache", "/app/: fuori da Google e sempre aggiornata");
  const sw = await worker.fetch(new Request("https://presente.example/app/sw.js"), { ASSETS });
  verifica(sw.headers.get("cache-control") === "no-cache", "/app/sw.js: il service worker si aggiorna subito");
  const icona = await worker.fetch(new Request("https://presente.example/app/icone/icona-192.png"), { ASSETS });
  verifica(icona.headers.get("cache-control") === "public, max-age=3600", "/app/ icone: in cache per un'ora");
  const senzaBarra = await worker.fetch(new Request("https://presente.example/app"), { ASSETS });
  verifica(senzaBarra.status === 301 && senzaBarra.headers.get("location") === "https://presente.example/app/", "/app rimanda a /app/");
  const post = await worker.fetch(new Request("https://presente.example/app/", { method: "POST" }), { ASSETS });
  verifica(post.status === 405, "/app/: solo lettura (GET e HEAD)");
  const altra = await worker.fetch(new Request("https://presente.example/applicazione"), { ASSETS });
  verifica(altra.headers.get("content-security-policy") === landingCsp, "le pagine che iniziano per «app» ma non sono /app/ restano della landing");
  const manifesto = JSON.parse(readFileSync(new URL("../landing/app/manifest.webmanifest", import.meta.url), "utf8"));
  verifica(manifesto.scope === "/app/" && manifesto.start_url === "/app/" && manifesto.display === "standalone"
    && manifesto.icons.some((i) => i.sizes === "512x512") && manifesto.icons.some((i) => i.sizes === "192x192"),
    "manifest: installabile (standalone, icone 192 e 512, ambito /app/)");
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  verifica(config.includes('"/app", "/app/*"'), "wrangler.jsonc: /app passa dal Worker (run_worker_first)");
  const paginaApp = readFileSync(new URL("../landing/app/index.html", import.meta.url), "utf8");
  verifica(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(paginaApp) && !/\son[a-z]+=/i.test(paginaApp) && !/https?:\/\//.test(paginaApp.replace(/<!--[\s\S]*?-->/g, "")),
    "app/index.html: nessuno script in linea, nessun gestore on*, nessuna risorsa esterna");
}

// /app/config.json (#2): solo indirizzo e chiave anon, mai la service_role.
{
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const token = (ruolo) => `eyJhbGciOiJIUzI1NiJ9.${b64({ role: ruolo, iss: "supabase" })}.firmafinta`;
  const ASSETS = { fetch: async () => new Response("") };
  const leggi = async (env) => { const r = await worker.fetch(new Request("https://presente.example/app/config.json"), { ASSETS, ...env }); return [r, await r.json()]; };
  const [ok, corpoOk] = await leggi({ SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co/", SUPABASE_ANON_KEY: token("anon") });
  verifica(ok.status === 200 && corpoOk.pronta && corpoOk.supabaseUrl === "https://abcdefghijklmnopqrst.supabase.co" && ok.headers.get("cache-control") === "no-cache",
    "/app/config.json: indirizzo e chiave anon quando i secret ci sono");
  const [, nuovaChiave] = await leggi({ SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_ANON_KEY: "sb_publishable_abc123" });
  verifica(nuovaChiave.pronta === true, "/app/config.json: accetta anche le nuove chiavi pubbliche sb_publishable_");
  const [manca, corpoManca] = await leggi({});
  verifica(manca.status === 200 && corpoManca.pronta === false && corpoManca.problemi.length === 2, "/app/config.json: dice quali secret mancano");
  const [servizio, corpoServizio] = await leggi({ SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_ANON_KEY: token("service_role") });
  verifica(corpoServizio.pronta === false && !JSON.stringify(corpoServizio).includes("eyJ"), "/app/config.json: la chiave service_role non esce mai");
  verifica(corpoOk.accesso === false && corpoManca.accesso === false, "/app/config.json: accesso spento se ACCESSO_APP non vale «si»");
  const [, acceso] = await leggi({ SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_ANON_KEY: token("anon"), ACCESSO_APP: "si" });
  verifica(acceso.accesso === true, "/app/config.json: accesso acceso con ACCESSO_APP = «si»");
  const [, accesoSenzaChiavi] = await leggi({ ACCESSO_APP: "si" });
  verifica(accesoSenzaChiavi.accesso === false, "/app/config.json: senza chiavi giuste l'accesso resta spento");
  const [, segreta] = await leggi({ SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_ANON_KEY: "sb_secret_abc" });
  verifica(segreta.pronta === false, "/app/config.json: le chiavi segrete sb_secret_ non escono mai");
  const [sbagliato, corpoSbagliato] = await leggi({ SUPABASE_URL: "https://supabase.com/dashboard/project/x", SUPABASE_ANON_KEY: token("anon") });
  verifica(corpoSbagliato.pronta === false && !JSON.stringify(corpoSbagliato).includes("dashboard"), "/app/config.json: indirizzo sbagliato segnalato senza ripeterlo");
}

// Codice della web app: niente risorse esterne, niente innerHTML/eval, e il calcolo dell'affinità non arriva al browser.
{
  const cartella = new URL("../landing/app/", import.meta.url);
  const file = ["avvio.js", "sw.js", ...readdirSync(new URL("moduli/", cartella)).map((f) => "moduli/" + f)];
  for (const nome of file) {
    const testo = readFileSync(new URL(nome, cartella), "utf8").replace(/\/\/.*$/gm, "");
    verifica(!/https?:\/\//.test(testo), `app/${nome}: nessuna risorsa esterna`);
    verifica(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(testo), `app/${nome}: niente HTML in stringa né eval`);
    verifica(!/affinita|PESI|peso/.test(testo), `app/${nome}: niente pesi né affinità nel browser`);
  }
}

// Esiti dei tentativi d'iscrizione e visite precaricate nei numeri di /conteggio (solo totali)
{
  const env = aperte({ DB: databaseFinto({ nuove: true }) });
  await iscrizione(modulo({}, { origin: "https://presente.example" }), env);
  const esito = env.DB.query.find((q) => q.sql.startsWith("INSERT INTO esiti_iscrizione"));
  verifica(esito && esito.valori[1] === "nuova" && !JSON.stringify(esito.valori).includes("@"), "iscrizione valida: esito «nuova» contato, senza email");
  const DB = { prepare: () => ({ all: async () => ({ results: [
    { giorno: "2026-10-30", esito: "nuova", n: 2 }, { giorno: "2026-10-30", esito: "altro_sito", n: 5 } ] }) }) };
  const e = await perEsiti({ DB });
  verifica(e["2026-10-30"].nuova === 2 && e["2026-10-30"].altro_sito === 5, "perEsiti: totali per giorno ed esito");
  const DBv = { prepare: () => ({ all: async () => ({ results: [
    { pagina: "precaricate", giorno: "2026-10-30", sorgente: "meta", campagna: "lista_traffico", n: 9 },
    { pagina: "home", giorno: "2026-10-30", sorgente: "meta", campagna: "lista_traffico", n: 3 } ] }) }) };
  const v = await perVisite({ DB: DBv });
  verifica(v.precaricate === 9 && v.home === 3 && v.per_giorno["2026-10-30"].precaricate === 9 && v.per_utm["meta/lista_traffico"].precaricate === 9,
    "perVisite: precaricate separate da home, per giorno e per utm");
}

// 16. Città scritta a mano (D64, punto 1): normalizzata verso le zone, il resto in «altra-citta-italia» con la città.
{
  const casi = [["Milano", "milano", null], ["MI", "milano", null], [" Milan ", "milano", null], ["RM", "roma", null],
    ["Mestre", "venezia-padova", null], ["bergamo", "brescia-bergamo", null], ["venezia-padova", "venezia-padova", null],
    ["Fuori dall'Italia", "estero", null], ["Forlì", "altra-citta-italia", "forli"], ["REGGIO  EMILIA", "altra-citta-italia", "reggio emilia"]];
  verifica(casi.every(([v, z, c]) => { const r = normalizzaCitta(v); return r && r.zona === z && r.citta === c; }),
    "città: sigle, nomi stranieri, accenti e maiuscole portati alla zona giusta");
  verifica(normalizzaCitta("") === null && normalizzaCitta("x") === null && normalizzaCitta("ZZ") === null && normalizzaCitta("123") === null,
    "città vuota, troppo corta o senza lettere: rifiutata");
  const strana = normalizzaCitta("<b>Pisa</b>\"; DROP");
  verifica(strana && /^[a-z ]+$/.test(strana.citta), "città con simboli: restano solo lettere e spazi");
  verifica(nomeCitta(chiaveCitta("altra-citta-italia", "l aquila")) === "L'Aquila" && nomeCitta("milano") === "Milano", "nome leggibile della città");

  const env = aperte({ DB: databaseFinto({ nuove: true }) });
  const r = await iscrizione(modulo({ zona: "Reggio Emilia" }, { origin: "https://presente.example" }), env);
  const ins = env.DB.query.find((q) => q.sql.startsWith("INSERT INTO iscrizioni"));
  verifica(r.status === 303 && ins.valori[1] === "altra-citta-italia" && ins.valori[5] === "reggio emilia" && !ins.sql.includes("reggio"),
    "iscrizione con città scritta: zona «altra-citta-italia» e città come parametro");
  const env2 = aperte();
  const r2 = await iscrizione(modulo({ zona: "a" }), env2);
  verifica(r2.status === 400 && soloEsito(env2, "dati_mancanti"), "città non valida: rifiutata prima del database");

  // Database vero senza la colonna «citta»: la aggiunge e riprova una volta.
  const query = [];
  let primo = true;
  const DBv = { query, prepare(sql) { const voce = { sql, valori: [] }; query.push(voce); return {
    bind(...v) { voce.valori = v; return this; },
    async run() { if (sql.startsWith("INSERT INTO iscrizioni") && primo) { primo = false; throw new Error("D1_ERROR: table iscrizioni has no column named citta"); } return { meta: { changes: 1 } }; } }; } };
  const r3 = await iscrizione(modulo({}, { origin: "https://presente.example" }), { ISCRIZIONI_APERTE: "si", DB: DBv });
  verifica(r3.status === 303 && query.some((q) => q.sql.startsWith("ALTER TABLE iscrizioni ADD COLUMN citta"))
    && query.filter((q) => q.sql.startsWith("INSERT INTO iscrizioni")).length === 2, "colonna citta mancante: aggiunta e iscrizione salvata");

  const DBc = { prepare: () => ({ all: async () => ({ results: [
    { zona: "milano", citta: null, n: 4 }, { zona: "altra-citta-italia", citta: "pisa", n: 2 }, { zona: "altra-citta-italia", citta: null, n: 1 }] }) }) };
  const pc = await perCitta({ DB: DBc });
  verifica(pc.milano === 4 && pc.pisa === 2 && pc["altra-citta-italia"] === 1, "perCitta: totali per zona e per città scritta");
  // Dal 1/11 (D79 A) il campo città sta nel passo 2, su /grazie.
  const passo2 = readFileSync(new URL("../landing/grazie.html", import.meta.url), "utf8");
  verifica(/<input id="zona" name="zona" type="text" required list="citta-italiane"/.test(passo2) && (passo2.match(/<option value=/g) || []).length >= 100 && !/<select[^>]*name="zona"/.test(passo2),
    "passo 2: campo città scritto con circa 100 suggerimenti, senza menu a tendina");
}

// 17. Home con i numeri (D64, punti 2 e 4): «restano N posti» solo con MOSTRA_POSTI = "si",
// contatore solo per le città con almeno 10 iscritti; senza numeri la pagina resta identica.
{
  const home = readFileSync(new URL("../landing/index.html", import.meta.url), "utf8");
  verifica(home.includes(SEGNAPOSTO_POSTI) && home.includes(SEGNAPOSTO_CONTATORE), "home: segnaposto dei posti e del contatore presenti");
  const DBn = (totale, righe) => ({ prepare: (sql) => ({
    first: async () => totale,
    all: async () => ({ results: righe }),
    bind() { return this; }, run: async () => ({}) }) });
  const righe = [{ zona: "milano", citta: null, n: 12 }, { zona: "roma", citta: null, n: 9 }, { zona: "altra-citta-italia", citta: "pisa", n: 10 },
    { zona: "estero", citta: null, n: 30 }, { zona: "altra-citta-italia", citta: null, n: 40 }];
  svuotaMemoria();
  const n = await numeriPubblici({ DB: DBn(101, righe) }, 1000);
  const spento = conNumeri(home, n, { MOSTRA_POSTI: "no" });
  verifica(!spento.includes("posti</p>") && !spento.includes("class=\"posti\""), "posti: con MOSTRA_POSTI diverso da «si» la frase non compare");
  const acceso = conNumeri(home, n, { MOSTRA_POSTI: "si" });
  verifica(acceso.includes("I primi 150 iscritti hanno 9 crediti in regalo, una stanza in più, al primo acquisto. Restano <strong>49</strong> posti.")
    && acceso.includes("Crediti non convertibili in denaro."), "posti: testo del CFO con N = 150 − iscritti (101 → 49) e nota");
  svuotaMemoria();
  verifica(conNumeri(home, await numeriPubblici({ DB: DBn(149, []) }, 1000), { MOSTRA_POSTI: "si" }).includes("Resta <strong>1</strong> posto."), "posti: singolare a 1");
  svuotaMemoria();
  await numeriPubblici({ DB: DBn(101, righe) }, 1000);
  verifica(/Milano<\/span> <strong>12/.test(acceso) && !acceso.includes("Pisa</span>") && !acceso.includes("Roma</span>")
    && !/estero|altra-citta/i.test(acceso.slice(acceso.indexOf("contatore-citta"), acceso.indexOf("contatore-citta") + 400)),
    "contatore: solo le 14 città con stanza e 10+ iscritti (D76 A: Pisa scritta a mano non compare), senza «estero» e «altre città»");
  svuotaMemoria();
  const pieno = conNumeri(home, await numeriPubblici({ DB: DBn(150, []) }, 1000), { MOSTRA_POSTI: "si" });
  verifica(pieno === home, "posti finiti e nessuna città a 10: pagina identica");
  svuotaMemoria();
  let letture = 0;
  const DBc = { prepare: () => ({ first: async () => { letture++; return 3; }, all: async () => ({ results: [] }) }) };
  await numeriPubblici({ DB: DBc }, 1000); await numeriPubblici({ DB: DBc }, 30_000); await numeriPubblici({ DB: DBc }, 62_000);
  verifica(letture === 2, "numeri in memoria per 60 secondi: D1 letto una volta al minuto");
  svuotaMemoria();
  const ASSETS = { fetch: async () => new Response(home, { headers: { "content-type": "text/html; charset=utf-8" } }) };
  const r = await worker.fetch(new Request("https://presente.example/", { headers: { "user-agent": TELEFONO } }),
    { ASSETS, DB: DBn(20, righe), MOSTRA_POSTI: "si" }, { waitUntil() {} });
  const t = await r.text();
  verifica(r.status === 200 && t.includes("Restano <strong>130</strong> posti") && (r.headers.get("content-security-policy") || "").includes("script-src 'none'")
    && (r.headers.get("cache-control") || "").includes("no-store"), "home dal Worker: numeri scritti, CSP invariata, nessuna cache condivisa");
  svuotaMemoria();
}

// 18. Pagina /grazie (D64, punto 3): «<Città>: mancano N persone», link «porta un amico», carte da scaricare.
{
  const grazieHtml = readFileSync(new URL("../landing/grazie.html", import.meta.url), "utf8");
  const ASSETS = { fetch: async () => new Response(grazieHtml, { headers: { "content-type": "text/html; charset=utf-8" } }) };
  const righe = [{ zona: "milano", citta: null, n: 6 }, { zona: "altra-citta-italia", citta: "reggio emilia", n: 35 }, { zona: "roma", citta: null, n: 40 }];
  let letture = 0;
  const DB = { prepare: () => ({ first: async () => { letture++; return 81; }, all: async () => ({ results: righe }), bind() { return this; }, run: async () => ({}) }) };
  const apri = async (q) => (await grazieConCitta(new Request("https://presente.example/grazie" + q), { ASSETS, DB })).text();
  svuotaMemoria();
  verifica((await apri("?citta=milano")).includes("<strong>Milano</strong>: mancano <strong>30</strong> persone"), "/grazie: Milano a 6 → mancano 30");
  const libera = await apri("?citta=reggio%20emilia");
  verifica(libera.includes("La tua città apre a 36 iscritti: invita un'amica o un amico.") && !libera.includes("<strong>Reggio Emilia</strong>")
    && !/<strong>35<\/strong>|manca <strong>1/.test(libera), "/grazie (D76 A): città scritta a mano → frase fissa, senza numero e senza nome");
  verifica((await apri("?citta=a%20caso%20qualsiasi")).includes("La tua città apre a 36 iscritti"), "/grazie (D76 A): testo qualsiasi nel campo città → frase fissa");
  verifica((await apri("?citta=roma")).includes("ha già 36 iscritti"), "/grazie: città a quota 36");
  verifica(letture === 4, "/grazie: numeri sempre freschi (conta anche chi si è appena iscritto)");
  const cattiva = await apri("?citta=%3Cscript%3Ealert(1)%3C%2Fscript%3E");
  verifica(!cattiva.includes("<script>") && !cattiva.includes("alert(1)"), "/grazie: la città dell'indirizzo non può inserire codice");
  const senza = await apri("");
  verifica(!senza.includes("class=\"mancano\"") && (await apri("?citta=estero")) === senza, "/grazie senza città o dall'estero: nessun «mancano N»");
  // Classifica pubblica delle città (D74 A): solo città e totali, da 10 iscritti in su, Milano (6) non compare.
  verifica(senza.includes("<li><span>Roma</span> <strong>40</strong> <small>apre</small></li>")
    && !senza.includes("Reggio Emilia") && !senza.includes("<strong>35</strong>")
    && !senza.includes("<span>Milano</span>") && !senza.includes(SEGNAPOSTO_CLASSIFICA), "/grazie: classifica solo delle 14 città con stanza (D76 A), da 10 iscritti");
  verifica(htmlClassifica({ totale: 9, citta: { milano: 9 } }).includes("Nessuna città ha ancora 10 iscritti") && !htmlClassifica({ totale: 9, citta: { milano: 9 } }).includes("<ol>"),
    "classifica: sotto i 10 iscritti nessuna città e nessun numero");
  verifica(htmlClassifica(null) === "", "classifica: senza database niente");
  const soloLibere = htmlClassifica({ totale: 200, citta: { pisa: 100, "l aquila": 50, estero: 30 } });
  verifica(soloLibere.includes("Nessuna città ha ancora 10 iscritti") && !/Pisa|Aquila|<ol>/.test(soloLibere), "classifica (D76 A): città scritte a mano mai in classifica");
  const senzaDb = await (await grazieConCitta(new Request("https://presente.example/grazie"), { ASSETS })).text();
  verifica(senzaDb === conPasso2(grazieHtml, ""), "/grazie senza database: pagina identica (tolto solo il passo 2, senza gettone)");
  verifica(!/@|email/i.test(htmlClassifica({ totale: 50, citta: { roma: 50 } })), "classifica: nessun dato personale");
  verifica(htmlMancano("Pisa", 0).includes("mancano <strong>36</strong>"), "htmlMancano: città nuova → mancano 36");
  verifica(["presente-30-domande-primo-appuntamento.pdf", "presente-30-carte.pdf"].every((f) => grazieHtml.includes(`href="/media/${f}"`)
    && readFileSync(new URL("../landing/media/" + f, import.meta.url)).subarray(0, 5).toString() === "%PDF-"),
    "/grazie: pulsante delle 30 carte e PDF presente");
  verifica((grazieHtml.match(/presenteincontri\.app%2Fda%2Famico/g) || []).length === 2, "/grazie: WhatsApp e Telegram condividono il link /da/amico");
  const r = await worker.fetch(new Request("https://presente.example/da/amico", { headers: { "user-agent": TELEFONO } }), { DB: databaseFinto() }, { waitUntil() {} });
  verifica(r.status === 302 && r.headers.get("location") === "https://presente.example/?da=amico", "/da/amico: rimanda alla home con il canale «amico»");
  svuotaMemoria();
}

// 19. Domande facoltative (D33 A, testi D65 A): solo valori dell'elenco; «chi cerchi» si salva solo con la casella a parte;
// ci si iscrive anche senza rispondere; /conteggio mostra solo totali per domanda.
{
  const salva = async (campi) => {
    const env = aperte({ DB: databaseFinto({ nuove: true }) });
    const r = await iscrizione(modulo(campi, { origin: "https://presente.example" }), env);
    return { r, ins: env.DB.query.find((q) => q.sql.startsWith("INSERT INTO iscrizioni")) };
  };
  const a = await salva({});
  verifica(a.r.status === 303 && a.ins.valori.slice(6, 10).every((v) => v === null), "senza domande facoltative: iscrizione valida, risposte vuote");
  const b = await salva({ presento: "donna", cerchi: "uomini", fascia: "25-34" });
  verifica(b.r.status === 303 && b.ins.valori[6] === "donna" && b.ins.valori[7] === null && b.ins.valori[8] === "25-34" && b.ins.valori[9] === null,
    "«chi cerchi» senza la casella a parte: la risposta NON si salva, le altre sì");
  const c = await salva({ cerchi: "uomini", "consenso-cerchi": "si" });
  verifica(c.ins.valori[7] === "uomini" && /^\d{4}-\d{2}-\d{2}T/.test(c.ins.valori[9]), "«chi cerchi» con la casella spuntata: salvata con la data del consenso");
  const d = await salva({ presento: "'; DROP TABLE iscrizioni; --", cerchi: "tutto", "consenso-cerchi": "si", fascia: "12-17" });
  verifica(d.r.status === 303 && d.ins.valori.slice(6, 10).every((v) => v === null) && !d.ins.sql.includes("DROP"), "valori fuori elenco: scartati, iscrizione comunque valida");
  const e = await salva({ "consenso-cerchi": "si" });
  verifica(e.ins.valori[7] === null && e.ins.valori[9] === null, "casella spuntata senza risposta: nessuna data di consenso");

  const DBr = (righe) => ({ prepare: (sql) => ({ all: async () => ({ results: righe[sql.match(/SELECT (\w+)/)[1]] || [] }) }) });
  const pochi = await perRisposte({ DB: DBr({ presento: [{ valore: "donna", n: 3 }, { valore: "x", n: 9 }], cerchi: [{ valore: "uomini", n: 2 }], fascia: [] }) });
  verifica(pochi.presento.donna === 3 && !("x" in pochi.presento) && pochi.cerchi === `meno di ${MINIMO_CERCHI}` && Object.keys(pochi.fascia).length === 0,
    "perRisposte: totali per domanda, «chi cerchi» nascosto sotto 10 risposte");
  const tanti = await perRisposte({ DB: DBr({ cerchi: [{ valore: "uomini", n: 7 }, { valore: "donne", n: 4 }] }) });
  verifica(tanti.cerchi.uomini === 7 && tanti.cerchi.donne === 4, "perRisposte: «chi cerchi» visibile da 10 risposte");

  const home = readFileSync(new URL("../landing/index.html", import.meta.url), "utf8");
  const g2 = readFileSync(new URL("../landing/grazie.html", import.meta.url), "utf8");
  verifica(g2.includes("So che può far capire il mio orientamento sessuale.") && /<input id="consenso-cerchi" name="consenso-cerchi" type="checkbox" value="si">/.test(g2)
    && home.includes("Ho almeno 18 anni e voglio entrare nella lista d'attesa di Presente: usate i miei dati solo per avvisarmi quando apre e per conteggi totali")
    && !home.includes('name="maggiorenne"'), "testi D80 A: casella unica in home, casella a parte non spuntata nel passo 2");
}

// 20. «Porta un'amica» (spec referral parte 2, D69 A): codice personale casuale, link personale su /grazie,
// città di chi invita precompilata, conteggi solo totali.
{
  // Codice: 6 caratteri, senza 0/O/1/I, casuale e mai derivato dall'email.
  const codici = new Set(Array.from({ length: 2000 }, () => generaCodice()));
  verifica([...codici].every((c) => CODICE_PERSONALE.test(c) && !/[01OI]/.test(c)) && codici.size > 1990, "codice personale: 6 caratteri leggibili, casuale");

  // Iscrizione nuova: codice salvato nella riga e mostrato in /grazie; email già in lista: nessun codice, nessun +1.
  const dbConCodice = ({ nuove = true, collisioni = 0, rompiIndice = false } = {}) => {
    const query = [];
    let doppi = collisioni;
    let colonnaAggiunta = false;
    return { query, prepare(sql) {
      const voce = { sql, valori: [] };
      query.push(voce);
      return {
        bind(...valori) { voce.valori = valori; return this; },
        async run() {
          if (sql.startsWith("ALTER TABLE iscrizioni ADD COLUMN codice")) colonnaAggiunta = true;
          if (rompiIndice && sql.startsWith("CREATE UNIQUE INDEX") && !colonnaAggiunta) throw new Error("D1_ERROR: no such column: codice");
          if (sql.startsWith("INSERT INTO iscrizioni ") && doppi > 0) { doppi--; throw new Error("D1_ERROR: UNIQUE constraint failed: iscrizioni.codice"); }
          return nuove && sql.startsWith("INSERT INTO iscrizioni ") ? { meta: { changes: 1 } } : { meta: { changes: 0 } };
        },
      };
    } };
  };
  const env = aperte({ DB: dbConCodice() });
  const r = await iscrizione(modulo({ email: "nuova@example.com" }, { origin: "https://presente.example" }), env);
  const ins = env.DB.query.find((q) => q.sql.startsWith("INSERT INTO iscrizioni "));
  const salvato = ins.valori[10];
  verifica(CODICE_PERSONALE.test(salvato) && !ins.valori.slice(0, 10).includes(salvato), "iscrizione nuova: codice personale nella riga");
  verifica(!salvato.includes("NUOVA") && r.headers.get("location").endsWith("&c=" + salvato), "iscrizione nuova: /grazie riceve il codice (non derivato dall'email)");
  const envG = aperte({ DB: dbConCodice({ nuove: false }) });
  const rg = await iscrizione(modulo({}, { origin: "https://presente.example" }), envG);
  verifica(!rg.headers.get("location").includes("c="), "email già in lista: nessun codice mostrato (né nuovo né vecchio)");
  const envC = aperte({ DB: dbConCodice({ collisioni: 2 }) });
  const rc = await iscrizione(modulo({}, { origin: "https://presente.example" }), envC);
  const tentativi = envC.DB.query.filter((q) => q.sql.startsWith("INSERT INTO iscrizioni "));
  verifica(rc.status === 303 && tentativi.length === 3 && new Set(tentativi.map((q) => q.valori[10])).size === 3, "collisione di codice: se ne genera un altro prima di salvare");
  const envV = aperte({ DB: dbConCodice({ rompiIndice: true }) });
  const rv = await iscrizione(modulo({}, { origin: "https://presente.example" }), envV);
  verifica(rv.status === 303 && envV.DB.query.some((q) => q.sql === "ALTER TABLE iscrizioni ADD COLUMN codice TEXT"), "database senza colonna codice: si aggiunge da sola");
  const envX = aperte({ DB: dbConCodice() });
  const rx = await iscrizione(modulo({ invito: "ZZ%%<b>" }, { origin: "https://presente.example" }), envX);
  verifica(rx.status === 303, "codice d'invito inesistente o malformato: l'iscrizione va avanti");

  // /grazie con il codice: link personale con città; codice falso: pagina com'è.
  const grazieHtml = readFileSync(new URL("../landing/grazie.html", import.meta.url), "utf8");
  verifica(grazieHtml.includes(INIZIO_INVITO) && grazieHtml.indexOf(FINE_INVITO) > grazieHtml.indexOf(INIZIO_INVITO), "grazie.html: blocco invito delimitato");
  const ASSETS = { fetch: async () => new Response(grazieHtml, { headers: { "content-type": "text/html; charset=utf-8" } }) };
  const DB = { prepare: () => ({ first: async () => 6, all: async () => ({ results: [{ zona: "milano", citta: null, n: 6 }] }), bind() { return this; }, run: async () => ({}) }) };
  svuotaMemoria();
  const p = await (await grazieConCitta(new Request("https://presenteincontri.app/grazie?citta=milano&c=K7MQ2P"), { ASSETS, DB })).text();
  verifica(p.includes("https://presenteincontri.app/da/amico?invito=K7MQ2P&amp;citta=milano") && p.includes(encodeURIComponent("https://presenteincontri.app/da/amico?invito=K7MQ2P&citta=milano")),
    "/grazie?c=: link personale visibile e dentro i messaggi WhatsApp/Telegram");
  verifica(p.includes("fa salire <strong>Milano</strong>") && p.includes("mancano <strong>30</strong>") && !p.includes("scrivi%20il%20mio%20nome"), "/grazie?c=: la città di chi invita sale, niente più «scrivi il mio nome»");
  verifica(!/premi|regalo per te|prime stanze/i.test(p.slice(p.indexOf(INIZIO_INVITO), p.indexOf(FINE_INVITO))), "/grazie?c=: nessuna promessa di premi (DPR 430/2001 da chiarire)");
  const falso = await (await grazieConCitta(new Request("https://presenteincontri.app/grazie?c=%3Cscript%3E"), { ASSETS, DB })).text();
  verifica(!falso.includes("<script>") && falso.slice(falso.indexOf(INIZIO_INVITO), falso.indexOf(FINE_INVITO)) === grazieHtml.slice(grazieHtml.indexOf(INIZIO_INVITO), grazieHtml.indexOf(FINE_INVITO)),
    "/grazie con codice malformato: blocco invito identico, nessun codice inserito");
  const soloCodice = await (await grazieConCitta(new Request("https://presenteincontri.app/grazie?c=K7MQ2P&citta=estero"), { ASSETS, DB })).text();
  verifica(soloCodice.includes("invito=K7MQ2P\"") === false && soloCodice.includes("/da/amico?invito=K7MQ2P") && !soloCodice.includes("citta=estero"), "/grazie dall'estero: link senza città");
  svuotaMemoria();

  // Link personale → home con codice e città precompilati.
  const rd = await worker.fetch(new Request("https://presente.example/da/amico?invito=K7MQ2P&citta=Reggio%20Emilia", { headers: { "user-agent": TELEFONO } }), { DB: databaseFinto() }, { waitUntil() {} });
  verifica(rd.headers.get("location") === "https://presente.example/?da=amico&invito=K7MQ2P&citta=reggio+emilia", "/da/amico?invito=&citta=: porta codice e città semplificata");
  const home = readFileSync(new URL("../landing/index.html", import.meta.url), "utf8");
  const AH = { fetch: async () => new Response(home, { headers: { "content-type": "text/html; charset=utf-8" } }) };
  const h = await (await worker.fetch(new Request("https://presente.example/?da=amico&invito=K7MQ2P&citta=reggio+emilia"), { ASSETS: AH })).text();
  verifica(h.includes('name="invito" value="K7MQ2P"') && h.includes('<input type="hidden" name="suggerita" value="Reggio Emilia">'), "home dal link personale: invito compilato e città suggerita per il passo 2");
  const hc = await (await worker.fetch(new Request("https://presente.example/?citta=%22%3E%3Cscript%3E"), { ASSETS: AH })).text();
  verifica(!hc.includes('name="suggerita"') && !hc.includes("<script>"), "home con ?citta= senza codice: nessuna città suggerita");
  verifica(cittaDelLink('"><script>alert(1)</script>') === "Scriptalert Script" && cittaDelLink("estero") === "" && cittaDelLink("mi") === "Milano", "città del link: solo lettere, estero escluso");
  verifica(linkPersonale("https://x.example/grazie", "K7MQ2P", "altra-citta-italia") === "https://x.example/da/amico?invito=K7MQ2P", "link personale: senza città se generica");

  // Conteggi: due iscrizioni con lo stesso invito contano 2; nomi e codici inesistenti non contano; i codici non escono.
  verifica(codiceNelCampo("Giulia k7mq2p", new Set(["K7MQ2P"])) === "K7MQ2P" && codiceNelCampo("Giulia", new Set(["K7MQ2P"])) === "", "codice scritto insieme al nome: conta solo il codice");
  const DBi = { prepare: (sql) => ({ all: async () => ({ results: sql.startsWith("SELECT codice")
    ? [{ codice: "K7MQ2P" }, { codice: "AB34CD" }, { codice: "ZZ99ZZ" }]
    : [{ invito: "K7MQ2P", n: 2 }, { invito: "Marco Rossi", n: 4 }, { invito: "AB34CD", n: 3 }, { invito: "QQQQQQ", n: 5 }] }) }) };
  const ip = await invitiPersonali({ DB: DBi });
  verifica(ip.iscritti_con_invito === 5 && ip.persone_che_hanno_invitato === 2 && ip.per_numero_di_amici["2"] === 1 && ip.per_numero_di_amici["3+"] === 1,
    "inviti_personali: stesso codice due volte = 2, nomi e codici inesistenti ignorati");
  verifica(!JSON.stringify(ip).includes("K7MQ2P"), "inviti_personali: i codici non compaiono nei numeri pubblici");
}

// /conteggio è pubblico: le città scritte a mano sotto 10 iscritti non escono col nome (revisione CISO 31/10).
{
  const r = raggruppaCittaPiccole({ torino: 2, "reggio emilia": 1, "mario rossi": 1, "altra-citta-italia": 1, monza: 12 });
  verifica(r.torino === 2 && r.monza === 12 && r["altra-citta-italia"] === 3 && !("reggio emilia" in r) && !("mario rossi" in r),
    "/conteggio per_citta: città scritte a mano sotto 10 iscritti sommate in «altra-citta-italia», zone sempre visibili");
}

// D79 A, punto 3: modulo in due passi. Passo 1 solo email + caselle → zona «non-indicata» e gettone monouso di 24 ore;
// passo 2 su /grazie?t= → /completa aggiorna solo la riga con quel gettone. Punto 4: titolo dall'elenco fisso.
{
  const dbI = ({ nuove = true, completa: righe = [{ codice: "K7MQ2P" }] } = {}) => {
    const query = [];
    return { query, prepare(sql) { const v = { sql, valori: [] }; query.push(v); return {
      bind(...x) { v.valori = x; return this; },
      async run() { return { meta: { changes: nuove ? 1 : 0 } }; },
      async all() { return { results: sql.startsWith("UPDATE iscrizioni") ? righe : [] }; },
    }; } };
  };
  const env = (db) => ({ DB: db, ISCRIZIONI_APERTE: "si" });
  const soloEmail = (campi = {}) => new Request("https://presente.example/iscrizione", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://presente.example" },
    body: new URLSearchParams({ email: "Prova@Example.com", maggiorenne: "si", consenso: "si", ...campi }).toString() });
  {
    const db = dbI();
    const r = await iscrizione(soloEmail({ canale: "meta" }), env(db));
    const loc = new URL(r.headers.get("location"));
    const ins = db.query.find((q) => q.sql.startsWith("INSERT INTO iscrizioni"));
    const t = loc.searchParams.get("t") || "";
    verifica(r.status === 303 && loc.pathname === "/grazie" && /^[0-9a-f]{32}$/.test(t) && /^[A-HJ-NP-Z2-9]{6}$/.test(loc.searchParams.get("c")) && loc.searchParams.get("da") === "meta",
      "passo 1 (solo email): /grazie?t=<gettone>&c=<codice>&da=<canale>");
    verifica(ins.valori[1] === ZONA_NON_INDICATA && ins.valori[0] === "prova@example.com", "passo 1: zona «non-indicata»");
    verifica(ins.valori[11] === await impronta(t) && ins.valori[11] !== t && !JSON.stringify(db.query).includes(t), "passo 1: nel database solo l'impronta SHA-256 del gettone, mai il gettone");
    const scade = Date.parse(ins.valori[12]) - Date.now();
    verifica(scade > 23.9 * 3600e3 && scade <= 24 * 3600e3, "passo 1: il gettone scade in 24 ore");
    verifica(t !== loc.searchParams.get("c"), "passo 1: il gettone non è il codice invito");
  }
  {
    const r = await iscrizione(soloEmail({ suggerita: "Reggio Emilia" }), env(dbI()));
    verifica(new URL(r.headers.get("location")).searchParams.get("citta") === "reggio emilia", "passo 1 dal link di un'amica: città suggerita portata al passo 2");
    const gia = await iscrizione(soloEmail(), env(dbI({ nuove: false })));
    const lg = new URL(gia.headers.get("location"));
    verifica(!lg.searchParams.has("t") && !lg.searchParams.has("c"), "passo 1 con email già in lista: nessun gettone, nessun codice");
    const vecchio = dbI();
    const rv = await iscrizione(soloEmail({ zona: "Milano" }), env(vecchio));
    const iv = vecchio.query.find((q) => q.sql.startsWith("INSERT INTO iscrizioni"));
    verifica(!new URL(rv.headers.get("location")).searchParams.has("t") && iv.valori[1] === "milano" && iv.valori[11] === null,
      "modulo vecchio con la città (pagine in cache): salvato come prima, senza gettone");
    const manca = await iscrizione(soloEmail({ consenso: "" }), env(dbI()));
    verifica(manca.status === 400, "passo 1 senza consenso: rifiutato");
  }
  const passo2 = (campi = {}, intest = {}) => new Request("https://presente.example/completa", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://presente.example", ...intest },
    body: new URLSearchParams({ t: "0123456789abcdef0123456789abcdef", zona: "Pisa", ...campi }).toString() });
  {
    const db = dbI();
    const r = await completa(passo2({ presento: "donna", cerchi: "uomini", "consenso-cerchi": "si", fascia: "25-34", canale: "instagram" }), env(db));
    const up = db.query.find((q) => q.sql.startsWith("UPDATE iscrizioni"));
    const loc = new URL(r.headers.get("location"));
    verifica(r.status === 303 && loc.pathname === "/grazie" && loc.searchParams.get("citta") === "pisa" && loc.searchParams.get("c") === "K7MQ2P"
      && loc.searchParams.get("da") === "instagram" && !loc.searchParams.has("t"), "passo 2: torna a /grazie con città e codice per «mancano N» e il link personale");
    verifica(/WHERE gettone = \? AND gettone_scade > \? AND zona = 'non-indicata'/.test(up.sql) && /gettone = NULL/.test(up.sql)
      && up.valori[7] === await impronta("0123456789abcdef0123456789abcdef"), "passo 2: aggiorna solo la riga con l'impronta del gettone, non scaduto e «non-indicata», poi lo cancella");
    verifica(up.valori[0] === "altra-citta-italia" && up.valori[1] === "pisa" && up.valori[2] === "donna" && up.valori[6] === "uomini" && up.valori[5],
      "passo 2: città e risposte facoltative salvate, «chi cerchi» con la data del consenso");
    verifica(db.query.some((q) => q.sql.startsWith("INSERT INTO esiti_iscrizione") && q.valori[1] === "passo2_completato"), "passo 2: completamento contato negli esiti");
  }
  {
    const senzaC = dbI();
    await completa(passo2({ cerchi: "uomini" }), env(senzaC));
    const up = senzaC.query.find((q) => q.sql.startsWith("UPDATE iscrizioni"));
    verifica(up.valori[4] === null && up.valori[6] === null, "passo 2: «chi cerchi» senza casella a parte viene scartato");
    const scad = dbI({ completa: [] });
    const rs = await completa(passo2(), env(scad));
    verifica(rs.status === 410 && scad.query.some((q) => q.valori[1] === "passo2_scaduto"), "passo 2 con gettone scaduto o già usato: 410, nessun dato cambiato");
    const brutti = [passo2({ t: "abc" }), passo2({ t: "0123456789ABCDEF0123456789ABCDEF" }), passo2({ zona: "" })];
    for (const req of brutti) {
      const db = dbI();
      const rb = await completa(req, env(db));
      verifica(rb.status === 400 && !db.query.some((q) => q.sql.startsWith("UPDATE")), "passo 2 con gettone malformato o senza città: 400, nessuna scrittura");
    }
    const fuori = dbI();
    const rf = await completa(passo2({}, { origin: "https://cattivo.example" }), env(fuori));
    verifica(rf.status === 403 && !fuori.query.some((q) => q.sql.startsWith("UPDATE")), "passo 2 da un altro sito: rifiutato");
    const limite = { ...env(dbI()), LIMITE_ISCRIZIONI: { limit: async ({ key }) => ({ success: !key.startsWith("completa:") }) } };
    verifica((await completa(passo2(), limite)).status === 429, "passo 2: limite di frequenza come /iscrizione");
    const chiuse = await completa(passo2(), { DB: dbI(), ISCRIZIONI_APERTE: "no" });
    verifica(chiuse.status === 503, "passo 2 con iscrizioni chiuse: 503");
    const get = await worker.fetch(new Request("https://presente.example/completa"), { DB: dbI() });
    verifica(get.status === 303 && get.headers.get("location").endsWith("/grazie"), "GET /completa: rimanda a /grazie");
  }
  {
    const g = readFileSync(new URL("../landing/grazie.html", import.meta.url), "utf8");
    const t = "0123456789abcdef0123456789abcdef";
    const con = conPasso2(g, t, "meta", "Reggio Emilia");
    verifica(con.includes(`<input type="hidden" name="t" value="${t}">`) && con.includes('<input type="hidden" name="canale" value="meta">')
      && con.includes('<input id="zona" name="zona" value="Reggio Emilia"') && con.includes('action="/completa"'), "/grazie?t=: passo 2 con gettone, canale e città suggerita");
    const senza = conPasso2(g, "<script>", "", "");
    verifica(!senza.includes("/completa") && !senza.includes("<script>") && !senza.includes("Ultimo passo"), "/grazie senza gettone valido: niente passo 2");
    const ASSETS = { fetch: async () => new Response(g, { headers: { "content-type": "text/html; charset=utf-8" } }) };
    svuotaMemoria();
    const DBg = { prepare: (sql) => ({ bind() { return this; }, async first() { return 40; }, async all() { return { results: [{ zona: "milano", citta: null, n: 6 }] }; } }) };
    const pagina2 = await (await grazieConCitta(new Request(`https://presente.example/grazie?t=${t}&citta=milano&c=K7MQ2P`), { ASSETS, DB: DBg })).text();
    verifica(pagina2.includes('name="zona" value="Milano"') && !pagina2.includes('class="mancano"') && pagina2.includes("/da/amico?invito=K7MQ2P"),
      "/grazie?t=&citta=: città solo come suggerimento (niente «mancano N» prima del passo 2), link personale già pronto");
    svuotaMemoria();
  }
  {
    const pc = await perCitta({ DB: { prepare: () => ({ all: async () => ({ results: [{ zona: "non-indicata", citta: null, n: 9 }, { zona: "roma", citta: null, n: 3 }] }) }) } });
    verifica(!("non-indicata" in pc) && pc.roma === 3, "zona «non-indicata»: fuori da contatori, classifica e per_citta");
  }
  {
    const home = readFileSync(new URL("../landing/index.html", import.meta.url), "utf8");
    const AH = { fetch: async () => new Response(home, { headers: { "content-type": "text/html; charset=utf-8" } }) };
    const apri = async (q) => (await (await worker.fetch(new Request("https://presente.example/" + q), { ASSETS: AH })).text());
    const titolo = (h) => h.slice(h.indexOf('<h1 id="titolo">'), h.indexOf("</h1>") + 5);
    verifica(titolo(await apri("")) === '<h1 id="titolo">Prima la voce. <em>Poi il resto.</em></h1>', "titolo neutro senza parametro");
    verifica(titolo(await apri("?v=voce")).includes(TITOLI.voce[0]) && titolo(await apri("?utm_content=BUCA")).includes(TITOLI.buca[0])
      && titolo(await apri("?v=donne&utm_source=meta")).includes(TITOLI.donne[0]), "?v= o utm_content scelgono il titolo dall'elenco fisso");
    const strano = await apri("?v=%3Cscript%3Ealert(1)%3C%2Fscript%3E&utm_content=ciao");
    verifica(titolo(strano).includes("Prima la voce.") && !strano.includes("<script>alert") && sceltaTitolo(new URLSearchParams("v=constructor")) === "",
      "valori fuori elenco: titolo neutro, nessun testo dell'indirizzo nella pagina");
    const rv = await apri("?v=foto");
    verifica(rv.includes(`<p class="attacco">${TITOLI.foto[1]}</p>`) && (await apri("")).includes("<p class=\"attacco\">L'app di incontri al buio: vi parlate a voce per una settimana, le foto solo se vi scegliete.</p>"),
      "variante: cambia anche la riga sotto il titolo (testi di Contenuti), senza variante resta quella neutra");
    const da = await worker.fetch(new Request("https://presente.example/da/instagram?v=voce&utm_source=Pinterest&utm_campaign=pin%3Cx%3E&utm_content=x", { headers: { "user-agent": "curl/8" } }), { DB: { prepare: () => ({ bind() { return this; }, async run() { return {}; } }) } });
    const dl = new URL(da.headers.get("location"));
    verifica(dl.searchParams.get("v") === "voce" && dl.searchParams.get("utm_source") === "pinterest" && dl.searchParams.get("utm_campaign") === "pinx" && !dl.searchParams.has("utm_content"),
      "/da/<canale>: ?v= (solo elenco) e utm ripuliti passano alla home");
    const daBrutto = new URL((await worker.fetch(new Request("https://presente.example/da/meta?v=%3Cscript%3E"), { DB: { prepare: () => ({ bind() { return this; }, async run() { return {}; } }) } })).headers.get("location"));
    verifica(!daBrutto.searchParams.has("v"), "/da/<canale>: ?v= fuori elenco non passa");
    const e = etichetteUtm(new URLSearchParams("utm_source=pinterest&utm_campaign=pin"), { CAMPAGNE_UTM: "lista_traffico,pin" });
    verifica(e.sorgente === "pinterest" && e.campagna === "pin" && etichetteUtm(new URLSearchParams("utm_source=reddit"), {}).sorgente === "reddit", "utm: pinterest e reddit sono sorgenti ammesse");
    const campi = [...home.matchAll(/<(?:input|select|textarea)[^>]*name="([^"]+)"/g)].map((m) => m[1]);
    verifica(!campi.includes("zona") && !campi.includes("presento") && campi.includes("email") && campi.includes("consenso"), "home (passo 1): solo email, caselle e invito");
    // D80 A: casella unica. Senza «maggiorenne» si entra; con un valore diverso da «si» no.
    const unica = await iscrizione(new Request("https://presente.example/iscrizione", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "unica@example.com", consenso: "si" }).toString() }), env(dbI()));
    const strana = await iscrizione(new Request("https://presente.example/iscrizione", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "unica@example.com", consenso: "si", maggiorenne: "no" }).toString() }), env(dbI()));
    verifica(unica.status === 303 && strana.status === 400, "D80 A: casella unica accettata, «maggiorenne» diverso da «si» rifiutato");
    // D82 A: /segui conta il clic (solo persone) e rimanda al profilo Instagram.
    const clic = [];
    const dbClic = { prepare: (sql) => ({ bind(...v) { clic.push(v); return this; }, async run() { return {}; } }) };
    const persona = { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
    const sg = await worker.fetch(new Request("https://presente.example/segui", { headers: persona }), { DB: dbClic });
    const robot = await worker.fetch(new Request("https://presente.example/segui", { headers: { "user-agent": "facebookexternalhit/1.1" } }), { DB: dbClic });
    verifica(sg.status === 302 && sg.headers.get("location") === "https://www.instagram.com/presente_app/" && robot.status === 302
      && clic.length === 1 && clic[0][0] === "grazie-ig", "D82 A: /segui conta un clic per persona (non i robot) e rimanda a Instagram");
    const g = readFileSync(new URL("../landing/grazie.html", import.meta.url), "utf8");
    verifica(g.includes('href="/segui"') && g.includes("Segui @presente_app") && g.includes("Le città e i primi posti li annunciamo prima su Instagram"), "D82 A: pulsante e frase sulla pagina grazie");
    verifica(home.indexOf("<!--posti-->") < home.indexOf("<form") && home.indexOf("<!--posti-nota-->") > home.indexOf('type="submit"'), "home: posti sopra il modulo, nota del CFO sotto il pulsante");
  }
}

if (errori) {
  console.log(`\n${errori} controlli non superati.`);
  process.exit(1);
}
console.log("\nTutti i controlli di sicurezza del Worker sono superati.");
