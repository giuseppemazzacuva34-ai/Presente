// Design v4 (#349, approvato da Giuseppe il 22/11), schermate 33 «Le chiavi» e 34 «Chiave data» (#n23, #n24 nel
// prototipo). Linea «sviluppatore-c» (#5). La chiave si dà da una schermata sua, non più dal riquadro nella scheda;
// dopo, una conferma breve con «Cambia frase», «Riprendi la chiave» e «Torna alla stanza».
// Le regole restano quelle del server (chiavi.js, worker/chiavi_api.js): qui solo la vista.
// h finto che costruisce oggetti, chiavi finte, nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaChiaviStanza, vistaSchermataChiave, vistaSchedaChiave } from "../landing/app/moduli/chiavi_stanza.js";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const LEI = "11111111-2222-4333-8444-555555555555";
const LUI = "66666666-7777-4888-9999-000000000000";
const CHIUDE = "2026-11-15T20:00:00Z";
const stato = (date = [], extra = {}) => ({ stanza: true, chiude_il: CHIUDE, chiuse: false, restanti: 2 - date.length, date, ...extra });

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottoni = (n) => tutti(n, (x) => x.tag === "button");
const bottone = (n, t) => bottoni(n).find((b) => testo(b) === t);
const classe = (n, c) => tutti(n, (x) => typeof x.a.classe === "string" && x.a.classe.split(" ").includes(c));

function chiaviFinte(iniziale = stato()) {
  const chiamate = [];
  const risposte = {};
  let attuale = iniziale;
  return {
    chiamate, risposte,
    async leggi() { chiamate.push(["leggi"]); return { ok: true, stato: attuale }; },
    async dai(a, frase) { chiamate.push(["dai", a, frase]); if (risposte.dai) return risposte.dai; attuale = stato([...attuale.date, { a, frase: frase || null }]); return { ok: true, stato: attuale }; },
    async riprendi(a) { chiamate.push(["riprendi", a]); attuale = stato(attuale.date.filter((k) => k.a !== a)); return { ok: true, stato: attuale }; },
    async cambiaFrase(a, frase) { chiamate.push(["frase", a, frase]); attuale = stato(attuale.date.map((k) => (k.a === a ? { a, frase: frase || null } : k))); return { ok: true, stato: attuale }; },
  };
}

test("33: niente da dare o da confermare → nessuna schermata, resta la stanza", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte() });
  assert.equal(vistaSchermataChiave(h, c), null, "prima di leggere");
  await c.carica();
  assert.equal(vistaSchermataChiave(h, c), null);
});

test("33: «Dai una chiave» apre la schermata sua, con i testi del disegno e i pulsanti nel piede", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte() });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  const s = vistaSchermataChiave(h, c);
  assert.equal(s.tag, "section");
  assert.ok(s.a.classe.split(" ").includes("schermata") && s.a.classe.split(" ").includes("chiave-v4"));
  const titolo = tutti(s, (x) => x.tag === "h1")[0];
  assert.equal(testo(titolo), "Dai una chiavea Giulia?");
  assert.equal(testo(tutti(titolo, (x) => x.tag === "em")[0]), "a Giulia?", "il nome in rosso corsivo, come nel disegno");
  assert.equal(s.a["aria-labelledby"], titolo.a.id);
  assert.equal(testo(classe(s, "passo")[0]), "Le tue chiavi · 2 di 2");
  assert.match(testo(s), /La leggerà solo se anche Giulia ti dà una chiave\./, "testo senza genere (D141)");
  assert.match(testo(s), /Puoi cambiare idea fino a domenica alle 21\./);
  const campo = tutti(s, (x) => x.tag === "textarea")[0];
  assert.equal(campo.a.id, "chiave-frase");
  assert.equal(campo.a.maxlength, "140");
  assert.ok(tutti(s, (x) => x.tag === "label" && x.a.for === "chiave-frase" && testo(x) === "Una frase per Giulia").length, "etichetta vera per il lettore di schermo");
  assert.equal(classe(s, "chiave-finestra").length, 1, "il campo resta in .chiave-finestra: chiaviCambiate ci mette il fuoco");
  const piede = classe(s, "azioni")[0];
  assert.deepEqual(bottoni(piede).map(testo), ["Indietro", "Dai la chiave"]);
  assert.equal(bottone(piede, "Indietro").a.classe, "bottone-secondario");
  assert.equal(bottone(piede, "Dai la chiave").a.classe, "bottone");
});

test("33: con la schermata aperta la scheda nella stanza non ha più il riquadro della finestra", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte() });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  const sc = vistaSchedaChiave(h, c, LEI, "Giulia");
  assert.equal(tutti(sc, (x) => x.tag === "textarea" || x.a.role === "dialog").length, 0);
  assert.ok(bottone(vistaSchedaChiave(h, c, LUI, "Luca"), "Dai una chiave"), "le altre schede non cambiano");
});

test("33: «Indietro» chiude la schermata senza mandare niente", async () => {
  const chiavi = chiaviFinte();
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  bottone(vistaSchermataChiave(h, c), "Indietro").a.onclick();
  assert.equal(vistaSchermataChiave(h, c), null);
  assert.equal(chiavi.chiamate.filter((x) => x[0] !== "leggi").length, 0);
});

test("33: rifiuto del server → la schermata resta, con l'avviso e la frase scritta", async () => {
  const chiavi = chiaviFinte();
  chiavi.risposte.dai = { ok: false, testo: "La frase non può contenere contatti. Ve li scambierete dopo esservi visti." };
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  tutti(vistaSchermataChiave(h, c), (x) => x.tag === "textarea")[0].a.oninput({ target: { value: "scrivimi su instagram" } });
  await bottone(vistaSchermataChiave(h, c), "Dai la chiave").a.onclick();
  const s = vistaSchermataChiave(h, c);
  assert.equal(testo(tutti(s, (x) => x.a.role === "alert")[0]), "La frase non può contenere contatti. Ve li scambierete dopo esservi visti.");
  assert.equal(testo(tutti(s, (x) => x.tag === "textarea")[0]), "scrivimi su instagram");
});

test("34: dopo «Dai la chiave» la conferma breve con la frase, «Ti resta 1 chiave» e tre pulsanti", async () => {
  const chiavi = chiaviFinte();
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  c.scrivi("La tua risata mi è rimasta in testa.");
  await c.conferma();
  assert.deepEqual(chiavi.chiamate.at(-1), ["dai", LEI, "La tua risata mi è rimasta in testa."]);
  const s = vistaSchermataChiave(h, c);
  assert.ok(s.a.classe.split(" ").includes("chiave-data"));
  assert.equal(testo(classe(s, "passo")[0]), "Ti resta 1 chiave");
  const titolo = tutti(s, (x) => x.tag === "h1")[0];
  assert.equal(testo(titolo), "Hai dato una chiavea Giulia.");
  assert.equal(testo(tutti(titolo, (x) => x.tag === "em")[0]), "a Giulia.");
  assert.equal(testo(tutti(s, (x) => x.tag === "blockquote")[0]), "La tua risata mi è rimasta in testa.");
  const piede = classe(s, "azioni")[0];
  assert.deepEqual(bottoni(piede).map(testo), ["Cambia frase", "Riprendi la chiave", "Torna alla stanza"]);
  assert.equal(bottone(piede, "Torna alla stanza").a.classe, "bottone");
  assert.equal(bottone(piede, "Cambia frase").a["aria-label"], "Cambia la frase per Giulia");
  assert.equal(bottone(piede, "Riprendi la chiave").a["aria-label"], "Riprendi la chiave a Giulia");
  bottone(piede, "Torna alla stanza").a.onclick();
  assert.equal(vistaSchermataChiave(h, c), null, "si torna alla stanza");
  assert.equal(c.scheda(LEI).segno, "Hai dato una chiave");
});

test("34: senza frase niente citazione; con l'ultima chiave «Le tue chiavi: 0»", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte(stato([{ a: LUI, frase: null }])) });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  await c.conferma();
  const s = vistaSchermataChiave(h, c);
  assert.equal(tutti(s, (x) => x.tag === "blockquote").length, 0);
  assert.equal(testo(classe(s, "passo")[0]), "Le tue chiavi: 0");
});

test("34 → «Cambia frase»: parte dalla frase data, «Salva» torna alla conferma con la frase nuova", async () => {
  const chiavi = chiaviFinte();
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  c.scrivi("Il treno delle 8");
  await c.conferma();
  bottone(vistaSchermataChiave(h, c), "Cambia frase").a.onclick();
  let s = vistaSchermataChiave(h, c);
  assert.equal(testo(tutti(s, (x) => x.tag === "h1")[0]), "Modifica la frase");
  assert.equal(testo(tutti(s, (x) => x.tag === "textarea")[0]), "Il treno delle 8");
  assert.deepEqual(bottoni(classe(s, "azioni")[0]).map(testo), ["Indietro", "Salva"]);
  tutti(s, (x) => x.tag === "textarea")[0].a.oninput({ target: { value: "Il treno delle 9" } });
  await bottone(s, "Salva").a.onclick();
  assert.deepEqual(chiavi.chiamate.at(-1), ["frase", LEI, "Il treno delle 9"]);
  s = vistaSchermataChiave(h, c);
  assert.ok(s.a.classe.split(" ").includes("chiave-data"));
  assert.equal(testo(tutti(s, (x) => x.tag === "blockquote")[0]), "Il treno delle 9");
});

test("34 → «Indietro» da «Cambia frase» torna alla conferma, non alla stanza", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte() });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  await c.conferma();
  bottone(vistaSchermataChiave(h, c), "Cambia frase").a.onclick();
  bottone(vistaSchermataChiave(h, c), "Indietro").a.onclick();
  assert.ok(vistaSchermataChiave(h, c).a.classe.split(" ").includes("chiave-data"));
});

test("34 → «Riprendi la chiave»: «Non lo saprà.», poi si torna alla stanza con la chiave di nuovo da dare", async () => {
  const chiavi = chiaviFinte();
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  await c.conferma();
  bottone(vistaSchermataChiave(h, c), "Riprendi la chiave").a.onclick();
  const s = vistaSchermataChiave(h, c);
  assert.equal(testo(tutti(s, (x) => x.tag === "h1")[0]), "Riprendi la chiavea Giulia?");
  assert.match(testo(s), /Non lo saprà\./);
  assert.equal(tutti(s, (x) => x.tag === "textarea").length, 0);
  assert.deepEqual(bottoni(classe(s, "azioni")[0]).map(testo), ["Indietro", "Riprendi la chiave"]);
  await bottone(classe(s, "azioni")[0], "Riprendi la chiave").a.onclick();
  assert.deepEqual(chiavi.chiamate.at(-1), ["riprendi", LEI]);
  assert.equal(vistaSchermataChiave(h, c), null);
  assert.deepEqual(c.scheda(LEI), { dai: "Dai una chiave" });
});

test("dalla scheda: «Riprendi la chiave» e «Modifica la frase» aprono la stessa schermata", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte(stato([{ a: LEI, frase: "Ciao" }])) });
  await c.carica();
  bottone(vistaSchedaChiave(h, c, LEI, "Giulia"), "Modifica la frase").a.onclick();
  assert.equal(testo(tutti(vistaSchermataChiave(h, c), (x) => x.tag === "h1")[0]), "Modifica la frase");
  bottone(vistaSchermataChiave(h, c), "Indietro").a.onclick();
  assert.equal(vistaSchermataChiave(h, c), null, "aperta dalla stanza, «Indietro» torna alla stanza");
});

test("34 dopo le 20:59: chiavi chiuse → solo «Torna alla stanza» e il testo delle chiavi chiuse", async () => {
  const chiavi = chiaviFinte();
  const c = creaChiaviStanza({ chiavi });
  await c.carica();
  c.apriDai(LEI, "Giulia");
  chiavi.dai = async (a, frase) => ({ ok: true, stato: stato([{ a, frase }], { chiuse: true }) });
  await c.conferma();
  const s = vistaSchermataChiave(h, c);
  assert.deepEqual(bottoni(classe(s, "azioni")[0]).map(testo), ["Torna alla stanza"]);
  assert.match(testo(s), /Le chiavi sono chiuse\. Tra poco le porte\./);
});

test("flusso: la schermata delle chiavi prende la pagina, con una sola riga aggiunta in disegna()", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /import \{[^}]*vistaSchermataChiave[^}]*\} from "\.\/chiavi_stanza\.js"/);
  const disegna = flusso.slice(flusso.indexOf("function disegna()"), flusso.indexOf("function barra()"));
  assert.match(disegna, /vistaSchermataChiave\(h, chiaviStanza\)/);
  assert.ok(disegna.indexOf("vistaSchermataChiave") < disegna.indexOf("vistaDomenicaSera"), "prima della schermata 35");
});

test("stile: classi della schermata nel blocco della linea C in fondo ad app.css; service worker nuovo", () => {
  const css = leggi("../landing/app/app.css");
  assert.match(css, /Linea C \(#349\): schermate 33-34/);
  assert.match(css, /\.app \.chiave-v4 h1/);
  assert.match(css, /\.chiave-data \.azioni/);
  assert.ok(!leggi("../landing/app/sw.js").includes('"presente-app-66"'));
});

test("stile: 33 e 34 alte quanto lo schermo, pulsanti in fondo come il design v4 (non più min(80vh, 700px))", () => {
  const css = leggi("../landing/app/app.css");
  const regola = css.match(/\.app \.chiave-v4 \{[^}]*\}/)[0];
  assert.match(regola, /min-height: calc\(100dvh - 140px\)/);
  assert.match(regola, /box-sizing: border-box/);
  assert.doesNotMatch(regola, /80vh/);
});
