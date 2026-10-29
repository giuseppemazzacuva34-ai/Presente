// Test di «Elimina il mio account» (issue #2). Supabase è finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eliminaAccount } from "../worker/elimina.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-servizio-finta" };

function richiesta({ metodo = "POST", origine = "https://presenteincontri.app", token = TOKEN } = {}) {
  const headers = {};
  if (origine) headers.origin = origine;
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("https://presenteincontri.app/app/api/elimina-account", { method: metodo, headers });
}

// Supabase finto con file in memoria: voci/<id>/... e foto/<id>/..., più un altro utente da non toccare.
function supabaseFinto({ utente = 200, rompiCancellazione = false, rompiAccount = false, file } = {}) {
  const archivio = {
    voci: new Set(file?.voci ?? [`${ID}/presentazione.webm`, `${ID}/risposta-1.webm`, "altro-utente/presentazione.webm"]),
    foto: new Set(file?.foto ?? [`${ID}/1.jpg`, `${ID}/2.jpg`, `${ID}/3.jpg`, "altro-utente/1.jpg"]),
  };
  const chiamate = [];
  let accountCancellato = false;
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    const corpo = opzioni.body ? JSON.parse(opzioni.body) : null;
    chiamate.push({ percorso: u.pathname, metodo: opzioni.method || "GET", headers: opzioni.headers, corpo });
    if (u.origin !== BASE) throw new Error("rete assente");
    if (u.pathname === "/auth/v1/user") {
      if (utente !== 200) return new Response("{}", { status: utente });
      return Response.json({ id: ID, email: "non-usare@example.com" });
    }
    let m = u.pathname.match(/^\/storage\/v1\/object\/list\/(voci|foto)$/);
    if (m) {
      const cartella = corpo.prefix + "/";
      const nomi = [...archivio[m[1]]].filter((n) => n.startsWith(cartella)).sort();
      const pagina = nomi.slice(corpo.offset, corpo.offset + corpo.limit).map((n) => ({ id: "x", name: n.slice(cartella.length) }));
      return Response.json(pagina);
    }
    m = u.pathname.match(/^\/storage\/v1\/object\/(voci|foto)$/);
    if (m && opzioni.method === "DELETE") {
      if (rompiCancellazione) return new Response("{}", { status: 500 });
      for (const n of corpo.prefixes) archivio[m[1]].delete(n);
      return Response.json([]);
    }
    if (u.pathname === `/auth/v1/admin/users/${ID}` && opzioni.method === "DELETE") {
      if (rompiAccount) return new Response("{}", { status: 500 });
      accountCancellato = true;
      return Response.json({});
    }
    return new Response("{}", { status: 404 });
  };
  return { f, chiamate, archivio, cancellato: () => accountCancellato };
}

test("cancella tutti i file della persona, poi l'account; gli altri utenti restano intatti", async () => {
  const s = supabaseFinto();
  const r = await eliminaAccount(richiesta(), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.deepEqual([...s.archivio.voci], ["altro-utente/presentazione.webm"]);
  assert.deepEqual([...s.archivio.foto], ["altro-utente/1.jpg"]);
  assert.equal(s.cancellato(), true);
  // L'identità la dà Supabase dal token dell'utente; la service_role serve solo per file e account.
  assert.equal(s.chiamate[0].headers.authorization, `Bearer ${TOKEN}`);
  const ultima = s.chiamate.at(-1);
  assert.equal(ultima.percorso, `/auth/v1/admin/users/${ID}`);
  assert.equal(ultima.headers.authorization, "Bearer chiave-servizio-finta");
});

test("più di 100 file: li cancella tutti, a pagine", async () => {
  const voci = Array.from({ length: 230 }, (_, i) => `${ID}/v${String(i).padStart(3, "0")}.webm`);
  const s = supabaseFinto({ file: { voci, foto: [] } });
  const r = await eliminaAccount(richiesta(), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(s.archivio.voci.size, 0);
});

test("se i file non si cancellano, l'account resta (si può riprovare) e il telefono non vede dettagli", async () => {
  const s = supabaseFinto({ rompiCancellazione: true });
  const r = await eliminaAccount(richiesta(), ENV, s.f);
  assert.equal(r.status, 502);
  assert.deepEqual(await r.json(), { ok: false, motivo: "riprova" });
  assert.equal(s.cancellato(), false);
});

test("account non cancellato: errore «riprova»", async () => {
  const s = supabaseFinto({ rompiAccount: true });
  assert.equal((await eliminaAccount(richiesta(), ENV, s.f)).status, 502);
});

test("spento finché ACCESSO_APP non vale «si»: nessuna chiamata a Supabase", async () => {
  const s = supabaseFinto();
  const r = await eliminaAccount(richiesta(), { ...ENV, ACCESSO_APP: "no" }, s.f);
  assert.equal(r.status, 404);
  assert.equal(s.chiamate.length, 0);
});

test("rifiuta altri siti, token mancante o scaduto, metodo sbagliato, configurazione assente", async () => {
  const s = supabaseFinto({ utente: 401 });
  assert.equal((await eliminaAccount(richiesta({ origine: "https://sito-cattivo.example" }), ENV, s.f)).status, 403);
  assert.equal((await eliminaAccount(richiesta({ origine: null }), ENV, s.f)).status, 403);
  assert.equal((await eliminaAccount(richiesta({ token: null }), ENV, s.f)).status, 401);
  assert.equal((await eliminaAccount(richiesta({ metodo: "GET" }), ENV, s.f)).status, 405);
  assert.equal((await eliminaAccount(richiesta(), { ...ENV, SUPABASE_SERVICE_ROLE_KEY: "" }, s.f)).status, 503);
  assert.equal(s.chiamate.length, 0);
  const r = await eliminaAccount(richiesta(), ENV, s.f);
  assert.equal(r.status, 401);
  assert.equal(s.cancellato(), false);
});

test("passa dal Worker con le intestazioni dell'app e senza cache", async () => {
  const r = await worker.fetch(richiesta(), { ACCESSO_APP: "no" }, { waitUntil() {} });
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.ok(r.headers.get("content-security-policy"));
});
