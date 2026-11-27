// Difetto trovato dal Coordinatore nella prova finta (D141 A), ma presente anche nell'app vera: sotto «● Registra»
// (passi 6 e 7 dell'iscrizione) compariva la parola «null». Causa: Element.append(null) aggiunge il testo "null";
// il registratore passava `cond ? errore : null` direttamente a box.append. Nessun dato reale, nessuna rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
const registratore = flusso.slice(flusso.indexOf("const box = h(\"div\", { classe: \"registratore"), flusso.indexOf("function casellaFoto"));

test("registratore: nessun box.append diretto (append(null) scrive «null» sullo schermo)", () => {
  assert.ok(registratore.length > 100, "blocco del registratore trovato");
  assert.doesNotMatch(registratore, /box\.append\(/);
  assert.match(registratore, /aggiungi\(box,/);
});

test("aggiungi: salta null, undefined e false come fa h()", () => {
  const corpo = flusso.slice(flusso.indexOf("function aggiungi("), flusso.indexOf("function aggiungi(") + 300);
  assert.match(corpo, /function aggiungi\(el, \.\.\.figli\)/);
  // Eseguo la funzione vera su un elemento finto: solo i figli veri arrivano ad append.
  const sorgente = corpo.slice(0, corpo.indexOf("\n}\n") + 2);
  const aggiungi = new Function(`${sorgente}; return aggiungi;`)();
  const ricevuti = [];
  aggiungi({ append: (...f) => ricevuti.push(...f) }, "a", null, undefined, false, "b");
  assert.deepEqual(ricevuti, ["a", "b"]);
});
