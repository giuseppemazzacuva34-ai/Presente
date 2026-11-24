// Regalo ricevuto durante la chiamata (issue #349, design v4 schermata 27, linea «sviluppatore-b»).
// Mentre la chiamata è in corso il telefono chiede al server i regali da vedere (GET /app/api/regali → avvisi),
// mostra sopra la chiamata solo quelli dell'altra persona (mostraAvvisoRegalo di regali.js, sparisce da solo)
// e li segna visti. Finita la chiamata smette di chiedere. Tutto finto: niente rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaRegaloRicevuto, OGNI_MS } from "../landing/app/moduli/regalo_ricevuto.js";
import { DURATA_AVVISO_MS } from "../landing/app/moduli/regali.js";

const LEI = "11111111-2222-4333-8444-555555555555";
const ALTRO = "99999999-2222-4333-8444-555555555555";
const ID1 = "aaaaaaaa-2222-4333-8444-555555555555";
const ID2 = "bbbbbbbb-2222-4333-8444-555555555555";
const ID3 = "cccccccc-2222-4333-8444-555555555555";
const aspetta = () => new Promise((r) => setTimeout(r, 0));
const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// Orologio finto: i timer partono solo quando il test li fa scattare.
function orologio() {
  const coda = [];
  return {
    coda,
    setTimeout: (fn, ms) => { const t = { fn, ms, via: false }; coda.push(t); return t; },
    clearTimeout: (t) => { if (t) t.via = true; },
    async scatta(ms) {
      const t = coda.find((x) => !x.via && x.ms === ms);
      assert.ok(t, `nessun timer da ${ms} ms`);
      t.via = true;
      t.fn();
      await aspetta();
      await aspetta();
    },
    attivi: (ms) => coda.filter((x) => !x.via && (ms === undefined || x.ms === ms)).length,
  };
}

function server(risposte) {
  const chieste = [];
  const segnati = [];
  return {
    chieste, segnati,
    async avvisi() { chieste.push(1); return risposte.length ? risposte.shift() : { ok: true, saldo: 10, avvisi: [] }; },
    async visti(ids) { segnati.push(ids); return { ok: true }; },
  };
}

test("in chiamata: il regalo dell'altra persona compare sopra la chiamata e viene segnato visto", async () => {
  const o = orologio();
  const mostrati = [];
  const r = server([{ ok: true, saldo: 10, avvisi: [{ id: ID1, da: LEI, regalo: "rosa", testo: "Sara ti ha mandato una rosa." }] }]);
  const rr = creaRegaloRicevuto({ regali: r, mostra: (a) => mostrati.push(a), orologio: o });
  rr.avvia(() => LEI);
  await aspetta(); await aspetta();
  assert.deepEqual(mostrati, [{ id: ID1, da: LEI, regalo: "rosa", testo: "Sara ti ha mandato una rosa." }]);
  assert.deepEqual(r.segnati, [[ID1]]);
  assert.equal(o.attivi(OGNI_MS), 1, "la prossima domanda al server è già programmata");
});

test("i regali di altre persone della stanza non compaiono in chiamata e restano da vedere", async () => {
  const o = orologio();
  const mostrati = [];
  const r = server([{ ok: true, saldo: 10, avvisi: [{ id: ID1, da: ALTRO, regalo: "rosa", testo: "Luca ti ha mandato una rosa." }] }]);
  const rr = creaRegaloRicevuto({ regali: r, mostra: (a) => mostrati.push(a), orologio: o });
  rr.avvia(() => LEI);
  await aspetta(); await aspetta();
  assert.deepEqual(mostrati, []);
  assert.deepEqual(r.segnati, []);
});

test("due regali insieme: uno alla volta, il secondo quando il primo è sparito", async () => {
  const o = orologio();
  const mostrati = [];
  const r = server([{ ok: true, saldo: 10, avvisi: [
    { id: ID1, da: LEI, regalo: "rosa", testo: "Sara ti ha mandato una rosa." },
    { id: ID2, da: LEI, regalo: "fiori", testo: "Sara ti ha mandato dei fiori." },
  ] }]);
  const rr = creaRegaloRicevuto({ regali: r, mostra: (a) => mostrati.push(a.id), orologio: o });
  rr.avvia(() => LEI);
  await aspetta(); await aspetta();
  assert.deepEqual(mostrati, [ID1]);
  await o.scatta(DURATA_AVVISO_MS + 400);
  assert.deepEqual(mostrati, [ID1, ID2]);
  assert.deepEqual(r.segnati, [[ID1], [ID2]]);
});

test("un regalo già mostrato non ricompare anche se il server non l'ha ancora segnato visto", async () => {
  const o = orologio();
  const mostrati = [];
  const avviso = { id: ID1, da: LEI, regalo: "rosa", testo: "Sara ti ha mandato una rosa." };
  const r = server([{ ok: true, avvisi: [avviso] }, { ok: true, avvisi: [avviso, { id: ID3, da: LEI, regalo: "spumante", testo: "Sara ti ha mandato uno spumante." }] }]);
  r.visti = async () => ({ ok: false, motivo: "riprova" });
  const rr = creaRegaloRicevuto({ regali: r, mostra: (a) => mostrati.push(a.id), orologio: o });
  rr.avvia(() => LEI);
  await aspetta(); await aspetta();
  await o.scatta(DURATA_AVVISO_MS + 400); // il primo avviso è sparito
  await o.scatta(OGNI_MS);
  assert.deepEqual(mostrati, [ID1, ID3]);
});

test("finita la chiamata smette di chiedere; avvia due volte non raddoppia le domande", async () => {
  const o = orologio();
  let con = LEI;
  const r = server([]);
  const rr = creaRegaloRicevuto({ regali: r, mostra: () => {}, orologio: o });
  rr.avvia(() => con);
  rr.avvia(() => con);
  await aspetta(); await aspetta();
  assert.equal(r.chieste.length, 1);
  con = null;
  await o.scatta(OGNI_MS);
  assert.equal(r.chieste.length, 1, "senza chiamata nessuna domanda");
  assert.equal(o.attivi(), 0);
  // Nuova chiamata: riparte.
  con = LEI;
  rr.avvia(() => con);
  await aspetta(); await aspetta();
  assert.equal(r.chieste.length, 2);
});

test("server che non risponde o dati strani: niente avviso, niente errori, si riprova al giro dopo", async () => {
  const o = orologio();
  const mostrati = [];
  const r = server([{ ok: false, motivo: "riprova" }, { ok: true, avvisi: [{ id: "x", da: LEI, regalo: "rosa", testo: "t" },
    { id: ID2, da: LEI, regalo: "anello", testo: "t" }, { id: ID3, da: LEI, regalo: "rosa", testo: "" }, null] }]);
  r.avvisi = (orig => async () => { const x = await orig(); if (r.chieste.length === 3) throw new Error("rete"); return x; })(r.avvisi);
  const rr = creaRegaloRicevuto({ regali: r, mostra: (a) => mostrati.push(a), orologio: o });
  rr.avvia(() => LEI);
  await aspetta(); await aspetta();
  await o.scatta(OGNI_MS);
  await o.scatta(OGNI_MS);
  assert.deepEqual(mostrati, []);
  assert.equal(o.attivi(OGNI_MS), 1);
});

test("una domanda ogni 15 secondi: resta sotto il limite di 10 al minuto del Worker anche mandando regali", () => {
  assert.equal(OGNI_MS, 15000);
});

test("collegamento: flusso.js avvia il controllo nello schermo «in corso», avvio.js lo crea, il service worker lo salva", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /regaloRicevuto\.avvia\(\(\) => telefono && telefono\.modello\(\)\.inCorsoCon\)/);
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /creaRegaloRicevuto\(/);
  assert.match(avvio, /mostraAvvisoRegalo\(/);
  assert.match(leggi("../landing/app/sw.js"), /"\/app\/moduli\/regalo_ricevuto\.js"/);
});

test("il modulo non salva niente in locale e non scrive log", () => {
  const src = leggi("../landing/app/moduli/regalo_ricevuto.js");
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|console\./);
});
