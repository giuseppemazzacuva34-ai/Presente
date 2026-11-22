// Accesso solo per i tester (richiesta di Giuseppe del 22/11): ACCESSO_APP = «tester».
// Il login con email funziona solo per gli indirizzi del segreto EMAIL_TESTER; per tutti gli altri l'app resta chiusa
// e non parte nessuna email. Supabase è finto: nessuna rete, nessun indirizzo reale (solo example.com).
import { test } from "node:test";
import assert from "node:assert/strict";
import { modoAccesso, accessoAperto, emailAmmessa, personaAmmessa, accessoTester, PERCORSO_ACCESSO_TESTER } from "../worker/accesso_tester.js";
import { configurazione } from "../worker/app.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ENV = {
  ACCESSO_APP: "tester",
  EMAIL_TESTER: " Prova.Tester@Example.com, seconda@example.com ",
  SUPABASE_URL: BASE,
  SUPABASE_ANON_KEY: "sb_publishable_finta",
  SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta",
};

function supabaseFinto(risposte = {}) {
  const chiamate = [];
  const f = async (url, opzioni = {}) => {
    chiamate.push({ url, ...opzioni, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    const percorso = new URL(url).pathname;
    const r = risposte[percorso] || [200, {}];
    return new Response(JSON.stringify(r[1]), { status: r[0] });
  };
  return { f, chiamate };
}

function richiesta(corpo, { metodo = "POST", origine = "https://presenteincontri.app" } = {}) {
  const headers = { "content-type": "application/json" };
  if (origine) headers.origin = origine;
  return new Request("https://presenteincontri.app" + PERCORSO_ACCESSO_TESTER, {
    method: metodo, headers, body: metodo === "POST" ? JSON.stringify(corpo) : undefined,
  });
}

test("modo dell'accesso: «si», «tester», tutto il resto «no»", () => {
  assert.equal(modoAccesso({ ACCESSO_APP: "si" }), "si");
  assert.equal(modoAccesso({ ACCESSO_APP: " tester " }), "tester");
  assert.equal(modoAccesso({ ACCESSO_APP: "no" }), "no");
  assert.equal(modoAccesso({ ACCESSO_APP: "TESTER-x" }), "no");
  assert.equal(modoAccesso({}), "no");
  assert.equal(accessoAperto({ ACCESSO_APP: "si" }), true);
  assert.equal(accessoAperto({ ACCESSO_APP: "tester" }), true);
  assert.equal(accessoAperto({ ACCESSO_APP: "no" }), false);
});

test("email ammessa solo se è nel segreto EMAIL_TESTER (maiuscole e spazi non contano)", () => {
  assert.equal(emailAmmessa(ENV, "prova.tester@example.com"), true);
  assert.equal(emailAmmessa(ENV, "  PROVA.TESTER@example.com "), true);
  assert.equal(emailAmmessa(ENV, "seconda@example.com"), true);
  assert.equal(emailAmmessa(ENV, "altra@example.com"), false);
  assert.equal(emailAmmessa(ENV, "tester@example.com"), false); // niente corrispondenze parziali
  assert.equal(emailAmmessa(ENV, ""), false);
  assert.equal(emailAmmessa({ ...ENV, EMAIL_TESTER: "" }, ""), false);
  assert.equal(emailAmmessa({ ...ENV, EMAIL_TESTER: undefined }, "prova.tester@example.com"), false);
});

test("persona ammessa: con «si» tutti, con «tester» solo chi ha l'email in lista e confermata", () => {
  const tester = { email: "prova.tester@example.com", email_confirmed_at: "2026-11-22T20:00:00Z" };
  assert.equal(personaAmmessa({ ACCESSO_APP: "si" }, { email: "chiunque@example.com" }), true);
  assert.equal(personaAmmessa(ENV, tester), true);
  assert.equal(personaAmmessa(ENV, { ...tester, email: "altra@example.com" }), false);
  assert.equal(personaAmmessa(ENV, { ...tester, email_confirmed_at: null }), false);
  assert.equal(personaAmmessa(ENV, null), false);
  assert.equal(personaAmmessa({ ACCESSO_APP: "no" }, tester), false);
});

test("con «tester» un'email fuori lista riceve «non_aperto» e non parte nessuna email", async () => {
  const s = supabaseFinto();
  const r = await accessoTester(richiesta({ email: "altra@example.com" }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: false, motivo: "non_aperto" });
  assert.equal(s.chiamate.length, 0);
});

test("con «tester» un'email in lista: account creato se manca, poi email con link e codice", async () => {
  const s = supabaseFinto({ "/auth/v1/admin/users": [422, { error_code: "email_exists" }] });
  const r = await accessoTester(richiesta({ email: " Prova.Tester@Example.com " }), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(s.chiamate.length, 2);
  const [crea, otp] = s.chiamate;
  assert.equal(new URL(crea.url).pathname, "/auth/v1/admin/users");
  assert.equal(crea.headers.apikey, "chiave-server-finta");
  assert.deepEqual(crea.corpo, { email: "prova.tester@example.com", email_confirm: true });
  assert.equal(new URL(otp.url).pathname, "/auth/v1/otp");
  // L'email la manda Supabase con la chiave pubblica e senza creare account (le iscrizioni libere restano chiuse).
  assert.equal(otp.headers.apikey, "sb_publishable_finta");
  assert.deepEqual(otp.corpo, { email: "prova.tester@example.com", create_user: false });
  assert.equal(new URL(otp.url).searchParams.get("redirect_to"), "https://presenteincontri.app/app/");
});

test("spento con «no» o «si»: risposta 404 e nessuna chiamata (con «si» l'app usa Supabase come prima)", async () => {
  for (const valore of ["no", "si", ""]) {
    const s = supabaseFinto();
    const r = await accessoTester(richiesta({ email: "prova.tester@example.com" }), { ...ENV, ACCESSO_APP: valore }, s.f);
    assert.equal(r.status, 404);
    assert.equal(s.chiamate.length, 0);
  }
});

test("solo POST dalla nostra web app", async () => {
  const s = supabaseFinto();
  assert.equal((await accessoTester(richiesta(null, { metodo: "GET" }), ENV, s.f)).status, 405);
  assert.equal((await accessoTester(richiesta({ email: "prova.tester@example.com" }, { origine: "https://altro.example" }), ENV, s.f)).status, 403);
  assert.equal((await accessoTester(richiesta({ email: "prova.tester@example.com" }, { origine: null }), ENV, s.f)).status, 403);
  assert.equal(s.chiamate.length, 0);
});

test("email scritta male o corpo non valido: «email», nessuna chiamata", async () => {
  const s = supabaseFinto();
  for (const corpo of [{ email: "non-una-email" }, { email: 42 }, {}]) {
    const r = await accessoTester(richiesta(corpo), ENV, s.f);
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { ok: false, motivo: "email" });
  }
  assert.equal(s.chiamate.length, 0);
});

test("troppe richieste dalla stessa connessione: 429 prima di guardare l'email", async () => {
  const s = supabaseFinto();
  const env = { ...ENV, LIMITE_ACCESSO: { async limit() { return { success: false }; } } };
  const r = await accessoTester(richiesta({ email: "prova.tester@example.com" }), env, s.f);
  assert.equal(r.status, 429);
  assert.deepEqual(await r.json(), { ok: false, motivo: "troppe" });
  assert.equal(s.chiamate.length, 0);
});

test("Supabase dice troppe email o non risponde: messaggi generici, mai il testo del server", async () => {
  const troppe = supabaseFinto({ "/auth/v1/otp": [429, { msg: "dettaglio interno" }] });
  assert.deepEqual(await (await accessoTester(richiesta({ email: "prova.tester@example.com" }), ENV, troppe.f)).json(), { ok: false, motivo: "troppe" });
  const rotto = supabaseFinto({ "/auth/v1/admin/users": [500, { msg: "dettaglio interno" }] });
  const r = await accessoTester(richiesta({ email: "prova.tester@example.com" }), ENV, rotto.f);
  assert.deepEqual(await r.json(), { ok: false, motivo: "generico" });
  assert.equal(rotto.chiamate.length, 1); // senza account non si manda l'email
  const rete = async () => { throw new Error("rete assente"); };
  assert.deepEqual(await (await accessoTester(richiesta({ email: "prova.tester@example.com" }), ENV, rete)).json(), { ok: false, motivo: "generico" });
});

test("mancano i segreti: «generico» e nessuna chiamata", async () => {
  const s = supabaseFinto();
  const r = await accessoTester(richiesta({ email: "prova.tester@example.com" }), { ...ENV, SUPABASE_SERVICE_ROLE_KEY: "" }, s.f);
  assert.deepEqual(await r.json(), { ok: false, motivo: "generico" });
  assert.equal(s.chiamate.length, 0);
});

test("config.json: con «tester» l'accesso è acceso e dice il modo; l'elenco delle email non esce mai", async () => {
  const corpo = await configurazione(ENV).json();
  assert.equal(corpo.accesso, true);
  assert.equal(corpo.modo, "tester");
  assert.doesNotMatch(JSON.stringify(corpo), /example\.com/);
  const si = await configurazione({ ...ENV, ACCESSO_APP: "si" }).json();
  assert.equal(si.accesso, true);
  assert.equal(si.modo, "si");
  const no = await configurazione({ ...ENV, ACCESSO_APP: "no" }).json();
  assert.equal(no.accesso, false);
});
