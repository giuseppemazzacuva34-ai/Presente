// La sera delle chiavi nella home (issue #5 spec v1.1, passo 8; linea «sviluppatore-c», passo 8c): dalle 21:00 fino a
// lunedì 9:00 in cima a «La tua stanza» le porte aperte, oppure lo stesso testo per chi non ne ha. «Vai allo
// svelamento» compare solo quando il flusso della #65 (CTO) passa la funzione per aprirlo.
// h finto che costruisce oggetti, chiavi finte, nessuna rete, nessun dato reale.
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
  const chiamate = [];
  return {
    chiamate,
    async leggi() { chiamate.push("leggi"); return { ok: true, stato: { stanza: false } }; },
    async sera() { chiamate.push("sera"); return sere.length > 1 ? sere.shift() : sere[0]; },
  };
}
const conPorta = { ok: true, stato: "pronta", porte: [{ id: PORTA, con: LEI, nome: "Giulia", frase_per_te: "Il treno, ancora." }] };
const senzaPorte = { ok: true, stato: "pronta", porte: [], testo: "Stasera nessuna porta si è aperta. Lunedì alle 9 apre una nuova stanza." };

test("prepara: legge anche la sera, una volta sola", async () => {
  const chiavi = chiaviFinte({ ok: true, stato: "nessuna" });
  const c = creaChiaviStanza({ chiavi });
  await c.prepara();
  await c.prepara();
  assert.deepEqual(chiavi.chiamate.filter((x) => x === "sera"), ["sera"]);
  assert.equal(vistaSera(h, c), null, "fuori dalla sera niente da mostrare");
});

test("con una porta: nome, frase dell'altra persona e «Vai allo svelamento» che apre quella porta", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte(conPorta) });
  await c.prepara();
  const aperte = [];
  const v = vistaSera(h, c, { svelamento: (porta) => aperte.push(porta) });
  assert.equal(v.a.classe, "chiavi-sera");
  // Design v4 (#349, approvato da Giuseppe): l'unico titolo è quello della schermata, «Una porta / si è aperta.».
  assert.deepEqual(tutti(v, (x) => /^h\d$/.test(x.tag)).map(testo), ["Una portasi è aperta."]);
  assert.match(testo(v), /Giulia/);
  assert.match(testo(v), /Giulia ti ha scritto:/);
  assert.match(testo(v), /Il treno, ancora\./);
  assert.equal(bottone(v, "Vai allo svelamento").a["aria-label"], "Vai allo svelamento con Giulia", "con due porte i pulsanti si distinguono");
  bottone(v, "Vai allo svelamento").a.onclick();
  assert.deepEqual(aperte, [PORTA]);
});

test("senza il flusso dello svelamento il pulsante non compare (niente pulsanti che non fanno niente)", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte(conPorta) });
  await c.prepara();
  const v = vistaSera(h, c);
  assert.match(testo(v), /Una portasi è aperta\.Giulia/);
  assert.equal(bottone(v, "Vai allo svelamento"), undefined);
});

test("senza porte: lo stesso testo per tutti, nessun pulsante", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte(senzaPorte) });
  await c.prepara();
  const v = vistaSera(h, c, { svelamento: () => {} });
  assert.equal(testo(tutti(v, (x) => x.tag === "p")[0]), "Stasera nessuna porta si è aperta. Lunedì alle 9 apre una nuova stanza.");
  assert.equal(tutti(v, (x) => x.tag === "button").length, 0);
});

test("in attesa del calcolo delle 21:00: «Tra poco le porte» e una nuova lettura dopo 20 secondi", async () => {
  const timer = [];
  const chiavi = chiaviFinte({ ok: true, stato: "attesa" }, conPorta);
  const c = creaChiaviStanza({ chiavi, dopo: (fn, ms) => timer.push([fn, ms]) });
  await c.prepara();
  assert.equal(testo(vistaSera(h, c)), "Le chiavi sono chiuse. Tra poco le porte.");
  assert.equal(timer.length, 1);
  assert.equal(timer[0][1], 20000);
  await timer[0][0]();
  assert.match(testo(vistaSera(h, c)), /Una portasi è aperta\.Giulia/);
  assert.equal(timer.length, 1, "dopo la risposta pronta nessuna nuova lettura");
});

test("errore di rete sulla sera: niente da mostrare, la stanza resta com'è", async () => {
  const c = creaChiaviStanza({ chiavi: chiaviFinte({ ok: false, motivo: "rete", testo: "Sei senza connessione. Riprova tra poco." }) });
  await c.prepara();
  assert.equal(vistaSera(h, c), null);
});

test("flusso: la sera in cima a «La tua stanza», lo svelamento lo passa chi lo costruisce (#65)", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /vistaSera\(h, chiaviStanza, \{ svelamento \}\)/);
  // Dal passo 4c (CTO) la funzione la costruisce il flusso dalla schermata della porta (svelamento.js).
  assert.match(flusso, /svelamento = portaSvelamento \? \(id\) => portaSvelamento\.apri\(id\) : null/);
});

test("service worker: versione nuova, così i telefoni prendono i moduli delle chiavi aggiornati", () => {
  assert.ok(!leggi("../landing/app/sw.js").includes('"presente-app-21"'));
});
