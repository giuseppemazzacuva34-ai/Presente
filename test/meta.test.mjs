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

// ── Import diretto dei contatti del modulo Meta (D85 A). Meta e D1 finti: nessun dato reale. ──
import { contattiModulo, importaContatto, righeDaContatto } from "../worker/meta.js";

const lead = (id = "123456", pagina = "111") => ({ object: "page", entry: [{ id: pagina, changes: [{ field: "leadgen", value: { leadgen_id: id, page_id: pagina, form_id: "9" } }] }] });

function dbFinto() {
  const scritte = [];
  const email = new Set();
  return {
    scritte,
    prepare(sql) {
      return {
        bind(...v) {
          return {
            async run() {
              if (sql.startsWith("INSERT INTO iscrizioni")) {
                scritte.push({ sql, v });
                const nuova = !email.has(v[0]);
                email.add(v[0]);
                return { meta: { changes: nuova ? 1 : 0 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
        async run() { return {}; },
      };
    },
  };
}

function metaContatti(campi, { ok = true } = {}) {
  const chiamate = [];
  const f = async (url, opzioni = {}) => {
    chiamate.push({ url, metodo: opzioni.method || "GET", auth: opzioni.headers && opzioni.headers.authorization });
    return new Response(JSON.stringify({ created_time: "2026-11-02T08:00:00+0000", id: "123456", field_data: campi }), { status: ok ? 200 : 400 });
  };
  return { f, chiamate };
}

const CAMPI = [
  { name: "email", values: ["Giulia.Prova@Example.com"] },
  { name: "in_quale_città_vivi?", values: ["Roma"] },
  { name: "hai_almeno_18_anni?", values: ["Sì"] },
  { name: "mi_presento_come", values: ["Donna"] },
];
const ENV_IMPORT = { ...ENV, RISPOSTE_META: "no", IMPORT_META: "si", ISCRIZIONI_APERTE: "si" };

test("contatti del modulo: solo campo leadgen della nostra Pagina, id numerici", () => {
  assert.deepEqual(contattiModulo(lead(), ENV), ["123456"]);
  assert.deepEqual(contattiModulo(lead("123456", "777"), ENV), []);
  assert.deepEqual(contattiModulo(lead("1; DROP"), ENV), []);
  assert.deepEqual(contattiModulo(fb("BUIO"), ENV), []);
  assert.deepEqual(contattiModulo({ object: "instagram", entry: [] }, ENV), []);
  assert.deepEqual(righeDaContatto({ created_time: "x", field_data: [{ name: "email", values: ["a@b.it"] }, null, { values: [] }] }), { created_time: "x", email: "a@b.it" });
});

test("import diretto: salva email, città, presento e data del modulo; un doppione non cambia nulla", async () => {
  const DB = dbFinto();
  const m = metaContatti(CAMPI);
  const env = { ...ENV_IMPORT, DB };
  assert.equal(await importaContatto("123456", env, m.f), "meta_nuova");
  assert.equal(await importaContatto("123456", env, m.f), "meta_gia_in_lista");
  assert.match(m.chiamate[0].url, /\/v24\.0\/123456\?fields=created_time,field_data$/);
  assert.equal(m.chiamate[0].metodo, "GET");
  assert.equal(m.chiamate[0].auth, "Bearer token-finto");
  const [email, zona, invito, consenso, versione, sorgente, presento] = DB.scritte[0].v;
  assert.deepEqual([email, zona, invito, consenso, versione, sorgente, presento],
    ["giulia.prova@example.com", "roma", null, "2026-11-02T08:00:00.000Z", "1.4.1-2026-11-03", "meta_modulo", "donna"]);
  assert.match(DB.scritte[0].sql, /ON CONFLICT\(email\) DO NOTHING$/);
});

test("import diretto: scarta prova di Meta, minorenni, email sbagliate; errore di Meta non salva", async () => {
  const casi = [
    [[{ name: "email", values: ["<test lead: dummy data for email>"] }, { name: "hai_almeno_18_anni?", values: ["Sì"] }], "meta_scartata"],
    [[{ name: "email", values: ["a@example.com"] }, { name: "hai_almeno_18_anni?", values: ["No"] }], "meta_scartata"],
    [[{ name: "email", values: ["non-email"] }, { name: "hai_almeno_18_anni?", values: ["Sì"] }], "meta_scartata"],
    [[{ name: "email", values: ["a@example.com"] }], "meta_scartata"],
    [[{ name: "telefono", values: ["1"] }], "meta_scartata"],
  ];
  for (const [campi, atteso] of casi) {
    const DB = dbFinto();
    assert.equal(await importaContatto("1", { ...ENV_IMPORT, DB }, metaContatti(campi).f), atteso);
    assert.equal(DB.scritte.length, 0);
  }
  const DB = dbFinto();
  assert.equal(await importaContatto("1", { ...ENV_IMPORT, DB }, metaContatti(CAMPI, { ok: false }).f), "meta_errore");
  // dichiarazione obbligatoria dei 18 anni nel modulo (senza domanda): vale solo con l'interruttore
  const soloEmail = [{ name: "email", values: ["b@example.com"] }];
  assert.equal(await importaContatto("1", { ...ENV_IMPORT, DB, META_MAGGIORENNE_NEL_MODULO: "si" }, metaContatti(soloEmail).f), "meta_nuova");
});

test("webhook: senza IMPORT_META o senza firma non si legge nulla da Meta; acceso importa", async () => {
  const DB = dbFinto();
  const m = metaContatti(CAMPI);
  await metaWebhook(await notifica(lead()), { ...ENV_IMPORT, IMPORT_META: "no", DB }, null, m.f);
  await metaWebhook(await notifica(lead(), { firmaRotta: true }), { ...ENV_IMPORT, DB }, null, m.f);
  // contenimento d'emergenza: iscrizioni chiuse = nessun contatto letto né salvato
  await metaWebhook(await notifica(lead()), { ...ENV_IMPORT, ISCRIZIONI_APERTE: "no", DB }, null, m.f);
  assert.equal(m.chiamate.length, 0);
  const r = await metaWebhook(await notifica(lead()), { ...ENV_IMPORT, DB }, null, m.f);
  assert.equal(r.status, 200);
  assert.equal(DB.scritte.length, 1);
});

test("import diretto: nel log nessuna email, id o risposta", async () => {
  const righe = [];
  const [log, err] = [console.log, console.error];
  console.log = (...a) => righe.push(a.join(" "));
  console.error = (...a) => righe.push(a.join(" "));
  try {
    await metaWebhook(await notifica(lead("987654")), { ...ENV_IMPORT, DB: dbFinto() }, null, metaContatti(CAMPI).f);
  } finally {
    console.log = log;
    console.error = err;
  }
  const testo = righe.join("\n");
  assert.match(testo, /meta_nuova 1/);
  assert.doesNotMatch(testo, /giulia|example|987654|Roma|Donna/i);
});

test("import diretto con la provincia (D84 A): sigla o nome → provincia, regione, zona; colonne mancanti aggiunte", async () => {
  const DB = dbFinto();
  let primo = true;
  const prep = DB.prepare.bind(DB);
  DB.prepare = (sql) => {
    const p = prep(sql);
    if (sql.startsWith("INSERT INTO iscrizioni") && primo) {
      primo = false;
      return { bind: () => ({ run: async () => { throw new Error("D1_ERROR: table iscrizioni has no column named provincia"); } }) };
    }
    return p;
  };
  const campi = [{ name: "email", values: ["p@example.com"] }, { name: "hai_almeno_18_anni?", values: ["Sì"] }, { name: "in_quale_provincia_vivi?", values: ["Lecce"] }];
  assert.equal(await importaContatto("1", { ...ENV_IMPORT, DB }, metaContatti(campi).f), "meta_nuova");
  assert.deepEqual(DB.scritte[0].v.slice(1, 2).concat(DB.scritte[0].v.slice(7)), ["altra-citta-italia", "lecce", "LE", "Puglia"]);
  const DB2 = dbFinto();
  const roma = [{ name: "email", values: ["r@example.com"] }, { name: "hai_almeno_18_anni?", values: ["Sì"] }, { name: "provincia", values: ["RM"] }];
  await importaContatto("2", { ...ENV_IMPORT, DB: DB2 }, metaContatti(roma).f);
  assert.deepEqual(DB2.scritte[0].v.slice(7), [null, "RM", "Lazio"]);
  assert.equal(DB2.scritte[0].v[1], "roma");
});
