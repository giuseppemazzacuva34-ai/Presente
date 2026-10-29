// Questionario privato e affinità (Fase 2, issue #2, specifica v1.1 del CPO, D35 A).
// Questo file gira SOLO sul server (Worker «presente-api» e lavori del lunedì): l'affinità non va mai al browser
// e non si mostra a nessun utente. Le risposte si salvano con la versione del questionario («v1»), così le domande
// si potranno cambiare in futuro senza rompere i calcoli.
//
// Formato di un profilo:
//   { versione: "v1",
//     risposte: { 1: [0, 3], 2: 4, 3: 1, ... },   // numero domanda → indice dell'opzione (da 0), elenco per le multiple, 1–5 per la scala
//     importanza: { valori: 3, ritmi: 1, ... } }   // «Quanto conta per te?» poco 1 · abbastanza 2 · molto 3

export const VERSIONE = "v1";

// Pesi di base dei temi (somma 100).
export const TEMI = {
  valori: { nome: "Valori", peso: 25 },
  ritmi: { nome: "Ritmi", peso: 10 },
  soldi: { nome: "Soldi", peso: 15 },
  famiglia: { nome: "Famiglia", peso: 20 },
  conflitti: { nome: "Conflitti", peso: 25 },
  tempo_libero: { nome: "Tempo libero", peso: 5 },
};

export const IMPORTANZA = ["Poco", "Abbastanza", "Molto"]; // valori 1, 2, 3
export const DOMANDA_IMPORTANZA = "Quanto conta per te?";

// Tipi: "multipla" (min–max scelte), "scala" (1–5), "ordinata" (opzioni in ordine), "categorica" (opzioni senza ordine).
export const DOMANDE = [
  { n: 1, tema: "valori", tipo: "multipla", min: 2, max: 2, testo: "Nella vita metti al primo posto… (scegli 2)",
    opzioni: ["Famiglia", "Lavoro e carriera", "Libertà e viaggi", "Amici", "Crescita personale", "Stabilità e sicurezza", "Impegno per gli altri"] },
  { n: 2, tema: "valori", tipo: "scala", min: 1, max: 5, testo: "In coppia ognuno deve avere spazi tutti suoi",
    estremi: ["Per niente d'accordo", "Del tutto d'accordo"] },
  { n: 3, tema: "valori", tipo: "ordinata", testo: "Quanto contano per te le tradizioni di famiglia (feste, pranzi, abitudini)?",
    opzioni: ["Poco", "Abbastanza", "Molto"] },
  { n: 4, tema: "ritmi", tipo: "ordinata", testo: "Sei più del mattino o della sera?",
    opzioni: ["Mattino", "Né l'uno né l'altro", "Sera"] },
  { n: 5, tema: "ritmi", tipo: "ordinata", testo: "Il tuo weekend ideale",
    opzioni: ["Casa e calma", "Un po' e un po'", "Sempre fuori"] },
  { n: 6, tema: "soldi", tipo: "ordinata", testo: "Con i soldi sei…",
    opzioni: ["Prima risparmio", "Equilibrio", "Me li godo"] },
  { n: 7, tema: "soldi", tipo: "categorica", testo: "In coppia le spese si dividono…",
    opzioni: ["A metà", "In proporzione a quanto si guadagna", "Cassa comune"] },
  { n: 8, tema: "famiglia", tipo: "ordinata", testo: "Quanto spesso vorresti vedere la tua famiglia d'origine?",
    opzioni: ["Ogni settimana", "Ogni mese", "Ogni tanto"] },
  { n: 9, tema: "famiglia", tipo: "ordinata", testo: "Tra cinque anni ti vedi…",
    opzioni: ["Nella mia città", "Pronto/a a trasferirmi in Italia", "Mi piacerebbe vivere all'estero"] },
  { n: 10, tema: "famiglia", tipo: "categorica", testo: "I lavori di casa…",
    opzioni: ["Tutto alla pari", "Ognuno fa ciò che gli riesce meglio", "Ne parliamo volta per volta"] },
  { n: 11, tema: "conflitti", tipo: "ordinata", testo: "Quando c'è un problema preferisci…",
    opzioni: ["Parlarne subito", "Prima calmarmi, poi parlarne", "Lasciar correre"] },
  { n: 12, tema: "conflitti", tipo: "categorica", testo: "Dopo una discussione ti serve…",
    opzioni: ["Chiarire a parole", "Un gesto d'affetto", "Un po' di tempo da solo/a"] },
  { n: 13, tema: "conflitti", tipo: "multipla", min: 2, max: 2, testo: "Come mostri che tieni a qualcuno? (scegli 2)",
    opzioni: ["Parole", "Attenzioni e gesti", "Tempo insieme", "Contatto", "Piccoli regali"] },
  { n: 14, tema: "tempo_libero", tipo: "categorica", testo: "Con gli amici sei…",
    opzioni: ["Pochi amici stretti", "Grande compagnia", "Dipende"] },
  { n: 15, tema: "tempo_libero", tipo: "multipla", min: 1, max: 3, testo: "Cosa ti piacerebbe fare insieme? (fino a 3)",
    opzioni: ["Sport", "Cucina", "Viaggi", "Cinema, libri, mostre", "Musica e concerti", "Natura", "Serate fuori", "Giochi"] },
];

const PER_NUMERO = new Map(DOMANDE.map((d) => [d.n, d]));

// Controlla una singola risposta. Restituisce null se va bene, altrimenti il motivo (in italiano, per l'interfaccia).
export function erroreRisposta(n, valore) {
  const d = PER_NUMERO.get(Number(n));
  if (!d) return "Domanda inesistente.";
  if (d.tipo === "multipla") {
    if (!Array.isArray(valore)) return "Scegli dall'elenco.";
    const diverse = new Set(valore);
    if (diverse.size !== valore.length) return "Ogni voce si sceglie una volta sola.";
    if (!valore.every((v) => Number.isInteger(v) && v >= 0 && v < d.opzioni.length)) return "Scegli dall'elenco.";
    if (valore.length < d.min || valore.length > d.max) {
      return d.min === d.max ? `Scegli esattamente ${d.min} voci.` : `Scegli da ${d.min} a ${d.max} voci.`;
    }
    return null;
  }
  if (d.tipo === "scala") {
    return Number.isInteger(valore) && valore >= d.min && valore <= d.max ? null : `Scegli un valore da ${d.min} a ${d.max}.`;
  }
  return Number.isInteger(valore) && valore >= 0 && valore < d.opzioni.length ? null : "Scegli una risposta.";
}

// Il questionario è completo con 15 risposte valide e i 6 «quanto conta» (1–3), nella versione attuale.
export function questionarioCompleto(profilo) {
  if (!profilo || profilo.versione !== VERSIONE) return false;
  const risposte = profilo.risposte || {};
  const importanza = profilo.importanza || {};
  return DOMANDE.every((d) => erroreRisposta(d.n, risposte[d.n]) === null)
    && Object.keys(TEMI).every((t) => [1, 2, 3].includes(importanza[t]));
}

// Prima domanda ancora senza risposta valida (per riprendere da dove si era lasciato), o null se sono tutte fatte.
export function primaMancante(profilo) {
  const risposte = (profilo && profilo.risposte) || {};
  const d = DOMANDE.find((x) => erroreRisposta(x.n, risposte[x.n]) !== null);
  return d ? d.n : null;
}

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
