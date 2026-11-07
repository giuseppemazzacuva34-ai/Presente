// Contatore «mancano N persone» nella home della web app (issue #3, spec v1.2 del CPO, D121 A).
// Il Worker ricava l'area dalla provincia salvata (mai dalla richiesta), legge conteggi_aree() con la chiave del server
// e al telefono manda solo il nome della zona e il testo del contatore: mai totali di altre aree, nomi o email.
// Supabase è finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contatoreZona, PERCORSO_ZONA } from "../worker/zona.js";
import { creaZona } from "../landing/app/moduli/zona.js";
import worker from "../worker/index.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const URL_API = "https://presenteincontri.app" + PERCORSO_ZONA;

const CONTEGGI = [
  { codice: "milano", nome: "Milano e dintorni", totale: 29, donne: 14 },
  { codice: "roma", nome: "Roma e dintorni", totale: 36, donne: 12 },
  { codice: "torino", nome: "Torino e dintorni", totale: 40, donne: 20 },
  { codice: "no", nome: "Novara", totale: 2, donne: 1 },
];

function supabaseFinto({ profilo = { provincia: "MB" }, utente = 200, conteggi = CONTEGGI, rpcStato = 200 } = {}) {
  const chiamate = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    chiamate.push({ percorso: u.pathname, cerca: u.search, metodo: opzioni.method || "GET", headers: opzioni.headers || {} });
    if (u.origin !== BASE) throw new Error("rete assente");
    if (u.pathname === "/auth/v1/user") {
      if (utente !== 200) return new Response("{}", { status: utente });
      return Response.json({ id: ID, email: "anna@example.com", email_confirmed_at: "2026-11-06T10:00:00Z" });
    }
    if (u.pathname === "/rest/v1/profili") return Response.json(profilo ? [profilo] : []);
    if (u.pathname === "/rest/v1/rpc/conteggi_aree") {
      if (rpcStato !== 200) return new Response("{}", { status: rpcStato });
      return Response.json(conteggi);
    }
    return new Response("{}", { status: 404 });
  };
  return { f, chiamate };
}

function env(extra = {}) {
  return { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-servizio-finta", ...extra };
}

function richiesta({ metodo = "GET", token = TOKEN, cerca = "" } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(URL_API + cerca, { method: metodo, headers });
}

test("area non accesa: nome della zona e «mancano N persone», nient'altro", async () => {
  const s = supabaseFinto();
  const r = await contatoreZona(richiesta(), env(), s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const corpo = await r.json();
  assert.deepEqual(corpo, {
    zona: "Milano e dintorni",
    accesa: false,
    testo: "Milano e dintorni: mancano 7 persone per aprire le stanze della tua zona. Intanto entri nella Stanza Italia.",
  });
  // La chiave del server serve solo per i conteggi e per leggere la provincia di chi ha il token.
  const profilo = s.chiamate.find((c) => c.percorso === "/rest/v1/profili");
  assert.match(profilo.cerca, new RegExp(`id=eq\\.${ID}`));
});

test("mancano solo donne: testo «Servono ancora N donne»", async () => {
  const s = supabaseFinto({ profilo: { provincia: "RM" } });
  const corpo = await (await contatoreZona(richiesta(), env(), s.f)).json();
  assert.equal(corpo.zona, "Roma e dintorni");
  // 36 profili, 12 donne: servono 4 donne in più (16 su 40 = 40%).
  assert.equal(corpo.testo, "Roma e dintorni: ci siete quasi. Servono ancora 4 donne per aprire le stanze. Invita un'amica.");
});

test("area accesa: nessun contatore", async () => {
  const s = supabaseFinto({ profilo: { provincia: "AT" } });
  const corpo = await (await contatoreZona(richiesta(), env(), s.f)).json();
  assert.deepEqual(corpo, { zona: "Torino e dintorni", accesa: true, testo: null });
});

test("provincia da sola (Novara) usa la sua area; area senza righe vale zero", async () => {
  let corpo = await (await contatoreZona(richiesta(), env(), supabaseFinto({ profilo: { provincia: "NO" } }).f)).json();
  assert.equal(corpo.testo, "Novara: mancano 34 persone per aprire le stanze della tua zona. Intanto entri nella Stanza Italia.");
  corpo = await (await contatoreZona(richiesta(), env(), supabaseFinto({ profilo: { provincia: "BA" } }).f)).json();
  assert.equal(corpo.testo, "Bari e dintorni: mancano 36 persone per aprire le stanze della tua zona. Intanto entri nella Stanza Italia.");
});

test("vale la provincia in vigore: un cambio non ancora valido usa la provincia di prima", async () => {
  const domani = new Date(Date.now() + 86400000).toISOString();
  const ieri = new Date(Date.now() - 86400000).toISOString();
  let corpo = await (await contatoreZona(richiesta(), env(), supabaseFinto({ profilo: { provincia: "RM", provincia_precedente: "MI", provincia_in_vigore_dal: domani } }).f)).json();
  assert.equal(corpo.zona, "Milano e dintorni");
  corpo = await (await contatoreZona(richiesta(), env(), supabaseFinto({ profilo: { provincia: "RM", provincia_precedente: "MI", provincia_in_vigore_dal: ieri } }).f)).json();
  assert.equal(corpo.zona, "Roma e dintorni");
});

test("l'area non si sceglie dalla richiesta: ?area=torino è ignorato", async () => {
  const corpo = await (await contatoreZona(richiesta({ cerca: "?area=torino&provincia=TO" }), env(), supabaseFinto().f)).json();
  assert.equal(corpo.zona, "Milano e dintorni");
});

test("estero, provincia mancante o profilo assente: nessuna zona", async () => {
  for (const profilo of [{ provincia: "EE" }, { provincia: null }, null]) {
    const corpo = await (await contatoreZona(richiesta(), env(), supabaseFinto({ profilo }).f)).json();
    assert.deepEqual(corpo, { zona: null, accesa: false, testo: null });
  }
});

test("conteggi non disponibili: nome della zona ma nessun numero inventato", async () => {
  for (const s of [supabaseFinto({ rpcStato: 500 }), supabaseFinto({ conteggi: "rotto" })]) {
    const corpo = await (await contatoreZona(richiesta(), env(), s.f)).json();
    assert.deepEqual(corpo, { zona: "Milano e dintorni", accesa: false, testo: null });
  }
});

test("spento finché ACCESSO_APP non vale «si»; senza token 401; token rifiutato 401; solo GET", async () => {
  const s = supabaseFinto();
  assert.equal((await contatoreZona(richiesta(), env({ ACCESSO_APP: "no" }), s.f)).status, 404);
  assert.equal(s.chiamate.length, 0, "spento: nessuna chiamata a Supabase");
  assert.equal((await contatoreZona(richiesta({ token: null }), env(), s.f)).status, 401);
  assert.equal((await contatoreZona(richiesta(), env(), supabaseFinto({ utente: 401 }).f)).status, 401);
  assert.equal((await contatoreZona(richiesta({ metodo: "POST" }), env(), s.f)).status, 405);
});

test("senza chiavi del server: nessuna zona, mai un errore per il telefono", async () => {
  const corpo = await (await contatoreZona(richiesta(), env({ SUPABASE_SERVICE_ROLE_KEY: "" }), supabaseFinto().f)).json();
  assert.deepEqual(corpo, { zona: null, accesa: false, testo: null });
});

test("limite di frequenza: oltre il limite 429", async () => {
  const LIMITE_PROVINCIA = { async limit({ key }) { assert.match(key, /^zona:/); return { success: false }; } };
  assert.equal((await contatoreZona(richiesta(), env({ LIMITE_PROVINCIA }), supabaseFinto().f)).status, 429);
});

test("il Worker serve /app/api/zona con le intestazioni dell'app", async () => {
  const r = await worker.fetch(richiesta(), env({ ACCESSO_APP: "no" }), { waitUntil() {} });
  assert.equal(r.status, 404);
  assert.match(r.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.equal(r.headers.get("cache-control"), "no-store");
});

// --- Telefono -----------------------------------------------------------------------------------------------------

test("app: legge il testo del contatore; ogni problema → null, entro 2 secondi", async () => {
  const ok = creaZona({ token: async () => TOKEN, fetch: async (url, o) => {
    assert.equal(url, PERCORSO_ZONA);
    assert.equal(o.headers.authorization, `Bearer ${TOKEN}`);
    return Response.json({ zona: "Milano e dintorni", accesa: false, testo: "Milano e dintorni: mancano 7 persone per aprire le stanze della tua zona. Intanto entri nella Stanza Italia." });
  } });
  assert.match(await ok.leggi(), /^Milano e dintorni: mancano 7 persone/);
  assert.equal(await creaZona({ token: async () => null, fetch: async () => { throw new Error("no"); } }).leggi(), null);
  assert.equal(await creaZona({ token: async () => TOKEN, fetch: async () => new Response("", { status: 500 }) }).leggi(), null);
  assert.equal(await creaZona({ token: async () => TOKEN, fetch: async () => Response.json({ testo: 42 }) }).leggi(), null);
  const lenta = creaZona({ token: async () => TOKEN, attesa: 20, fetch: (u, o) => new Promise((_, no) => o.signal.addEventListener("abort", () => no(new Error("fermata")))) });
  assert.equal(await lenta.leggi(), null);
});

test("app: la home mostra il contatore e il service worker tiene zona.js", () => {
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.match(flusso, /id: "contatore-zona"/);
  assert.match(flusso, /zona\.leggi\(\)/);
  const avvio = readFileSync(new URL("../landing/app/avvio.js", import.meta.url), "utf8");
  assert.match(avvio, /creaZona\(/);
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"/app/moduli/zona.js"'));
});
