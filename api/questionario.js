// Questionario privato e affinità (Fase 2, issue #2, specifica v1.1 del CPO, D35 A).
// Questo file gira SOLO sul server (Worker «presente-api» e lavori del lunedì): l'affinità non va mai al browser
// e non si mostra a nessun utente. Le risposte si salvano con la versione del questionario («v1»), così le domande
// si potranno cambiare in futuro senza rompere i calcoli.
//
// Formato di un profilo:
//   { versione: "v1",
//     risposte: { 1: [0, 3], 2: 4, 3: 1, ... },   // numero domanda → indice dell'opzione (da 0), elenco per le multiple, 1–5 per la scala
//     importanza: { valori: 3, ritmi: 1, ... } }   // «Quanto conta per te?» poco 1 · abbastanza 2 · molto 3

import { VERSIONE, TEMI as NOMI_TEMI, IMPORTANZA, DOMANDA_IMPORTANZA, DOMANDE, DOMANDE_VOCE, erroreRisposta, questionarioCompleto, primaMancante }
  from "../landing/app/moduli/domande.js";

export { VERSIONE, IMPORTANZA, DOMANDA_IMPORTANZA, DOMANDE, DOMANDE_VOCE, erroreRisposta, questionarioCompleto, primaMancante };

// Pesi di base dei temi (somma 100). Solo server.
const PESI = { valori: 25, ritmi: 10, soldi: 15, famiglia: 20, conflitti: 25, tempo_libero: 5 };
export const TEMI = Object.fromEntries(Object.entries(NOMI_TEMI).map(([id, t]) => [id, { ...t, peso: PESI[id] }]));

// Punteggio di una domanda tra due persone, da 0 a 1 (regole della specifica v1.1).
export function punteggioDomanda(d, a, b) {
  if (d.tipo === "multipla") {
    const sa = new Set(a), sb = new Set(b);
    const unione = new Set([...sa, ...sb]);
    if (unione.size === 0) return 0;
    let comuni = 0;
    for (const v of sa) if (sb.has(v)) comuni++;
    return comuni / unione.size;
  }
  if (a === b) return 1;
  if (d.tipo === "categorica") return 0;
  // Ordinata (un passo di distanza) e scala 1–5 (al massimo 1 punto di distanza): vicine = 0,5.
  return Math.abs(a - b) <= 1 ? 0.5 : 0;
}

// Affinità tra due profili completi, da 0 a 100 (intero).
// Per ogni tema: media dei punteggi delle sue domande × peso del tema × media dei due «quanto conta» ÷ 3.
// La somma si riporta su 0–100 dividendo per il massimo possibile con quegli stessi «quanto conta»:
// così due profili identici fanno sempre 100 e due profili tutti diversi e lontani fanno 0.
// Restituisce null se uno dei due profili non è completo o è di un'altra versione (non entra nel calcolo).
export function affinita(a, b) {
  if (!questionarioCompleto(a) || !questionarioCompleto(b)) return null;
  let somma = 0, massimo = 0;
  for (const [tema, { peso }] of Object.entries(TEMI)) {
    const domande = DOMANDE.filter((d) => d.tema === tema);
    const media = domande.reduce((s, d) => s + punteggioDomanda(d, a.risposte[d.n], b.risposte[d.n]), 0) / domande.length;
    const quantoConta = (a.importanza[tema] + b.importanza[tema]) / 2 / 3;
    somma += media * peso * quantoConta;
    massimo += peso * quantoConta;
  }
  return Math.round((somma / massimo) * 100);
}
