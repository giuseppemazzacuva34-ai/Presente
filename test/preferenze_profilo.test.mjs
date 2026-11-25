// Profilo (schermata 23, #349): «Notifiche» e «Privacy» (spec del CPO del 25/11). Linea «sviluppatore-b».
// Notifiche: niente interruttori in beta (D24, D136 B), solo una frase e «Indietro». Privacy: 4 righe nell'ordine della
// spec; «Elimina il mio account» resta solo nel profilo. Nessun dato, nessuna rete. Albero finto al posto del DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { vistaNotifiche, vistaPrivacy, TESTI_NOTIFICHE, TESTI_PRIVACY } from "../landing/app/moduli/preferenze_profilo.js";
import { REGOLE_COMMUNITY } from "../landing/app/moduli/regole_community.js";

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (typeof n === "string" ? n : n.f.map(testo).join(""));
const tutti = (n, pred, out = []) => { if (typeof n === "object") { if (pred(n)) out.push(n); n.f.forEach((x) => tutti(x, pred, out)); } return out; };
const pulsanti = (n) => tutti(n, (x) => x.tag === "button");

test("Notifiche: solo la frase della spec e «Indietro», nessun interruttore", () => {
  let indietro = 0;
  const v = vistaNotifiche(h, { indietro: () => indietro++ });
  assert.equal(v.tag, "section");
  assert.equal(v.a["aria-labelledby"], "notifiche-titolo");
  assert.equal(testo(tutti(v, (x) => x.tag === "h2")[0]), "Notifiche");
  assert.match(testo(v), /Per ora ti avvisiamo dentro l'app, quando la apri\. Le notifiche sul telefono arriveranno presto\./);
  assert.equal(tutti(v, (x) => x.tag === "input").length, 0);
  assert.deepEqual(pulsanti(v).map(testo), ["Indietro"]);
  pulsanti(v)[0].a.onclick();
  assert.equal(indietro, 1);
  assert.equal(TESTI_NOTIFICHE.testo, "Per ora ti avvisiamo dentro l'app, quando la apri. Le notifiche sul telefono arriveranno presto.");
});

test("Privacy: 4 righe nell'ordine della spec, poi «Indietro»; niente «Elimina»", () => {
  const v = vistaPrivacy(h, { indietro: () => {}, aiuto: () => {} });
  assert.equal(v.a["aria-labelledby"], "privacy-titolo");
  assert.equal(testo(tutti(v, (x) => x.tag === "h2")[0]), "Privacy");
  const righe = tutti(v, (x) => String(x.a.classe || "").split(" ").includes("voce-profilo")).map((x) => testo(x).replace("›", ""));
  assert.deepEqual(righe, ["Informativa privacy", "Regole della community", "Chi vede cosa", "Una copia dei tuoi dati"]);
  assert.doesNotMatch(testo(v), /Elimina/);
  assert.equal(tutti(v, (x) => x.tag === "input").length, 0);
});

test("Privacy: «Informativa privacy» è un link vero a /privacy.html", () => {
  const v = vistaPrivacy(h, { indietro: () => {} });
  const a = tutti(v, (x) => x.tag === "a");
  assert.equal(a.length, 1);
  assert.equal(a[0].a.href, "/privacy.html");
  assert.equal(testo(a[0]).replace("›", ""), "Informativa privacy");
});

test("Privacy: le altre tre righe sono pulsanti che aprono e chiudono il loro testo (aria-expanded)", () => {
  const v = vistaPrivacy(h, { indietro: () => {}, aiuto: () => {} });
  const righe = pulsanti(v).filter((b) => b.a["aria-expanded"] !== undefined);
  assert.equal(righe.length, 3);
  for (const b of righe) {
    assert.equal(b.a.type, "button");
    assert.equal(b.a["aria-expanded"], "false");
    const pannello = tutti(v, (x) => x.a.id === b.a["aria-controls"])[0];
    assert.ok(pannello, "manca il pannello");
    assert.equal(pannello.a.hidden, true);
  }
});

test("Privacy: «Chi vede cosa» e «Una copia dei tuoi dati» con i testi della spec", () => {
  const v = vistaPrivacy(h, { indietro: () => {}, aiuto: () => {} });
  const t = testo(v);
  assert.match(t, /Voce e risposte: le persone della tua stanza\. Foto: solo dopo il sì di entrambi\. Questionario, diario e chi vuoi incontrare: nessuno\./);
  assert.match(t, /Scrivici da Aiuto › Scrivici: te la mandiamo entro 30 giorni\./);
  assert.equal(TESTI_PRIVACY.chiVede, "Voce e risposte: le persone della tua stanza. Foto: solo dopo il sì di entrambi. Questionario, diario e chi vuoi incontrare: nessuno.");
});

test("Privacy: le Regole della community sono le 10 approvate (una sola copia, regole_community.js)", () => {
  const v = vistaPrivacy(h, { indietro: () => {} });
  const voci = tutti(v, (x) => x.tag === "ol")[0];
  assert.ok(voci);
  assert.deepEqual(tutti(voci, (x) => x.tag === "li").map(testo), REGOLE_COMMUNITY.map(([, t]) => t));
});

test("Privacy: «Vai ad Aiuto» c'è solo se l'Aiuto è disponibile, e lo apre", () => {
  let aperto = 0;
  const con = vistaPrivacy(h, { indietro: () => {}, aiuto: () => aperto++ });
  const vai = pulsanti(con).filter((b) => testo(b) === TESTI_PRIVACY.vaiAiuto);
  assert.equal(vai.length, 1);
  vai[0].a.onclick();
  assert.equal(aperto, 1);
  const senza = vistaPrivacy(h, { indietro: () => {} });
  assert.equal(pulsanti(senza).filter((b) => testo(b) === TESTI_PRIVACY.vaiAiuto).length, 0);
});

test("Privacy: «Indietro» è l'ultimo pulsante e torna al profilo", () => {
  let n = 0;
  const v = vistaPrivacy(h, { indietro: () => n++ });
  const ultimo = pulsanti(v).at(-1);
  assert.equal(testo(ultimo), "Indietro");
  ultimo.a.onclick();
  assert.equal(n, 1);
});

test("flusso: le righe «Notifiche» e «Privacy» del profilo aprono le loro schermate; «Indietro» torna al profilo", async () => {
  const { readFileSync } = await import("node:fs");
  const f = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.match(f, /import \{ vistaNotifiche, vistaPrivacy \} from "\.\/preferenze_profilo\.js";/);
  assert.match(f, /notifiche: \(\) => apriSottoProfilo\("notifiche"\), privacy: \(\) => apriSottoProfilo\("privacy"\),/);
  assert.match(f, /if \(profiloSotto === "notifiche"\) return vistaNotifiche\(h, \{ indietro: chiudiSottoProfilo \}\);/);
  assert.match(f, /if \(profiloSotto === "privacy"\) return vistaPrivacy\(h, \{ indietro: chiudiSottoProfilo, aiuto: supporto \?/);
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"/app/moduli/preferenze_profilo.js"'), "manca il modulo nella copia offline");
  assert.ok(!sw.includes('"presente-app-62"'), "versione del service worker da aumentare");
});
