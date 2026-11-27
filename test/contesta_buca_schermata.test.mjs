// «Ero lì» / «Non riesco a fare il check-in» dentro «Il vostro incontro» (issue #6, spec v1 casi limite, v1.4 del CPO
// del 27/11; D51 A). Linea «sviluppatore-b». Il foglio legge lo stato della contestazione una volta per porta, si apre
// col pulsante giusto per la fase, manda il testo e mostra «In revisione» o l'esito. h finto, client finto, orologio fisso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { vistaIncontro } from "../landing/app/moduli/incontro.js";
import { TESTI_BUCA, creaFoglioBuca } from "../landing/app/moduli/contesta_buca.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ADESSO = new Date("2026-11-24T19:10:00Z");
const confermato = { stato: "confermato", scadenza: "2026-11-29T20:00:00Z", orario: "2026-11-24T19:30:00Z", luogo: "Bar Centrale",
  locale: null, azioni: ["sono_qui"], esito: null, checkin_mio: false, checkin_altro: false,
  checkin_da: "2026-11-24T19:00:00Z", checkin_fino: "2026-11-24T20:00:00Z" };
const buca = { ...confermato, stato: "concluso", esito: "buca_a", azioni: [] };
const contestato = { ...confermato, stato: "concluso", esito: "contestato", azioni: [] };

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];
const inc = (i) => ({ modello: () => ({ porta: PORTA, incontro: i, proposta: false, conferma: null, bozza: {} }), adesso: () => ADESSO });

function client(stati, esiti = []) {
  const viste = { leggi: [], manda: [] };
  return { viste, leggi: async (p) => { viste.leggi.push(p); return { ok: true, contestazione: stati.shift() }; },
    manda: async (p, t) => { viste.manda.push([p, t]); return esiti.shift() || { ok: true }; } };
}
const pronto = async (c, i) => { const fb = creaFoglioBuca({ client: c }); vistaIncontro(h, inc(i), { buca: fb }); await fb.letto(); return fb; };

test("senza il foglio la schermata non cambia", () => {
  assert.equal(bottone(vistaIncontro(h, inc(confermato)), TESTI_BUCA.nonRiesco), undefined);
});

test("nella finestra: legge una volta per porta e mostra «Non riesco a fare il check-in»", async () => {
  const c = client([{ contestabile: true, stato: null }]);
  const fb = await pronto(c, confermato);
  const v = vistaIncontro(h, inc(confermato), { buca: fb });
  assert.ok(bottone(v, TESTI_BUCA.nonRiesco));
  assert.equal(bottone(v, TESTI_BUCA.eroLi), undefined);
  assert.deepEqual(c.viste.leggi, [PORTA], "una sola lettura");
});

test("dopo la buca: «Ero lì»; non contestabile → nessun pulsante", async () => {
  assert.ok(bottone(vistaIncontro(h, inc(buca), { buca: await pronto(client([{ contestabile: true, stato: null }]), buca) }), TESTI_BUCA.eroLi));
  const v = vistaIncontro(h, inc(buca), { buca: await pronto(client([{ contestabile: false, stato: null }]), buca) });
  assert.equal(bottone(v, TESTI_BUCA.eroLi), undefined);
});

test("foglio: etichetta vera sul campo, nota collegata, «Manda» e «Annulla»; testo corto → errore senza invio", async () => {
  const c = client([{ contestabile: true, stato: null }]);
  const fb = await pronto(c, buca);
  bottone(vistaIncontro(h, inc(buca), { buca: fb }), TESTI_BUCA.eroLi).a.onclick();
  const v = vistaIncontro(h, inc(buca), { buca: fb });
  const etichetta = tutti(v, (x) => x.tag === "label")[0];
  const campo = tutti(v, (x) => x.tag === "textarea")[0];
  assert.equal(testo(etichetta), TESTI_BUCA.domanda);
  assert.equal(etichetta.a.for, campo.a.id);
  const nota = tutti(v, (x) => x.a.id === campo.a["aria-describedby"])[0];
  assert.equal(testo(nota), TESTI_BUCA.nota);
  assert.ok(bottone(v, TESTI_BUCA.manda) && bottone(v, TESTI_BUCA.annulla));
  assert.equal(bottone(v, TESTI_BUCA.eroLi), undefined, "col foglio aperto il pulsante non c'è");
  fb.imposta("corto");
  await fb.manda();
  assert.equal(c.viste.manda.length, 0);
  assert.match(testo(vistaIncontro(h, inc(buca), { buca: fb })), /almeno 10 caratteri/);
  bottone(vistaIncontro(h, inc(buca), { buca: fb }), TESTI_BUCA.annulla).a.onclick();
  assert.ok(bottone(vistaIncontro(h, inc(buca), { buca: fb }), TESTI_BUCA.eroLi));
});

test("invio: manda porta e testo, poi «inviata» e «In revisione»; errore del server resta nel foglio", async () => {
  const c = client([{ contestabile: true, stato: null }], [{ ok: false, testo: TESTI_BUCA.errori.gia_inviata }, { ok: true }]);
  const fb = await pronto(c, confermato);
  fb.apri();
  fb.imposta("La rete non andava, ero al tavolo.");
  await fb.manda();
  assert.match(testo(vistaIncontro(h, inc(confermato), { buca: fb })), new RegExp(TESTI_BUCA.errori.gia_inviata));
  await fb.manda();
  assert.deepEqual(c.viste.manda[1], [PORTA, "La rete non andava, ero al tavolo."]);
  const v = testo(vistaIncontro(h, inc(confermato), { buca: fb }));
  assert.ok(v.includes(TESTI_BUCA.inviata) && v.includes(TESTI_BUCA.inRevisione));
  assert.equal(tutti(vistaIncontro(h, inc(confermato), { buca: fb }), (x) => x.tag === "textarea").length, 0);
});

test("esito deciso → frase; chi ha aspettato vede «L'altra persona dice…» con l'esito «contestato»", async () => {
  assert.ok(testo(vistaIncontro(h, inc(buca), { buca: await pronto(client([{ contestabile: false, stato: "accolta" }]), buca) }))
    .includes(TESTI_BUCA.accolta));
  const altro = testo(vistaIncontro(h, inc(contestato), { buca: await pronto(client([{ contestabile: false, stato: null }]), contestato) }));
  assert.ok(altro.includes(TESTI_BUCA.altroContesta));
  const mio = testo(vistaIncontro(h, inc(contestato), { buca: await pronto(client([{ contestabile: false, stato: "in_attesa" }]), contestato) }));
  assert.ok(!mio.includes(TESTI_BUCA.altroContesta) && mio.includes(TESTI_BUCA.inRevisione));
});
