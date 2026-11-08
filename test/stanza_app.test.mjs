// «Entra nella stanza» e «Vuoi entrare intanto nella Stanza Italia?» nella web app (issue #3, spec v1, v1.1, v1.2).
// La conferma la scrive il database (settimana e ora dal server, regole per riga): il telefono manda un corpo vuoto.
// Supabase è finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaStanza, testoConferma, chiediItalia, contatoreSoloZona } from "../landing/app/moduli/stanza.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const LUNEDI = "2026-11-09T08:00:00+00:00"; // lunedì 9 novembre, 9:00 di Roma

function finto(rispondi = () => [200, []]) {
  const chiamate = [];
  const f = async (url, o = {}) => {
    const u = new URL(url);
    const c = { percorso: u.pathname, query: u.searchParams, metodo: o.method || "GET", headers: o.headers || {}, corpo: o.body };
    chiamate.push(c);
    if (u.origin !== BASE) throw new Error("rete assente");
    const [stato, dati] = rispondi(c);
    return new Response(JSON.stringify(dati), { status: stato });
  };
  return { f, chiamate };
}
const crea = (f, token = "tok-utente", adesso = () => Date.parse("2026-11-08T12:00:00Z")) =>
  creaStanza({ supabaseUrl: BASE, supabaseAnonKey: "anon", token: async () => token, fetch: f, adesso });

test("leggi: solo la propria conferma per un lunedì che deve ancora aprire, con il token dell'utente", async () => {
  const s = finto(() => [200, [{ apre_il: LUNEDI }]]);
  assert.deepEqual(await crea(s.f).leggi(), { ok: true, apreIl: LUNEDI });
  const c = s.chiamate[0];
  assert.equal(c.percorso, "/rest/v1/conferme_stanza");
  assert.equal(c.metodo, "GET");
  assert.equal(c.query.get("select"), "apre_il");
  assert.equal(c.query.get("apre_il"), "gt.2026-11-08T12:00:00.000Z");
  assert.equal(c.headers.authorization, "Bearer tok-utente");
});

test("leggi: nessuna conferma → apreIl null; errore → ok false", async () => {
  assert.deepEqual(await crea(finto(() => [200, []]).f).leggi(), { ok: true, apreIl: null });
  assert.deepEqual(await crea(finto(() => [500, {}]).f).leggi(), { ok: false, motivo: "salvataggio" });
});

test("entra: corpo vuoto (settimana, ora e persona le scrive il server) e risposta con il lunedì", async () => {
  const s = finto(() => [201, [{ apre_il: LUNEDI }]]);
  assert.deepEqual(await crea(s.f).entra(), { ok: true, apreIl: LUNEDI });
  const c = s.chiamate[0];
  assert.equal(c.metodo, "POST");
  assert.equal(c.percorso, "/rest/v1/conferme_stanza");
  assert.equal(c.corpo, "{}");
  assert.equal(c.query.get("select"), "apre_il");
  assert.match(c.headers.prefer, /return=representation/);
});

test("entra due volte nella stessa settimana: il database rifiuta (409) e l'app rilegge la conferma già fatta", async () => {
  const s = finto((c) => (c.metodo === "POST" ? [409, { code: "23505" }] : [200, [{ apre_il: LUNEDI }]]));
  assert.deepEqual(await crea(s.f).entra(), { ok: true, apreIl: LUNEDI });
});

test("ritira: cancella solo la conferma di quel lunedì; dopo domenica 23:59 il database non cancella → «scaduta»", async () => {
  const s = finto(() => [200, [{ apre_il: LUNEDI }]]);
  assert.deepEqual(await crea(s.f).ritira(LUNEDI), { ok: true });
  assert.equal(s.chiamate[0].metodo, "DELETE");
  assert.equal(s.chiamate[0].query.get("apre_il"), `eq.${LUNEDI}`);
  assert.deepEqual(await crea(finto(() => [200, []]).f).ritira(LUNEDI), { ok: false, motivo: "scaduta" });
  assert.deepEqual(await crea(finto().f).ritira("lunedì"), { ok: false, motivo: "salvataggio" });
});

test("senza token nessuna chiamata parte; 401 → accesso; rete assente → rete", async () => {
  const s = finto();
  assert.deepEqual(await crea(s.f, null).entra(), { ok: false, motivo: "accesso" });
  assert.equal(s.chiamate.length, 0);
  assert.deepEqual(await crea(finto(() => [401, {}]).f).leggi(), { ok: false, motivo: "accesso" });
  const rotta = async () => { throw new Error("offline"); };
  assert.deepEqual(await crea(rotta).entra(), { ok: false, motivo: "rete" });
});

test("testo della conferma con lunedì e scadenza in ora di Roma (anche col cambio d'ora)", () => {
  assert.equal(testoConferma(LUNEDI),
    "Ci sei: entri nella stanza di lunedì 9 novembre alle 9:00. Puoi ripensarci fino a domenica 8 novembre alle 23:59.");
  // Lunedì 30 marzo 2026, dopo il passaggio all'ora legale: 9:00 di Roma = 7:00 UTC.
  assert.equal(testoConferma("2026-03-30T07:00:00Z"),
    "Ci sei: entri nella stanza di lunedì 30 marzo alle 9:00. Puoi ripensarci fino a domenica 29 marzo alle 23:59.");
  assert.equal(testoConferma("non-una-data"), null);
});

test("domanda «Stanza Italia» solo a chi ha «Solo la mia zona» e la zona non è accesa, finché non risponde", () => {
  const t = "Milano e dintorni: mancano 7 persone per aprire le stanze della tua zona. Intanto entri nella Stanza Italia.";
  assert.equal(chiediItalia({ raggio: "citta", contatore: t, aspetto: false }), true);
  assert.equal(chiediItalia({ raggio: "citta", contatore: t, aspetto: true }), false);
  assert.equal(chiediItalia({ raggio: "italia", contatore: t, aspetto: false }), false);
  assert.equal(chiediItalia({ raggio: "estero", contatore: t, aspetto: false }), false);
  // Zona accesa o numeri non disponibili: nessun contatore, nessuna domanda.
  assert.equal(chiediItalia({ raggio: "citta", contatore: null, aspetto: false }), false);
});

test("chi ha «Solo la mia zona» non legge «Intanto entri nella Stanza Italia» (non è vero finché non tocca Sì)", () => {
  assert.equal(contatoreSoloZona("Milano e dintorni: mancano 7 persone per aprire le stanze della tua zona. Intanto entri nella Stanza Italia."),
    "Milano e dintorni: mancano 7 persone per aprire le stanze della tua zona.");
  const donne = "Milano e dintorni: ci siete quasi. Servono ancora 3 donne per aprire le stanze. Invita un'amica.";
  assert.equal(contatoreSoloZona(donne), donne);
  assert.equal(contatoreSoloZona(null), null);
});

test("la web app usa la conferma vera, la domanda con i due pulsanti e il raggio cambia solo con «Sì»", () => {
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.ok(flusso.includes("Entra nella stanza"));
  assert.ok(flusso.includes("Vuoi entrare intanto nella Stanza Italia?"));
  assert.ok(flusso.includes("Sì, allarga il raggio"));
  assert.ok(flusso.includes("Aspetto la mia zona"));
  assert.ok(flusso.includes("La prima stanza è in regalo"));
  // L'unico punto che cambia il raggio dalla home è il pulsante «Sì».
  assert.equal((flusso.match(/salvaFiltri\(\{ raggio: "italia" \}\)/g) || []).length, 1);
  const avvio = readFileSync(new URL("../landing/app/avvio.js", import.meta.url), "utf8");
  assert.match(avvio, /creaStanza\(/);
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"/app/moduli/stanza.js"'), "il service worker tiene anche stanza.js");
});
