// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A): schermata 18 «Il Filo apre la stanza» nella web
// app, passo 9a della linea «sviluppatore-c». Modulo, letture dal Worker e vista; rete finta, nessun dato reale.
// Testi della spec (parte 2): «Lunedì · La tua stanza apre», «<Nome> · il Filo della stanza», «Vi accompagna tutta la
// settimana», «Vi presento» con il proprio nome in rosso e «(tu)», la riga delle regole, «Entra nella stanza» sempre
// attivo. Vocale non ancora caricato: «Il vocale del Filo arriva in mattinata.». Il vocale non parte mai da solo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TESTI_FILO_LUNEDI, schermataFiloLunedi, creaFiloLunedi, vistaFiloLunedi,
} from "../landing/app/moduli/filo_lunedi.js";

const STANZA = "11111111-2222-4333-8444-555555555555";
const BENVENUTO = { stanza: STANZA, filo: "Valentina", visto: false };
const VOCALE = { url: "https://esempio.supabase.co/firmato", durata: 70, testo: "Ciao a tutti, vi presento la stanza.", filo: "Valentina", scade_tra: 300 };
const PERSONE = [{ id: "a", nome: "Marco" }, { id: "b", nome: "Anna" }, { id: "c", nome: "Luca" }];

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };

function rete(risposte) {
  const chiamate = [];
  const f = async (url, init = {}) => {
    chiamate.push({ url, ...init });
    const chiave = `${init.method || "GET"} ${url}`;
    const r = risposte[chiave] ?? { status: 500, body: {} };
    if (r.errore) throw new Error("rete");
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  return { f, chiamate };
}
const LEGGI = "GET /app/api/filo/benvenuto";
const SEGNA = "POST /app/api/filo/benvenuto";
const ASCOLTA = "GET /app/api/filo/ascolta?tipo=lunedi";
const ok = (body) => ({ status: 200, body: { ok: true, ...body } });

test("testi della spec, parte 2", () => {
  assert.equal(TESTI_FILO_LUNEDI.occhiello, "Lunedì · La tua stanza apre");
  assert.equal(TESTI_FILO_LUNEDI.sotto, "Vi accompagna tutta la settimana");
  assert.equal(TESTI_FILO_LUNEDI.viPresento, "Vi presento");
  assert.equal(TESTI_FILO_LUNEDI.regoleTitolo, "Le regole:");
  assert.equal(TESTI_FILO_LUNEDI.regole, "solo voce, 15 minuti · niente numeri né social prima della porta · rispetto, sempre · chi dà buca paga.");
  assert.equal(TESTI_FILO_LUNEDI.attesa, "Il vocale del Filo arriva in mattinata.");
  assert.equal(TESTI_FILO_LUNEDI.bottone, "Entra nella stanza");
  assert.equal(TESTI_FILO_LUNEDI.ascolta, "Ascolta il vocale del Filo");
  assert.equal(TESTI_FILO_LUNEDI.leggi, "Leggi il testo");
  assert.ok(Object.isFrozen(TESTI_FILO_LUNEDI));
});

test("stanza senza Filo, già vista o dati non validi: la schermata 18 non c'è", () => {
  assert.equal(schermataFiloLunedi({ benvenuto: null, vocale: VOCALE, persone: PERSONE, mioNome: "Sara" }), null);
  assert.equal(schermataFiloLunedi({ benvenuto: { ...BENVENUTO, visto: true }, vocale: VOCALE, persone: PERSONE, mioNome: "Sara" }), null);
  assert.equal(schermataFiloLunedi({ benvenuto: { ...BENVENUTO, stanza: "" }, vocale: null, persone: PERSONE, mioNome: "Sara" }), null);
});

test("scheda «<Nome> · il Filo della stanza»; senza nome del Filo resta «Il Filo della stanza»", () => {
  const s = schermataFiloLunedi({ benvenuto: BENVENUTO, vocale: null, persone: PERSONE, mioNome: "Sara" });
  assert.deepEqual([s.occhiello, s.scheda.titolo, s.scheda.sotto], ["Lunedì · La tua stanza apre", "Valentina · il Filo della stanza", "Vi accompagna tutta la settimana"]);
  const senza = schermataFiloLunedi({ benvenuto: { ...BENVENUTO, filo: null }, vocale: null, persone: PERSONE, mioNome: "Sara" });
  assert.equal(senza.scheda.titolo, "Il Filo della stanza");
});

test("«Vi presento»: il proprio nome per primo (design v4), poi gli altri in ordine; doppioni e nomi vuoti scartati", () => {
  const s = schermataFiloLunedi({ benvenuto: BENVENUTO, vocale: null,
    persone: [...PERSONE, { id: "a", nome: "Marco" }, { id: "d", nome: "  " }, null], mioNome: " Sara " });
  assert.deepEqual(s.nomi, [
    { nome: "Sara", io: true }, { nome: "Anna", io: false }, { nome: "Luca", io: false }, { nome: "Marco", io: false },
  ]);
  // Senza il proprio nome (non ancora letto): solo gli altri.
  assert.deepEqual(schermataFiloLunedi({ benvenuto: BENVENUTO, vocale: null, persone: [], mioNome: "" }).nomi, []);
});

test("vocale: lettore con durata e testo; mancante o non valido → «Il vocale del Filo arriva in mattinata.»", () => {
  const s = schermataFiloLunedi({ benvenuto: BENVENUTO, vocale: VOCALE, persone: PERSONE, mioNome: "Sara" });
  assert.deepEqual(s.vocale, { url: VOCALE.url, durata: "1:10", testo: VOCALE.testo });
  assert.equal(s.attesa, null);
  for (const v of [null, { ...VOCALE, url: "http://non-sicuro" }, { ...VOCALE, testo: " " }, { ...VOCALE, durata: "70" }]) {
    const x = schermataFiloLunedi({ benvenuto: BENVENUTO, vocale: v, persone: PERSONE, mioNome: "Sara" });
    assert.equal(x.vocale, null);
    assert.equal(x.attesa, "Il vocale del Filo arriva in mattinata.");
  }
});

test("lettura: benvenuto e vocale del lunedì dal Worker col token; già vista o senza Filo non chiede il vocale", async () => {
  const { f, chiamate } = rete({ [LEGGI]: ok({ benvenuto: BENVENUTO }), [ASCOLTA]: ok({ vocale: VOCALE }) });
  const fl = creaFiloLunedi({ token: () => "tok", fetch: f });
  await fl.prepara();
  const m = fl.modello();
  assert.equal(m.letto, true);
  assert.deepEqual(m.benvenuto, BENVENUTO);
  assert.equal(m.vocale.url, VOCALE.url);
  assert.deepEqual(chiamate.map((c) => [`${c.method} ${c.url}`, c.headers.authorization]), [[LEGGI, "Bearer tok"], [ASCOLTA, "Bearer tok"]]);

  for (const benvenuto of [null, { ...BENVENUTO, visto: true }]) {
    const r = rete({ [LEGGI]: ok({ benvenuto }) });
    const x = creaFiloLunedi({ token: () => "tok", fetch: r.f });
    await x.prepara();
    assert.equal(r.chiamate.length, 1);
    assert.equal(vistaFiloLunedi(h, x, { persone: PERSONE, mioNome: "Sara" }), null);
  }
});

test("benvenuto che non arriva (senza token, 401, 503, rete): nessuna schermata, la stanza apre come sempre", async () => {
  const casi = [[() => null, {}], [() => "tok", { [LEGGI]: { status: 401, body: { ok: false } } }],
    [() => "tok", { [LEGGI]: { status: 503, body: { ok: false } } }], [() => "tok", { [LEGGI]: { errore: true } }]];
  for (const [token, risposte] of casi) {
    const { f } = rete(risposte);
    const fl = creaFiloLunedi({ token, fetch: f });
    await fl.prepara();
    assert.equal(fl.modello().letto, true);
    assert.equal(vistaFiloLunedi(h, fl, { persone: PERSONE, mioNome: "Sara" }), null);
  }
});

test("prepara() legge una volta sola per apertura dell'app", async () => {
  const { f, chiamate } = rete({ [LEGGI]: ok({ benvenuto: BENVENUTO }), [ASCOLTA]: ok({ vocale: null }) });
  let avvisi = 0;
  const fl = creaFiloLunedi({ token: () => "tok", fetch: f, aggiorna: () => { avvisi++; } });
  await Promise.all([fl.prepara(), fl.prepara()]);
  assert.equal(chiamate.length, 2);
  assert.ok(avvisi >= 1);
});

test("vista: occhiello, scheda, lettore mai automatico con nome accessibile, «Leggi il testo», nomi, regole, «Entra»", async () => {
  const { f } = rete({ [LEGGI]: ok({ benvenuto: BENVENUTO }), [ASCOLTA]: ok({ vocale: VOCALE }), [SEGNA]: ok({ segnato: true }) });
  const fl = creaFiloLunedi({ token: () => "tok", fetch: f });
  await fl.prepara();
  const v = vistaFiloLunedi(h, fl, { persone: PERSONE, mioNome: "Sara", entra: () => {} });
  const t = testo(v);
  for (const parte of ["Lunedì · La tua stanza apre", "Valentina · il Filo della stanza", "Vi accompagna tutta la settimana",
    "Leggi il testo", VOCALE.testo, "Vi presento", "Anna", "Luca", "Marco", "Sara (tu)", "Le regole:",
    "solo voce, 15 minuti · niente numeri né social prima della porta · rispetto, sempre · chi dà buca paga.", "Entra nella stanza"]) {
    assert.ok(t.includes(parte), `manca «${parte}»`);
  }
  assert.ok(!t.includes("arriva in mattinata"));
  const audio = tutti(v, (x) => x.tag === "audio");
  assert.equal(audio.length, 1);
  assert.equal(audio[0].a.src, VOCALE.url);
  assert.equal(audio[0].a.autoplay, undefined);
  assert.equal(audio[0].a.preload, "none");
  assert.equal(audio[0].a.controls, true); // lettore nativo: usabile da tastiera
  assert.equal(audio[0].a["aria-label"], "Ascolta il vocale del Filo");
  const io = tutti(v, (x) => x.tag === "li" && (x.a.classe || "").includes("filo-io"));
  assert.equal(io.length, 1);
  assert.equal(testo(io[0]), "Sara (tu)");
  const sezione = tutti(v, (x) => x.tag === "section")[0];
  assert.equal(sezione.a["aria-labelledby"], "filo-lunedi-titolo");
  assert.equal(tutti(v, (x) => x.a.id === "filo-lunedi-titolo").length, 1);
});

test("vista senza vocale: niente lettore, «Il vocale del Filo arriva in mattinata.»; «Entra» resta attivo", async () => {
  const { f } = rete({ [LEGGI]: ok({ benvenuto: BENVENUTO }), [ASCOLTA]: ok({ vocale: null }) });
  const fl = creaFiloLunedi({ token: () => "tok", fetch: f });
  await fl.prepara();
  const v = vistaFiloLunedi(h, fl, { persone: PERSONE, mioNome: "Sara" });
  assert.ok(testo(v).includes("Il vocale del Filo arriva in mattinata."));
  assert.equal(tutti(v, (x) => x.tag === "audio").length, 0);
  const b = tutti(v, (x) => x.tag === "button" && testo(x) === "Entra nella stanza")[0];
  assert.ok(b);
  assert.equal(b.a.disabled, undefined);
});

test("«Entra nella stanza»: la schermata sparisce subito, si segna vista sul server una volta, poi entra()", async () => {
  const { f, chiamate } = rete({ [LEGGI]: ok({ benvenuto: BENVENUTO }), [ASCOLTA]: ok({ vocale: VOCALE }), [SEGNA]: ok({ segnato: true }) });
  let entrato = 0;
  const fl = creaFiloLunedi({ token: () => "tok", fetch: f });
  await fl.prepara();
  const v = vistaFiloLunedi(h, fl, { persone: PERSONE, mioNome: "Sara", entra: () => { entrato++; } });
  const b = tutti(v, (x) => x.tag === "button" && testo(x) === "Entra nella stanza")[0];
  await b.a.onclick();
  await b.a.onclick();
  assert.equal(entrato, 2);
  assert.equal(vistaFiloLunedi(h, fl, { persone: PERSONE, mioNome: "Sara" }), null);
  const segna = chiamate.filter((c) => `${c.method} ${c.url}` === SEGNA);
  assert.equal(segna.length, 1);
  assert.equal(segna[0].headers.authorization, "Bearer tok");
  assert.equal(segna[0].headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(segna[0].body), { stanza: STANZA });
});

test("segnare non riuscito (rete o 503): si entra lo stesso, nessun errore", async () => {
  for (const risposta of [{ errore: true }, { status: 503, body: { ok: false } }]) {
    const { f } = rete({ [LEGGI]: ok({ benvenuto: BENVENUTO }), [ASCOLTA]: ok({ vocale: null }), [SEGNA]: risposta });
    let entrato = 0;
    const fl = creaFiloLunedi({ token: () => "tok", fetch: f });
    await fl.prepara();
    await fl.entra(() => { entrato++; });
    assert.equal(entrato, 1);
    assert.equal(vistaFiloLunedi(h, fl, { persone: PERSONE, mioNome: "Sara" }), null);
  }
});

test("link firmato scaduto: si chiede un link nuovo, al massimo due volte", async () => {
  const { f, chiamate } = rete({ [LEGGI]: ok({ benvenuto: BENVENUTO }), [ASCOLTA]: ok({ vocale: VOCALE }) });
  const fl = creaFiloLunedi({ token: () => "tok", fetch: f });
  await fl.prepara();
  const nodo = { src: VOCALE.url };
  await fl.rinnova(nodo);
  await fl.rinnova(nodo);
  await fl.rinnova(nodo);
  assert.equal(chiamate.filter((c) => `${c.method} ${c.url}` === ASCOLTA).length, 3);
});

test("il modulo non salva nulla nel telefono e non scrive nei log", () => {
  const sorgente = readFileSync(new URL("../landing/app/moduli/filo_lunedi.js", import.meta.url), "utf8");
  assert.ok(!/localStorage|sessionStorage|indexedDB|console\./.test(sorgente));
  assert.ok(!/autoplay/.test(sorgente.replace(/\/\/.*$/gm, "")));
});
