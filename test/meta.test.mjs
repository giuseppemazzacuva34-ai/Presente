// Test del webhook di Meta per i commenti «BUIO». Meta è finta: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { metaWebhook, contieneBuio, commentiBuio, firmaValida } from "../worker/meta.js";
import worker from "../worker/index.js";

const SEGRETO = "segreto-di-prova";
const ENV = { META_APP_SECRET: SEGRETO, META_VERIFY_TOKEN: "parola-di-prova", META_PAGE_TOKEN: "token-finto", META_PAGE_ID: "111", META_IG_ID: "222", RISPOSTE_META: "si" };

async function firma(corpo, segreto = SEGRETO) {
  const chiave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const f = new Uint8Array(await crypto.subtle.sign("HMAC", chiave, new TextEncoder().encode(corpo)));
  return "sha256=" + Array.from(f, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function notifica(dati, { segreto = SEGRETO, firmaRotta = false } = {}) {
  const corpo = JSON.stringify(dati);
  const intestazione = firmaRotta ? "sha256=" + "0".repeat(64) : await firma(corpo, segreto);
  return new Request("https://presenteincontri.app/meta/webhook", { method: "POST", headers: { "x-hub-signature-256": intestazione, "content-type": "application/json" }, body: corpo });
}

function metaFinta({ privatoOk = true } = {}) {
  const chiamate = [];
  const f = async (url, opzioni) => {
    chiamate.push({ url, corpo: JSON.parse(opzioni.body), auth: opzioni.headers.authorization });
    const ok = url.endsWith("/messages") ? privatoOk : true;
    return new Response("{}", { status: ok ? 200 : 400 });
  };
  return { f, chiamate };
}

const ig = (testo, da = "999") => ({ object: "instagram", entry: [{ id: "222", changes: [{ field: "comments", value: { id: "c1", text: testo, from: { id: da, username: "qualcuno" }, media: { id: "m1" } } }] }] });
const fb = (testo, da = "999", verb = "add") => ({ object: "page", entry: [{ id: "111", changes: [{ field: "feed", value: { item: "comment", verb, comment_id: "p1_c2", post_id: "p1", message: testo, from: { id: da, name: "Qualcuno" } } }] }] });

test("BUIO riconosciuto come parola, non dentro altre parole", () => {
  for (const t of ["BUIO", "buio", "Buio!!", "  buio 🖤", "voglio il BUIO.", "BÙIO"]) assert.equal(contieneBuio(t), true, t);
  for (const t of ["", "buiosa", "abbuiato", "luce", null, 42]) assert.equal(contieneBuio(t), false, String(t));
});

test("verifica di Meta: risponde con la sfida solo con la parola giusta", async () => {
  const base = "https://presenteincontri.app/meta/webhook?hub.mode=subscribe&hub.challenge=12345&hub.verify_token=";
  const ok = await metaWebhook(new Request(base + "parola-di-prova"), ENV);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "12345");
  assert.equal((await metaWebhook(new Request(base + "sbagliata"), ENV)).status, 403);
  assert.equal((await metaWebhook(new Request(base + "x"), {})).status, 503);
  const sfidaStrana = await metaWebhook(new Request(base.replace("12345", "%3Cscript%3E") + "parola-di-prova"), ENV);
  assert.equal(sfidaStrana.status, 400);
});

test("senza firma giusta non si chiama Meta", async () => {
  const m = metaFinta();
  assert.equal((await metaWebhook(await notifica(ig("BUIO"), { firmaRotta: true }), ENV, null, m.f)).status, 401);
  assert.equal((await metaWebhook(await notifica(ig("BUIO"), { segreto: "altro" }), ENV, null, m.f)).status, 401);
  const senzaFirma = new Request("https://presenteincontri.app/meta/webhook", { method: "POST", body: JSON.stringify(ig("BUIO")) });
  assert.equal((await metaWebhook(senzaFirma, ENV, null, m.f)).status, 401);
  assert.equal(m.chiamate.length, 0);
  assert.equal(await firmaValida(new TextEncoder().encode("x"), "sha256=abc", ""), false);
});

test("Instagram: messaggio privato con il link e risposta pubblica", async () => {
  const m = metaFinta();
  const r = await metaWebhook(await notifica(ig("buio!")), ENV, null, m.f);
  assert.equal(r.status, 200);
  assert.equal(m.chiamate.length, 2);
  const [privato, pubblico] = m.chiamate;
  assert.match(privato.url, /\/v24\.0\/111\/messages$/);
  assert.deepEqual(privato.corpo.recipient, { comment_id: "c1" });
  assert.match(privato.corpo.message.text, /presenteincontri\.app\/da\/instagram/);
  assert.match(pubblico.url, /\/c1\/replies$/);
  assert.doesNotMatch(pubblico.corpo.message, /https?:/);
  assert.equal(privato.auth, "Bearer token-finto");
});

test("Facebook: commento sulla Pagina, rispondi con /comments; link pubblico se il privato non parte", async () => {
  const m = metaFinta({ privatoOk: false });
  await metaWebhook(await notifica(fb("BUIO")), ENV, null, m.f);
  assert.equal(m.chiamate.length, 2);
  assert.match(m.chiamate[1].url, /\/p1_c2\/comments$/);
  assert.match(m.chiamate[1].corpo.message, /presenteincontri\.app\/da\/facebook/);
});

test("niente risposte ai nostri commenti, ai commenti senza BUIO, alle modifiche o con l'interruttore spento", async () => {
  const m = metaFinta();
  await metaWebhook(await notifica(ig("BUIO", "222")), ENV, null, m.f);
  await metaWebhook(await notifica(fb("BUIO", "111")), ENV, null, m.f);
  await metaWebhook(await notifica(ig("che bello")), ENV, null, m.f);
  await metaWebhook(await notifica(fb("BUIO", "999", "edited")), ENV, null, m.f);
  const spento = await metaWebhook(await notifica(ig("BUIO")), { ...ENV, RISPOSTE_META: "no" }, null, m.f);
  assert.equal(spento.status, 200);
  assert.equal(m.chiamate.length, 0);
});

test("corpo non JSON o strano: 200 e nessuna chiamata", async () => {
  const m = metaFinta();
  const corpo = "non è json";
  const r = new Request("https://presenteincontri.app/meta/webhook", { method: "POST", headers: { "x-hub-signature-256": await firma(corpo) }, body: corpo });
  assert.equal((await metaWebhook(r, ENV, null, m.f)).status, 200);
  assert.deepEqual(commentiBuio({ object: "instagram", entry: [{ changes: [null, {}] }] }, ENV), []);
  assert.equal(m.chiamate.length, 0);
});

test("il Worker instrada /meta/webhook e nel log non finiscono testi né id", async () => {
  const righe = [];
  const originale = console.log;
  console.log = (...a) => righe.push(a.join(" "));
  const veraFetch = globalThis.fetch;
  globalThis.fetch = metaFinta().f;
  try {
    const r = await worker.fetch(await notifica(ig("BUIO segreto-del-commento")), { ...ENV, ASSETS: { fetch: () => new Response("") } }, null);
    assert.equal(r.status, 200);
  } finally {
    console.log = originale;
    globalThis.fetch = veraFetch;
  }
  const log = righe.join("\n");
  assert.doesNotMatch(log, /segreto-del-commento|c1|999|qualcuno/);
});
