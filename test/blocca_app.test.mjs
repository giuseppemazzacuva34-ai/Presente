// «Blocca» dalla scheda della persona (issue #7, spec v1.1 punto 5 e regola «Blocco»; passo 8a della linea
// «sviluppatore-b»). Il telefono scrive solo la propria riga in blocchi (regole per riga: chi = auth.uid()).
// Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { confermaBlocco, creaBlocca } from "../landing/app/moduli/blocca.js";

const IO = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LEI = "11111111-2222-4333-8444-555555555555";
const BASE = "https://abcdefghijklmnopqrst.supabase.co";

test("conferma: i testi della spec, con il nome e mai un id", () => {
  const c = confermaBlocco("Giulia");
  assert.equal(c.titolo, "Blocca Giulia");
  assert.equal(c.testo, "Non vi vedrete più in nessuna stanza. Non potrete chiamarvi. Non lo saprà. Non si può annullare.");
  assert.equal(c.conferma, "Blocca");
  assert.equal(c.annulla, "Annulla");
  assert.equal(confermaBlocco("").titolo, "Blocca questa persona");
});

function rete(stato) {
  const viste = [];
  const f = async (url, init) => { viste.push({ url, init }); if (stato === "giu") throw new Error("rete"); return new Response(null, { status: stato }); };
  return { f, viste };
}
const crea = (f, token = async () => "tok-di-prova-abcdefghijk", utenteId = () => IO) =>
  creaBlocca({ supabaseUrl: BASE, supabaseAnonKey: "anon", token, utenteId, fetch: f });

test("blocca: una sola riga in blocchi con chi = io e bloccato = l'altra persona", async () => {
  const { f, viste } = rete(201);
  assert.deepEqual(await crea(f).blocca(LEI), { ok: true });
  assert.equal(viste.length, 1);
  assert.equal(viste[0].url, `${BASE}/rest/v1/blocchi`);
  assert.equal(viste[0].init.method, "POST");
  assert.deepEqual(JSON.parse(viste[0].init.body), { chi: IO, bloccato: LEI });
  assert.equal(viste[0].init.headers.authorization, "Bearer tok-di-prova-abcdefghijk");
  assert.match(viste[0].init.headers.prefer, /return=minimal/);
});

test("blocca: già bloccata (409) conta come fatto", async () => {
  assert.deepEqual(await crea(rete(409).f).blocca(LEI), { ok: true });
});

test("blocca: errori → motivo, senza richieste se mancano accesso o persona", async () => {
  assert.deepEqual(await crea(rete(401).f).blocca(LEI), { ok: false, motivo: "accesso" });
  assert.deepEqual(await crea(rete(500).f).blocca(LEI), { ok: false, motivo: "riprova" });
  assert.deepEqual(await crea(rete("giu").f).blocca(LEI), { ok: false, motivo: "rete" });
  const vuota = rete(201);
  assert.deepEqual(await crea(vuota.f, async () => null).blocca(LEI), { ok: false, motivo: "accesso" });
  assert.deepEqual(await crea(vuota.f).blocca("boh"), { ok: false, motivo: "persona" });
  assert.deepEqual(await crea(vuota.f).blocca(IO), { ok: false, motivo: "persona" }); // mai se stessi
  assert.equal(vuota.viste.length, 0);
});

test("indirizzo Supabase non valido: errore subito", () => {
  assert.throws(() => creaBlocca({ supabaseUrl: "https://esempio.com", supabaseAnonKey: "a", token: () => "t", utenteId: () => IO }));
});

test("il modulo non salva nulla sul telefono e non scrive nei log", () => {
  const codice = readFileSync(new URL("../landing/app/moduli/blocca.js", import.meta.url), "utf8");
  assert.ok(!/console\.|localStorage|sessionStorage|indexedDB/i.test(codice.replace(/\/\/.*$/gm, "")));
});
