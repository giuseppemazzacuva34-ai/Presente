// Chiavi nella home (issue #5 spec v1.1, passi 4, 5 e 7; linea «sviluppatore-c», passo 8b): il contatore in alto in
// «La tua stanza», il pulsante sulla scheda di ogni persona e la finestra «Dai una chiave» / «Modifica la frase» /
// «Riprendi la chiave». Le viste ricevono h() dall'esterno: qui un h finto che costruisce oggetti, niente DOM.
// Chiavi finte, nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaChiaviStanza, vistaChiavi, vistaSchedaChiave, vistaSchermataChiave } from "../landing/app/moduli/chiavi_stanza.js";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const LEI = "11111111-2222-4333-8444-555555555555";
const CHIUDE = "2026-11-15T20:00:00Z";
const stato = (date = [], extra = {}) => ({ stanza: true, chiude_il: CHIUDE, chiuse: false, restanti: 2 - date.length, date, ...extra });

// h finto: { tag, a (attributi), f (figli piatti senza vuoti) }.
const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottoni = (n) => tutti(n, (x) => x.tag === "button");
const bottone = (n, t) => bottoni(n).find((b) => testo(b) === t);

function chiaviFinte(iniziale = stato()) {
  const chiamate = [];
  return {
    chiamate,
    async leggi() { chiamate.push(["leggi"]); return { ok: true, stato: iniziale }; },
    async dai(a, frase) { chiamate.push(["dai", a, frase]); return { ok: true, stato: stato([{ a, frase: frase || null }]) }; },
    async riprendi(a) { chiamate.push(["riprendi", a]); return { ok: true, stato: stato() }; },
    async cambiaFrase(a, frase) { chiamate.push(["frase", a, frase]); return { ok: true, stato: stato([{ a, frase }]) }; },
  };
}

test("prepara: legge lo stato una volta sola, anche se la home si ridisegna", async () => {
  const chiavi = chiaviFinte();
  const c = creaChiaviStanza({ chiavi });
  await c.prepara();
  await c.prepara();
  c.prepara();
  assert.deepEqual(chiavi.chiamate, [["leggi"]]);
});

test("vistaChiavi: «Le tue chiavi: 2» con due icone, nulla senza stanza aperta", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte(), adesso: () => new Date("2026-11-12T10:00:00Z") });
  assert.equal(vistaChiavi(h, c), null, "prima di leggere niente");
  await c.carica();
  const v = vistaChiavi(h, c);
  assert.match(testo(v), /Le tue chiavi: 2/);
  const icone = tutti(v, (x) => x.a.classe === "chiave-icona" || x.a.classe === "chiave-icona chiave-usata");
  assert.equal(icone.length, 2);
  assert.ok(icone.every((i) => i.a["aria-hidden"] === "true"), "le icone non si leggono: basta il testo");
  const vuota = creaChiaviStanza({ chiavi: { leggi: async () => ({ ok: true, stato: { stanza: false } }) } });
  await vuota.carica();
  assert.equal(vistaChiavi(h, vuota), null);
});

test("vistaChiavi: dalle 20:00 il conto alla rovescia, come stato che si annuncia", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte(), adesso: () => new Date("2026-11-15T19:01:00Z") });
  await c.carica();
  const conto = tutti(vistaChiavi(h, c), (x) => x.a.id === "chiavi-conto")[0];
  assert.equal(testo(conto), "Le porte si aprono tra 59 minuti");
  assert.equal(conto.a.role, "status");
});

test("la finestra di una persona non compare sulla scheda delle altre", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte() });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  const altra = vistaSchedaChiave(h, c, "66666666-7777-4888-9999-000000000000", "Luca");
  assert.equal(tutti(altra, (x) => x.a.role === "dialog").length, 0);
  assert.ok(bottone(altra, "Dai una chiave"));
});

test("scheda: «Dai una chiave» apre la schermata sua (v4, 33) con il nome, il campo da 140 e la nota", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte() });
  await c.carica();
  const s = vistaSchedaChiave(h, c, LEI, "Giulia");
  const dai = bottone(s, "Dai una chiave");
  assert.ok(dai, "pulsante sulla scheda");
  assert.equal(dai.a["aria-label"], "Dai una chiave a Giulia");
  dai.a.onclick();
  const f = vistaSchermataChiave(h, c);
  assert.match(testo(f), /Dai una chiavea Giulia\?/);
  const campo = tutti(f, (x) => x.tag === "textarea")[0];
  assert.equal(campo.a.maxlength, "140");
  assert.equal(campo.a.id, "chiave-frase");
  assert.ok(tutti(f, (x) => x.tag === "label" && x.a.for === "chiave-frase" && testo(x) === "Una frase per Giulia").length);
  assert.match(testo(f), /La leggerà solo se anche Giulia ti dà una chiave\./);
  assert.ok(bottone(f, "Indietro"));
});

test("schermata: «Dai la chiave» manda la frase scritta, poi la scheda mostra il segno", async () => {
  const chiavi = chiaviFinte();
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  const f = vistaSchermataChiave(h, c);
  tutti(f, (x) => x.tag === "textarea")[0].a.oninput({ target: { value: "Mi è piaciuta la storia del treno" } });
  await bottone(f, "Dai la chiave").a.onclick();
  assert.deepEqual(chiavi.chiamate.at(-1), ["dai", LEI, "Mi è piaciuta la storia del treno"]);
  const s = vistaSchedaChiave(h, c, LEI, "Giulia");
  assert.match(testo(s), /Hai dato una chiave/);
  assert.match(testo(s), /Mi è piaciuta la storia del treno/);
  assert.ok(bottone(s, "Riprendi la chiave"));
  assert.ok(bottone(s, "Modifica la frase"));
  assert.ok(!bottone(s, "Dai una chiave"));
});

test("riprendere: conferma «Non lo saprà.» e poi la chiave torna disponibile", async () => {
  const chiavi = chiaviFinte(stato([{ a: LEI, frase: null }]));
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  bottone(vistaSchedaChiave(h, c, LEI, "Giulia"), "Riprendi la chiave").a.onclick();
  const f = vistaSchermataChiave(h, c);
  assert.match(testo(f), /Riprendi la chiavea Giulia\?Non lo saprà\./);
  assert.equal(tutti(f, (x) => x.tag === "textarea").length, 0, "per riprendere nessun campo");
  await bottone(f, "Riprendi la chiave").a.onclick();
  assert.deepEqual(chiavi.chiamate.at(-1), ["riprendi", LEI]);
  assert.ok(bottone(vistaSchedaChiave(h, c, LEI, "Giulia"), "Dai una chiave"));
});

test("rifiuto del server: la schermata resta aperta con il suo testo, come avviso", async () => {
  const chiavi = chiaviFinte();
  chiavi.dai = async () => ({ ok: false, testo: "Puoi dare una chiave solo a chi hai già chiamato in questa stanza." });
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  await bottone(vistaSchermataChiave(h, c), "Dai la chiave").a.onclick();
  const f = vistaSchermataChiave(h, c);
  const avviso = tutti(f, (x) => x.a.role === "alert")[0];
  assert.equal(testo(avviso), "Puoi dare una chiave solo a chi hai già chiamato in questa stanza.");
  assert.ok(bottone(f, "Dai la chiave"), "si può correggere e riprovare");
});

test("chiuse dalle 20:59: sulla scheda solo il testo, nessun pulsante", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte(stato([{ a: LEI, frase: null }], { chiuse: true })) });
  await c.carica();
  const s = vistaSchedaChiave(h, c, LEI, "Giulia");
  assert.match(testo(s), /Hai dato una chiave/);
  assert.match(testo(s), /Le chiavi sono chiuse\. Tra poco le porte\./);
  assert.equal(bottoni(s).length, 0);
});

test("flusso: le chiavi in «La tua stanza» (contatore, scheda, finestra) con aggiunte minime", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /from "\.\/chiavi_stanza\.js"/);
  assert.match(flusso, /vistaChiavi\(h, chiaviStanza\)/);
  assert.match(flusso, /vistaSchedaChiave\(h, chiaviStanza, p\.id, nomeScheda\(p\)\)/);
  assert.match(flusso, /export function chiaviCambiate\(/);
});

test("avvio: chiavi con il token dell'utente e aggiornamento della home", () => {
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /creaChiavi\(/);
  assert.match(avvio, /creaChiaviStanza\(/);
  assert.match(avvio, /chiaviCambiate\(\)/);
});

test("service worker: chiavi.js e chiavi_stanza.js in memoria, versione nuova", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.ok(sw.includes('"/app/moduli/chiavi.js"'));
  assert.ok(sw.includes('"/app/moduli/chiavi_stanza.js"'));
  assert.ok(!sw.includes('"presente-app-20"'));
});
