// «Ho mandato l'email» nel pannello, lato browser (issue #7 spec v1.3; D144 A). Linea «sviluppatore-b», passo 15f.
// Il pannello segna «Email mandata» solo dopo il tocco di «Ho mandato l'email» (data e ora salvate dal Worker) e,
// riaprendo l'email, dice se era già segnata. Pulsante con etichetta e tastiera (button nativo). Rete finta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaPannello, testoMandata } from "../landing/app/moduli/pannello.js";

const ZID = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const EMAIL = { a: "persona@example.com", livello: "avviso", regola: "affari", fine_il: null };
const QUANDO = "2026-11-21T15:05:00+00:00";

function reteFinta(risposte) {
  const viste = [];
  const f = async (url, init = {}) => {
    viste.push([url, init.method, init.body ? JSON.parse(init.body) : null]);
    const r = risposte[url];
    return r ? Response.json(r.corpo, { status: r.stato || 200 }) : new Response("{}", { status: 404 });
  };
  return { f, viste };
}

test("testo: «Email mandata il <giorno> alle <ora>» con l'ora di Roma; data strana → vuoto", () => {
  assert.equal(testoMandata(QUANDO), "Email mandata il 21 novembre alle 16:05.");
  assert.equal(testoMandata(null), "");
  assert.equal(testoMandata("non una data"), "");
});

test("client: «Ho mandato l'email» chiama /mandata e restituisce il testo con data e ora", async () => {
  const { f, viste } = reteFinta({ "/app/api/pannello/mandata": { corpo: { ok: true, mandata_il: QUANDO } } });
  const p = creaPannello({ token: async () => "tok", fetch: f });
  assert.deepEqual(await p.segnaMandata(ZID), { ok: true, mandata: "Email mandata il 21 novembre alle 16:05." });
  assert.deepEqual(viste[0], ["/app/api/pannello/mandata", "POST", { id: ZID }]);
});

test("client: id malformato non parte; risposta senza data o errore → riprova", async () => {
  const { f, viste } = reteFinta({ "/app/api/pannello/mandata": { corpo: { ok: true, mandata_il: "x" } } });
  const p = creaPannello({ token: async () => "tok", fetch: f });
  assert.deepEqual(await p.segnaMandata("x"), { ok: false, motivo: "id" });
  assert.equal(viste.length, 0);
  assert.deepEqual(await p.segnaMandata(ZID), { ok: false, motivo: "riprova" });
  const g = creaPannello({ token: async () => "tok", fetch: reteFinta({ "/app/api/pannello/mandata": { stato: 503, corpo: { ok: false } } }).f });
  assert.equal((await g.segnaMandata(ZID)).ok, false);
});

test("client: riaprendo l'email il pannello sa se era già segnata", async () => {
  const prima = creaPannello({ token: async () => "tok", fetch: reteFinta({ "/app/api/pannello/email": { corpo: { ok: true, email: EMAIL, mandata_il: null } } }).f });
  assert.equal((await prima.emailSanzione(ZID)).mandata, "");
  const dopo = creaPannello({ token: async () => "tok", fetch: reteFinta({ "/app/api/pannello/email": { corpo: { ok: true, email: EMAIL, mandata_il: QUANDO } } }).f });
  assert.equal((await dopo.emailSanzione(ZID)).mandata, "Email mandata il 21 novembre alle 16:05.");
});

test("schermata: pulsante «Ho mandato l'email» (button con testo) e stato annunciato; nessun invio di email", () => {
  const avvio = readFileSync(new URL("../landing/app/pannello_avvio.js", import.meta.url), "utf8");
  assert.match(avvio, /const segna = h\("button", \{ type: "button"/);
  assert.match(avvio, /testo: "Ho mandato l'email" \}\)/);
  assert.match(avvio, /p\.segnaMandata\(sanzione\)/);
  assert.match(avvio, /role: "status"/);
  assert.doesNotMatch(avvio, /mailto:|sendmail|resend|mailchannels/i);
});
