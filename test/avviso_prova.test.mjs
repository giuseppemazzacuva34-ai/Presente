// Email di prova degli avvisi di sicurezza (#7, D139 A; richiesta del Coordinatore del 25/11 dopo az-brevo-chiave):
// UNA email alla casella della sicurezza nel solo minuto scritto in AVVISO_PROVA (wrangler.jsonc), anche con l'app
// spenta, per controllare che BREVO_API_KEY ed EMAIL_SICUREZZA funzionino. Nessun database, nessun dato personale.
// Linea «sviluppatore-b». Nessun dato reale: fetch finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { avvisoDiProva, TESTO_PROVA } from "../worker/avviso_prova.js";
import { CRON_AVVISI } from "../worker/avvisi_sicurezza.js";
import worker from "../worker/index.js";

const MINUTO = "2026-11-25T14:30Z";
const DENTRO = Date.parse("2026-11-25T14:30:00Z") + 1500; // il cron può partire qualche secondo dopo
const ENV = { ACCESSO_APP: "no", AVVISO_PROVA: MINUTO, BREVO_API_KEY: "brevo-finta", EMAIL_SICUREZZA: "casella@example.org" };

function finto(stato = 201) {
  const viste = [];
  const f = async (url, o = {}) => {
    viste.push({ url: String(url), headers: o.headers || {}, corpo: o.body ? JSON.parse(o.body) : null });
    return new Response("{}", { status: stato });
  };
  return { f, viste };
}

test("nel minuto di AVVISO_PROVA parte una sola email via Brevo, anche con l'app spenta", async () => {
  const { f, viste } = finto();
  assert.deepEqual(await avvisoDiProva(ENV, DENTRO, f), { esito: "spedito" });
  assert.equal(viste.length, 1);
  assert.equal(viste[0].url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(viste[0].headers["api-key"], "brevo-finta");
  assert.deepEqual(viste[0].corpo.to, [{ email: "casella@example.org" }]);
  assert.equal(viste[0].corpo.subject, TESTO_PROVA.oggetto);
  assert.match(viste[0].corpo.subject, /prova/);
  assert.equal(viste[0].corpo.sender.email, "ciao@presenteincontri.app");
});

test("fuori dal minuto, o senza AVVISO_PROVA, nessuna richiesta", async () => {
  for (const [env, quando] of [[ENV, DENTRO + 60000], [ENV, DENTRO - 120000], [{ ...ENV, AVVISO_PROVA: "" }, DENTRO], [{ ...ENV, AVVISO_PROVA: "domani" }, DENTRO]]) {
    const { f, viste } = finto();
    const r = await avvisoDiProva(env, quando, f);
    assert.notEqual(r.esito, "spedito");
    assert.equal(viste.length, 0);
  }
});

test("senza i segreti di Brevo nessuna richiesta, esito «segreti_mancanti»", async () => {
  for (const manca of ["BREVO_API_KEY", "EMAIL_SICUREZZA"]) {
    const { f, viste } = finto();
    assert.deepEqual(await avvisoDiProva({ ...ENV, [manca]: "" }, DENTRO, f), { esito: "segreti_mancanti" });
    assert.equal(viste.length, 0);
  }
});

test("Brevo risponde male: esito «errore», mai eccezioni", async () => {
  const { f } = finto(401);
  assert.deepEqual(await avvisoDiProva(ENV, DENTRO, f), { esito: "errore" });
  const rotto = async () => { throw new Error("rete"); };
  assert.deepEqual(await avvisoDiProva(ENV, DENTRO, rotto), { esito: "errore" });
});

test("il testo è solo una prova: niente nomi, email o numeri di segnalazioni", () => {
  assert.match(TESTO_PROVA.testo, /prova/);
  assert.match(TESTO_PROVA.testo, /112/);
  assert.doesNotMatch(TESTO_PROVA.testo, /@/);
});

test("il cron di ogni minuto manda la prova anche con l'app spenta; AVVISO_PROVA è in wrangler.jsonc", async () => {
  const wr = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(wr, /"AVVISO_PROVA": "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z"/);
  const viste = [];
  const fetchVero = globalThis.fetch;
  globalThis.fetch = async (url) => { viste.push(String(url)); return new Response("{}", { status: 201 }); };
  try {
    await worker.scheduled({ cron: CRON_AVVISI, scheduledTime: DENTRO }, ENV, null);
  } finally { globalThis.fetch = fetchVero; }
  assert.deepEqual(viste, ["https://api.brevo.com/v3/smtp/email"]);
});
