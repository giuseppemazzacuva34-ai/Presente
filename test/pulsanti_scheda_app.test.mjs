// Chiamate (issue #4, spec v1.3 § 2, passo 3c-5b-2b-1): il testo sul pulsante «Chiama» nella scheda, prima del tocco.
// La web app legge GET /app/api/chiamata/pulsanti (3c-5b-2a) e mette sul pulsante disattivato UNO dei 6 testi della
// spec; ogni altro testo si ignora (il pulsante resta «Chiama» e decide il server al tocco). Tutto finto: nessuna rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaChiamata, testoMotivo } from "../landing/app/moduli/chiamata.js";
import { schedaCompagno, testoPulsante } from "../landing/app/moduli/compagni.js";
import { creaTelefono } from "../landing/app/moduli/telefono.js";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const P = { id: ID1, nome: "Giulia", eta: 34, citta: "Torino" };

const SEI = [
  "Avete già parlato 3 volte. Ora tocca alle chiavi",
  "Per oggi hai fatto 5 chiamate. A domani",
  "Per oggi non può ricevere altre chiamate. Riprova domani.",
  "È in un'altra chiamata",
  "Disponibile da 19:00",
  "Disponibile domani dalle 9:00",
  "Chiedi di parlare",
];

function finto(rispondi) {
  const chiamate = [];
  const f = async (url, o = {}) => {
    chiamate.push({ url, metodo: o.method || "GET", headers: o.headers || {}, corpo: o.body });
    const [stato, dati] = rispondi();
    if (stato === "rete") throw new TypeError("rete assente");
    return new Response(JSON.stringify(dati), { status: stato });
  };
  return { f, chiamate };
}

test("i testi ammessi sono quelli della spec v1.3 e coincidono con chiamata.js", () => {
  assert.equal(testoMotivo("tre_con_lei"), SEI[0]);
  assert.equal(testoMotivo("cinque_oggi"), SEI[1]);
  assert.equal(testoMotivo("cinque_oggi_lei"), SEI[2]);
  assert.equal(testoMotivo("occupato"), SEI[3]);
  assert.equal(testoMotivo("serve_permesso"), SEI[6]);
  for (const t of SEI) assert.equal(testoPulsante(t), t);
  for (const t of ["", null, 3, "Sospesa", "Disponibile da 25:00", "Disponibile da 19:00 <b>", "Non potete chiamarvi", "La stanza è chiusa"]) {
    assert.equal(testoPulsante(t), "", String(t));
  }
});

test("scheda: senza testo il pulsante è «Chiama»; con un testo è disattivato e lo dice, anche al lettore di schermo", () => {
  assert.deepEqual(schedaCompagno(P), {
    titolo: "Giulia, 34", sottotitolo: "Torino", chiama: true, etichetta: "Chiama", descrizione: "Chiama Giulia, 34",
  });
  for (const t of SEI) {
    const s = schedaCompagno(P, { testo: t });
    assert.equal(s.chiama, false);
    assert.equal(s.etichetta, t);
    assert.equal(s.descrizione, `Giulia, 34: ${t}`);
  }
  const strano = schedaCompagno(P, { testo: "Sospesa fino a lunedì" });
  assert.equal(strano.chiama, true);
  assert.equal(strano.etichetta, "Chiama");
  const occupato = schedaCompagno(P, { inChiamata: true });
  assert.equal(occupato.chiama, false);
  assert.equal(occupato.etichetta, "Chiama");
});

test("pulsanti: GET /app/api/chiamata/pulsanti con il token, senza corpo; tornano solo id validi e testi ammessi", async () => {
  const s = finto(() => [200, { ok: true, pulsanti: [
    { id: ID1, testo: SEI[3] }, { id: "non-un-id", testo: SEI[0] }, { id: ID2, testo: "Sospesa" }, { id: ID1, testo: SEI[0] },
  ] }]);
  const r = await creaChiamata({ token: async () => "tok", fetch: s.f }).pulsanti();
  assert.deepEqual(r, { ok: true, pulsanti: [{ id: ID1, testo: SEI[3] }], chiamate: [] });
  assert.equal(s.chiamate[0].url, "/app/api/chiamata/pulsanti");
  assert.equal(s.chiamate[0].metodo, "GET");
  assert.equal(s.chiamate[0].headers.authorization, "Bearer tok");
  assert.equal(s.chiamate[0].corpo, undefined);
});

test("pulsanti: spento, rete o risposta strana → nessun testo (i pulsanti restano «Chiama»)", async () => {
  for (const [stato, dati, motivo] of [[404, {}, "spento"], ["rete", null, "rete"], [200, { ok: true, pulsanti: "x" }, null], [401, {}, "accesso"]]) {
    const r = await creaChiamata({ token: async () => "tok", fetch: finto(() => [stato, dati]).f }).pulsanti();
    if (motivo) assert.deepEqual(r, { ok: false, motivo });
    else assert.deepEqual(r, { ok: true, pulsanti: [], chiamate: [] });
  }
  const senza = await creaChiamata({ token: async () => null, fetch: () => { throw new Error("nessuna rete"); } }).pulsanti();
  assert.deepEqual(senza, { ok: false, motivo: "accesso" });
});

function telefono(pulsanti) {
  const fatti = [];
  const t = creaTelefono({
    compagni: { leggi: async () => ({ ok: true, persone: [P, { id: ID2, nome: "Marco", eta: 38, citta: "Asti" }] }) },
    linea: { chiama: async (id) => { fatti.push(`chiama:${id}`); return { ok: true, vista: null }; } },
    chiamata: { pulsanti: async () => { fatti.push("pulsanti"); return pulsanti(); } },
    voce: { muto: () => {}, chiudi: () => {} },
  });
  return { t, fatti };
}

test("telefono: dopo le persone legge i testi una volta e li mette sulle schede; il tocco su un pulsante spento non chiama", async () => {
  const a = telefono(() => ({ ok: true, pulsanti: [{ id: ID2, testo: SEI[4] }] }));
  await a.t.caricaPersone();
  await a.t.caricaPersone();
  assert.equal(a.fatti.filter((x) => x === "pulsanti").length, 1);
  const [giulia, marco] = a.t.modello().stanza.persone;
  assert.deepEqual([giulia.chiama, giulia.etichetta], [true, "Chiama"]);
  assert.deepEqual([marco.chiama, marco.etichetta], [false, SEI[4]]);
  await a.t.chiama(ID2);
  assert.ok(!a.fatti.includes(`chiama:${ID2}`));
  await a.t.chiama(ID1);
  assert.ok(a.fatti.includes(`chiama:${ID1}`));
});

test("telefono: se i testi non arrivano la stanza c'è lo stesso, tutti «Chiama»; «Torna alla stanza» li rilegge", async () => {
  let volta = 0;
  const a = telefono(() => (++volta === 1 ? { ok: false, motivo: "rete" } : { ok: true, pulsanti: [{ id: ID1, testo: SEI[2] }] }));
  await a.t.caricaPersone();
  const m = a.t.modello();
  assert.equal(m.stanza.stato, "pronta");
  assert.ok(m.stanza.persone.every((p) => p.chiama && p.etichetta === "Chiama"));
  a.t.torna();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(a.fatti.filter((x) => x === "pulsanti").length, 2);
  assert.equal(a.t.modello().stanza.persone[0].etichetta, SEI[2]);
});

test("telefono senza chiamata.pulsanti (versioni vecchie dei test) funziona come prima", async () => {
  const t = creaTelefono({
    compagni: { leggi: async () => ({ ok: true, persone: [P] }) }, linea: {}, chiamata: {}, voce: { muto: () => {}, chiudi: () => {} },
  });
  await t.caricaPersone();
  assert.equal(t.modello().stanza.persone[0].etichetta, "Chiama");
});
