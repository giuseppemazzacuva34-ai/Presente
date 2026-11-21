// «Disdici» e «Annulla l'incontro» nella schermata «Il vostro incontro» (issue #6, spec v1.1 del CPO del 20/11, punto 2).
// Passo 2r della linea «sviluppatore-b». Azioni e disdetta arrivano dallo stato (passi 2p e 2q); qui solo cosa si
// mostra, le conferme e cosa si manda. h finto, rete finta, orologio fisso, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTI_INCONTRO, schermataIncontro, testoErroreIncontro, creaIncontro, vistaIncontro } from "../landing/app/moduli/incontro.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORARIO = "2026-11-24T19:30:00Z"; // martedì 24 novembre, 20:30 di Roma
const SCADENZA = "2026-11-29T20:00:00Z"; // domenica 29 novembre
const PRIMA = new Date("2026-11-22T10:00:00Z"); // più di 6 ore prima
const TARDI = new Date("2026-11-24T16:00:00Z"); // 3 ore e mezza prima
const base = (extra = {}) => ({ stato: "confermato", scadenza: SCADENZA, orario: ORARIO, locale: null, luogo: "Bar Centrale",
  proposta_mia: false, proposta_scade: null, controproposte_rimaste: 3, azioni: ["disdici"], ritardo_minuti: null, esito: null,
  checkin_mio: false, checkin_altro: false, checkin_da: null, checkin_fino: null, segnale: null, disdetta: null, ...extra });
const daFissare = (extra = {}) => base({ stato: "da_fissare", orario: null, luogo: null, azioni: ["proponi", "annulla_incontro"], ...extra });

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];

function rete(risposte) {
  const chiamate = [];
  const f = async (url, opz) => {
    chiamate.push({ url, metodo: opz.method, corpo: opz.body ? JSON.parse(opz.body) : null });
    const r = risposte.shift();
    return { status: r.status ?? 200, json: async () => r.dati };
  };
  return { f, chiamate };
}
const stato = (i) => ({ dati: { ok: true, incontro: i } });

test("testi della spec v1.1 per «Disdici» e «Annulla l'incontro»", () => {
  assert.equal(TESTI_INCONTRO.disdici, "Disdici");
  assert.equal(TESTI_INCONTRO.confermaDisdici, "Disdici questo appuntamento? Potete fissarne un altro entro il <data>. Se non lo fissate, i crediti tornano a entrambi.");
  assert.equal(TESTI_INCONTRO.disdettoAltro, "<nome> ha disdetto l'appuntamento di <giorno>. Potete fissarne un altro entro il <data>.");
  assert.equal(TESTI_INCONTRO.confermaAnnulla, "Annulli l'incontro? Non potrete più fissarlo. I crediti tornano a entrambi.");
});

test("confermato con «disdici» tra le azioni: c'è il pulsante «Disdici»", () => {
  assert.deepEqual(schermataIncontro(base(), PRIMA).azioni, ["disdici"]);
  const inc = creaIncontro({ token: () => "t", fetch: rete([stato(base())]).f, adesso: () => PRIMA });
  return inc.apri(PORTA).then(() => {
    const v = vistaIncontro(h, inc);
    assert.ok(bottone(v, "Disdici"), "manca «Disdici»");
  });
});

test("«Disdici» in tempo: prima chiede conferma con la data, poi manda { azione: disdici } e rilegge", async () => {
  const dopo = daFissare({ disdetta: { mia: true, il: "2026-11-22T10:00:00Z", orario: ORARIO } });
  const r = rete([stato(base()), { dati: { ok: true, esito: "disdetto" } }, stato(dopo)]);
  const inc = creaIncontro({ token: () => "t", fetch: r.f, adesso: () => PRIMA });
  await inc.apri(PORTA);
  assert.equal(await inc.disdici(), false, "il primo tocco chiede conferma");
  assert.equal(r.chiamate.length, 1);
  const v = vistaIncontro(h, inc);
  assert.match(testo(v), /Disdici questo appuntamento\? Potete fissarne un altro entro il 29 novembre\. Se non lo fissate, i crediti tornano a entrambi\./);
  assert.ok(bottone(v, TESTI_INCONTRO.siDisdici));
  assert.equal(bottone(v, "Disdici"), undefined, "durante la conferma non c'è di nuovo «Disdici»");
  assert.equal(await inc.disdici(), true);
  assert.deepEqual(r.chiamate[1].corpo, { azione: "disdici", porta: PORTA });
  assert.equal(inc.modello().conferma, null);
  assert.equal(inc.modello().incontro.stato, "da_fissare");
});

test("«Disdici» nelle ultime 6 ore: la conferma dice che è come non presentarsi", async () => {
  const inc = creaIncontro({ token: () => "t", fetch: rete([stato(base())]).f, adesso: () => TARDI });
  await inc.apri(PORTA);
  await inc.disdici();
  const t = testo(vistaIncontro(h, inc));
  assert.ok(t.includes(TESTI_INCONTRO.confermaDisdiciTardi));
  assert.ok(!t.includes("Potete fissarne un altro"));
});

test("«No, torna indietro» toglie la conferma senza mandare nulla", async () => {
  const r = rete([stato(base())]);
  const inc = creaIncontro({ token: () => "t", fetch: r.f, adesso: () => PRIMA });
  await inc.apri(PORTA);
  await inc.disdici();
  bottone(vistaIncontro(h, inc), TESTI_INCONTRO.no).a.onclick();
  assert.equal(inc.modello().conferma, null);
  assert.ok(bottone(vistaIncontro(h, inc), "Disdici"));
  assert.equal(r.chiamate.length, 1);
});

test("«Disdici» senza l'azione dal server non manda nulla", async () => {
  const r = rete([stato(base({ azioni: [] }))]);
  const inc = creaIncontro({ token: () => "t", fetch: r.f, adesso: () => PRIMA });
  await inc.apri(PORTA);
  assert.equal(await inc.disdici(), false);
  assert.equal(inc.modello().conferma, null);
  assert.equal(r.chiamate.length, 1);
});

test("«Annulla l'incontro» da «da fissare»: conferma della spec, poi { azione: annulla }", async () => {
  const fine = base({ stato: "concluso", esito: "annullato", azioni: [] });
  const r = rete([stato(daFissare()), { dati: { ok: true, esito: "annullato" } }, stato(fine)]);
  const inc = creaIncontro({ token: () => "t", fetch: r.f, adesso: () => PRIMA });
  await inc.apri(PORTA);
  const v = vistaIncontro(h, inc);
  assert.ok(bottone(v, "Annulla l'incontro"));
  assert.equal(await inc.annullaIncontro(), false);
  assert.ok(testo(vistaIncontro(h, inc)).includes(TESTI_INCONTRO.confermaAnnulla));
  assert.equal(await inc.annullaIncontro(), true);
  assert.deepEqual(r.chiamate[1].corpo, { azione: "annulla", porta: PORTA });
  assert.equal(schermataIncontro(inc.modello().incontro, PRIMA).testo, TESTI_INCONTRO.annullato);
});

test("dopo la disdetta dell'altra persona: «<nome> ha disdetto…» col giorno e la data", async () => {
  const i = daFissare({ disdetta: { mia: false, il: "2026-11-22T10:00:00Z", orario: ORARIO } });
  const inc = creaIncontro({ token: () => "t", fetch: rete([stato(i)]).f, adesso: () => PRIMA });
  await inc.apri(PORTA, { nome: "Giulia" });
  assert.match(testo(vistaIncontro(h, inc)), /Giulia ha disdetto l'appuntamento di martedì 24 novembre\. Potete fissarne un altro entro il 29 novembre\./);
  const senzaNome = schermataIncontro(i, PRIMA);
  assert.equal(senzaNome.disdetta, "L'altra persona ha disdetto l'appuntamento di martedì 24 novembre. Potete fissarne un altro entro il 29 novembre.");
});

test("dopo la mia disdetta: lo dico a me, senza nome", () => {
  const s = schermataIncontro(daFissare({ disdetta: { mia: true, il: null, orario: ORARIO } }), PRIMA);
  assert.equal(s.disdetta, "Hai disdetto l'appuntamento di martedì 24 novembre. Potete fissarne un altro entro il 29 novembre.");
});

test("disdetta di forma strana o senza orario: nessun testo inventato", () => {
  assert.equal(schermataIncontro(daFissare({ disdetta: { mia: false, il: null, orario: null } }), PRIMA).disdetta, null);
  assert.equal(schermataIncontro(daFissare({ disdetta: "x" }), PRIMA).disdetta, null);
  assert.equal(schermataIncontro(base({ disdetta: { mia: false, il: null, orario: ORARIO } }), PRIMA).disdetta, undefined,
    "a incontro di nuovo confermato la vecchia disdetta non si mostra");
});

test("il nome resta solo in memoria e non va mai al server", async () => {
  const r = rete([stato(base()), { dati: { ok: true, esito: "disdetto" } }, stato(daFissare())]);
  const inc = creaIncontro({ token: () => "t", fetch: r.f, adesso: () => PRIMA });
  await inc.apri(PORTA, { nome: "Giulia" });
  await inc.disdici(); await inc.disdici();
  for (const c of r.chiamate) assert.ok(!JSON.stringify(c).includes("Giulia"));
});

test("errori della disdetta con parole giuste", () => {
  assert.equal(testoErroreIncontro("disdici:troppo_tardi"), TESTI_INCONTRO.orarioPassatoDisdici);
  assert.equal(testoErroreIncontro("annulla:gia_confermato"), TESTI_INCONTRO.giaConfermato);
});

test("«Disdici» rifiutato dal server per «troppo_tardi»: rilegge e dice che l'orario è passato", async () => {
  const r = rete([stato(base()), { status: 409, dati: { ok: false, motivo: "troppo_tardi" } }, stato(base({ azioni: [] }))]);
  const inc = creaIncontro({ token: () => "t", fetch: r.f, adesso: () => PRIMA });
  await inc.apri(PORTA);
  await inc.disdici();
  assert.equal(await inc.disdici(), false);
  assert.equal(inc.modello().errore, TESTI_INCONTRO.orarioPassatoDisdici);
  assert.equal(r.chiamate.length, 3);
});

test("il limite delle 6 ore è lo stesso di api/incontro.js (6 h 01 in tempo, 5 h 59 tardi)", async () => {
  const { INCONTRO } = await import("../api/incontro.js");
  const ora = Date.parse(ORARIO);
  for (const [minuti, tardi] of [[INCONTRO.disdettaGratisOre * 60 + 1, false], [INCONTRO.disdettaGratisOre * 60 - 1, true]]) {
    const inc = creaIncontro({ token: () => "t", fetch: rete([stato(base())]).f, adesso: () => new Date(ora - minuti * 60000) });
    await inc.apri(PORTA);
    await inc.disdici();
    assert.equal(testo(vistaIncontro(h, inc)).includes(TESTI_INCONTRO.confermaDisdiciTardi), tardi, `${minuti} minuti prima`);
  }
});
