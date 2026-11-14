// Chiamate solo voce (issue #4, passo 3b-2b-2b): le richieste del Worker /app/api/chiamata/….
//   POST /app/api/chiamata/apri  { verso, offerta } → { ok, descrizione, vista } oppure { ok: false, motivo }
//   GET  /app/api/chiamata       → { ok, vista } (la propria chiamata in arrivo, in corso o appena finita, o null)
// Chi chiama lo dice SOLO il token (Supabase), mai il corpo della richiesta. Spento finché ACCESSO_APP non vale «si».
// Supabase, Realtime e i Durable Object sono finti: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chiamataApi, dipendenze, PERCORSO_CHIAMATA } from "../worker/chiamata_api.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const ALTRO = "66666666-7777-4888-9999-000000000000";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const OFFERTA = { type: "offer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\n" };

const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

function supabaseFinto({ utente = 200 } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    viste.push(u.pathname);
    if (u.origin !== BASE) throw new Error("rete assente");
    if (u.pathname === "/auth/v1/user") {
      if (utente !== 200) return new Response("{}", { status: utente });
      return Response.json({ id: ID });
    }
    return new Response("{}", { status: 404 });
  };
  return { f, viste };
}

// Al posto di api/apri_chiamata.js: registra con che cosa è stata chiamata.
function finte({ apri = { ok: true, descrizione: { type: "answer", sdp: "v=0" }, vista: { stato: "squilla" } }, stato = { ok: true, vista: null }, passo = {} } = {}) {
  const ricevute = [];
  return {
    ricevute,
    apriChiamata: async (dati) => { ricevute.push(["apri", dati]); return apri; },
    statoChiamata: async (dati) => { ricevute.push(["stato", dati]); return stato; },
    rispondiChiamata: async (dati) => { ricevute.push(["rispondi", dati]); return passo.rispondi || { ok: true, descrizione: { type: "answer", sdp: "v=0" }, vista: { fase: "in_corso" } }; },
    rifiutaChiamata: async (dati) => { ricevute.push(["rifiuta", dati]); return passo.rifiuta || { ok: true, vista: { fase: "finita" } }; },
    chiudiChiamata: async (dati) => { ricevute.push(["chiudi", dati]); return passo.chiudi || { ok: true, vista: { fase: "finita" } }; },
  };
}

function richiesta(percorso, { metodo = "GET", corpo, token = TOKEN } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers["content-type"] = "application/json";
  return new Request(SITO + percorso, {
    method: metodo, headers, body: corpo === undefined ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

test("spento finché ACCESSO_APP non vale «si»: nessuna chiamata a Supabase", async () => {
  const { f, viste } = supabaseFinto();
  const r = await chiamataApi(richiesta(PERCORSO_CHIAMATA), { ...ENV, ACCESSO_APP: "no" }, f, finte());
  assert.equal(r.status, 404);
  assert.equal((await r.json()).motivo, "spento");
  assert.equal(viste.length, 0);
});

test("senza token o con token rifiutato da Supabase: 401", async () => {
  const { f } = supabaseFinto();
  const senza = await chiamataApi(richiesta(PERCORSO_CHIAMATA, { token: null }), ENV, f, finte());
  assert.equal(senza.status, 401);
  const rifiutato = supabaseFinto({ utente: 401 });
  const r = await chiamataApi(richiesta(PERCORSO_CHIAMATA), ENV, rifiutato.f, finte());
  assert.equal(r.status, 401);
  assert.equal((await r.json()).motivo, "accesso");
});

test("apri: chi chiama è quello del token, mai quello scritto nel corpo", async () => {
  const { f } = supabaseFinto();
  const d = finte();
  const r = await chiamataApi(richiesta(PERCORSO_CHIAMATA + "/apri", { metodo: "POST", corpo: { chi: ALTRO, verso: ALTRO, offerta: OFFERTA } }), ENV, f, d);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, descrizione: { type: "answer", sdp: "v=0" }, vista: { stato: "squilla" } });
  const [tipo, dati] = d.ricevute[0];
  assert.equal(tipo, "apri");
  assert.equal(dati.chi, ID);
  assert.equal(dati.verso, ALTRO);
  assert.deepEqual(dati.offerta, OFFERTA);
  assert.ok(dati.adesso instanceof Date);
});

test("apri: al telefono solo ok, descrizione e vista (mai id della chiamata o sessioni)", async () => {
  const { f } = supabaseFinto();
  const d = finte({ apri: { ok: true, descrizione: { type: "answer", sdp: "v=0" }, vista: { stato: "squilla" }, id: "segreto", sessione: "s" } });
  const corpo = await (await chiamataApi(richiesta(PERCORSO_CHIAMATA + "/apri", { metodo: "POST", corpo: { verso: ALTRO, offerta: OFFERTA } }), ENV, f, d)).json();
  assert.deepEqual(Object.keys(corpo).sort(), ["descrizione", "ok", "vista"]);
});

test("apri: un no delle regole torna con il suo motivo (200), «riprova» è 503, dati sbagliati 400", async () => {
  const { f } = supabaseFinto();
  const post = () => richiesta(PERCORSO_CHIAMATA + "/apri", { metodo: "POST", corpo: { verso: ALTRO, offerta: OFFERTA } });
  const regola = await chiamataApi(post(), ENV, f, finte({ apri: { ok: false, motivo: "tre_volte" } }));
  assert.equal(regola.status, 200);
  assert.deepEqual(await regola.json(), { ok: false, motivo: "tre_volte" });
  const riprova = await chiamataApi(post(), ENV, f, finte({ apri: { ok: false, motivo: "riprova" } }));
  assert.equal(riprova.status, 503);
  const soloVoce = await chiamataApi(post(), ENV, f, finte({ apri: { ok: false, motivo: "solo_voce" } }));
  assert.equal(soloVoce.status, 400);
});

test("apri: fuori fascia arriva anche l'orario «Disponibile da …» (spec v1.3), e nient'altro", async () => {
  const { f } = supabaseFinto();
  const post = () => richiesta(PERCORSO_CHIAMATA + "/apri", { metodo: "POST", corpo: { verso: ALTRO, offerta: OFFERTA } });
  for (const testo of ["Disponibile da 19:00", "Disponibile domani dalle 9:00"]) {
    const r = await chiamataApi(post(), ENV, f, finte({ apri: { ok: false, motivo: "fuori_fascia", testo } }));
    assert.deepEqual(await r.json(), { ok: false, motivo: "fuori_fascia", testo });
  }
  // Un testo che non ha la forma attesa non passa; gli altri motivi non portano testo.
  const strano = await chiamataApi(post(), ENV, f, finte({ apri: { ok: false, motivo: "fuori_fascia", testo: "In pausa oggi" } }));
  assert.deepEqual(await strano.json(), { ok: false, motivo: "fuori_fascia" });
  const altro = await chiamataApi(post(), ENV, f, finte({ apri: { ok: false, motivo: "occupato", testo: "x" } }));
  assert.deepEqual(await altro.json(), { ok: false, motivo: "occupato" });
});

test("apri: corpo non JSON o troppo grande non arriva alle regole", async () => {
  const { f } = supabaseFinto();
  const d = finte();
  const rotto = await chiamataApi(richiesta(PERCORSO_CHIAMATA + "/apri", { metodo: "POST", corpo: "{non json" }), ENV, f, d);
  assert.equal(rotto.status, 400);
  assert.equal((await rotto.json()).motivo, "dati");
  const grande = await chiamataApi(richiesta(PERCORSO_CHIAMATA + "/apri", { metodo: "POST", corpo: { verso: ALTRO, offerta: { type: "offer", sdp: "x".repeat(70000) } } }), ENV, f, d);
  assert.equal(grande.status, 413);
  assert.equal(d.ricevute.length, 0);
});

test("stato: GET della propria chiamata, per la persona del token", async () => {
  const { f } = supabaseFinto();
  const d = finte({ stato: { ok: true, vista: { stato: "in_corso" } } });
  const r = await chiamataApi(richiesta(PERCORSO_CHIAMATA), ENV, f, d);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, vista: { stato: "in_corso" } });
  assert.equal(d.ricevute[0][0], "stato");
  assert.equal(d.ricevute[0][1].per, ID);
});

test("metodi e indirizzi sbagliati: 405 e 404, senza toccare le regole", async () => {
  const { f } = supabaseFinto();
  const d = finte();
  assert.equal((await chiamataApi(richiesta(PERCORSO_CHIAMATA + "/apri"), ENV, f, d)).status, 405);
  assert.equal((await chiamataApi(richiesta(PERCORSO_CHIAMATA, { metodo: "POST", corpo: {} }), ENV, f, d)).status, 405);
  assert.equal((await chiamataApi(richiesta(PERCORSO_CHIAMATA + "/boh"), ENV, f, d)).status, 404);
  assert.equal(d.ricevute.length, 0);
});

test("dipendenze: un Centralino per stanza e un Durable Object per chiamata, id nuovi casuali", async () => {
  const chiesti = [];
  const spazio = (nome) => ({
    idFromName: (n) => ({ nome, n }),
    get: (id) => { chiesti.push(id); return { di: id }; },
  });
  const d = dipendenze({ ...ENV, CENTRALINO: spazio("centralino"), CHIAMATA: spazio("chiamata") });
  assert.deepEqual(d.centralino("stanza-1"), { di: { nome: "centralino", n: "stanza-1" } });
  assert.deepEqual(d.chiamata("c-1"), { di: { nome: "chiamata", n: "c-1" } });
  const a = d.nuovoId(), b = d.nuovoId();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
  for (const nome of ["stanzaDi", "datiPerChiamare", "nuovaSessione", "pubblicaVoce", "chiudiSessione"]) assert.equal(typeof d[nome], "function", nome);
});

test("il Worker manda /app/api/chiamata qui, con le intestazioni dell'app e senza cache", async () => {
  const r = await worker.fetch(richiesta(PERCORSO_CHIAMATA), { ACCESSO_APP: "no", ASSETS: { fetch: () => new Response("pagina") } }, {});
  assert.equal(r.status, 404);
  assert.equal((await r.json()).motivo, "spento");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(r.headers.get("content-security-policy") || "", /default-src 'self'/);
});

// Passo 3b-2b-2c-1: rispondi, rifiuta, chiudi.
test("rispondi: POST con l'offerta, per la persona del token; al telefono solo descrizione e vista", async () => {
  const { f } = supabaseFinto();
  const d = finte();
  const r = await chiamataApi(richiesta(PERCORSO_CHIAMATA + "/rispondi", { metodo: "POST", corpo: { offerta: OFFERTA, per: ALTRO } }), ENV, f, d);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, descrizione: { type: "answer", sdp: "v=0" }, vista: { fase: "in_corso" } });
  assert.deepEqual(d.ricevute[0][0], "rispondi");
  assert.equal(d.ricevute[0][1].per, ID);
  assert.deepEqual(d.ricevute[0][1].offerta, OFFERTA);
});

test("rifiuta e chiudi: POST, persona del token; «segnala» solo se è true", async () => {
  const { f } = supabaseFinto();
  const d = finte({ passo: { chiudi: { ok: true, vista: { fase: "finita" }, segnala: true } } });
  const r1 = await chiamataApi(richiesta(PERCORSO_CHIAMATA + "/rifiuta", { metodo: "POST", corpo: {} }), ENV, f, d);
  assert.deepEqual(await r1.json(), { ok: true, vista: { fase: "finita" } });
  const r2 = await chiamataApi(richiesta(PERCORSO_CHIAMATA + "/chiudi", { metodo: "POST", corpo: { segnala: true } }), ENV, f, d);
  assert.deepEqual(await r2.json(), { ok: true, vista: { fase: "finita" }, segnala: true });
  await chiamataApi(richiesta(PERCORSO_CHIAMATA + "/chiudi", { metodo: "POST", corpo: { segnala: "si" } }), ENV, f, d);
  assert.deepEqual(d.ricevute.map(([n, x]) => [n, x.per, x.segnala]), [["rifiuta", ID, undefined], ["chiudi", ID, true], ["chiudi", ID, false]]);
});

test("rispondi/rifiuta/chiudi: no delle regole 200, «riprova» 503, «solo_voce» 400, metodo GET 405", async () => {
  const { f } = supabaseFinto();
  const casi = [
    ["/rispondi", { rispondi: { ok: false, motivo: "squillo_finito" } }, 200],
    ["/rispondi", { rispondi: { ok: false, motivo: "realtime" } }, 503],
    ["/rispondi", { rispondi: { ok: false, motivo: "solo_voce" } }, 400],
    ["/rifiuta", { rifiuta: { ok: false, motivo: "nessuna" } }, 200],
    ["/chiudi", { chiudi: { ok: false, motivo: "gia_finita" } }, 200],
  ];
  for (const [p, passo, codice] of casi) {
    const r = await chiamataApi(richiesta(PERCORSO_CHIAMATA + p, { metodo: "POST", corpo: { offerta: OFFERTA } }), ENV, f, finte({ passo }));
    assert.equal(r.status, codice, p + " " + JSON.stringify(passo));
  }
  for (const p of ["/rispondi", "/rifiuta", "/chiudi"]) {
    const d = finte();
    assert.equal((await chiamataApi(richiesta(PERCORSO_CHIAMATA + p), ENV, f, d)).status, 405);
    assert.equal(d.ricevute.length, 0);
  }
});
