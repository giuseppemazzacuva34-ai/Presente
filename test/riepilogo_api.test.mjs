// Riepilogo alla cieca delle valutazioni (issue #6, spec v1 del CPO del 3/11, «Valutazione (D20)»), passo 3i della
// linea «sviluppatore-b»: GET /app/api/incontro?riepilogo=1 → riepilogo_valutazioni della persona del token.
// Al telefono arrivano solo { valutati, bollini, no_ricevuti }: mai la singola valutazione, mai la domanda sulla
// sicurezza, mai nomi, date o id. Supabase finto, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { incontroApi, PERCORSO_INCONTRO } from "../worker/incontro_api.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const ALTRO = "66666666-7777-4888-9999-000000000000";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

function supabaseFinto(riepilogo) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID });
    if (u.pathname === "/rest/v1/rpc/riepilogo_valutazioni") return riepilogo instanceof Response ? riepilogo : Response.json(riepilogo);
    return new Response("{}", { status: 404 });
  };
  return { f, viste };
}
const leggi = (q = "?riepilogo=1") => new Request(SITO + PERCORSO_INCONTRO + q, { headers: { authorization: `Bearer ${TOKEN}` } });

test("riepilogo: chiede al database solo la persona del token, mai quella scritta nell'indirizzo", async () => {
  const s = supabaseFinto({ valutati: 0, bollini: null, no_ricevuti: [] });
  const r = await incontroApi(leggi(`?riepilogo=1&persona=${ALTRO}`), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, riepilogo: { valutati: 0, bollini: null, no_ricevuti: [] } });
  const chiamate = s.viste.filter((v) => v.percorso === "/rest/v1/rpc/riepilogo_valutazioni");
  assert.deepEqual(chiamate.map((c) => c.corpo), [{ p_persona: ID }]);
});

test("riepilogo: bollini e «no» passano, qualunque altro campo si scarta", async () => {
  const s = supabaseFinto({ valutati: 3, bollini: { presentato: 3, foto_sue: 2, come_in_chiamata: 3, sicuro: 1 },
    no_ricevuti: ["foto_sue", "sicuro", "aspetto"], valutazioni: [{ persona: ALTRO, sicuro: false }] });
  const corpo = await (await incontroApi(leggi(), ENV, s.f)).json();
  assert.deepEqual(corpo, { ok: true, riepilogo: { valutati: 3,
    bollini: { presentato: 3, foto_sue: 2, come_in_chiamata: 3 }, no_ricevuti: ["foto_sue"] } });
  assert.ok(!JSON.stringify(corpo).includes("sicur"));
  assert.ok(!JSON.stringify(corpo).includes(ALTRO));
});

test("riepilogo: bollini prima del terzo incontro valutato → null anche se il database li mandasse", async () => {
  const s = supabaseFinto({ valutati: 2, bollini: { presentato: 2, foto_sue: 2, come_in_chiamata: 2 }, no_ricevuti: [] });
  const corpo = await (await incontroApi(leggi(), ENV, s.f)).json();
  assert.equal(corpo.riepilogo.bollini, null);
});

test("riepilogo: risposta di forma sconosciuta o errore del database → 503 «riprova»", async () => {
  for (const cattivo of [null, "ciao", { valutati: -1, no_ricevuti: [] }, { valutati: 1 }, new Response("{}", { status: 500 }),
    { valutati: 4, bollini: { presentato: 9, foto_sue: 1, come_in_chiamata: 1 }, no_ricevuti: [] }]) {
    const r = await incontroApi(leggi(), ENV, supabaseFinto(cattivo).f);
    assert.equal(r.status, 503, JSON.stringify(cattivo));
    assert.equal((await r.json()).motivo, "riprova");
  }
});

test("riepilogo: spento finché ACCESSO_APP non vale «si»", async () => {
  const s = supabaseFinto({ valutati: 0, bollini: null, no_ricevuti: [] });
  const r = await incontroApi(leggi(), { ...ENV, ACCESSO_APP: "no" }, s.f);
  assert.equal(r.status, 404);
  assert.equal(s.viste.length, 0);
});

test("senza «riepilogo» il GET resta lo stato dell'incontro (serve la porta)", async () => {
  const s = supabaseFinto({ valutati: 0, bollini: null, no_ricevuti: [] });
  const r = await incontroApi(leggi(""), ENV, s.f);
  assert.equal(r.status, 400);
  assert.equal(s.viste.filter((v) => v.percorso.includes("riepilogo")).length, 0);
});
