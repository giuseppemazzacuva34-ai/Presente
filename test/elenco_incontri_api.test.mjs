// Elenco dei propri incontri (issue #6, spec v1 del CPO del 3/11, punto 1 «Vi incontrate»), passo 3l della linea
// «sviluppatore-b»: GET /app/api/incontro?elenco=1 → miei_incontri della persona del token, per raggiungere dalla home
// la schermata «Il vostro incontro». Al telefono solo { porta, nome, stato, scadenza, orario, esito }. Supabase finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { incontroApi, PERCORSO_INCONTRO } from "../worker/incontro_api.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const ALTRO = "66666666-7777-4888-9999-000000000000";
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PORTA2 = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const SCADE = "2026-12-02T20:00:00+00:00";

function supabaseFinto(elenco) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID });
    if (u.pathname === "/rest/v1/rpc/miei_incontri") return elenco instanceof Response ? elenco : Response.json(elenco);
    return new Response("{}", { status: 404 });
  };
  return { f, viste };
}
const leggi = (q = "?elenco=1") => new Request(SITO + PERCORSO_INCONTRO + q, { headers: { authorization: "Bearer eyJhbGciOi.prova.firma12345" } });

test("elenco: chiede al database solo la persona del token", async () => {
  const s = supabaseFinto([]);
  const r = await incontroApi(leggi(`?elenco=1&persona=${ALTRO}`), ENV, s.f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { ok: true, incontri: [] });
  assert.deepEqual(s.viste.filter((v) => v.percorso === "/rest/v1/rpc/miei_incontri").map((v) => v.corpo), [{ p_persona: ID }]);
});

test("elenco: solo i sei campi previsti; righe di forma sbagliata si scartano", async () => {
  const s = supabaseFinto([
    { porta: PORTA, nome: "Bruno", stato: "da_fissare", scadenza: SCADE, orario: null, esito: null, email: "x@example.com", con: ALTRO },
    { porta: PORTA2, nome: "Carlo", stato: "concluso", scadenza: SCADE, orario: SCADE, esito: "avvenuto", segnale: "mela" },
    { porta: "non-un-id", nome: "X", stato: "da_fissare", scadenza: SCADE },
    { porta: PORTA, nome: "Y", stato: "inventato", scadenza: SCADE },
    { porta: PORTA, nome: "Z", stato: "proposto", scadenza: "ieri" },
    null,
  ]);
  const corpo = await (await incontroApi(leggi(), ENV, s.f)).json();
  assert.deepEqual(corpo, { ok: true, incontri: [
    { porta: PORTA, nome: "Bruno", stato: "da_fissare", scadenza: SCADE, orario: null, esito: null },
    { porta: PORTA2, nome: "Carlo", stato: "concluso", scadenza: SCADE, orario: SCADE, esito: "avvenuto" },
  ] });
});

test("elenco: nome mancante o troppo lungo → null (la schermata dice «l'altra persona»)", async () => {
  const s = supabaseFinto([{ porta: PORTA, nome: "x".repeat(200), stato: "proposto", scadenza: SCADE, orario: SCADE, esito: null }]);
  const corpo = await (await incontroApi(leggi(), ENV, s.f)).json();
  assert.equal(corpo.incontri[0].nome, null);
});

test("elenco: risposta che non è un elenco o errore del database → 503 «riprova»", async () => {
  for (const cattivo of [null, { porta: PORTA }, "ciao", new Response("{}", { status: 500 })]) {
    const r = await incontroApi(leggi(), ENV, supabaseFinto(cattivo).f);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).motivo, "riprova");
  }
});

test("elenco: spento finché ACCESSO_APP non vale «si»", async () => {
  const s = supabaseFinto([]);
  assert.equal((await incontroApi(leggi(), { ...ENV, ACCESSO_APP: "no" }, s.f)).status, 404);
  assert.equal(s.viste.length, 0);
});
