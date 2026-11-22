// Schermata delle 4 domande della valutazione (issue #6, spec v1 del CPO del 3/11, «Valutazione (D20)»; passo 3f,
// linea «sviluppatore-b»). Una domanda per schermata, risposta obbligatoria, «Non ora» salta tutto (la domanda resta
// aperta: lo dice il server con l'azione «valuta»). Al server vanno solo le 4 risposte; mai un voto, mai l'aspetto.
// h finto, rete finta, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_VALUTAZIONE, domandeValutazione, creaValutazione, vistaValutazione, testoErroreValutazione }
  from "../landing/app/moduli/valutazione.js";
import { VALUTAZIONE, controllaRisposte } from "../api/valutazione.js";
import { schermataIncontro, vistaIncontro, creaIncontro } from "../landing/app/moduli/incontro.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
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
  const d = domandeValutazione("Marta");
  assert.equal(d.length, 4);
  assert.equal(d[0].testo, "Marta si è presentata/o?");
  assert.deepEqual(d[0].risposte.map(([, t]) => t), ["Sì", "Sì, ma in ritardo", "No"]);
  assert.equal(d[1].testo, "Le foto erano davvero sue?");
  assert.deepEqual(d[1].risposte.map(([, t]) => t), ["Sì", "Non ne sono sicura/o", "No"]);
  assert.equal(d[2].testo, "Era come in chiamata?");
  assert.deepEqual(d[2].risposte.map(([, t]) => t), ["Sì", "Più o meno", "No"]);
  assert.equal(d[3].testo, "Ti sei sentita/o al sicuro?");
  assert.deepEqual(d[3].risposte.map(([, t]) => t), ["Sì", "No"]);
  assert.equal(TESTI_VALUTAZIONE.titolo, "Com'è andata? Tutto bene?");
  assert.equal(TESTI_VALUTAZIONE.nonOra, "Non ora");
  assert.equal(TESTI_VALUTAZIONE.racconta, "Vuoi raccontarci cosa è successo?");
});

test("senza nome si usa «L'altra persona»; la domanda sulla sicurezza dice che resta privata", () => {
  assert.equal(domandeValutazione(null)[0].testo, "L'altra persona si è presentata/o?");
  assert.equal(domandeValutazione("  ")[0].testo, "L'altra persona si è presentata/o?");
  assert.ok(domandeValutazione("Marta")[3].nota.includes("Marta non la vedrà mai"));
});

test("valori uguali a api/valutazione.js: ogni combinazione di risposte è accettata dal server", () => {
  const d = domandeValutazione("Marta");
  for (let i = 0; i < 3; i++) {
    assert.equal(d[i].id, VALUTAZIONE.domande[i].id);
    assert.deepEqual(d[i].risposte.map(([v]) => v), VALUTAZIONE.domande[i].risposte);
  }
  assert.equal(d[3].id, "sicuro");
  assert.deepEqual(d[3].risposte.map(([v]) => v), [true, false]);
  for (const a of d[0].risposte) for (const b of d[1].risposte) for (const c of d[2].risposte) for (const s of d[3].risposte) {
    assert.equal(controllaRisposte({ presentato: a[0], foto_sue: b[0], come_in_chiamata: c[0], sicuro: s[0] }).ok, true);
  }
});

test("una domanda alla volta: si va avanti solo rispondendo, si può tornare indietro", async () => {
  const { f, chiamate } = rete([]);
  const v = creaValutazione({ token: () => "t", fetch: f });
  v.apri(PORTA, { nome: "Marta" });
  assert.equal(v.modello().passo, 0);
  assert.equal(await v.rispondi("forse"), false, "risposta fuori lista ignorata");
  assert.equal(v.modello().passo, 0);
  await v.rispondi("in_ritardo");
  assert.equal(v.modello().passo, 1);
  v.indietro();
  assert.equal(v.modello().passo, 0);
  assert.equal(v.modello().risposte.presentato, "in_ritardo", "la risposta data resta");
  await v.rispondi("si");
  await v.rispondi("non_sicuro");
  await v.rispondi("piu_o_meno");
  assert.equal(v.modello().passo, 3);
  assert.equal(chiamate.length, 0, "niente al server prima dell'ultima risposta");
});

test("all'ultima risposta si manda tutto insieme, solo le 4 risposte e la porta", async () => {
  const { f, chiamate } = rete([{ dati: { ok: true, esito: "grazie" } }]);
  let fatto = null;
  const v = creaValutazione({ token: () => "tok", fetch: f, finito: (e) => { fatto = e; } });
  v.apri(PORTA, { nome: "Marta" });
  for (const r of ["si", "si", "si", true]) await v.rispondi(r);
  assert.equal(chiamate.length, 1);
  assert.equal(chiamate[0].url, "/app/api/incontro");
  assert.equal(chiamate[0].metodo, "POST");
  assert.equal(chiamate[0].auth, "Bearer tok");
  assert.deepEqual(chiamate[0].corpo, { azione: "valuta", porta: PORTA, presentato: "si", foto_sue: "si", come_in_chiamata: "si", sicuro: true });
  assert.equal(v.modello().esito, "grazie");
  assert.equal(fatto, "grazie");
  const vista = vistaValutazione(h, v);
  assert.ok(testo(vista).includes(TESTI_VALUTAZIONE.grazie));
  assert.ok(!testo(vista).includes("Marta"), "dopo l'invio nessun riepilogo sull'altra persona");
});

test("con «No» alla sicurezza: «Vuoi raccontarci cosa è successo?» e il pulsante per raccontare", async () => {
  const { f } = rete([{ dati: { ok: true, esito: "racconta" } }]);
  const v = creaValutazione({ token: () => "t", fetch: f });
  v.apri(PORTA, { nome: "Marta" });
  for (const r of ["si", "no", "no", false]) await v.rispondi(r);
  assert.equal(v.modello().esito, "racconta");
  const vista = vistaValutazione(h, v);
  assert.ok(testo(vista).includes(TESTI_VALUTAZIONE.racconta));
  assert.ok(testo(vista).includes(TESTI_VALUTAZIONE.giaAvvisati.replace("<nome>", "Marta")), "si dice che il controllo è già partito");
  assert.ok(tutti(vista, (x) => x.tag === "a" && x.a.href === "tel:112").length === 1, "112 a portata di dito");
  assert.ok(bottone(vista, TESTI_VALUTAZIONE.nonOra), "si può anche non raccontare");
  assert.equal(tutti(vista, (x) => x.tag === "textarea").length, 0, "la casella si apre solo con «Sì, racconto»");
  bottone(vista, TESTI_VALUTAZIONE.raccontaSi).a.onclick();
  assert.deepEqual(v.modello().racconto, { testo: "", inviato: false });
});

// Passo 3g-3i: «Sì, racconto» apre la casella qui; il racconto va nella segnalazione da 1 ora già partita.
async function finoAlRacconto(risposte = []) {
  const r = rete([{ dati: { ok: true, esito: "racconta" } }, ...risposte]);
  let fatto = null;
  const v = creaValutazione({ token: () => "t", fetch: r.f, finito: (e) => { fatto = e; } });
  v.apri(PORTA, { nome: "Marta" });
  for (const x of ["si", "si", "si", false]) await v.rispondi(x);
  v.apriRacconto();
  return { v, ...r, fatto: () => fatto };
}

test("racconto: casella da 1000 caratteri con etichetta, «Manda» e «Non ora»", async () => {
  const { v } = await finoAlRacconto();
  const vista = vistaValutazione(h, v);
  const [casella] = tutti(vista, (x) => x.tag === "textarea");
  assert.equal(casella.a.maxlength, "1000");
  assert.ok(tutti(vista, (x) => x.tag === "label" && x.a.for === casella.a.id).length === 1, "la casella ha la sua etichetta");
  casella.a.oninput({ target: { value: "Mi ha seguita." } });
  assert.equal(v.modello().racconto.testo, "Mi ha seguita.");
  assert.ok(bottone(vista, TESTI_VALUTAZIONE.manda));
  assert.ok(bottone(vista, TESTI_VALUTAZIONE.nonOra));
});

test("racconto vuoto: nessuna richiesta, si chiede di scrivere", async () => {
  const { v, chiamate } = await finoAlRacconto();
  v.scriviRacconto("   ");
  assert.equal(await v.mandaRacconto(), false);
  assert.equal(chiamate.length, 1, "solo la valutazione");
  assert.equal(v.modello().errore, TESTI_VALUTAZIONE.scriviQualcosa);
});

test("racconto: una sola richiesta con azione, porta e testo, poi il grazie", async () => {
  const { v, chiamate } = await finoAlRacconto([{ dati: { ok: true, esito: "raccontato" } }]);
  v.scriviRacconto("x".repeat(1200));
  assert.equal([...v.modello().racconto.testo].length, 1000, "mai oltre 1000 caratteri");
  v.scriviRacconto("Mi ha seguita fino a casa.");
  assert.equal(await v.mandaRacconto(), true);
  assert.equal(chiamate.length, 2);
  assert.deepEqual(chiamate[1].corpo, { azione: "racconta", porta: PORTA, testo: "Mi ha seguita fino a casa." });
  assert.equal(chiamate[1].auth, "Bearer t");
  assert.equal(v.modello().racconto.inviato, true);
  const vista = vistaValutazione(h, v);
  assert.ok(testo(vista).includes(TESTI_VALUTAZIONE.raccontoRicevuto));
  assert.equal(tutti(vista, (x) => x.tag === "textarea").length, 0);
  assert.ok(bottone(vista, TESTI_VALUTAZIONE.chiudi));
  assert.ok(!bottone(vista, TESTI_VALUTAZIONE.raccontaSi));
});

test("racconto: senza rete il testo resta per riprovare; già ricevuto vale come mandato", async () => {
  const { v } = await finoAlRacconto([new Error("rete"), { dati: { ok: false, motivo: "gia_raccontato" } }]);
  v.scriviRacconto("Mi ha seguita.");
  assert.equal(await v.mandaRacconto(), false);
  assert.equal(v.modello().errore, testoErroreValutazione("rete"));
  assert.equal(v.modello().racconto.testo, "Mi ha seguita.");
  assert.equal(await v.mandaRacconto(), true);
  assert.equal(v.modello().racconto.inviato, true);
});

test("racconto: segnalazione già letta → si dice di usare «Segnala un problema», la casella si chiude", async () => {
  const { v } = await finoAlRacconto([{ dati: { ok: false, motivo: "nessuna_segnalazione" } }]);
  v.scriviRacconto("Mi ha seguita.");
  assert.equal(await v.mandaRacconto(), false);
  assert.equal(v.modello().errore, testoErroreValutazione("nessuna_segnalazione"));
  assert.equal(v.modello().racconto, null);
  assert.ok(!bottone(vistaValutazione(h, v), TESTI_VALUTAZIONE.raccontaSi), "non si riapre");
});

test("«Non ora» chiude senza mandare nulla", async () => {
  const { f, chiamate } = rete([]);
  let fatto = null;
  const v = creaValutazione({ token: () => "t", fetch: f, finito: (e) => { fatto = e; } });
  v.apri(PORTA, { nome: "Marta" });
  await v.rispondi("si");
  bottone(vistaValutazione(h, v), TESTI_VALUTAZIONE.nonOra).a.onclick();
  assert.equal(chiamate.length, 0);
  assert.equal(v.modello().porta, null);
  assert.equal(vistaValutazione(h, v), null);
  assert.equal(fatto, "non_ora");
});

test("errori: rete e già fatta, senza perdere le risposte quando si può riprovare", async () => {
  const { f } = rete([new Error("rete"), { status: 409, dati: { ok: false, motivo: "gia_fatta" } }]);
  const v = creaValutazione({ token: () => "t", fetch: f });
  v.apri(PORTA);
  for (const r of ["si", "si", "si", true]) await v.rispondi(r);
  assert.equal(v.modello().errore, testoErroreValutazione("rete"));
  assert.equal(v.modello().passo, 3, "resta sull'ultima domanda per riprovare");
  await v.rispondi(true);
  assert.equal(v.modello().errore, testoErroreValutazione("gia_fatta"));
  assert.equal(v.modello().esito, "chiusa");
  assert.equal(testoErroreValutazione("chiusa"), "Il tempo per rispondere è finito.");
  assert.equal(testoErroreValutazione("boh"), "Non è andata. Riprova tra poco.");
});

test("porta non valida: niente schermata e niente richieste", async () => {
  const { f, chiamate } = rete([]);
  const v = creaValutazione({ token: () => "t", fetch: f });
  v.apri("non-un-id");
  assert.equal(v.modello().porta, null);
  assert.equal(await v.rispondi("si"), false);
  assert.equal(chiamate.length, 0);
});

test("la vista: titolo, una domanda con le sue risposte come pulsanti, «Non ora», niente stelle né voti", () => {
  const v = creaValutazione({ token: () => "t", fetch: rete([]).f });
  v.apri(PORTA, { nome: "Marta" });
  const vista = vistaValutazione(h, v);
  assert.equal(vista.tag, "section");
  assert.ok(testo(vista).includes(TESTI_VALUTAZIONE.titolo));
  assert.ok(testo(vista).includes("Marta si è presentata/o?"));
  assert.ok(testo(vista).includes("1 di 4"));
  for (const t of ["Sì", "Sì, ma in ritardo", "No", "Non ora"]) assert.ok(bottone(vista, t), t);
  assert.ok(!bottone(vista, TESTI_VALUTAZIONE.indietro), "niente «Indietro» sulla prima domanda");
  assert.doesNotMatch(JSON.stringify(vista), /stell|voto|★|bell[oa]|aspetto/i);
});

test("schermata dell'incontro: dopo l'incontro avvenuto, con «valuta» c'è «Com'è andata?»", () => {
  const i = { stato: "concluso", esito: "avvenuto", azioni: ["valuta"], segnale: "mela", scadenza: null };
  assert.deepEqual(schermataIncontro(i).azioni, ["valuta"]);
  assert.deepEqual(schermataIncontro({ ...i, azioni: [] }).azioni, []);
  const inc = creaIncontro({ token: () => "t", fetch: rete([]).f });
  inc.modello = () => ({ porta: PORTA, incontro: i, carica: false, inCorso: false, errore: null, proposta: false, conferma: null, nome: "Marta", bozza: {} });
  let aperta = 0;
  const vista = vistaIncontro(h, inc, { valuta: () => { aperta++; } });
  bottone(vista, TESTI_VALUTAZIONE.apri).a.onclick();
  assert.equal(aperta, 1);
  assert.ok(!bottone(vistaIncontro(h, inc), TESTI_VALUTAZIONE.apri), "senza chi apre la valutazione, nessun pulsante");
});
