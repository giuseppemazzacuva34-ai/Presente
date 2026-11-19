// Avvisi di sicurezza della #7 (spec v1.1, D139 A): ogni minuto il Worker mette in coda gli avvisi da ripetere,
// legge quelli non ancora spediti e manda UNA email via Brevo alla casella della sicurezza, poi li segna come spediti.
// Nel testo solo il tipo e i numeri: mai nomi, email, racconti o id. Linea «sviluppatore-b». Nessun dato reale: fetch finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spedisciAvvisiSicurezza, testoAvviso, CRON_AVVISI } from "../worker/avvisi_sicurezza.js";
import worker from "../worker/index.js";

const ENV = {
  ACCESSO_APP: "si",
  SUPABASE_URL: "https://prova.supabase.co/",
  SUPABASE_SERVICE_ROLE_KEY: "chiave-finta",
  BREVO_API_KEY: "brevo-finta",
  EMAIL_SICUREZZA: "casella@example.org",
};

// Supabase e Brevo finti: registrano le richieste.
function finto({ ripetere = [], inCoda = [], brevoOk = true } = {}) {
  const viste = [];
  const f = async (url, o = {}) => {
    viste.push({ url: String(url), metodo: o.method || "GET", headers: o.headers || {}, corpo: o.body ? JSON.parse(o.body) : null });
    const u = String(url);
    if (u.endsWith("/rest/v1/rpc/avvisi_da_ripetere")) return new Response(JSON.stringify(ripetere), { status: 200 });
    if (u.startsWith("https://api.brevo.com/")) return new Response("{}", { status: brevoOk ? 201 : 500 });
    if (u.includes("/rest/v1/avvisi_sicurezza") && (o.method || "GET") === "GET") return new Response(JSON.stringify(inCoda), { status: 200 });
    return new Response(null, { status: 201 });
  };
  return { f, viste };
}

for (const manca of ["ACCESSO_APP", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "BREVO_API_KEY", "EMAIL_SICUREZZA"]) {
  test(`spento senza ${manca}: nessuna richiesta`, async () => {
    const { f, viste } = finto();
    const env = { ...ENV, [manca]: manca === "ACCESSO_APP" ? "no" : "" };
    assert.deepEqual(await spedisciAvvisiSicurezza(env, f), { esito: "spento" });
    assert.equal(viste.length, 0);
  });
}

test("niente in coda: nessuna email", async () => {
  const { f, viste } = finto();
  assert.deepEqual(await spedisciAvvisiSicurezza(ENV, f), { esito: "niente" });
  assert.equal(viste.filter((v) => v.url.includes("brevo")).length, 0);
});

test("ripete in coda gli avvisi dovuti, poi manda una sola email e segna spediti quelli letti", async () => {
  const ripetere = [{ segnalazione_id: "11111111-1111-1111-1111-111111111111", sospensione_id: null, perche: "non_aperta" }];
  const inCoda = [
    { id: "aaaaaaaa-0000-0000-0000-000000000001", perche: "nuova" },
    { id: "aaaaaaaa-0000-0000-0000-000000000002", perche: "nuova" },
    { id: "aaaaaaaa-0000-0000-0000-000000000003", perche: "non_aperta" },
  ];
  const { f, viste } = finto({ ripetere, inCoda });
  const esito = await spedisciAvvisiSicurezza(ENV, f);
  assert.deepEqual(esito, { esito: "spedito", avvisi: 3 });

  const [rpc, inserisci, leggi, brevo, segna] = viste;
  assert.equal(rpc.url, "https://prova.supabase.co/rest/v1/rpc/avvisi_da_ripetere");
  assert.equal(rpc.metodo, "POST");
  assert.equal(rpc.headers.apikey, "chiave-finta");
  assert.equal(inserisci.url, "https://prova.supabase.co/rest/v1/avvisi_sicurezza");
  assert.equal(inserisci.metodo, "POST");
  assert.deepEqual(inserisci.corpo, ripetere);
  assert.equal(leggi.metodo, "GET");
  assert.match(leggi.url, /avvisi_sicurezza\?select=id,perche&inviato_il=is\.null/);

  assert.equal(brevo.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(brevo.metodo, "POST");
  assert.equal(brevo.headers["api-key"], "brevo-finta");
  assert.deepEqual(brevo.corpo.to, [{ email: "casella@example.org" }]);
  assert.equal(brevo.corpo.sender.email, "ciao@presenteincontri.app");
  assert.match(brevo.corpo.textContent, /2 segnalazioni nuove/);
  assert.match(brevo.corpo.textContent, /1 segnalazione non ancora aperta/);
  assert.match(brevo.corpo.textContent, /112/);
  for (const c of inCoda) assert.doesNotMatch(JSON.stringify(brevo.corpo), new RegExp(c.id));

  assert.equal(segna.metodo, "PATCH");
  assert.equal(segna.url, `https://prova.supabase.co/rest/v1/avvisi_sicurezza?id=in.(${inCoda.map((c) => c.id).join(",")})`);
  assert.ok(segna.corpo.inviato_il);
});

test("se Brevo non risponde bene gli avvisi restano in coda per il minuto dopo", async () => {
  const { f, viste } = finto({ inCoda: [{ id: "aaaaaaaa-0000-0000-0000-000000000009", perche: "nuova" }], brevoOk: false });
  assert.deepEqual(await spedisciAvvisiSicurezza(ENV, f), { esito: "errore" });
  assert.equal(viste.filter((v) => v.metodo === "PATCH").length, 0);
});

test("un errore di rete non esce mai come eccezione", async () => {
  const esito = await spedisciAvvisiSicurezza(ENV, async () => { throw new TypeError("rete"); });
  assert.deepEqual(esito, { esito: "errore" });
});

test("il testo dice solo tipi e numeri, con le sospensioni da rivedere", () => {
  const t = testoAvviso([{ perche: "revisione_scaduta" }, { perche: "nuova" }]);
  assert.match(t.oggetto, /sicurezza/i);
  assert.match(t.testo, /1 segnalazione nuova/);
  assert.match(t.testo, /1 sospensione da rivedere/);
  assert.match(t.testo, /presenteincontri\.app\/app\/pannello\.html/);
});

test("ogni minuto parte solo il lavoro degli avvisi, e il cron è in wrangler.jsonc", async () => {
  const wr = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.ok(wr.includes(`"${CRON_AVVISI}"`), "manca il cron ogni minuto in wrangler.jsonc");
  // Con il cron degli avvisi e l'app spenta non deve partire nessuna richiesta (né D1 né Supabase).
  let chiamate = 0;
  const fetchVero = globalThis.fetch;
  globalThis.fetch = async () => { chiamate++; return new Response("{}"); };
  try {
    const env = { ACCESSO_APP: "no", DB: { prepare() { chiamate++; throw new Error("D1 non doveva partire"); } } };
    await worker.scheduled({ cron: CRON_AVVISI }, env, null);
  } finally { globalThis.fetch = fetchVero; }
  assert.equal(chiamate, 0);
});
