// Dopo la chiamata (Fase 2, issue #4 spec v1.3 § 3 del CPO, collegata a #5 e #7): passo 3c-4a.
// Questo file gira SOLO sul server e fa solo calcoli: nessun database, nessun servizio esterno.
// La risposta a «La richiameresti?» la legge solo il server (suggerimenti, #3) e si cancella alla chiusura della stanza
// (migrazione 20261113220000_richiameresti.sql). Non la vedono mai l'altra persona, il pannello delle segnalazioni (#7)
// né gli algoritmi del diario (che non esiste per gli algoritmi).

import { CHIAMATA } from "./chiamate.js";

export const RISPOSTE = Object.freeze(["si", "no", "salta"]);

export const TESTI_DOPO = Object.freeze({
  domanda: "La richiameresti?",
  risposte: Object.freeze({ si: "Sì", no: "No", salta: "Salta" }),
  breve: "La chiamata è durata poco e non conta nei limiti.",
  segnala: "Segnala un problema",
  torna: "Torna alla stanza",
});

export const notaSegreta = (nome) =>
  `Resta tra te e Presente. ${String(nome || "").trim() || "L'altra persona"} non lo saprà mai.`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const durataValida = (d) => Number.isInteger(d) && d >= 0 && d <= CHIAMATA.durataMassima;

// Cosa mostrare quando la chiamata è finita. «passi» in ordine; «fine» = link «Segnala un problema» + «Torna alla stanza».
// Il diario (#5 passo 2) è un passo a sé: finché #5 non c'è, l'app lo salta.
export function schermataDopo(chiamata) {
  const { esito, durata } = chiamata || {};
  if (esito === "chiudi_e_segnala") return { tipo: "segnala", passi: ["segnala"], origine: "chiudi_e_segnala", segnala: true, testo: null };
  const valida = durataValida(durata);
  if (valida && durata >= CHIAMATA.minimoPerContare && (esito === "tempo_scaduto" || esito === "chiusa")) {
    return { tipo: "richiameresti", passi: ["richiameresti", "diario", "fine"], segnala: true, testo: null };
  }
  // Sotto i 60 secondi: il testo della spec. Caduta lunga senza rientro: niente testo «durata poco» (sarebbe falso).
  const breve = valida && durata < CHIAMATA.minimoPerContare;
  return { tipo: "breve", passi: ["fine"], segnala: true, testo: breve ? TESTI_DOPO.breve : null };
}

// Corpo della richiesta «La richiameresti?»: la chiamata si riconosce da chi l'ha aperta e dall'istante di inizio
// (chiave del registro). Nient'altro: niente nomi, niente testo libero. Restituisce null se qualcosa non va.
export function leggiRisposta(corpo) {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return null;
  const chiavi = Object.keys(corpo).sort().join(",");
  if (chiavi !== "chi,inizio,risposta") return null;
  const { chi, inizio, risposta } = corpo;
  if (!UUID.test(chi || "") || !RISPOSTE.includes(risposta)) return null;
  if (typeof inizio !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(inizio)) return null;
  const t = new Date(inizio);
  if (Number.isNaN(t.getTime())) return null;
  return { chi, inizio: t.toISOString(), risposta };
}
