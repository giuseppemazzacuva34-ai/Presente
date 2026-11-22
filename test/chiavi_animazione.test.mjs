// La sera delle chiavi (issue #5 spec v1.1, passo 8; linea «sviluppatore-c», passo 11): alle 21:00, prima delle porte
// (o del testo «nessuna porta»), una breve animazione di porte che si aprono, 3 secondi, saltabile. Una volta sola
// per apertura dell'app; spenta per chi chiede meno movimento (animazioneMs 0, lo decide avvio.js).
// h finto, timer finto, chiavi finte: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaChiaviStanza, vistaSera } from "../landing/app/moduli/chiavi_stanza.js";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const PORTA = "aaaaaaaa-aaaa-4bbb-8ccc-dddddddddddd";
const LEI = "11111111-2222-4333-8444-555555555555";
const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];

function chiaviFinte(...sere) {
  return {
    async leggi() { return { ok: true, stato: { stanza: false } }; },
    async sera() { return sere.length > 1 ? sere.shift() : sere[0]; },
  };
}
// Timer finto: tiene le funzioni programmate, le fa partire a comando.
function orologio() {
  const coda = [];
  return { coda, dopo: (fn, ms) => { coda.push({ fn, ms }); }, scatta: async (ms) => {
    const i = coda.findIndex((x) => x.ms === ms);
    assert.ok(i >= 0, `nessun timer da ${ms} ms`);
    const [t] = coda.splice(i, 1);
    await t.fn();
  } };
}
const conPorta = { ok: true, stato: "pronta", porte: [{ id: PORTA, con: LEI, nome: "Giulia", frase_per_te: null }] };
const senzaPorte = { ok: true, stato: "pronta", porte: [] };
const attesa = { ok: true, stato: "attesa" };

test("sera pronta: prima l'animazione delle porte con «Salta», niente esito sotto", async () => {
  const o = orologio();
  const c = creaChiaviStanza({ chiavi: chiaviFinte(conPorta), dopo: o.dopo, animazioneMs: 3000 });
  await c.prepara();
  assert.equal(c.modello().animazione, true);
  const v = vistaSera(h, c);
  assert.equal(v.a.classe, "chiavi-sera porte-animazione");
  assert.ok(bottone(v, "Salta"), "l'animazione si può saltare");
  assert.equal(tutti(v, (x) => x.a.classe === "porta-anta").length, 2, "due ante");
  assert.ok(tutti(v, (x) => x.a.classe === "porte-ante")[0].a["aria-hidden"] === "true", "le ante sono solo decorazione");
  assert.ok(!testo(v).includes("Giulia"), "il nome arriva dopo l'animazione");
  assert.ok(o.coda.some((x) => x.ms === 3000), "dura 3 secondi");
});

test("dopo 3 secondi l'animazione finisce da sola e compare la porta", async () => {
  const o = orologio();
  let aggiornata = 0;
  const c = creaChiaviStanza({ chiavi: chiaviFinte(conPorta), dopo: o.dopo, animazioneMs: 3000, aggiorna: () => { aggiornata += 1; } });
  await c.prepara();
  const prima = aggiornata;
  await o.scatta(3000);
  assert.equal(c.modello().animazione, false);
  assert.ok(aggiornata > prima, "la pagina si ridisegna");
  assert.ok(testo(vistaSera(h, c)).includes("Una portasi è aperta.Giulia"));
});

test("«Salta» chiude subito l'animazione; il timer dopo non fa danni", async () => {
  const o = orologio();
  const c = creaChiaviStanza({ chiavi: chiaviFinte(senzaPorte), dopo: o.dopo, animazioneMs: 3000 });
  await c.prepara();
  bottone(vistaSera(h, c), "Salta").a.onclick();
  assert.equal(c.modello().animazione, false);
  assert.equal(testo(vistaSera(h, c)), "Stasera nessuna porta si è aperta. Lunedì alle 9 apre una nuova stanza.");
  await o.scatta(3000);
  assert.equal(c.modello().animazione, false);
});

test("in attesa del calcolo niente animazione; parte quando la sera è pronta, una volta sola", async () => {
  const o = orologio();
  const c = creaChiaviStanza({ chiavi: chiaviFinte(attesa, conPorta), dopo: o.dopo, animazioneMs: 3000 });
  await c.prepara();
  assert.equal(c.modello().animazione, false, "nessuna animazione mentre si aspetta");
  await o.scatta(20000);
  assert.equal(c.modello().animazione, true);
  await o.scatta(3000);
  assert.equal(c.modello().animazione, false);
});

test("senza animazioneMs (o con 0, meno movimento) l'esito si vede subito", async () => {
  for (const extra of [{}, { animazioneMs: 0 }]) {
    const o = orologio();
    const c = creaChiaviStanza({ chiavi: chiaviFinte(conPorta), dopo: o.dopo, ...extra });
    await c.prepara();
    assert.equal(c.modello().animazione, false);
    assert.ok(testo(vistaSera(h, c)).includes("Giulia"));
  }
});

test("fuori dalla sera o con errore di rete: niente animazione", async () => {
  for (const sera of [{ ok: true, stato: "nessuna" }, { ok: false, motivo: "rete" }]) {
    const c = creaChiaviStanza({ chiavi: chiaviFinte(sera), dopo: orologio().dopo, animazioneMs: 3000 });
    await c.prepara();
    assert.equal(c.modello().animazione, false);
    assert.equal(vistaSera(h, c), null);
  }
});

test("avvio.js accende l'animazione da 3 secondi solo senza «riduci movimento»; il CSS la ferma comunque", () => {
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /animazioneMs:\s*window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches \? 0 : 3000/);
  const css = leggi("../landing/app/app.css");
  assert.match(css, /\.porta-anta/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^}]*\.porta-anta/);
});
