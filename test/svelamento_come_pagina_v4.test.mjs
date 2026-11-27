// Design v4 (#349, D149), schermata 40 «Lo svelamento · Come» come pagina intera (linea «sviluppatore-c»).
// Dopo la propria caparra la pagina è la 40 del design: occhiello «Svelamento · <nome>, <età>», titolo
// «Come vi volete / vedere?», due schede, «Quando», e il piede «Torna» / pulsante principale su una riga in fondo.
// Solo vista: usa ps.scegli, ps.pronto, ps.mostraOrari, ps.impostaFascia, ps.inviaFasce, ps.riprova di svelamento.js.
// h finto, ps finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schermataPorta, vistaPorta } from "../landing/app/moduli/svelamento.js";
import { vistaComePagina } from "../landing/app/moduli/svelamento_come.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LEI = "11111111-2222-4333-8444-555555555555";
const ADESSO = new Date("2026-11-16T09:40:00Z");
const porta = (extra = {}) => ({ porta: PORTA, con: LEI, nome: "Marco", eta: 35, aperta_il: "2026-11-15T20:00:00Z",
  scade_il: "2026-11-17T20:00:00Z", mia_caparra: true, sua_caparra: true, aspetta: null, mia_scelta: "video",
  mie_fasce: [], fascia_fissata: null, mio_pronto: false, suo_pronto: false, pronto_scade_il: null, pronta: null, ...extra });
const schermata = (p = porta()) => schermataPorta({ saldo: 145, caparra: 100, beta: true, porte: [p] }, PORTA, ADESSO);

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const conClasse = (n, c) => tutti(n, (x) => String(x.a.classe || "").split(" ").includes(c));
const bottoni = (n) => tutti(n, (x) => x.tag === "button");

function psFinto(m = {}) {
  const chiamate = [];
  const ps = {};
  for (const f of ["scegli", "pronto", "mostraOrari", "impostaFascia", "inviaFasce", "riprova"]) ps[f] = (...a) => { chiamate.push([f, ...a]); };
  let tornato = 0;
  return { ps, chiamate, torna: () => { tornato += 1; }, tornati: () => tornato,
    m: { inCorso: false, orari: false, bozza: ["", "", ""], ...m } };
}
const pagina = (s, extra = {}) => { const f = psFinto(extra); return { ...f, v: vistaComePagina(h, f.ps, f.m, s, { torna: f.torna }) }; };

test("40 pagina: null senza porta, prima della propria caparra o al momento dello svelamento", () => {
  const { ps, m, torna } = psFinto();
  assert.equal(vistaComePagina(h, ps, m, null, { torna }), null);
  assert.equal(vistaComePagina(h, ps, m, { tipo: "chiusa", testo: "x" }, { torna }), null);
  assert.equal(vistaComePagina(h, ps, m, schermata(porta({ mia_caparra: false, sua_caparra: false })), { torna }), null);
  assert.equal(vistaComePagina(h, ps, m, schermata(porta({ momento: true, tipo: "video" })), { torna }), null);
});

test("40 pagina: sezione svelamento-v4, occhiello «Svelamento · Marco, 35» e h1 «Come vi volete / vedere?»", () => {
  const { v } = pagina(schermata());
  assert.equal(v.tag, "section");
  assert.ok(String(v.a.classe).split(" ").includes("svelamento-v4"));
  assert.equal(v.a["aria-labelledby"], "porta-titolo");
  assert.equal(testo(conClasse(v, "passo")[0]), "Svelamento · Marco, 35");
  const h1 = tutti(v, (x) => x.tag === "h1");
  assert.equal(h1.length, 1);
  assert.equal(h1[0].a.id, "porta-titolo");
  assert.equal(testo(h1[0]), "Come vi volete vedere?");
  assert.equal(tutti(h1[0], (x) => x.tag === "br").length, 1);
  assert.equal(testo(tutti(h1[0], (x) => x.tag === "em")[0]), "vedere?");
  // Le schede restano un gruppo con il nome del titolo della pagina.
  assert.equal(conClasse(v, "scelta2")[0].a["aria-labelledby"], "porta-titolo");
});

test("40 pagina: niente righe della schermata di prima (titolo lungo, saldo, conto, caparra di entrambi)", () => {
  const { v } = pagina(schermata());
  const t = testo(v);
  assert.doesNotMatch(t, /Una porta si è aperta/);
  assert.doesNotMatch(t, /I tuoi crediti/);
  assert.doesNotMatch(t, /Mancano/);
  assert.equal(conClasse(v, "porta-chi").length, 0);
});

test("40 pagina: piede in fondo con «Torna» e «Ci sono adesso» sulla stessa riga", () => {
  const { v, chiamate, tornati } = pagina(schermata());
  const piede = conClasse(v, "azioni");
  assert.equal(piede.length, 1);
  assert.equal(v.f[v.f.length - 1], piede[0]);
  const [torna, principale] = bottoni(piede[0]);
  assert.equal(bottoni(piede[0]).length, 2);
  assert.equal(testo(torna), "Torna");
  assert.equal(torna.a.classe, "bottone-secondario");
  assert.equal(testo(principale), "Ci sono adesso");
  assert.equal(principale.a.classe, "bottone");
  torna.a.onclick();
  principale.a.onclick();
  assert.equal(tornati(), 1);
  assert.deepEqual(chiamate, [["pronto"]]);
  // Il pulsante principale non è ripetuto sopra il piede.
  assert.equal(bottoni(v).filter((b) => testo(b) === "Ci sono adesso").length, 1);
});

test("40 pagina: con gli orari il pulsante principale è «Salva gli orari» (ps.inviaFasce)", () => {
  const { v, chiamate } = pagina(schermata(), { orari: true });
  const principale = bottoni(conClasse(v, "azioni")[0])[1];
  assert.equal(testo(principale), "Salva gli orari");
  principale.a.onclick();
  assert.deepEqual(chiamate, [["inviaFasce"]]);
  assert.equal(tutti(v, (x) => x.tag === "select").length, 3);
});

test("40 pagina: in attesa della caparra dell'altra persona resta la riga del server e solo «Torna»", () => {
  const { v } = pagina(schermata(porta({ sua_caparra: false, aspetta: "Aspettiamo Marco." })));
  assert.match(testo(v), /Aspettiamo Marco\./);
  assert.equal(bottoni(conClasse(v, "azioni")[0]).length, 1);
});

test("40 pagina: errore con «Riprova»; in corso il principale dice «Un attimo…» ed è spento", () => {
  const { v, chiamate } = pagina(schermata(), { errore: "Non riesco a leggere lo svelamento." });
  assert.equal(tutti(v, (x) => x.a.role === "alert").length, 1);
  bottoni(v).find((b) => testo(b) === "Riprova").a.onclick();
  assert.deepEqual(chiamate, [["riprova"]]);
  const { v: v2 } = pagina(schermata(), { inCorso: true });
  const principale = bottoni(conClasse(v2, "azioni")[0])[1];
  assert.equal(testo(principale), "Un attimo…");
  assert.equal(principale.a.disabled, true);
});

test("vistaPorta: dopo la propria caparra la pagina è la 40", () => {
  const f = psFinto();
  const ps = { ...f.ps, modello: () => ({ ...f.m, aperta: true, schermata: schermata(), adesso: ADESSO }) };
  const v = vistaPorta(h, ps, { torna: f.torna });
  assert.ok(String(v.a.classe).split(" ").includes("svelamento-v4"));
  assert.equal(testo(tutti(v, (x) => x.tag === "h1")[0]), "Come vi volete vedere?");
});

test("stile: la 40 come pagina ha il piede in fondo (blocco della linea C in app.css)", () => {
  const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
  assert.match(css, /\.app \.come-v4 h1\s*\{/);
});
