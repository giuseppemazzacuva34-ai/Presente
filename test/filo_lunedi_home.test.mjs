// Il Filo della stanza (issue #360, spec v1 parte 2, D151 A): la schermata 18 nella home, passo 9b della linea
// «sviluppatore-c». Al posto di «La tua stanza», una volta a settimana, finché non si tocca «Entra nella stanza».
// Stanza senza Filo, già vista, chiusa o errore: la stanza di sempre. h finto, rete finta, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaFiloLunedi, vistaStanzaFilo } from "../landing/app/moduli/filo_lunedi.js";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const STANZA = "11111111-2222-4333-8444-555555555555";
const VOCALE = { url: "https://esempio.supabase.co/primo", durata: 70, testo: "Ciao a tutti.", filo: "Valentina", scade_tra: 300 };
const PERSONE = [{ id: "a", nome: "Marco" }, { id: "b", nome: "Anna" }];

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };

function rete(risposte) {
  const chiamate = [];
  const f = async (url, init = {}) => {
    chiamate.push({ url, ...init });
    const r = risposte[`${init.method || "GET"} ${url}`] ?? { status: 500, body: {} };
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  return { f, chiamate };
}
const ok = (body) => ({ status: 200, body: { ok: true, ...body } });
const BASE = {
  "GET /app/api/filo/benvenuto": ok({ benvenuto: { stanza: STANZA, filo: "Valentina", visto: false } }),
  "GET /app/api/filo/ascolta?tipo=lunedi": ok({ vocale: VOCALE }),
  "POST /app/api/filo/benvenuto": ok({ segnato: true }),
};

test("senza modulo del Filo: nessuna vista, la stanza di sempre e nessuna rete", () => {
  assert.equal(vistaStanzaFilo(h, null, { persone: PERSONE, mioNome: "Sara" }), null);
});

test("mentre legge: «Un attimo…» al posto della stanza (niente lampo della stanza prima della schermata 18)", () => {
  const { f } = rete(BASE);
  const fl = creaFiloLunedi({ token: () => "tok", fetch: f });
  const v = vistaStanzaFilo(h, fl, { persone: PERSONE, mioNome: "Sara" });
  assert.equal(testo(v), "Un attimo…");
  assert.equal(v.a.role, "status");
});

test("letto con il benvenuto: la schermata 18; «Entra nella stanza» la toglie e poi la vista è null", async () => {
  const { f } = rete(BASE);
  let entrato = 0;
  const fl = creaFiloLunedi({ token: () => "tok", fetch: f });
  await fl.prepara();
  const v = vistaStanzaFilo(h, fl, { persone: PERSONE, mioNome: "Sara", entra: () => { entrato++; } });
  assert.ok(testo(v).includes("Valentina · il Filo della stanza"));
  assert.ok(testo(v).includes("Sara (tu)"));
  const b = tutti(v, (x) => x.tag === "button" && testo(x) === "Entra nella stanza")[0];
  await b.a.onclick();
  assert.equal(entrato, 1);
  assert.equal(vistaStanzaFilo(h, fl, { persone: PERSONE, mioNome: "Sara" }), null);
});

test("senza Filo, già vista o errore: null, la stanza di sempre", async () => {
  for (const r of [ok({ benvenuto: null }), ok({ benvenuto: { stanza: STANZA, filo: "V", visto: true } }), { status: 503, body: {} }]) {
    const { f } = rete({ ...BASE, "GET /app/api/filo/benvenuto": r });
    const fl = creaFiloLunedi({ token: () => "tok", fetch: f });
    await fl.prepara();
    assert.equal(vistaStanzaFilo(h, fl, { persone: PERSONE, mioNome: "Sara" }), null);
  }
});

test("flusso e avvio: aggiunte minime per la schermata 18 nella home", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /import \{ vistaStanzaFilo \} from "\.\/filo_lunedi\.js";/);
  assert.match(flusso, /filoLunedi = \(telefono && opzioni\.filoLunedi\) \|\| null;/);
  // Solo con la stanza aperta (pronta e non chiusa), con le persone non bloccate e il proprio nome.
  assert.match(flusso, /st\.stato === "pronta" && !st\.chiusa && filoLunedi/);
  assert.match(flusso, /vistaStanzaFilo\(h, filoLunedi, \{ persone: st\.persone\.filter\(\(p\) => !scheda\.bloccate\.has\(p\.id\)\), mioNome: nomeMio\(\), entra: dopoBenvenutoFilo \}\)/);
  assert.match(flusso, /export function filoCambiato\(\)/);
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /import \{ creaFiloLunedi \} from "\/app\/moduli\/filo_lunedi\.js";/);
  assert.match(avvio, /creaFiloLunedi\(\{ token: \(\) => accesso\.token\(\), fetch: window\.fetch\.bind\(window\), aggiorna: \(\) => filoCambiato\(\) \}\)/);
  assert.match(avvio, /filoDomenica, filoLunedi \};/);
});

test("service worker: il modulo della schermata 18 è tra i file dell'app e la versione è cambiata", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.match(sw, /"\/app\/moduli\/filo_lunedi\.js"/);
  assert.doesNotMatch(sw, /const VERSIONE = "presente-app-53";/);
});

test("stile: la schermata 18 e la 36 hanno le loro regole in fondo a app.css (nome del tester in rosso)", () => {
  const css = leggi("../landing/app/app.css");
  assert.match(css, /\.app \.filo-io \{[^}]*color: var\(--rosso\)/);
  assert.match(css, /\.app \.filo-numero \{/);
  assert.match(css, /\.app \.filo-simbolo \{/);
});
