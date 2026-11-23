// Coin del design v4 (issue #349), passo 5c della linea «sviluppatore-b»: l'app legge il saldo dal nuovo indirizzo
// GET /app/api/coin (saldo, prima stanza usata, interruttore dei pagamenti) e capisce dove si trova la persona
// (home, chiamata, svelamento, sera delle porte) per la regola della schermata 21 (spec #331 v1.1, punto 5).
// fetch finto, token finto, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaCoinServer, momentoApp, creaSaldo, collegaSaldo } from "../landing/app/moduli/saldo_coin.js";

const json = (stato, corpo) => ({ status: stato, ok: stato >= 200 && stato < 300, json: async () => corpo });

test("creaCoinServer legge /app/api/coin con il token e restituisce saldo, prima stanza e interruttore", async () => {
  const chiamate = [];
  const f = async (url, opz) => { chiamate.push([url, opz]); return json(200, { ok: true, saldo: 45, primaStanzaUsata: true, pagamenti: false }); };
  const r = await creaCoinServer({ token: () => "tok", fetch: f }).saldo();
  assert.deepEqual(r, { ok: true, saldo: 45, primaStanzaUsata: true, pagamenti: false });
  assert.equal(chiamate[0][0], "/app/api/coin");
  assert.equal(chiamate[0][1].method, "GET");
  assert.equal(chiamate[0][1].headers.authorization, "Bearer tok");
});

test("creaCoinServer: senza token nessuna richiesta, motivo «accesso»", async () => {
  let chiamata = false;
  const r = await creaCoinServer({ token: () => null, fetch: async () => { chiamata = true; } }).saldo();
  assert.deepEqual(r, { ok: false, motivo: "accesso" });
  assert.equal(chiamata, false);
});

test("creaCoinServer: rete, 401, 503 e risposte storte non inventano numeri", async () => {
  const prova = async (f) => creaCoinServer({ token: () => "tok", fetch: f }).saldo();
  assert.deepEqual(await prova(async () => { throw new Error("giù"); }), { ok: false, motivo: "rete" });
  assert.deepEqual(await prova(async () => json(401, {})), { ok: false, motivo: "accesso" });
  assert.deepEqual(await prova(async () => json(503, { ok: false })), { ok: false, motivo: "riprova" });
  assert.deepEqual(await prova(async () => json(200, { ok: true, saldo: -3, primaStanzaUsata: true })), { ok: false, motivo: "riprova" });
  assert.deepEqual(await prova(async () => json(200, { ok: true, saldo: 10, primaStanzaUsata: "si" })), { ok: false, motivo: "riprova" });
  assert.deepEqual(await prova(async () => ({ status: 200, ok: true, json: async () => { throw new Error("no"); } })), { ok: false, motivo: "riprova" });
});

test("creaCoinServer: i pagamenti risultano accesi solo con true esatto dal server", async () => {
  const prova = async (pagamenti) => (await creaCoinServer({ token: () => "t",
    fetch: async () => json(200, { ok: true, saldo: 1, primaStanzaUsata: false, pagamenti }) }).saldo()).pagamenti;
  assert.equal(await prova(true), true);
  assert.equal(await prova("true"), false);
  assert.equal(await prova(undefined), false);
});

const tel = (tipo) => ({ modello: () => ({ schermo: { tipo } }) });
const porta = (aperta) => ({ modello: () => ({ aperta }) });
const chiavi = (sera) => ({ modello: () => ({ sera }) });

test("momentoApp: home quando non c'è chiamata, porta o sera", () => {
  assert.equal(momentoApp({ telefono: tel("nessuna"), porta: porta(false), chiavi: chiavi(null) }), "home");
  assert.equal(momentoApp({}), "home");
});

test("momentoApp: qualunque schermata della chiamata (anche dopo e segnala) vale «chiamata»", () => {
  for (const t of ["squilla", "in_corso", "finita", "dopo", "segnala", "diario"]) {
    assert.equal(momentoApp({ telefono: tel(t), porta: porta(true), chiavi: chiavi({ tipo: "attesa" }) }), "chiamata");
  }
});

test("momentoApp: porta dello svelamento aperta vale «svelamento», sera delle chiavi vale «porte»", () => {
  assert.equal(momentoApp({ telefono: tel("nessuna"), porta: porta(true), chiavi: chiavi({ tipo: "attesa" }) }), "svelamento");
  assert.equal(momentoApp({ telefono: tel("nessuna"), porta: porta(false), chiavi: chiavi({ tipo: "nessuna_porta" }) }), "porte");
});

test("momentoApp: se un modulo si rompe il momento è sconosciuto (niente avviso)", () => {
  const rotto = { modello: () => { throw new Error("x"); } };
  assert.equal(momentoApp({ telefono: rotto }), "sconosciuto");
  assert.equal(momentoApp({ porta: rotto }), "sconosciuto");
  assert.equal(momentoApp({ chiavi: rotto }), "sconosciuto");
});

test("insieme: con il nuovo indirizzo l'avviso parte in home e non durante una chiamata", async () => {
  const pagina = { visibilityState: "visible", ascolta: null, addEventListener(t, f) { this.ascolta = f; } };
  const fetch = async () => json(200, { ok: true, saldo: 15, primaStanzaUsata: true, pagamenti: false });
  const saldo = creaSaldo({ coin: creaCoinServer({ token: () => "t", fetch }), testata: () => {} });
  let dove = tel("in_corso");
  const avvisi = [];
  await collegaSaldo({ saldo, pagina, avviso: (n) => avvisi.push(n), momento: () => momentoApp({ telefono: dove }) });
  assert.deepEqual(avvisi, []);
  dove = tel("nessuna");
  await pagina.ascolta();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(avvisi, [15]);
});

test("avvio.js usa il nuovo indirizzo per il saldo e passa il momento", () => {
  const avvio = readFileSync(new URL("../landing/app/avvio.js", import.meta.url), "utf8");
  assert.match(avvio, /creaCoinServer\(/);
  assert.match(avvio, /momento: \(\) => momentoApp\(/);
});
