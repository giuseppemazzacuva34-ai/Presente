// Prova finta dell'app (/app/prova.html): le API finte di saldo, regali, Filo e stanza viva (richiesta del coordinatore
// del 25/11, punto 7: la prova deve mostrare anche saldo, profilo, crediti, regali, Filo e stanza viva).
// Le risposte passano dai moduli veri dell'app: se un modulo le scarta, la schermata non compare e il test fallisce.
import test from "node:test";
import assert from "node:assert/strict";
import { creaApiProva, SALDO_PROVA } from "../landing/app/moduli/prova_api.js";
import { PERSONE_PROVA } from "../landing/app/moduli/prova.js";
import { creaCoinServer } from "../landing/app/moduli/saldo_coin.js";
import { creaStoricoRegali } from "../landing/app/moduli/storico_regali.js";
import { creaRegali } from "../landing/app/moduli/regali.js";
import { creaFiloLunedi } from "../landing/app/moduli/filo_lunedi.js";
import { creaFiloDomenica } from "../landing/app/moduli/filo_domenica.js";
import { creaStanzaViva, rigaStato } from "../landing/app/moduli/appuntamenti_stanza.js";

const token = () => "prova";

test("saldo finto: il modulo vero del saldo lo accetta", async () => {
  const api = creaApiProva();
  const r = await creaCoinServer({ token, fetch: api.fetch }).saldo();
  assert.deepEqual(r, { ok: true, saldo: SALDO_PROVA, primaStanzaUsata: false, pagamenti: false });
});

test("regalo mandato: il saldo scende, anche nella testata e nel profilo", async () => {
  const api = creaApiProva();
  const regali = creaRegali({ token, fetch: api.fetch });
  const r = await regali.manda({ a: PERSONE_PROVA[0].id, regalo: "spumante", chiave: "k1" });
  assert.deepEqual(r, { ok: true, saldo: SALDO_PROVA - 10 });
  const s = await creaCoinServer({ token, fetch: api.fetch }).saldo();
  assert.equal(s.saldo, SALDO_PROVA - 10);
  const no = await regali.manda({ a: PERSONE_PROVA[0].id, regalo: "diamante", chiave: "k2" });
  assert.equal(no.ok, false);
  const avvisi = await regali.avvisi();
  assert.equal(avvisi.ok, true);
});

test("regali ricevuti (schermata 28): forma accettata dal modulo vero, con persone finte", async () => {
  const r = await creaStoricoRegali({ token, fetch: creaApiProva().fetch }).leggi();
  assert.equal(r.ok, true);
  assert.ok(r.vista.attuale.persone.length > 0);
  for (const p of r.vista.attuale.persone) assert.ok(PERSONE_PROVA.some((x) => x.nome === p.nome));
});

test("Filo del lunedì (18): benvenuto da vedere una volta, poi segnato visto", async () => {
  const api = creaApiProva();
  const fl = creaFiloLunedi({ token, fetch: api.fetch });
  await fl.prepara();
  assert.equal(fl.modello().benvenuto.visto, false);
  await fl.entra();
  const di = creaFiloLunedi({ token, fetch: api.fetch });
  await di.prepara();
  assert.equal(di.modello().benvenuto, null);
});

test("Filo della domenica (36): numero delle porte aperte", async () => {
  const fd = creaFiloDomenica({ token, fetch: creaApiProva().fetch });
  await fd.prepara();
  const s = fd.modello().schermata;
  assert.ok(s);
  assert.match(s.numero, /^\d+$/);
});

test("stanza viva (19): stati delle persone finte riconosciuti dal modulo vero", async () => {
  const viva = creaStanzaViva({ token, fetch: creaApiProva().fetch });
  const r = await viva.stati();
  assert.equal(r.ok, true);
  assert.equal(r.persone.length, PERSONE_PROVA.length);
  const nomi = new Map(PERSONE_PROVA.map((p) => [p.id, p.nome]));
  const righe = r.persone.map((s) => rigaStato(s, nomi));
  assert.ok(righe.includes("online"));
  assert.ok(righe.some((x) => x.startsWith("in chiamata con ")));
  assert.ok(righe.some((x) => x.startsWith("non in linea")));
  assert.ok(righe.every((x) => x !== ""));
  const a = await viva.appuntamenti();
  assert.equal(a.ok, true);
  assert.deepEqual((await viva.segnale()).ok, true);
});

test("indirizzi sconosciuti: 404, mai una chiamata alla rete vera", async () => {
  const r = await creaApiProva().fetch("/app/api/elimina", { method: "POST" });
  assert.equal(r.status, 404);
});

test("moduliProva: tutti i moduli per le opzioni di flusso.js, senza pagina nessun saldo in testata", async () => {
  const { moduliProva } = await import("../landing/app/moduli/prova_api.js");
  const m = moduliProva({});
  for (const k of ["coinProfilo", "storicoRegali", "filoDomenica", "filoLunedi", "filoRiascolto", "stanzaViva"]) assert.ok(m[k], k);
  assert.equal(m.regali, null);
});
