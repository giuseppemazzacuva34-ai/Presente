// Lato app della provincia dalla lista d'attesa (#2 v1.3): mai più di 2 secondi, mai un blocco.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaLista, ATTESA_MS } from "../landing/app/moduli/lista.js";

const token = async () => "eyJhbGciOi.utente-di-prova.firma12345";

test("legge la sigla dal Worker con il token dell'utente", async () => {
  const chiamate = [];
  const lista = creaLista({ token, fetch: async (url, o) => { chiamate.push({ url, o }); return Response.json({ sigla: "RM" }); } });
  assert.equal(await lista.leggi(), "RM");
  assert.equal(chiamate[0].url, "/app/api/provincia-lista");
  assert.match(chiamate[0].o.headers.authorization, /^Bearer /);
});

test("sigla sconosciuta, risposta strana o errore → nessuna precompilazione", async () => {
  for (const f of [async () => Response.json({ sigla: "XX" }), async () => Response.json({ sigla: "Roma" }),
    async () => new Response("{}", { status: 500 }), async () => { throw new Error("rete"); }, async () => new Response("non json")]) {
    assert.equal(await creaLista({ token, fetch: f }).leggi(), null);
  }
  assert.equal(await creaLista({ token: async () => null, fetch: async () => Response.json({ sigla: "RM" }) }).leggi(), null);
});

test("Worker che non risponde: si va avanti entro 2 secondi", async () => {
  assert.equal(ATTESA_MS, 2000);
  const lento = (url, o) => new Promise((ok, no) => { o.signal.addEventListener("abort", () => no(new Error("annullata"))); });
  const inizio = Date.now();
  assert.equal(await creaLista({ token, fetch: lento, attesa: 50 }).leggi(), null);
  assert.equal(await creaLista({ token, fetch: lento, attesa: 50 }).conferma("RM"), false);
  assert.ok(Date.now() - inizio < 1000);
});

test("conferma: manda solo la sigla e legge «lista»", async () => {
  let corpo = null;
  const lista = creaLista({ token, fetch: async (url, o) => { corpo = JSON.parse(o.body); return Response.json({ lista: true }); } });
  assert.equal(await lista.conferma("RM"), true);
  assert.deepEqual(corpo, { sigla: "RM" });
  assert.equal(await creaLista({ token, fetch: async () => Response.json({ lista: false }) }).conferma("RM"), false);
});
