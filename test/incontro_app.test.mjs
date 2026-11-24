// Schermata «Il vostro incontro» nella web app (issue #6, spec v1 del CPO del 3/11, passi 1-4 e regola sulla scadenza).
// Passo 2e della linea «sviluppatore-b». Stato letto da /app/api/incontro (worker/incontro_api.js): qui solo cosa si
// mostra e cosa si manda. h finto, rete finta, orologio fisso, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TESTI_INCONTRO, orariProposta, schermataIncontro, testoErroreIncontro, creaIncontro, vistaIncontro,
} from "../landing/app/moduli/incontro.js";
import { controllaOrario } from "../api/incontro.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ADESSO = new Date("2026-11-19T09:40:00Z"); // giovedì 10:40 di Roma
const SCADENZA = "2026-11-22T20:00:00Z"; // domenica 21:00 di Roma
const base = (extra = {}) => ({ stato: "da_fissare", scadenza: SCADENZA, orario: null, locale: null, luogo: null,
  proposta_mia: false, proposta_scade: null, controproposte_rimaste: 3, azioni: ["proponi"], ritardo_minuti: null,
  esito: null, ...extra });

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];

function rete(risposte) {
  const chiamate = [];
  const f = async (url, opz) => {
    chiamate.push({ url, metodo: opz.method, corpo: opz.body ? JSON.parse(opz.body) : null, auth: opz.headers.authorization });
    const r = risposte.shift();
    if (r instanceof Error) throw r;
    return { status: r.status ?? 200, json: async () => r.dati };
  };
  return { f, chiamate };
}

test("testi della spec, parola per parola", () => {
  assert.equal(TESTI_INCONTRO.viIncontrate, "Vi incontrate! Avete fino al <data> per vedervi.");
  assert.equal(TESTI_INCONTRO.proponi, "Proponi quando e dove");
  assert.equal(TESTI_INCONTRO.pubblico, "Scegliete sempre un posto pubblico e frequentato.");
  assert.equal(TESTI_INCONTRO.altroLuogo, "Un altro luogo pubblico");
  assert.equal(TESTI_INCONTRO.accetto, "Accetto");
  assert.equal(TESTI_INCONTRO.altraData, "Propongo un'altra data");
  assert.equal(TESTI_INCONTRO.annulla, "Annulla l'incontro");
  assert.equal(TESTI_INCONTRO.confermato, "Ci vediamo <giorno> alle <ora> · <luogo>");
  assert.equal(TESTI_INCONTRO.caparra, "Se uno dei due non si presenta, i suoi 100 crediti vanno: 70 a chi ha aspettato, 30 a Presente.");
  assert.equal(TESTI_INCONTRO.scaduto, "Non siete riusciti a fissare l'incontro. I tuoi 100 crediti sono di nuovo disponibili.");
});

test("orari proponibili: da domani 10:00 alla scadenza, ogni 30 minuti, 10:00-23:00 di Roma, tutti accettati dal server", () => {
  const giorni = orariProposta(SCADENZA, ADESSO);
  assert.deepEqual(giorni.map((g) => g.giorno), ["venerdì 20 novembre", "sabato 21 novembre", "domenica 22 novembre"]);
  assert.equal(giorni[0].orari[0].testo, "10:00");
  assert.equal(giorni[0].orari[0].valore, "2026-11-20T09:00:00.000Z");
  assert.equal(giorni[0].orari.at(-1).testo, "23:00");
  assert.equal(giorni[0].orari.length, 27);
  assert.equal(giorni[2].orari.at(-1).testo, "21:00", "non oltre la scadenza");
  for (const g of giorni) for (const o of g.orari) {
    assert.deepEqual(controllaOrario({ orario: o.valore, adesso: ADESSO, scadenza: SCADENZA }), { ok: true }, o.valore);
  }
});

test("orari proponibili: col cambio d'ora restano 10:00-23:00 di Roma; scadenza illeggibile o passata → nessun orario", () => {
  const giorni = orariProposta("2026-03-30T08:00:00Z", new Date("2026-03-28T12:00:00Z")); // passa all'ora legale il 29/3
  assert.deepEqual(giorni.map((g) => [g.giorno, g.orari[0].testo, g.orari.at(-1).testo, g.orari.length]),
    [["domenica 29 marzo", "10:00", "23:00", 27], ["lunedì 30 marzo", "10:00", "10:00", 1]], "la scadenza stessa è ammessa");
  assert.equal(giorni[0].orari[0].valore, "2026-03-29T08:00:00.000Z");
  assert.deepEqual(orariProposta("non è una data", ADESSO), []);
  assert.deepEqual(orariProposta("2026-11-19T10:00:00Z", ADESSO), []);
});

test("da fissare: «Vi incontrate!» con la data della scadenza e «Proponi quando e dove»", () => {
  const s = schermataIncontro(base(), ADESSO);
  assert.equal(s.tipo, "da_fissare");
  assert.equal(s.titolo, "Vi incontrate! Avete fino al domenica 22 novembre per vedervi.");
  assert.deepEqual(s.azioni, ["proponi"]);
});

test("proposta mia: cosa ho proposto e che aspettiamo la risposta, nessun pulsante", () => {
  const s = schermataIncontro(base({ stato: "proposto", orario: "2026-11-21T19:30:00Z", luogo: "Bar Centrale, via Roma 1",
    proposta_mia: true, proposta_scade: "2026-11-21T09:40:00Z", azioni: [] }), ADESSO);
  assert.equal(s.tipo, "attesa");
  assert.equal(s.proposta, "sabato 21 novembre alle 20:30 · Bar Centrale, via Roma 1");
  assert.equal(s.testo, TESTI_INCONTRO.aspetta);
  assert.deepEqual(s.azioni, []);
});

test("proposta ricevuta: Accetto · Propongo un'altra data · Annulla; dopo 3 controproposte solo Accetto e Annulla", () => {
  const ricevuta = base({ stato: "proposto", orario: "2026-11-21T19:30:00Z", luogo: "Bar Centrale", azioni: ["accetto", "altra_data", "annulla"] });
  const s = schermataIncontro(ricevuta, ADESSO);
  assert.equal(s.tipo, "ricevuta");
  assert.equal(s.proposta, "sabato 21 novembre alle 20:30 · Bar Centrale");
  assert.deepEqual(s.azioni, ["accetto", "altra_data", "annulla"]);
  const finite = schermataIncontro({ ...ricevuta, controproposte_rimaste: 0, azioni: ["accetto", "annulla"] }, ADESSO);
  assert.deepEqual(finite.azioni, ["accetto", "annulla"]);
  const strane = schermataIncontro({ ...ricevuta, azioni: ["accetto", "paga", "annulla"] }, ADESSO);
  assert.deepEqual(strane.azioni, ["accetto", "annulla"], "solo le azioni conosciute");
});

test("confermato: «Ci vediamo…» e il testo sulla caparra", () => {
  const s = schermataIncontro(base({ stato: "confermato", orario: "2026-11-21T19:30:00Z", luogo: "Bar Centrale", azioni: [] }), ADESSO);
  assert.equal(s.tipo, "confermato");
  assert.equal(s.titolo, "Ci vediamo sabato 21 novembre alle 20:30 · Bar Centrale");
  assert.equal(s.testo, TESTI_INCONTRO.caparra);
});

test("concluso: scaduto e annullato con i crediti restituiti; altri esiti con un testo neutro; nessuno stato → null", () => {
  assert.equal(schermataIncontro(base({ stato: "concluso", esito: "scaduto", azioni: [] }), ADESSO).testo, TESTI_INCONTRO.scaduto);
  assert.equal(schermataIncontro(base({ stato: "concluso", esito: "annullato", azioni: [] }), ADESSO).testo, TESTI_INCONTRO.annullato);
  assert.equal(schermataIncontro(base({ stato: "concluso", esito: "contestato", azioni: [] }), ADESSO).testo, TESTI_INCONTRO.chiuso); // «avvenuto»: test/checkin_app.test.mjs
  assert.equal(schermataIncontro(null, ADESSO), null);
  assert.equal(schermataIncontro({ stato: "boh" }, ADESSO), null);
});

test("errori del server → testi con una via d'uscita", () => {
  for (const m of ["prima_di_domani", "fuori_orario", "non_sul_passo", "dopo_la_scadenza", "orario_non_valido"]) {
    assert.equal(testoErroreIncontro(m), TESTI_INCONTRO.orarioNonVa, m);
  }
  assert.equal(testoErroreIncontro("luogo_non_valido"), TESTI_INCONTRO.luogoNonVa);
  assert.equal(testoErroreIncontro("rete"), "Sei senza connessione. Riprova tra poco.");
  assert.equal(testoErroreIncontro("qualcosa"), "Non è andata. Riprova tra poco.");
});

test("lettura: GET con il token e la porta; 404 → incontro non disponibile", async () => {
  const { f, chiamate } = rete([{ dati: { ok: true, incontro: base() } }, { status: 404, dati: { ok: false, motivo: "non_trovato" } }]);
  const inc = creaIncontro({ token: async () => "tok", fetch: f });
  await inc.apri(PORTA);
  assert.equal(chiamate[0].url, `/app/api/incontro?porta=${PORTA}`);
  assert.equal(chiamate[0].metodo, "GET");
  assert.equal(chiamate[0].auth, "Bearer tok");
  assert.equal(inc.modello().incontro.stato, "da_fissare");
  await inc.riprova();
  assert.equal(inc.modello().errore, TESTI_INCONTRO.nonDisponibile);
});

test("proposta: modulo aperto da «Proponi», un luogo scritto obbligatorio, invio e nuova lettura", async () => {
  const { f, chiamate } = rete([
    { dati: { ok: true, incontro: base() } },
    { dati: { ok: true, esito: "proposto" } },
    { dati: { ok: true, incontro: base({ stato: "proposto", proposta_mia: true, azioni: [] }) } },
  ]);
  const inc = creaIncontro({ token: async () => "tok", fetch: f });
  await inc.apri(PORTA);
  inc.apriProposta();
  assert.equal(inc.modello().proposta, true);
  assert.equal(await inc.proponi({ orario: "2026-11-21T19:30:00.000Z", luogo: "   " }), false, "luogo vuoto");
  assert.equal(inc.modello().errore, TESTI_INCONTRO.luogoNonVa);
  assert.equal(chiamate.length, 1, "niente invio senza luogo");
  assert.equal(await inc.proponi({ orario: "2026-11-21T19:30:00.000Z", luogo: " Bar Centrale, via Roma 1 " }), true);
  assert.deepEqual(chiamate[1].corpo, { azione: "proponi", porta: PORTA, orario: "2026-11-21T19:30:00.000Z", luogo: "Bar Centrale, via Roma 1" });
  assert.equal(chiamate[1].metodo, "POST");
  assert.equal(inc.modello().proposta, false);
  assert.equal(inc.modello().incontro.stato, "proposto");
});

test("risposta: «Accetto» subito; «Annulla l'incontro» solo dopo la conferma", async () => {
  const ricevuta = base({ stato: "proposto", orario: "2026-11-21T19:30:00Z", luogo: "Bar", azioni: ["accetto", "altra_data", "annulla"] });
  const { f, chiamate } = rete([
    { dati: { ok: true, incontro: ricevuta } },
    { dati: { ok: true, esito: "annullato" } },
    { dati: { ok: true, incontro: base({ stato: "concluso", esito: "annullato", azioni: [] }) } },
  ]);
  const inc = creaIncontro({ token: async () => "tok", fetch: f });
  await inc.apri(PORTA);
  assert.equal(await inc.rispondi("annulla"), false, "prima chiede conferma");
  assert.equal(inc.modello().conferma, "annulla");
  assert.equal(chiamate.length, 1);
  assert.equal(await inc.rispondi("annulla"), true);
  assert.deepEqual(chiamate[1].corpo, { azione: "rispondi", porta: PORTA, risposta: "annulla" });
  assert.equal(inc.modello().incontro.esito, "annullato");
  assert.equal(await inc.rispondi("paga"), false);
});

test("vista: pulsanti dello stato, modulo con giorno, ora, luogo e avviso sul posto pubblico", async () => {
  const { f } = rete([{ dati: { ok: true, incontro: base() } }]);
  const inc = creaIncontro({ token: async () => "tok", fetch: f, adesso: () => ADESSO });
  await inc.apri(PORTA);
  let v = vistaIncontro(h, inc);
  assert.match(testo(v), /Vi incontrate! Avete fino al domenica 22 novembre per vedervi\./);
  bottone(v, TESTI_INCONTRO.proponi).a.onclick();
  v = vistaIncontro(h, inc);
  assert.ok(tutti(v, (x) => x.tag === "select").length >= 2, "giorno e ora");
  const campo = tutti(v, (x) => x.tag === "input")[0];
  assert.equal(campo.a.maxlength, 80);
  assert.match(testo(v), /Scegliete sempre un posto pubblico e frequentato\./);
  assert.ok(bottone(v, TESTI_INCONTRO.invia));
  assert.equal(vistaIncontro(h, creaIncontro({ token: async () => "tok", fetch: f })), null, "non aperta → null");
});
