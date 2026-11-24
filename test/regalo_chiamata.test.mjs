// Tasto «Regalo» durante la chiamata (issue #349, design v4 schermata 27 «Regali in chiamata», linea «sviluppatore-b»).
// Il foglio è quello della scheda (regali.js) con inChiamata: true; il server ricontrolla tutto (manda_regalo).
// Tutto finto: niente rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vistaRegaloChiamata, ID_REGALO_CHIAMATA } from "../landing/app/moduli/regalo_chiamata.js";
import { creaRegaliStanza } from "../landing/app/moduli/regali_stanza.js";
import { creaTelefono } from "../landing/app/moduli/telefono.js";

const LEI = "11111111-2222-4333-8444-555555555555";
const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const aspetta = () => new Promise((r) => setTimeout(r, 0));
const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("in chiamata: pulsante «Regalo» con nome per il lettore di schermo; apre il foglio in modalità chiamata", () => {
  const aperti = [];
  const rs = { apriFoglio: (...a) => aperti.push(a) };
  const b = vistaRegaloChiamata(h, rs, { a: LEI, nome: "Sara" });
  assert.equal(b.tag, "button");
  assert.equal(b.a.id, ID_REGALO_CHIAMATA);
  assert.equal(b.a["aria-label"], "Manda un regalo a Sara");
  assert.equal(b.a["aria-haspopup"], "dialog");
  assert.equal(b.f.join(""), "Regalo");
  b.a.onclick();
  assert.deepEqual(aperti, [[LEI, "Sara", { inChiamata: true, ritorno: ID_REGALO_CHIAMATA }]]);
});

test("in chiamata: senza regali collegati o senza l'altra persona nessun pulsante; nome vuoto → «questa persona»", () => {
  assert.equal(vistaRegaloChiamata(h, null, { a: LEI, nome: "Sara" }), null);
  assert.equal(vistaRegaloChiamata(h, { apriFoglio() {} }, { a: null, nome: "Sara" }), null);
  const b = vistaRegaloChiamata(h, { apriFoglio() {} }, { a: LEI, nome: " " });
  assert.equal(b.a["aria-label"], "Manda un regalo a questa persona");
});

test("apriFoglio in chiamata: il foglio riceve inChiamata true e alla chiusura il fuoco torna sul tasto «Regalo»", async () => {
  const fuochi = [];
  const contenitore = { ownerDocument: { getElementById: (id) => ({ focus: () => fuochi.push(id) }) } };
  const ricevuti = [];
  const regali = { async avvisi() { return { ok: true, saldo: 40 }; } };
  const rs = creaRegaliStanza({ regali, contenitore, apri: (_c, o) => ricevuti.push(o) });
  await rs.apriFoglio(LEI, "Sara", { inChiamata: true, ritorno: ID_REGALO_CHIAMATA });
  assert.equal(ricevuti[0].inChiamata, true);
  assert.equal(ricevuti[0].saldo, 40);
  ricevuti[0].alChiudi();
  assert.deepEqual(fuochi, [ID_REGALO_CHIAMATA]);
  // Dalla scheda resta tutto come prima.
  await rs.apriFoglio(LEI, "Sara");
  assert.equal(ricevuti[1].inChiamata, false);
  ricevuti[1].alChiudi();
  assert.deepEqual(fuochi, [ID_REGALO_CHIAMATA, `regalo-${LEI}`]);
});

test("telefono: durante la chiamata il modello dà l'id dell'altra persona; fuori dalla chiamata null", async () => {
  const t = creaTelefono({
    compagni: { leggi: async () => ({ ok: true, persone: [{ id: LEI, nome: "Sara", eta: 31, citta: "Roma" }] }) },
    linea: {}, chiamata: { dopo: async () => ({ ok: true, dopo: null }) }, voce: { muto: () => {}, chiudi: () => {} },
  });
  await t.caricaPersone();
  assert.equal(t.modello().inCorsoCon, null);
  t.aggiorna({ ok: true, vista: { fase: "in_corso", io: "chiama", altra: LEI, restanti: 500, ascolto: "fatto", altraPersona: "collegata" } });
  await aspetta();
  assert.equal(t.modello().inCorsoCon, LEI);
  t.aggiorna({ ok: true, vista: { fase: "finita", altra: LEI } });
  await aspetta();
  assert.equal(t.modello().inCorsoCon, null);
});

test("flusso: il tasto «Regalo» sta tra le azioni della chiamata in corso, subito dopo le Carte", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  const blocco = flusso.slice(flusso.indexOf('sc.tipo === "in_corso"'), flusso.indexOf('sc.tipo === "richiameresti"'));
  const carte = blocco.indexOf("chiamata-carte");
  const regalo = blocco.indexOf("vistaRegaloChiamata(h, regaliStanza, { a: m.inCorsoCon, nome: m.nome })");
  const chiudi = blocco.indexOf('bottone("Chiudi", () => t.chiudi(false))');
  assert.ok(carte > 0 && regalo > carte && chiudi > regalo, "ordine: Carte, Regalo, Chiudi");
});

test("service worker: versione nuova dopo la modifica di flusso.js", () => {
  assert.ok(!leggi("../landing/app/sw.js").includes('"presente-app-48"'));
});
