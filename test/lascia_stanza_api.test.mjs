// «Lascia la stanza» (issue #381, spec v1 del CPO del 23/11, schermata 22). Linea «sviluppatore-b», passo 2: testi,
// controllo del motivo e richiesta del Worker POST /app/api/stanza/lascia. Chi esce lo dice SOLO il token.
// Spento finché ACCESSO_APP non vale «si». Supabase finto: niente rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MOTIVI_USCITA, TESTI_USCITA, uscitaValida } from "../api/lascia_stanza.js";
import { lasciaStanzaApi, PERCORSO_LASCIA_STANZA } from "../worker/lascia_stanza_api.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const ALTRO_ID = "66666666-7777-4888-9999-000000000000";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

function supabaseFinto({ utente = 200, esito = "ok" } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID }) : new Response("{}", { status: utente });
    if (u.pathname === "/rest/v1/rpc/lascia_stanza") return esito instanceof Response ? esito : Response.json(esito);
    return new Response("{}", { status: 404 });
  };
  return { f, viste };
}
function richiesta(corpo, { metodo = "POST", token = TOKEN, percorso = PERCORSO_LASCIA_STANZA } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(SITO + percorso, { method: metodo, headers, body: metodo === "POST" ? JSON.stringify(corpo) : undefined });
}

test("testi della schermata 22 come nella spec v1 (senza genere)", () => {
  assert.deepEqual(MOTIVI_USCITA.map((m) => [m.id, m.testo]), [
    ["tempo", "Questa settimana non ho tempo"],
    ["persone", "Non mi trovo con le persone della stanza"],
    ["conosciuto", "Ho conosciuto qualcuno"],
    ["app", "Problemi con l'app"],
    ["altro", "Altro, lo scrivo io"],
  ]);
  assert.equal(TESTI_USCITA.titolo, "Vuoi lasciare la stanza?");
  assert.equal(TESTI_USCITA.sotto, "Dicci il motivo. Le persone della stanza vedranno solo che hai lasciato la stanza.");
  assert.equal(TESTI_USCITA.coin, "I Coin della stanza non tornano indietro. Le chiavi che hai dato e ricevuto si annullano.");
  assert.equal(TESTI_USCITA.resto, "Resto");
  assert.equal(TESTI_USCITA.lascia, "Lascia la stanza");
  assert.equal(TESTI_USCITA.app, "Se qualcosa non funziona, scrivici dall'Aiuto.");
  assert.equal(TESTI_USCITA.inChiamata, "Prima chiudi la chiamata.");
  assert.equal(TESTI_USCITA.fatto, "Hai lasciato la stanza. Ti aspettiamo lunedì.");
});

test("motivo: uno dei cinque; «altro» con testo da 3 a 300 caratteri (spazi esclusi); il testo vale solo per «altro»", () => {
  assert.deepEqual(uscitaValida({ motivo: "tempo" }), { motivo: "tempo", testo: null });
  assert.deepEqual(uscitaValida({ motivo: "tempo", testo: "ignorato" }), { motivo: "tempo", testo: null });
  assert.deepEqual(uscitaValida({ motivo: "altro", testo: "  Cambio città  " }), { motivo: "altro", testo: "Cambio città" });
  assert.equal(uscitaValida({ motivo: "altro", testo: " ab " }), null);
  assert.equal(uscitaValida({ motivo: "altro", testo: "x".repeat(301) }), null);
  assert.equal(uscitaValida({ motivo: "altro" }), null);
  assert.equal(uscitaValida({ motivo: "noia" }), null);
  assert.equal(uscitaValida({}), null);
  assert.equal(uscitaValida(null), null);
});

test("uscita riuscita: chi esce lo dice il token, il server riceve motivo e testo puliti", async () => {
  const { f, viste } = supabaseFinto();
  const r = await lasciaStanzaApi(richiesta({ motivo: "altro", testo: " Cambio città ", persona: ALTRO_ID }), ENV, f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, testo: "Hai lasciato la stanza. Ti aspettiamo lunedì." });
  const rpc = viste.find((v) => v.percorso === "/rest/v1/rpc/lascia_stanza");
  assert.deepEqual(rpc.corpo, { p_persona: ID, p_motivo: "altro", p_testo: "Cambio città" });
});

test("il server rifiuta anche via API: senza motivo o con «altro» corto → 400, il database non viene chiamato", async () => {
  for (const corpo of [{}, { motivo: "altro", testo: "ab" }, { motivo: "boh" }, []]) {
    const { f, viste } = supabaseFinto();
    const r = await lasciaStanzaApi(richiesta(corpo), ENV, f);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.equal(viste.some((v) => v.percorso.startsWith("/rest/")), false);
  }
});

test("durante una chiamata: «Prima chiudi la chiamata.»; fuori stanza o stanza chiusa: motivo senza dettagli", async () => {
  let r = await lasciaStanzaApi(richiesta({ motivo: "tempo" }), ENV, supabaseFinto({ esito: "in_chiamata" }).f);
  assert.deepEqual(await r.json(), { ok: false, motivo: "in_chiamata", testo: "Prima chiudi la chiamata." });
  r = await lasciaStanzaApi(richiesta({ motivo: "tempo" }), ENV, supabaseFinto({ esito: "non_nella_stanza" }).f);
  assert.deepEqual(await r.json(), { ok: false, motivo: "non_nella_stanza" });
  r = await lasciaStanzaApi(richiesta({ motivo: "tempo" }), ENV, supabaseFinto({ esito: "non_valida" }).f);
  assert.equal(r.status, 400);
});

test("accesso: senza token o con token rifiutato → 401; database che non risponde → 503", async () => {
  let r = await lasciaStanzaApi(richiesta({ motivo: "tempo" }, { token: null }), ENV, supabaseFinto().f);
  assert.equal(r.status, 401);
  r = await lasciaStanzaApi(richiesta({ motivo: "tempo" }), ENV, supabaseFinto({ utente: 401 }).f);
  assert.equal(r.status, 401);
  r = await lasciaStanzaApi(richiesta({ motivo: "tempo" }), ENV, supabaseFinto({ esito: new Response("{}", { status: 500 }) }).f);
  assert.equal(r.status, 503);
});

test("spento finché ACCESSO_APP non vale «si»; solo POST; corpo troppo grande → 413", async () => {
  let r = await lasciaStanzaApi(richiesta({ motivo: "tempo" }), { ...ENV, ACCESSO_APP: "no" }, supabaseFinto().f);
  assert.equal(r.status, 404);
  r = await lasciaStanzaApi(richiesta(null, { metodo: "GET" }), ENV, supabaseFinto().f);
  assert.equal(r.status, 405);
  r = await lasciaStanzaApi(richiesta({ motivo: "altro", testo: "x".repeat(5000) }), ENV, supabaseFinto().f);
  assert.equal(r.status, 413);
});

test("il Worker instrada /app/api/stanza/lascia (spento senza ACCESSO_APP)", async () => {
  const r = await worker.fetch(richiesta({ motivo: "tempo" }), { ACCESSO_APP: "no", ASSETS: { fetch: async () => new Response("pagina") } }, {});
  assert.equal(r.status, 404);
  assert.equal((await r.json()).motivo, "spento");
});
