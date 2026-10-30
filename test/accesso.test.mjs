// Test dell'accesso con email (issue #2, passo 2). Supabase è finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaAccesso, MESSAGGI } from "../landing/app/moduli/accesso.js";

const URL_FINTA = "https://abcdefghijklmnopqrst.supabase.co";

function memoriaFinta() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function supabaseFinto(risposte) {
  const chiamate = [];
  const f = async (url, opzioni) => {
    chiamate.push({ url, ...opzioni, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    const percorso = new URL(url).pathname + new URL(url).search;
    const trovata = Object.entries(risposte).find(([chiave]) => percorso.startsWith(chiave));
    if (!trovata) throw new Error("rete assente");
    const [stato, corpo] = typeof trovata[1] === "function" ? trovata[1]() : trovata[1];
    return new Response(corpo === null ? null : JSON.stringify(corpo), { status: stato });
  };
  return { f, chiamate };
}

const token = (n = 1) => ({ access_token: `acc${n}`, refresh_token: `ref${n}`, expires_in: 3600, user: { id: "u1", email: "non-salvare@example.com" } });

test("manda il link: email pulita, chiave anon nell'intestazione, ritorno all'app", async () => {
  const s = supabaseFinto({ "/auth/v1/otp": [200, {}] });
  const a = creaAccesso({ supabaseUrl: URL_FINTA, supabaseAnonKey: "anon", fetch: s.f });
  const r = await a.mandaLink("  Prova@Example.com ", "https://presenteincontri.app/app/");
  assert.deepEqual(r, { ok: true });
  assert.equal(s.chiamate.length, 1);
  assert.equal(s.chiamate[0].headers.apikey, "anon");
  assert.equal(s.chiamate[0].headers.authorization, undefined);
  assert.deepEqual(s.chiamate[0].corpo, { email: "prova@example.com", create_user: true });
  assert.match(s.chiamate[0].url, /redirect_to=https%3A%2F%2Fpresenteincontri\.app%2Fapp%2F$/);
});

test("email scritta male: nessuna chiamata", async () => {
  const s = supabaseFinto({});
  const a = creaAccesso({ supabaseUrl: URL_FINTA, supabaseAnonKey: "anon", fetch: s.f });
  assert.deepEqual(await a.mandaLink("non-una-email"), { ok: false, motivo: "email" });
  assert.equal(s.chiamate.length, 0);
});

test("troppe richieste e rete assente danno messaggi chiari, mai il testo del server", async () => {
  const s = supabaseFinto({ "/auth/v1/otp": [429, { error_code: "over_email_send_rate_limit", msg: "dettaglio interno" }] });
  const a = creaAccesso({ supabaseUrl: URL_FINTA, supabaseAnonKey: "anon", fetch: s.f });
  assert.deepEqual(await a.mandaLink("a@example.com"), { ok: false, motivo: "troppe" });
  const senzaRete = creaAccesso({ supabaseUrl: URL_FINTA, supabaseAnonKey: "anon", fetch: supabaseFinto({}).f });
  assert.deepEqual(await senzaRete.mandaLink("a@example.com"), { ok: false, motivo: "rete" });
  for (const m of ["email", "troppe", "scaduto", "codice", "rete", "generico"]) assert.ok(MESSAGGI[m]);
  assert.equal(MESSAGGI.scaduto, "Link scaduto, te ne mandiamo un altro.");
});

test("codice di 6 cifre: entra e salva solo token, scadenza e id (niente email)", async () => {
  const s = supabaseFinto({ "/auth/v1/verify": [200, token()] });
  const memoria = memoriaFinta();
  const a = creaAccesso({ supabaseUrl: URL_FINTA, supabaseAnonKey: "anon", fetch: s.f, memoria, adesso: () => 1000 });
  const r = await a.verificaCodice("a@example.com", "123 456");
  assert.equal(r.ok, true);
  assert.deepEqual(s.chiamate[0].corpo, { type: "email", email: "a@example.com", token: "123456" });
  const salvato = [...memoria.m.values()][0];
  assert.ok(!salvato.includes("non-salvare@example.com"));
  assert.deepEqual(JSON.parse(salvato), { accessToken: "acc1", refreshToken: "ref1", scadeIl: 1000 + 3600_000, utenteId: "u1" });
  assert.equal(a.connesso(), true);
});

test("codice sbagliato o scaduto, o non di 6 cifre", async () => {
  const s = supabaseFinto({ "/auth/v1/verify": [403, { error_code: "otp_expired" }] });
  const a = creaAccesso({ supabaseUrl: URL_FINTA, supabaseAnonKey: "anon", fetch: s.f });
  assert.deepEqual(await a.verificaCodice("a@example.com", "123456"), { ok: false, motivo: "codice" });
  assert.deepEqual(await a.verificaCodice("a@example.com", "12ab"), { ok: false, motivo: "codice" });
  assert.equal(s.chiamate.length, 1);
  assert.equal(a.connesso(), false);
});

test("arrivo dal link: legge i token e toglie la parte dopo «#» dall'indirizzo", () => {
  const a = creaAccesso({ supabaseUrl: URL_FINTA, supabaseAnonKey: "anon", fetch: supabaseFinto({}).f, memoria: memoriaFinta(), adesso: () => 0 });
  assert.equal(a.daLink("https://presenteincontri.app/app/"), null);
  const r = a.daLink("https://presenteincontri.app/app/#access_token=acc&refresh_token=ref&expires_in=3600&token_type=bearer&type=magiclink");
  assert.equal(r.ok, true);
  assert.equal(r.indirizzo, "/app/");
  assert.equal(r.sessione.accessToken, "acc");
  assert.equal(a.connesso(), true);
});

test("link scaduto: messaggio della specifica", () => {
  const a = creaAccesso({ supabaseUrl: URL_FINTA, supabaseAnonKey: "anon", fetch: supabaseFinto({}).f });
  const r = a.daLink("https://presenteincontri.app/app/?x=1#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
  assert.deepEqual(r, { ok: false, motivo: "scaduto", indirizzo: "/app/?x=1" });
});

test("token: valido si usa, in scadenza si rinnova, rinnovo rifiutato fa uscire", async () => {
  let ora = 0;
  let rinnovo = [200, token(2)];
  const s = supabaseFinto({ "/auth/v1/verify": [200, token(1)], "/auth/v1/token": () => rinnovo });
  const memoria = memoriaFinta();
  const a = creaAccesso({ supabaseUrl: URL_FINTA, supabaseAnonKey: "anon", fetch: s.f, memoria, adesso: () => ora });
  await a.verificaCodice("a@example.com", "111111");
  assert.equal(await a.token(), "acc1");
  ora = 3600_000 - 30_000; // mancano 30 secondi
  assert.equal(await a.token(), "acc2");
  assert.deepEqual(s.chiamate.at(-1).corpo, { refresh_token: "ref1" });
  ora += 3600_000;
  rinnovo = [400, { error_code: "refresh_token_not_found" }];
  assert.equal(await a.token(), null);
  assert.equal(a.connesso(), false);
  assert.equal(memoria.m.size, 0);
});

test("senza rete il rinnovo non cancella la sessione", async () => {
  let ora = 0;
  const memoria = memoriaFinta();
  const conRete = supabaseFinto({ "/auth/v1/verify": [200, token(1)] });
  const a = creaAccesso({ supabaseUrl: URL_FINTA, supabaseAnonKey: "anon", fetch: conRete.f, memoria, adesso: () => ora });
  await a.verificaCodice("a@example.com", "111111");
  ora = 3600_000 * 2;
  assert.equal(await a.token(), null);
  assert.equal(a.connesso(), true);
});

test("la sessione si ritrova riaprendo l'app; esci la cancella", async () => {
  const memoria = memoriaFinta();
  const s = supabaseFinto({ "/auth/v1/verify": [200, token(1)], "/auth/v1/logout": [204, null] });
  await creaAccesso({ supabaseUrl: URL_FINTA, supabaseAnonKey: "anon", fetch: s.f, memoria }).verificaCodice("a@example.com", "111111");
  const riaperta = creaAccesso({ supabaseUrl: URL_FINTA, supabaseAnonKey: "anon", fetch: s.f, memoria });
  assert.equal(riaperta.connesso(), true);
  await riaperta.esci();
  assert.equal(riaperta.connesso(), false);
  assert.equal(memoria.m.size, 0);
  assert.equal(s.chiamate.at(-1).headers.authorization, "Bearer acc1");
});

test("memoria rotta (navigazione privata): funziona lo stesso", async () => {
  const rotta = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); }, removeItem() { throw new Error("no"); } };
  const a = creaAccesso({ supabaseUrl: URL_FINTA, supabaseAnonKey: "anon", fetch: supabaseFinto({ "/auth/v1/verify": [200, token()] }).f, memoria: rotta });
  assert.equal((await a.verificaCodice("a@example.com", "111111")).ok, true);
  assert.equal(a.connesso(), true);
});

test("rifiuta indirizzi che non sono Supabase", () => {
  assert.throws(() => creaAccesso({ supabaseUrl: "https://attaccante.example", supabaseAnonKey: "anon" }));
  assert.throws(() => creaAccesso({ supabaseUrl: "http://abcdefghijklmnopqrst.supabase.co", supabaseAnonKey: "anon" }));
});

test("utenteId: dalla risposta del codice o, arrivando dal link, dal token stesso", async () => {
  const s = supabaseFinto({ "/auth/v1/verify": [200, { ...token(1), user: { id: "11111111-2222-4333-8444-555555555555" } }] });
  const a = creaAccesso({ supabaseUrl: URL_FINTA, supabaseAnonKey: "anon", fetch: s.f, memoria: memoriaFinta() });
  assert.equal(a.utenteId(), null);
  await a.verificaCodice("a@example.com", "123456");
  assert.equal(a.utenteId(), "11111111-2222-4333-8444-555555555555");
  const corpo = Buffer.from(JSON.stringify({ sub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "authenticated" })).toString("base64url");
  const b = creaAccesso({ supabaseUrl: URL_FINTA, supabaseAnonKey: "anon", fetch: s.f, memoria: memoriaFinta() });
  b.daLink(`https://presenteincontri.app/app/#access_token=eyJhbGciOi.${corpo}.firma&refresh_token=r&expires_in=3600`);
  assert.equal(b.utenteId(), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
});
