// «racconta» del Worker /app/api/incontro (issue #6 spec v1 punto 4, #7 spec v1.1 «Priorità»; passo 3h, linea
// «sviluppatore-b»): «Sì, racconto» dopo «No» alla sicurezza manda il racconto a racconta_valutazione, con la persona
// del token. Le regole (una volta, segnalazione aperta, 1000 caratteri) le applica il database. Supabase finto, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { incontroApi, PERCORSO_INCONTRO } from "../worker/incontro_api.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const ALTRO = "66666666-7777-4888-9999-000000000000";
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

function supabaseFinto({ rpc = {} } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID, email: "prova@example.com" });
    const nome = u.pathname.replace("/rest/v1/rpc/", "");
    if (nome in rpc) return rpc[nome] instanceof Response ? rpc[nome] : Response.json(rpc[nome]);
    return new Response("{}", { status: 404 });
  };
  return { f, rpc: (nome) => viste.filter((v) => v.percorso === `/rest/v1/rpc/${nome}`) };
}
const racconta = (extra = {}) => new Request(SITO + PERCORSO_INCONTRO, { method: "POST",
  headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify({ azione: "racconta", porta: PORTA, testo: "Mi ha seguita fino a casa.", ...extra }) });

test("racconta: spento finché ACCESSO_APP non vale «si»", async () => {
  const s = supabaseFinto({ rpc: { racconta_valutazione: "raccontato" } });
  assert.equal((await incontroApi(racconta(), { ...ENV, ACCESSO_APP: "no" }, s.f)).status, 404);
  assert.equal(s.rpc("racconta_valutazione").length, 0);
});

test("racconta: la persona è quella del token e passano solo porta e testo", async () => {
  const s = supabaseFinto({ rpc: { racconta_valutazione: "raccontato" } });
  const r = await incontroApi(racconta({ persona: ALTRO, p_persona: ALTRO, contro: ALTRO }), ENV, s.f);
  assert.deepEqual(await r.json(), { ok: true, esito: "raccontato" });
  assert.deepEqual(s.rpc("racconta_valutazione")[0].corpo, { p_porta: PORTA, p_persona: ID, p_testo: "Mi ha seguita fino a casa." });
});

test("racconta: un racconto di 1000 caratteri di 4 byte ci sta", async () => {
  const s = supabaseFinto({ rpc: { racconta_valutazione: "raccontato" } });
  const r = await incontroApi(racconta({ testo: "😀".repeat(1000) }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(s.rpc("racconta_valutazione").length, 1);
});

test("racconta: testo mancante, vuoto, non testo o oltre 1000 caratteri → 400 senza chiamare il database", async () => {
  for (const testo of [undefined, null, "", "   ", 42, ["x"], "x".repeat(1001)]) {
    const s = supabaseFinto({ rpc: { racconta_valutazione: "raccontato" } });
    const r = await incontroApi(racconta({ testo }), ENV, s.f);
    assert.equal(r.status, 400, String(testo).slice(0, 20));
    assert.equal(s.rpc("racconta_valutazione").length, 0);
  }
});

test("racconta: i rifiuti del database arrivano con il loro motivo", async () => {
  for (const motivo of ["testo_non_valido", "nessuna_segnalazione", "gia_raccontato"]) {
    const s = supabaseFinto({ rpc: { racconta_valutazione: motivo } });
    assert.deepEqual(await (await incontroApi(racconta(), ENV, s.f)).json(), { ok: false, motivo });
  }
  const s = supabaseFinto({ rpc: { racconta_valutazione: "non_nella_porta" } });
  assert.equal((await incontroApi(racconta(), ENV, s.f)).status, 404);
});

test("racconta: esito sconosciuto o database giù → «riprova», mai un successo", async () => {
  assert.equal((await incontroApi(racconta(), ENV, supabaseFinto({ rpc: { racconta_valutazione: "boh" } }).f)).status, 503);
  assert.equal((await incontroApi(racconta(), ENV, supabaseFinto({ rpc: { racconta_valutazione: new Response("{}", { status: 500 }) } }).f)).status, 503);
});
