// Elenco ufficiale delle 10 Regole della community (issue #7, spec v1.2 del CPO, 20/11; titoli approvati con D9 A).
// Linea «sviluppatore-b», passo 15a. Una sola copia: la usano pannello, Worker e messaggio a chi è sanzionato.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGOLE_COMMUNITY, ID_REGOLE, testoRegola, regolaProposta } from "../landing/app/moduli/regole_community.js";
import { MOTIVI } from "../api/segnalazioni.js";

test("le 10 regole, con id e titoli della spec v1.2, in ordine", () => {
  assert.deepEqual(REGOLE_COMMUNITY.map((r) => [...r]), [
    ["maggiorenne", "Sei maggiorenne e sei tu"],
    ["rispetto", "Rispetto, sempre"],
    ["consenso", "Consenso prima di tutto"],
    ["presenza", "Presente vuol dire presente"],
    ["al_buio", "Al Buio resta al buio"],
    ["affari", "Niente affari"],
    ["inganni", "Niente inganni"],
    ["locale", "Il locale è casa d'altri"],
    ["sicurezza", "La sicurezza non si negozia"],
    ["segnala", "Segnala, non vendicarti"],
  ]);
  assert.deepEqual([...ID_REGOLE], REGOLE_COMMUNITY.map(([id]) => id));
  assert.ok(Object.isFrozen(REGOLE_COMMUNITY) && REGOLE_COMMUNITY.every(Object.isFrozen));
});

test("niente voce «Altre regole»", () => {
  assert.ok(!REGOLE_COMMUNITY.some(([, t]) => /altre regole/i.test(t)));
});

test("testo della regola dall'id; vecchie righe scritte a mano restano leggibili", () => {
  assert.equal(testoRegola("al_buio"), "Al Buio resta al buio");
  assert.equal(testoRegola("sicurezza"), "La sicurezza non si negozia");
  assert.equal(testoRegola("  Rispetto  "), "Rispetto");
  assert.equal(testoRegola(null), "");
  assert.equal(testoRegola(""), "");
  assert.equal(testoRegola(42), "");
});

test("regola proposta per ogni motivo (solo un suggerimento; «Altro» si sceglie a mano)", () => {
  const attese = {
    contatti_prima_porta: "al_buio",
    insulti: "rispetto",
    contenuti_sessuali: "consenso",
    minacce_pericolo: "sicurezza",
    sembra_minorenne: "maggiorenne",
    profilo_falso: "maggiorenne",
    soldi: "affari",
    diffusione_immagini: "al_buio",
    altro: "",
    sono_in_difficolta: "sicurezza",
    non_al_sicuro: "sicurezza",
  };
  assert.deepEqual(Object.keys(attese).sort(), Object.keys(MOTIVI).sort());
  for (const [motivo, id] of Object.entries(attese)) assert.equal(regolaProposta(motivo), id, motivo);
  assert.equal(regolaProposta("inventato"), "");
  assert.equal(regolaProposta(undefined), "");
});

test("l'app senza rete trova il modulo (lo importa il messaggio della sanzione)", async () => {
  const { readFileSync } = await import("node:fs");
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"/app/moduli/regole_community.js"'));
});
