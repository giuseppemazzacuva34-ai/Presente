// Issue #65 (spec v1 del CPO, passo 4 «Quando»; D48 A): gli avvisi delle porte nella home, linea del CTO.
// Senza notifiche push (vengono con D24) gli avvisi si vedono con l'app aperta: «<nome> è pronta per lo svelamento»,
// 10 minuti prima della fascia fissata e all'inizio. La porta resta raggiungibile anche dopo lunedì 9:00, fino alla
// scadenza delle 48 ore. h finto, svelamento finto, timer finti, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TESTI_AVVISI, avvisiPorte, prossimaLettura, creaAvvisiPorte, vistaAvvisiPorte, LETTURA_MS }
  from "../landing/app/moduli/avvisi_porte.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PORTA2 = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const LEI = "11111111-2222-4333-8444-555555555555";
// Martedì 17/11 alle 20:00 in Italia (19:00 UTC); la porta scade alle 21:00 (20:00 UTC).
const ADESSO = new Date("2026-11-17T19:00:00Z");
const porta = (extra = {}) => ({ porta: PORTA, con: LEI, nome: "Giulia", eta: 31, aperta_il: "2026-11-15T20:00:00Z",
  scade_il: "2026-11-17T20:00:00Z", mia_caparra: true, sua_caparra: true, mia_scelta: "video", mie_fasce: [],
  fascia_fissata: null, mio_pronto: false, suo_pronto: false, pronto_scade_il: null, pronta: null, ...extra });
const stato = (porte = [porta()]) => ({ saldo: 0, caparra: 10, beta: true, porte });

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };

test("nessuno stato o nessuna porta: nessun avviso", () => {
  assert.deepEqual(avvisiPorte(null, ADESSO), []);
  assert.deepEqual(avvisiPorte({ porte: "x" }, ADESSO), []);
  assert.deepEqual(avvisiPorte(stato([]), ADESSO), []);
});

test("porta aperta senza novità: «Una porta si è aperta: <nome>.» e «Vai allo svelamento», non urgente", () => {
  const [a] = avvisiPorte(stato(), ADESSO);
  assert.equal(a.porta, PORTA);
  assert.equal(a.testo, "Una porta si è aperta: Giulia.");
  assert.equal(a.urgente, false);
  assert.equal(a.bottone, "Vai allo svelamento");
  assert.equal(a.etichetta, "Vai allo svelamento con Giulia");
});

test("porta scaduta o con id non valido: non compare", () => {
  assert.deepEqual(avvisiPorte(stato([porta({ scade_il: "2026-11-17T19:00:00Z" })]), ADESSO), []);
  assert.deepEqual(avvisiPorte(stato([porta({ porta: "non-un-id" })]), ADESSO), []);
  assert.deepEqual(avvisiPorte(stato([porta({ scade_il: "domani" })]), ADESSO), []);
});

test("l'altra persona è pronta: il testo del server, urgente", () => {
  const [a] = avvisiPorte(stato([porta({ suo_pronto: true, pronta: "Giulia è pronta per lo svelamento" })]), ADESSO);
  assert.equal(a.testo, "Giulia è pronta per lo svelamento");
  assert.equal(a.urgente, true);
});

test("pronti tutti e due (il mio «pronto» ancora valido): «Siete pronti tutti e due.»", () => {
  const [a] = avvisiPorte(stato([porta({ suo_pronto: true, pronta: "Giulia è pronta per lo svelamento", mio_pronto: true,
    pronto_scade_il: "2026-11-17T19:03:00Z" })]), ADESSO);
  assert.equal(a.testo, TESTI_AVVISI.entrambiPronti);
  assert.equal(a.urgente, true);
});

test("il mio «pronto» scaduto conta come non pronto: torna l'avviso dell'altra persona", () => {
  const [a] = avvisiPorte(stato([porta({ suo_pronto: true, pronta: "Giulia è pronta per lo svelamento", mio_pronto: true,
    pronto_scade_il: "2026-11-17T18:59:00Z" })]), ADESSO);
  assert.equal(a.testo, "Giulia è pronta per lo svelamento");
});

test("fascia fissata tra 10 minuti o meno: «inizia tra N minuti», urgente; 1 minuto al singolare", () => {
  const tra7 = avvisiPorte(stato([porta({ fascia_fissata: "2026-11-17T19:06:30Z" })]), ADESSO)[0];
  assert.equal(tra7.testo, "Lo svelamento con Giulia inizia tra 7 minuti.");
  assert.equal(tra7.urgente, true);
  const tra10 = avvisiPorte(stato([porta({ fascia_fissata: "2026-11-17T19:10:00Z" })]), ADESSO)[0];
  assert.equal(tra10.testo, "Lo svelamento con Giulia inizia tra 10 minuti.");
  const tra1 = avvisiPorte(stato([porta({ fascia_fissata: "2026-11-17T19:00:30Z" })]), ADESSO)[0];
  assert.equal(tra1.testo, "Lo svelamento con Giulia inizia tra 1 minuto.");
});

test("fascia fissata oltre 10 minuti: testo di base con l'orario fissato, non urgente", () => {
  const [a] = avvisiPorte(stato([porta({ fascia_fissata: "2026-11-17T19:30:00Z" })]), ADESSO);
  assert.equal(a.testo, "Una porta si è aperta: Giulia.");
  assert.equal(a.fissata, "Lo svelamento è fissato: martedì 17 novembre, 20:30");
  assert.equal(a.urgente, false);
});

test("dentro la mezz'ora fissata: «inizia ora», urgente; finita la mezz'ora torna il testo di base", () => {
  const ora = avvisiPorte(stato([porta({ fascia_fissata: "2026-11-17T18:45:00Z" })]), ADESSO)[0];
  assert.equal(ora.testo, "Lo svelamento con Giulia inizia ora.");
  assert.equal(ora.urgente, true);
  const dopo = avvisiPorte(stato([porta({ fascia_fissata: "2026-11-17T18:30:00Z" })]), ADESSO)[0];
  assert.equal(dopo.testo, "Una porta si è aperta: Giulia.");
  assert.equal(dopo.urgente, false);
});

test("«pronta» vale più della fascia; due porte, due avvisi; nome mancante con il testo neutro", () => {
  const due = avvisiPorte(stato([
    porta({ suo_pronto: true, pronta: "Giulia è pronta per lo svelamento", fascia_fissata: "2026-11-17T19:05:00Z" }),
    porta({ porta: PORTA2, nome: "  " }),
  ]), ADESSO);
  assert.equal(due.length, 2);
  assert.equal(due[0].testo, "Giulia è pronta per lo svelamento");
  assert.equal(due[1].testo, "Una porta si è aperta: una persona della stanza.");
});

test("prossima lettura: ogni minuto con porte aperte; ferma senza porte, se spento o senza accesso", () => {
  assert.equal(LETTURA_MS, 60000);
  assert.equal(prossimaLettura({ ok: true, stato: stato() }, ADESSO), LETTURA_MS);
  assert.equal(prossimaLettura({ ok: true, stato: stato([]) }, ADESSO), null);
  assert.equal(prossimaLettura({ ok: true, stato: stato([porta({ scade_il: "2026-11-17T18:00:00Z" })]) }, ADESSO), null);
  assert.equal(prossimaLettura({ ok: false, motivo: "spento" }, ADESSO), null);
  assert.equal(prossimaLettura({ ok: false, motivo: "accesso" }, ADESSO), null);
  assert.equal(prossimaLettura({ ok: false, motivo: "rete" }, ADESSO), LETTURA_MS);
  assert.equal(prossimaLettura(null, ADESSO), LETTURA_MS);
});

function finti(...letture) {
  const timer = [];
  const pagina = { visibilityState: "visible", ascolta: null,
    addEventListener(_, f) { this.ascolta = f; }, removeEventListener() { this.ascolta = null; } };
  const svelamento = { letture: 0, async leggi() { this.letture++; return letture.length > 1 ? letture.shift() : letture[0]; } };
  const cambi = [];
  const ap = creaAvvisiPorte({ svelamento, pagina, adesso: () => ADESSO, aggiorna: () => cambi.push(1),
    setTimeout: (f, ms) => { timer.push({ f, ms }); return timer.length; }, clearTimeout: () => {} });
  return { ap, timer, pagina, svelamento, cambi };
}
const pausa = () => new Promise((r) => setImmediate(r));

test("controllo: legge all'avvio, rilegge dopo un minuto, avvisa solo se gli avvisi cambiano", async () => {
  const { ap, timer, svelamento, cambi } = finti({ ok: true, stato: stato() }, { ok: true, stato: stato() },
    { ok: true, stato: stato([porta({ suo_pronto: true, pronta: "Giulia è pronta per lo svelamento" })]) });
  ap.avvia();
  await pausa();
  assert.equal(svelamento.letture, 1);
  assert.equal(ap.modello().avvisi.length, 1);
  assert.equal(cambi.length, 1);
  assert.equal(timer.at(-1).ms, LETTURA_MS);
  timer.at(-1).f();
  await pausa();
  assert.equal(svelamento.letture, 2);
  assert.equal(cambi.length, 1, "stessi avvisi: niente ridisegno");
  timer.at(-1).f();
  await pausa();
  assert.equal(cambi.length, 2);
  assert.equal(ap.modello().avvisi[0].urgente, true);
});

test("controllo: in secondo piano nessuna lettura; tornando visibile legge subito; spento si ferma", async () => {
  const { ap, timer, pagina, svelamento } = finti({ ok: false, motivo: "spento" });
  pagina.visibilityState = "hidden";
  ap.avvia();
  await pausa();
  assert.equal(svelamento.letture, 0);
  pagina.visibilityState = "visible";
  pagina.ascolta();
  await pausa();
  assert.equal(svelamento.letture, 1);
  assert.equal(timer.length, 0, "spento: nessun altro giro");
  assert.deepEqual(ap.modello().avvisi, []);
  ap.ferma();
  assert.equal(pagina.ascolta, null);
});

test("controllo: con un errore di rete restano gli avvisi di prima", async () => {
  const { ap, timer } = finti({ ok: true, stato: stato() }, { ok: false, motivo: "rete" });
  ap.avvia();
  await pausa();
  timer.at(-1).f();
  await pausa();
  assert.equal(ap.modello().avvisi.length, 1);
});

test("vista: niente avvisi → null; urgente con role=status; pulsante con etichetta che apre la porta", () => {
  const vuoto = { modello: () => ({ avvisi: [] }) };
  assert.equal(vistaAvvisiPorte(h, vuoto, { apri: () => {} }), null);
  const aperte = [];
  const ap = { modello: () => ({ avvisi: avvisiPorte(stato([porta({ suo_pronto: true, pronta: "Giulia è pronta per lo svelamento" }),
    porta({ porta: PORTA2, nome: "Marta", fascia_fissata: "2026-11-17T19:30:00Z" })]), ADESSO) }) };
  const v = vistaAvvisiPorte(h, ap, { apri: (id) => aperte.push(id) });
  assert.match(testo(v), /Giulia è pronta per lo svelamento/);
  assert.match(testo(v), /Lo svelamento è fissato: martedì 17 novembre, 20:30/);
  const stati = tutti(v, (x) => x.a.role === "status");
  assert.equal(stati.length, 1);
  assert.match(testo(stati[0]), /Giulia è pronta/);
  const bottoni = tutti(v, (x) => x.tag === "button");
  assert.deepEqual(bottoni.map((b) => b.a["aria-label"]), ["Vai allo svelamento con Giulia", "Vai allo svelamento con Marta"]);
  bottoni[1].a.onclick();
  assert.deepEqual(aperte, [PORTA2]);
});

test("vista: «soloUrgenti» (la sera delle chiavi mostra già le porte) lascia solo gli avvisi urgenti", () => {
  const ap = { modello: () => ({ avvisi: avvisiPorte(stato([porta({ suo_pronto: true, pronta: "Giulia è pronta per lo svelamento" }),
    porta({ porta: PORTA2, nome: "Marta" })]), ADESSO) }) };
  const v = vistaAvvisiPorte(h, ap, { apri: () => {}, soloUrgenti: true });
  assert.doesNotMatch(testo(v), /Marta/);
  assert.match(testo(v), /Giulia/);
  const soloBase = { modello: () => ({ avvisi: avvisiPorte(stato([porta({ nome: "Marta" })]), ADESSO) }) };
  assert.equal(vistaAvvisiPorte(h, soloBase, { apri: () => {}, soloUrgenti: true }), null);
});

test("il service worker tiene il modulo e la home lo usa", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /"\/app\/moduli\/avvisi_porte\.js"/);
  assert.ok(!sw.includes('"presente-app-35"'), "versione della cache aumentata");
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.match(flusso, /vistaAvvisiPorte\(h, avvisiPorte/);
  const avvio = readFileSync(new URL("../landing/app/avvio.js", import.meta.url), "utf8");
  assert.match(avvio, /creaAvvisiPorte\(/);
});
