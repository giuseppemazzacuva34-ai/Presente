// Parità grafica della schermata 28 «I tuoi regali» (D149, richiesta del coordinatore del 26/11, linea «sviluppatore-b»):
// «Torna al profilo» è il pulsante principale (rosso) in fondo; nome e dettaglio stretti come nel design; nella prova
// i dati finti hanno la stessa forma del server vero (titolo con il punto, «Nome, età», il più recente in alto).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vistaStoricoRegali, creaStoricoRegali } from "../landing/app/moduli/storico_regali.js";
import { creaApiProva } from "../landing/app/moduli/prova_api.js";
import { PERSONE_PROVA } from "../landing/app/moduli/prova.js";
import { vistaStorico } from "../api/storico_regali.js";

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const tutti = (n, pred, out = []) => { if (typeof n === "object") { if (pred(n)) out.push(n); n.f.forEach((x) => tutti(x, pred, out)); } return out; };
const VISTA = { titolo: "Hai ricevuto 17 regali.", totale: { rosa: 12, spumante: 4, fiori: 1 },
  attuale: { citta: "Milano", persone: [{ nome: "Marco, 35", dettaglio: "3 rose · 1 spumante", quando: "oggi" }] }, passate: null };

test("28: «Torna al profilo» è il pulsante principale (classe «bottone»), come nel design v4", () => {
  const b = tutti(vistaStoricoRegali(h, VISTA, { torna: () => {} }), (x) => x.tag === "button");
  assert.equal(b[0].a.classe, "bottone");
});

test("28: nome e dettaglio uno sotto l'altro senza spazio in più (small a blocco)", () => {
  const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
  assert.match(css, /\.app \.storico-regali \.persona small \{[^}]*display: block/);
});

test("prova 28: titolo, nomi con l'età e ordine come li darebbe il server (il più recente in alto)", async () => {
  const r = await creaStoricoRegali({ token: () => "prova", fetch: creaApiProva().fetch }).leggi();
  assert.equal(r.ok, true);
  assert.match(r.vista.titolo, /^Hai ricevuto \d+ regali\.$/);
  const persone = r.vista.attuale.persone;
  assert.equal(persone[0].quando, "oggi");
  for (const p of persone) assert.ok(PERSONE_PROVA.some((x) => p.nome === `${x.nome}, ${x.eta}`), p.nome);
  // Il titolo è quello che scriverebbe il server con gli stessi numeri.
  const server = vistaStorico({ totale: r.vista.totale, passate: { rosa: 0, spumante: 0, fiori: 0, stanze: 0, persone: 0 }, attuale: null });
  assert.equal(r.vista.titolo, server.titolo);
});
