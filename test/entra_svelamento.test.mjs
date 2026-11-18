// Ingresso nello svelamento (issue #65, passo 6c, linea «sviluppatore»): la migrazione è chiusa al telefono e usa gli
// stessi valori di api/svelamento.js; il Worker fa entrare SOLO la persona del token. Il comportamento vero lo prova
// supabase/test/prova_entra_svelamento.sql su un Postgres di prova.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { svelamentoApi, PERCORSO_SVELAMENTO } from "../worker/svelamento_api.js";
import { SVELAMENTO, TESTI_SVELAMENTO } from "../api/svelamento.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_entra_svelamento\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const codice = sql.replace(/--.*$/gm, "");

test("la migrazione dell'ingresso esiste", () => assert.ok(file));

test("entra_svelamento solo per il server, mai per il telefono", () => {
  assert.match(sql, /revoke all on function public\.entra_svelamento\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.entra_svelamento\(uuid, uuid\) to service_role/);
  assert.doesNotMatch(codice, /to (anon|authenticated)/);
});

test("stessa attesa massima di api/svelamento.js (10 minuti) e nessuna colonna per audio, video o immagini", () => {
  assert.equal(SVELAMENTO.attesaMinuti, 10);
  assert.match(codice, new RegExp(`interval '${SVELAMENTO.attesaMinuti} minutes'`));
  assert.doesNotMatch(codice, new RegExp(`interval '(?!${SVELAMENTO.attesaMinuti} )\\d+ minutes'`));
  const colonne = codice.slice(codice.indexOf("alter table"), codice.indexOf("create function"));
  assert.deepEqual([...colonne.matchAll(/add column (\w+) (\w+)/g)].map((m) => [m[1], m[2]]),
    [["entrato_a_il", "timestamptz"], ["entrato_b_il", "timestamptz"]]);
  assert.doesNotMatch(codice, /bytea|immagine|registra|penale|buca/i);
});

test("l'avvio usa il «momento» e le caparre di tutti e due; «foto» di uno vale per entrambi", () => {
  assert.match(codice, /public\.momento_svelamento\(v_s\)/);
  assert.match(codice, /caparra_a_il is null or v_s\.caparra_b_il is null/);
  assert.match(codice, /tentativi = tentativi \+ 1/);
  assert.match(codice, /'foto' in \(v_s\.scelta_a, v_s\.scelta_b\)/);
});

// --- Worker ------------------------------------------------------------------------------------------------------------
const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const LEI = "66666666-7777-4888-9999-000000000000";
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

function supabaseFinto(esito) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID, email: "prova@example.com" });
    if (u.pathname === "/rest/v1/rpc/entra_svelamento") return esito instanceof Response ? esito : Response.json(esito);
    return new Response("{}", { status: 404 });
  };
  return { f, viste, rpc: () => viste.filter((v) => v.percorso === "/rest/v1/rpc/entra_svelamento") };
}
const entra = (extra = {}) => new Request("https://presenteincontri.app" + PERCORSO_SVELAMENTO, {
  method: "POST",
  headers: { authorization: "Bearer eyJhbGciOi.utente-di-prova.firma12345", "content-type": "application/json" },
  body: JSON.stringify({ azione: "entra", porta: PORTA, ...extra }),
});

test("POST entra: solo per la persona del token, mai per una persona scritta nel corpo", async () => {
  const s = supabaseFinto("in_attesa");
  const r = await svelamentoApi(entra({ persona: LEI, p_persona: LEI }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, esito: "in_attesa" });
  assert.deepEqual(s.rpc()[0].corpo, { p_porta: PORTA, p_persona: ID });
});

test("POST entra: iniziato con il video o con le foto → esito «iniziato» e tipo", async () => {
  for (const tipo of ["video", "foto"]) {
    const j = await (await svelamentoApi(entra(), ENV, supabaseFinto(`iniziato_${tipo}`).f)).json();
    assert.deepEqual(j, { ok: true, esito: "iniziato", tipo });
  }
});

test("POST entra: non ancora, non arrivata, caparra mancante, già iniziato → no, senza dettagli in più", async () => {
  for (const motivo of ["non_ancora", "non_arrivato", "manca_caparra", "gia_iniziato"]) {
    const j = await (await svelamentoApi(entra(), ENV, supabaseFinto(motivo).f)).json();
    assert.deepEqual(j, { ok: false, motivo });
  }
});

test("POST entra: scaduta, chiusa, di altri o risposta strana come per le altre azioni", async () => {
  const prova = async (esito) => svelamentoApi(entra(), ENV, supabaseFinto(esito).f);
  assert.deepEqual(await (await prova("porta_scaduta")).json(), { ok: false, motivo: "porta_scaduta", testo: TESTI_SVELAMENTO.scaduta });
  assert.deepEqual(await (await prova("porta_chiusa")).json(), { ok: false, motivo: "porta_chiusa", testo: TESTI_SVELAMENTO.portaChiusa });
  assert.equal((await prova("non_nella_porta")).status, 404);
  for (const strano of ["iniziato_audio", "iniziato_", "boh", 7]) assert.equal((await prova(strano)).status, 503, String(strano));
  assert.equal((await prova(new Response("{}", { status: 500 }))).status, 503);
});

test("POST entra con porta non valida: 400 senza chiamare il database", async () => {
  const s = supabaseFinto("in_attesa");
  const r = await svelamentoApi(entra({ porta: "non-un-uuid" }), ENV, s.f);
  assert.equal(r.status, 400);
  assert.equal(s.rpc().length, 0);
});
