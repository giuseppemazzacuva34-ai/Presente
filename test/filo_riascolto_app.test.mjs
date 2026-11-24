// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A): voce «Il vocale del Filo» nella stanza, passo 10c
// della linea «sviluppatore-c». Modulo, letture dal Worker e vista; rete finta, nessun dato reale.
// Spec (parte 2, punto 8 e casi): dalla stanza, tutta la settimana, voce «Il vocale del Filo» per riascoltarlo; se il
// vocale arriva dopo la schermata 18 compare con un pallino rosso fino al primo ascolto; nessuna notifica push.
// Il vocale non parte mai da solo; pulsante del lettore «Ascolta il vocale del Filo»; «Leggi il testo» (WCAG 1.2.1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TESTI_FILO_RIASCOLTO, creaFiloRiascolto, vistaFiloRiascolto } from "../landing/app/moduli/filo_riascolto.js";

const STANZA = "11111111-2222-4333-8444-555555555555";
const VOCALE = { url: "https://esempio.supabase.co/firmato", durata: 70, testo: "Ciao a tutti, vi presento la stanza.", filo: "Valentina", scade_tra: 300 };

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };

function rete(risposte) {
  const chiamate = [];
  const f = async (url, init = {}) => {
    chiamate.push({ url, ...init });
    const r = risposte[`${init.method || "GET"} ${url}`] ?? { status: 500, body: {} };
    if (r.errore) throw new Error("rete");
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  return { f, chiamate, quante: (chiave) => chiamate.filter((c) => `${c.method || "GET"} ${c.url}` === chiave).length };
}
const LEGGI = "GET /app/api/filo/riascolto";
const SEGNA = "POST /app/api/filo/riascolto";
const ASCOLTA = "GET /app/api/filo/ascolta?tipo=lunedi";
const ok = (body) => ({ status: 200, body: { ok: true, ...body } });
const pronto = async (risposte) => {
  const r = rete(risposte);
  const fr = creaFiloRiascolto({ token: () => "tok", fetch: r.f });
  await fr.prepara();
  return { fr, ...r };
};

test("testi della spec", () => {
  assert.equal(TESTI_FILO_RIASCOLTO.voce, "Il vocale del Filo");
  assert.equal(TESTI_FILO_RIASCOLTO.nuovo, "Il vocale del Filo, nuovo");
  assert.equal(TESTI_FILO_RIASCOLTO.ascolta, "Ascolta il vocale del Filo");
  assert.equal(TESTI_FILO_RIASCOLTO.leggi, "Leggi il testo");
  assert.ok(Object.isFrozen(TESTI_FILO_RIASCOLTO));
});

test("lettura col token; senza voce (nessun Filo, vocale non arrivato, errore, senza token) la vista non c'è", async () => {
  const { fr, chiamate } = await pronto({ [LEGGI]: ok({ riascolto: { stanza: STANZA, nuovo: false } }) });
  assert.equal(chiamate[0].headers.authorization, "Bearer tok");
  assert.deepEqual(fr.modello().voce, { stanza: STANZA, nuovo: false });
  for (const risposte of [{ [LEGGI]: ok({ riascolto: null }) }, { [LEGGI]: { status: 503, body: {} } }, { [LEGGI]: { errore: true } },
    { [LEGGI]: ok({ riascolto: { stanza: "", nuovo: true } }) }, { [LEGGI]: ok({ riascolto: { stanza: STANZA, nuovo: "si" } }) }]) {
    const { fr: altro } = await pronto(risposte);
    assert.equal(vistaFiloRiascolto(h, altro), null, JSON.stringify(risposte));
  }
  const senza = creaFiloRiascolto({ token: () => null, fetch: rete({}).f });
  await senza.prepara();
  assert.equal(vistaFiloRiascolto(h, senza), null);
});

test("prepara() legge una volta sola per apertura dell'app; il vocale si chiede solo quando si apre la voce", async () => {
  const { fr, quante } = await pronto({ [LEGGI]: ok({ riascolto: { stanza: STANZA, nuovo: true } }), [ASCOLTA]: ok({ vocale: VOCALE }) });
  await fr.prepara();
  await fr.prepara();
  assert.equal(quante(LEGGI), 1);
  assert.equal(quante(ASCOLTA), 0);
});

test("vista chiusa: pulsante «Il vocale del Filo» con aria-expanded; pallino rosso solo se nuovo, con nome «…, nuovo»", async () => {
  const { fr } = await pronto({ [LEGGI]: ok({ riascolto: { stanza: STANZA, nuovo: true } }) });
  const v = vistaFiloRiascolto(h, fr);
  const [b] = tutti(v, (n) => n.tag === "button");
  assert.equal(testo(b), "Il vocale del Filo");
  assert.equal(b.a["aria-expanded"], "false");
  assert.equal(b.a["aria-label"], "Il vocale del Filo, nuovo");
  const pallini = tutti(v, (n) => n.a.classe === "filo-pallino");
  assert.equal(pallini.length, 1);
  assert.equal(pallini[0].a["aria-hidden"], "true");
  assert.equal(tutti(v, (n) => n.tag === "audio").length, 0);

  const { fr: visto } = await pronto({ [LEGGI]: ok({ riascolto: { stanza: STANZA, nuovo: false } }) });
  const v2 = vistaFiloRiascolto(h, visto);
  assert.equal(tutti(v2, (n) => n.a.classe === "filo-pallino").length, 0);
  assert.equal(tutti(v2, (n) => n.tag === "button")[0].a["aria-label"], undefined);
});

test("aperta: chiede il link firmato, lettore mai automatico con nome accessibile, «Leggi il testo» col testo", async () => {
  const { fr, quante } = await pronto({ [LEGGI]: ok({ riascolto: { stanza: STANZA, nuovo: false } }), [ASCOLTA]: ok({ vocale: VOCALE }) });
  await fr.apri();
  assert.equal(quante(ASCOLTA), 1);
  const v = vistaFiloRiascolto(h, fr);
  assert.equal(tutti(v, (n) => n.tag === "button")[0].a["aria-expanded"], "true");
  const [audio] = tutti(v, (n) => n.tag === "audio");
  assert.equal(audio.a.src, VOCALE.url);
  assert.equal(audio.a.controls, true);
  assert.equal(audio.a.preload, "none");
  assert.equal(audio.a["aria-label"], "Ascolta il vocale del Filo");
  assert.ok(!("autoplay" in audio.a));
  const [det] = tutti(v, (n) => n.tag === "details");
  assert.equal(testo(tutti(det, (n) => n.tag === "summary")[0]), "Leggi il testo");
  assert.match(testo(det), /Ciao a tutti/);
  // Chiudere e riaprire non chiede un altro link.
  await fr.apri();
  assert.equal(tutti(vistaFiloRiascolto(h, fr), (n) => n.tag === "audio").length, 0);
  await fr.apri();
  assert.equal(quante(ASCOLTA), 1);
});

test("aperta con vocale che non arriva: niente lettore, «Riprova» chiede di nuovo", async () => {
  const r = rete({ [LEGGI]: ok({ riascolto: { stanza: STANZA, nuovo: false } }), [ASCOLTA]: { status: 503, body: {} } });
  const fr = creaFiloRiascolto({ token: () => "tok", fetch: r.f });
  await fr.prepara();
  await fr.apri();
  const v = vistaFiloRiascolto(h, fr);
  assert.equal(tutti(v, (n) => n.tag === "audio").length, 0);
  const riprova = tutti(v, (n) => n.tag === "button" && testo(n) === "Riprova");
  assert.equal(riprova.length, 1);
  await riprova[0].a.onclick();
  assert.equal(r.quante(ASCOLTA), 2);
});

test("primo ascolto: il pallino si spegne subito e si segna sul server una volta sola", async () => {
  const { fr, chiamate, quante } = await pronto({ [LEGGI]: ok({ riascolto: { stanza: STANZA, nuovo: true } }),
    [ASCOLTA]: ok({ vocale: VOCALE }), [SEGNA]: ok({ segnato: true }) });
  await fr.apri();
  const [audio] = tutti(vistaFiloRiascolto(h, fr), (n) => n.tag === "audio");
  await audio.a.onplay();
  await audio.a.onplay();
  assert.equal(fr.modello().voce.nuovo, false);
  assert.equal(tutti(vistaFiloRiascolto(h, fr), (n) => n.a.classe === "filo-pallino").length, 0);
  assert.equal(quante(SEGNA), 1);
  const segna = chiamate.find((c) => c.method === "POST");
  assert.deepEqual(JSON.parse(segna.body), { stanza: STANZA });
  assert.equal(segna.headers.authorization, "Bearer tok");
});

test("ascolto senza pallino: nessuna richiesta al server; segnare non riuscito non dà errori", async () => {
  const { fr, quante } = await pronto({ [LEGGI]: ok({ riascolto: { stanza: STANZA, nuovo: false } }), [ASCOLTA]: ok({ vocale: VOCALE }) });
  await fr.apri();
  await tutti(vistaFiloRiascolto(h, fr), (n) => n.tag === "audio")[0].a.onplay();
  assert.equal(quante(SEGNA), 0);
  const { fr: giu } = await pronto({ [LEGGI]: ok({ riascolto: { stanza: STANZA, nuovo: true } }), [ASCOLTA]: ok({ vocale: VOCALE }), [SEGNA]: { errore: true } });
  await giu.apri();
  await tutti(vistaFiloRiascolto(h, giu), (n) => n.tag === "audio")[0].a.onplay();
  assert.equal(giu.modello().voce.nuovo, false);
});

test("link firmato scaduto: si chiede un link nuovo, al massimo due volte", async () => {
  const { fr, quante } = await pronto({ [LEGGI]: ok({ riascolto: { stanza: STANZA, nuovo: false } }), [ASCOLTA]: ok({ vocale: { ...VOCALE, url: "https://esempio.supabase.co/nuovo" } }) });
  await fr.apri();
  const nodo = { src: VOCALE.url };
  await fr.rinnova(nodo);
  await fr.rinnova(nodo);
  await fr.rinnova(nodo);
  assert.equal(quante(ASCOLTA), 3);
  assert.equal(nodo.src, "https://esempio.supabase.co/nuovo");
});

test("il modulo non salva nulla nel telefono, non scrive nei log e non fa partire la voce da solo", () => {
  const sorgente = readFileSync(new URL("../landing/app/moduli/filo_riascolto.js", import.meta.url), "utf8");
  assert.ok(!/localStorage|sessionStorage|indexedDB|console\.|Notification|PushManager/.test(sorgente));
  assert.ok(!/autoplay/.test(sorgente.replace(/\/\/.*$/gm, "")));
});
