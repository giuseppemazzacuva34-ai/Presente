// Email a chi riceve una sanzione nel pannello (issue #7 spec v1.1 punto 7; D144 A di Giuseppe). Linea «sviluppatore-b»,
// passo 15c. Dopo la decisione il pannello mostra l'indirizzo e il testo pronto (livello, regola violata, data di fine,
// link «Contesta»), fatto con gli stessi testi del messaggio in app; l'email la manda Giuseppe a mano. Rete finta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaPannello, testoEmailSanzione, LINK_CONTESTA } from "../landing/app/moduli/pannello.js";
import { TESTI_SANZIONE } from "../landing/app/moduli/sanzioni.js";
import { testoRegola, ID_REGOLE } from "../landing/app/moduli/regole_community.js";

const SEG = "66666666-7777-4888-9999-000000000000";
const ZID = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const REGOLA = ID_REGOLE[0];

function reteFinta(risposte) {
  const viste = [];
  const f = async (url, init = {}) => {
    viste.push([url, init.method, init.body ? JSON.parse(init.body) : null]);
    const r = risposte[url];
    return r ? Response.json(r.corpo, { status: r.stato || 200 }) : new Response("{}", { status: 404 });
  };
  return { f, viste };
}

test("testo pronto: livello, regola violata, fine e link «Contesta», con i testi del messaggio in app", () => {
  const t = testoEmailSanzione({ livello: "sospensione_7", regola: REGOLA, fine_il: "2026-11-28T10:00:00Z" });
  assert.equal(t.oggetto, `Presente! · ${TESTI_SANZIONE.livelli.sospensione_7}`);
  assert.equal(t.corpo, [TESTI_SANZIONE.livelli.sospensione_7, `Regola violata: ${testoRegola(REGOLA)}`, "Fino al 28 novembre 2026",
    `${TESTI_SANZIONE.contesta}: ${LINK_CONTESTA}`].join("\n"));
  assert.equal(LINK_CONTESTA, "https://presenteincontri.app/app/");
});

test("testo pronto: un avviso o un'esclusione non hanno data di fine", () => {
  const t = testoEmailSanzione({ livello: "esclusione", regola: REGOLA, fine_il: null });
  assert.ok(!t.corpo.includes("Fino al"));
  assert.ok(t.corpo.startsWith(TESTI_SANZIONE.livelli.esclusione));
});

test("testo pronto: dati di forma strana → null", () => {
  assert.equal(testoEmailSanzione({ livello: "multa", regola: REGOLA }), null);
  assert.equal(testoEmailSanzione(null), null);
});

test("client: la decisione restituisce l'id della sanzione; l'email si chiede al Worker", async () => {
  const { f, viste } = reteFinta({
    "/app/api/pannello/decidi": { corpo: { ok: true, sanzione: ZID } },
    "/app/api/pannello/email": { corpo: { ok: true, email: { a: "persona@example.com", livello: "avviso", regola: REGOLA, fine_il: null } } },
  });
  const p = creaPannello({ token: async () => "tok", fetch: f });
  assert.deepEqual(await p.decidi({ id: SEG, azione: "avviso", regola: REGOLA, testo: "x" }), { ok: true, sanzione: ZID });
  const e = await p.emailSanzione(ZID);
  assert.equal(e.ok, true);
  assert.equal(e.a, "persona@example.com");
  assert.equal(e.oggetto, `Presente! · ${TESTI_SANZIONE.livelli.avviso}`);
  assert.deepEqual(viste[1], ["/app/api/pannello/email", "POST", { id: ZID }]);
});

test("client: email con id malformato non parte; risposta strana → riprova", async () => {
  const { f, viste } = reteFinta({ "/app/api/pannello/email": { corpo: { ok: true, email: { a: "x", livello: "multa" } } } });
  const p = creaPannello({ token: async () => "tok", fetch: f });
  assert.deepEqual(await p.emailSanzione("x"), { ok: false, motivo: "id" });
  assert.equal(viste.length, 0);
  assert.deepEqual(await p.emailSanzione(ZID), { ok: false, motivo: "riprova" });
});
