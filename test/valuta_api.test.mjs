// «valuta» del Worker /app/api/incontro (issue #6, spec v1 «Valutazione (D20)», passo 3c, linea «sviluppatore-b»):
// le 4 risposte dopo l'incontro passano a valuta_incontro con la persona del token, solo i campi previsti.
// Le regole (incontro avvenuto, una volta, 7 giorni) le applica il database. Supabase finto, dati inventati.
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
const ORARIO = "2026-11-20T18:00:00.000Z";

function supabaseFinto({ utente = 200, rpc = {} } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.pathname === "/auth/v1/user") return utente === 200 ? Response.json({ id: ID, email: "prova@example.com" }) : new Response("{}", { status: utente });
    const nome = u.pathname.replace("/rest/v1/rpc/", "");
    if (nome in rpc) return rpc[nome] instanceof Response ? rpc[nome] : Response.json(rpc[nome]);
    return new Response("{}", { status: 404 });
  };
  return { f, viste, rpc: (nome) => viste.filter((v) => v.percorso === `/rest/v1/rpc/${nome}`) };
}
function richiesta({ metodo = "POST", corpo = null, token = TOKEN, percorso = PERCORSO_INCONTRO } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== null) headers["content-type"] = "application/json";
  return new Request(SITO + percorso, { method: metodo, headers, body: corpo === null ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
}
const RISPOSTE = { presentato: "si", foto_sue: "non_sicuro", come_in_chiamata: "piu_o_meno", sicuro: true };
const valuta = (extra = {}) => richiesta({ corpo: { azione: "valuta", porta: PORTA, ...RISPOSTE, ...extra } });

test("valuta: spento finché ACCESSO_APP non vale «si»", async () => {
  const s = supabaseFinto({ rpc: { valuta_incontro: "grazie" } });
  assert.equal((await incontroApi(valuta(), { ...ENV, ACCESSO_APP: "no" }, s.f)).status, 404);
  assert.equal(s.viste.length, 0);
});

test("valuta: la persona è quella del token e passano solo le 4 risposte", async () => {
  const s = supabaseFinto({ rpc: { valuta_incontro: "grazie" } });
  const r = await incontroApi(valuta({ persona: ALTRO, p_persona: ALTRO, voto: 5, valutato: ALTRO }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, esito: "grazie" });
  assert.deepEqual(s.rpc("valuta_incontro")[0].corpo, { p_porta: PORTA, p_persona: ID, p_presentato: "si",
    p_foto_sue: "non_sicuro", p_come_in_chiamata: "piu_o_meno", p_sicuro: true });
});

test("valuta: con «No» alla sicurezza l'esito «racconta» è un successo (l'app propone la segnalazione, #7)", async () => {
  const s = supabaseFinto({ rpc: { valuta_incontro: "racconta" } });
  assert.deepEqual(await (await incontroApi(valuta({ sicuro: false }), ENV, s.f)).json(), { ok: true, esito: "racconta" });
});

test("valuta: risposte mancanti o fuori lista → 400 senza chiamare il database", async () => {
  for (const extra of [{ presentato: "forse" }, { foto_sue: undefined }, { sicuro: "no" }, { come_in_chiamata: 3 }, { porta: "x" }]) {
    const s = supabaseFinto({ rpc: { valuta_incontro: "grazie" } });
    const r = await incontroApi(valuta(extra), ENV, s.f);
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.equal(s.rpc("valuta_incontro").length, 0);
  }
});

test("valuta: i rifiuti del database arrivano con il loro motivo", async () => {
  for (const motivo of ["non_avvenuto", "chiusa", "gia_fatta", "risposta_non_valida"]) {
    const s = supabaseFinto({ rpc: { valuta_incontro: motivo } });
    const r = await incontroApi(valuta(), ENV, s.f);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: false, motivo });
  }
  const s = supabaseFinto({ rpc: { valuta_incontro: "non_nella_porta" } });
  assert.equal((await incontroApi(valuta(), ENV, s.f)).status, 404);
});

test("valuta: esito sconosciuto o database giù → «riprova», mai un successo", async () => {
  assert.equal((await incontroApi(valuta(), ENV, supabaseFinto({ rpc: { valuta_incontro: "boh" } }).f)).status, 503);
  assert.equal((await incontroApi(valuta(), ENV, supabaseFinto({ rpc: { valuta_incontro: new Response("{}", { status: 500 }) } }).f)).status, 503);
});
