// «Momento» dello svelamento (issue #65, passo 6a, linea «sviluppatore»): il server dice quando lo svelamento si può
// fare adesso e, solo allora, se sarà con il video o con le foto. Prima del momento il tipo non esce mai: la scelta
// dell'altra persona resta segreta. Il comportamento vero lo prova supabase/test/prova_momento_svelamento.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { svelamentoApi, PERCORSO_SVELAMENTO } from "../worker/svelamento_api.js";
import { SVELAMENTO } from "../api/svelamento.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_momento_svelamento\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const codice = sql.replace(/--.*$/gm, "");

test("la migrazione del «momento» esiste e l'ultima che ridefinisce svelamento_di tiene «momento» e «tipo»", () => {
  assert.ok(file);
  const tutte = readdirSync(cartella).filter((n) => n.endsWith(".sql")).sort();
  const ultima = tutte.filter((n) => /create or replace function public\.svelamento_di/.test(readFileSync(new URL(n, cartella), "utf8"))).pop();
  assert.ok(ultima >= file);
  const dopo = readFileSync(new URL(ultima, cartella), "utf8").replace(/--.*$/gm, "");
  assert.match(dopo, /'momento', public\.momento_svelamento\(s\)/);
  assert.match(dopo, /'tipo', case when public\.momento_svelamento\(s\)/);
});

test("funzioni solo per il server, mai per il telefono", () => {
  for (const f of ["momento_svelamento", "svelamento_di"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`), f);
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`), f);
  }
  assert.doesNotMatch(codice, /to (anon|authenticated)/);
});

test("stessi valori di api/svelamento.js: 5 minuti per «pronto», mezz'ora per la fascia", () => {
  const momento = codice.slice(codice.indexOf("create function public.momento_svelamento"), codice.indexOf("create or replace function public.svelamento_di"));
  assert.match(momento, new RegExp(`interval '${SVELAMENTO.attesaOraMinuti} minutes'`));
  assert.match(momento, new RegExp(`interval '${SVELAMENTO.fasciaMinuti} minutes'`));
  assert.match(momento, /caparra_a_il is not null and s\.caparra_b_il is not null/);
});

test("il tipo esce solo nel momento e la scelta dell'altra persona non esce mai come campo", () => {
  const stato = codice.slice(codice.indexOf("create or replace function public.svelamento_di"));
  assert.match(stato, /'momento', public\.momento_svelamento\(s\)/);
  assert.match(stato, /'tipo', case when public\.momento_svelamento\(s\)/);
  assert.doesNotMatch(stato, /'sua_scelta'|'scelta_a'|'scelta_b'|'sue_fasce'|'email'|'data_nascita'|'risposta/);
});

// --- Worker: solo valori previsti verso il telefono -------------------------------------------------------------------
const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const UNA = { porta: PORTA, con: "66666666-7777-4888-9999-000000000000", nome: "Giulia", eta: 31,
  aperta_il: "2026-11-15T20:00:00+00:00", scade_il: "2026-11-17T20:00:00+00:00", mia_caparra: true, sua_caparra: true, mia_scelta: "video" };
async function leggi(porte) {
  const f = async (url) => {
    const u = new URL(url);
    if (u.pathname === "/auth/v1/user") return Response.json({ id: "11111111-2222-4333-8444-555555555555", email: "prova@example.com" });
    if (u.pathname === "/rest/v1/rpc/svelamento_di") return Response.json({ saldo: 0, porte });
    return new Response("{}", { status: 404 });
  };
  const r = await svelamentoApi(new Request("https://presenteincontri.app" + PERCORSO_SVELAMENTO, { headers: { authorization: "Bearer eyJhbGciOi.utente-di-prova.firma12345" } }), ENV, f);
  return (await r.json()).porte;
}

test("GET: «momento» vale true solo se il database dice true; «tipo» solo video/foto e solo nel momento (valore sconosciuto = null, mai fotocamera per errore)", async () => {
  const p = await leggi([
    { ...UNA, momento: true, tipo: "foto" },
    { ...UNA, momento: true, tipo: "video" },
    { ...UNA, momento: false, tipo: "foto" },
    { ...UNA, momento: "si", tipo: "video" },
    { ...UNA, momento: true, tipo: "strano" },
    { ...UNA },
  ]);
  assert.deepEqual(p.map((x) => [x.momento, x.tipo]), [[true, "foto"], [true, "video"], [false, null], [false, null], [true, null], [false, null]]);
});
