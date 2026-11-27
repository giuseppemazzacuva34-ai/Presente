// Design v4 (issue #349, schermata 19 «La stanza», prototipo #n14; D149 A; linea A del CTO), passo 2: la testata.
// In alto «LA TUA STANZA · MILANO» a sinistra e «GIORNO 2 DI 7» a destra; «2 CHIAVI» sulla riga del primo gruppo
// («UOMINI · 6»); «Chiamata fissata con Luca oggi alle 21:00» con il nome in rosso. Città e giorno arrivano dalla
// tabella stanze (regola per riga: solo le stanze di cui fai parte). Nomi e città inventati, nessuna rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testataStanza, testoChiaviGruppo, vistaTestataStanza, vistaTitoloGruppo } from "../landing/app/moduli/testata_stanza.js";
import { creaCompagni } from "../landing/app/moduli/compagni.js";
import { creaTelefono } from "../landing/app/moduli/telefono.js";
import { avvisiAppuntamenti } from "../landing/app/moduli/appuntamenti_stanza.js";

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const trova = (n, pred) => (!n || typeof n !== "object" ? [] : [...(pred(n) ? [n] : []), ...(n.f || []).flatMap((x) => trova(x, pred))]);
const testo = (n) => (typeof n === "string" ? n : !n || typeof n !== "object" ? "" : (n.f || []).map(testo).join(""));
const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");

// Lunedì 23/11/2026 alle 9:00 di Roma (8:00 UTC).
const APRE = "2026-11-23T08:00:00+00:00";

test("testata: stanza di una città → «La tua stanza · Milano» e il giorno della settimana", () => {
  const t = testataStanza({ tipo: "citta", citta: "Milano", apreIl: APRE }, new Date("2026-11-24T20:00:00Z"));
  assert.deepEqual(t, { luogo: "La tua stanza · Milano", giorno: "Giorno 2 di 7" });
});

test("testata: Stanza Italia → «La tua stanza · Italia»", () => {
  assert.equal(testataStanza({ tipo: "italia", citta: null, apreIl: APRE }, new Date("2026-11-23T09:00:00Z")).luogo, "La tua stanza · Italia");
});

test("testata: i giorni si contano sul calendario di Roma, da 1 a 7", () => {
  const g = (iso) => testataStanza({ tipo: "italia", apreIl: APRE }, new Date(iso)).giorno;
  assert.equal(g("2026-11-23T08:30:00Z"), "Giorno 1 di 7"); // lunedì 9:30
  assert.equal(g("2026-11-23T22:59:00Z"), "Giorno 1 di 7"); // lunedì 23:59 di Roma
  assert.equal(g("2026-11-23T23:01:00Z"), "Giorno 2 di 7"); // martedì 0:01 di Roma
  assert.equal(g("2026-11-29T19:30:00Z"), "Giorno 7 di 7"); // domenica 20:30
  assert.equal(g("2026-11-30T07:00:00Z"), null); // dopo la settimana: nessun giorno inventato
  assert.equal(g("2026-11-22T10:00:00Z"), null); // prima dell'apertura
});

test("testata: senza dati della stanza resta «La tua stanza», senza giorno", () => {
  assert.deepEqual(testataStanza(null, new Date()), { luogo: "La tua stanza", giorno: null });
  assert.deepEqual(testataStanza({ tipo: "citta", citta: "  ", apreIl: "non una data" }, new Date()), { luogo: "La tua stanza", giorno: null });
});

test("vista della testata: titolo h2 con id per il fuoco, giorno a destra, «Chiusa» quando serve", () => {
  const v = vistaTestataStanza(h, { luogo: "La tua stanza · Milano", giorno: "Giorno 2 di 7" }, { chiusa: false });
  assert.equal(v.a.classe, "testata-stanza");
  const [h2] = trova(v, (n) => n.tag === "h2");
  assert.equal(h2.a.id, "tua-stanza-titolo");
  assert.equal(testo(h2), "La tua stanza · Milano");
  assert.equal(testo(trova(v, (n) => n.a.classe === "giorno-stanza")[0]), "Giorno 2 di 7");
  const chiusa = vistaTestataStanza(h, { luogo: "La tua stanza", giorno: null }, { chiusa: true });
  assert.equal(testo(trova(chiusa, (n) => n.tag === "h2")[0]), "La tua stanza · Chiusa");
  assert.equal(trova(chiusa, (n) => n.a.classe === "giorno-stanza").length, 0);
});

test("chiavi sulla riga del gruppo: «2 chiavi», «1 chiave», «0 chiavi»; nulla senza contatore", () => {
  assert.equal(testoChiaviGruppo({ icone: [true, true] }), "2 chiavi");
  assert.equal(testoChiaviGruppo({ icone: [true, false] }), "1 chiave");
  assert.equal(testoChiaviGruppo({ icone: [false, false] }), "0 chiavi");
  assert.equal(testoChiaviGruppo(null), null);
});

test("titolo del gruppo: «Uomini · 3» a sinistra e le chiavi a destra solo dove si passano", () => {
  const v = vistaTitoloGruppo(h, "Uomini · 3", "2 chiavi");
  assert.equal(v.tag, "h3");
  assert.equal(v.a.classe, "gruppo-stanza");
  assert.equal(testo(v), "Uomini · 3 · 2 chiavi"); // per il lettore di schermo, un « · » nascosto alla vista
  assert.equal(testo(trova(v, (n) => n.a.classe === "chiavi-gruppo")[0]), "2 chiavi");
  assert.equal(trova(vistaTitoloGruppo(h, "Donne · 1", null), (n) => n.a.classe === "chiavi-gruppo").length, 0);
});

test("compagni.stanza(): legge tipo, città e apertura della stanza aperta con il token dell'utente", async () => {
  const BASE = "https://abcdefghijklmnopqrst.supabase.co";
  const chiamate = [];
  const f = async (url, o = {}) => {
    chiamate.push({ url: new URL(url), o });
    return new Response(JSON.stringify([{ tipo: "citta", citta: "Milano", apre_il: APRE, email: "x@y.z" }]), { status: 200 });
  };
  const c = creaCompagni({ supabaseUrl: BASE, supabaseAnonKey: "anon", token: async () => "tok", fetch: f });
  const r = await c.stanza(new Date("2026-11-24T20:00:00Z"));
  assert.deepEqual(r, { ok: true, tipo: "citta", citta: "Milano", apreIl: APRE });
  const u = chiamate[0].url;
  assert.equal(u.pathname, "/rest/v1/stanze");
  assert.equal(u.searchParams.get("select"), "tipo,citta,apre_il");
  assert.equal(u.searchParams.get("apre_il"), "lte.2026-11-24T20:00:00.000Z");
  assert.equal(u.searchParams.get("chiude_il"), "gt.2026-11-24T20:00:00.000Z");
  assert.equal(chiamate[0].o.headers.authorization, "Bearer tok");
});

test("compagni.stanza(): errori e righe strane → { ok: false }, mai un'eccezione", async () => {
  const BASE = "https://abcdefghijklmnopqrst.supabase.co";
  const con = (fn) => creaCompagni({ supabaseUrl: BASE, supabaseAnonKey: "anon", token: async () => "tok", fetch: fn });
  assert.equal((await con(async () => { throw new Error("rete"); }).stanza()).ok, false);
  assert.equal((await con(async () => new Response("[]", { status: 200 })).stanza()).ok, false);
  assert.equal((await con(async () => new Response(JSON.stringify([{ tipo: "boh", apre_il: APRE }]), { status: 200 })).stanza()).ok, false);
  assert.equal((await con(async () => new Response("{}", { status: 500 })).stanza()).ok, false);
  const senza = creaCompagni({ supabaseUrl: BASE, supabaseAnonKey: "anon", token: async () => null, fetch: async () => { throw new Error("non deve"); } });
  assert.equal((await senza.stanza()).ok, false);
});

test("telefono: i dati della stanza arrivano nel modello (stanza.info), non con la stanza chiusa", async () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const fai = (chiusa, info) => creaTelefono({
    compagni: { leggi: async () => ({ ok: true, persone: [{ id: ID, nome: "Marco", eta: 35, citta: "Milano" }], ...(chiusa ? { chiusa: true } : {}) }),
      stanza: async () => info },
    linea: {}, chiamata: { stato: async () => ({ ok: true }) }, voce: {} });
  const t = fai(false, { ok: true, tipo: "citta", citta: "Milano", apreIl: APRE });
  await t.caricaPersone();
  assert.deepEqual(t.modello().stanza.info, { tipo: "citta", citta: "Milano", apreIl: APRE });
  const c = fai(true, { ok: true, tipo: "citta", citta: "Milano", apreIl: APRE });
  await c.caricaPersone();
  assert.equal(c.modello().stanza.info, null);
  const vecchio = creaTelefono({ compagni: { leggi: async () => ({ ok: true, persone: [] }) }, linea: {}, chiamata: { stato: async () => ({ ok: true }) }, voce: {} });
  await vecchio.caricaPersone();
  assert.equal(vecchio.modello().stanza.info, null);
});

test("«Chiamata fissata con <nome> oggi alle 21:00»: il nome a parte per il rosso, senza il «·»", () => {
  const ALTRA = "22222222-2222-4222-8222-222222222222";
  const adesso = new Date("2026-11-24T15:00:00Z");
  const [a] = avvisiAppuntamenti([{ id: "33333333-3333-4333-8333-333333333333", altra: ALTRA, stato: "confermato", fase: "fissato", quando: "2026-11-24T20:00:00.000Z" }],
    new Map([[ALTRA, "Luca"]]), adesso);
  assert.equal(a.testo, "◷ Chiamata fissata con Luca oggi alle 21:00");
  assert.deepEqual(a.parti, ["◷ Chiamata fissata con ", "Luca", " oggi alle 21:00"]);
});

test("flusso: testata v4 al posto del vecchio titolo, chiavi sul primo gruppo, nome rosso negli avvisi", () => {
  assert.match(flusso, /vistaTestataStanza\(h, testataStanza\(st\.info, new Date\(\)\), \{ chiusa: st\.chiusa \}\)/);
  assert.doesNotMatch(flusso, /h\("h2", \{ id: "tua-stanza-titolo" \}, "La tua stanza"/);
  assert.match(flusso, /vistaTitoloGruppo\(h, g\.titolo, i === 0 \? chiaviGruppo : null\)/);
  assert.match(flusso, /nome-avviso/);
});

test("stili: testata in maiuscoletto spaziato su una riga, giorno a destra; chiavi a destra del gruppo; nome rosso", () => {
  assert.match(css, /\.testata-stanza\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*space-between/);
  assert.match(css, /\.testata-stanza h2\s*\{[^}]*text-transform:\s*uppercase/);
  assert.match(css, /\.testata-stanza h2\s*\{[^}]*letter-spacing:\s*0\.25em/);
  assert.match(css, /\.gruppo-stanza\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*space-between/);
  assert.match(css, /\.avviso-appuntamento \.nome-avviso\s*\{[^}]*color:\s*var\(--rosso/);
});

test("il service worker cambia versione e mette in cache testata_stanza.js", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(!sw.includes('"presente-app-82"'), "versione della cache aumentata");
  assert.ok(sw.includes('"/app/moduli/testata_stanza.js"'));
});
