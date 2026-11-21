// Valutazione dopo l'incontro (Fase 2, issue #6, spec v1 del CPO del 3/11, «Valutazione (D20)»; D20 A).
// Tre domande sui fatti più una privata sulla sicurezza, mai sull'aspetto: niente voti né stelle.
// Le singole risposte restano al server; al telefono arrivano solo riepiloghi (passi successivi).
// Questo file gira SOLO sul server e non chiama database o servizi: solo regole su dati già letti.

export const VALUTAZIONE = Object.freeze({
  domande: Object.freeze([
    Object.freeze({ id: "presentato", risposte: Object.freeze(["si", "in_ritardo", "no"]) }), // «<nome> si è presentata/o?»
    Object.freeze({ id: "foto_sue", risposte: Object.freeze(["si", "non_sicuro", "no"]) }), // «Le foto erano davvero sue?»
    Object.freeze({ id: "come_in_chiamata", risposte: Object.freeze(["si", "piu_o_meno", "no"]) }), // «Era come in chiamata?»
  ]),
  giorniAperta: 7, // «Non ora»: resta aperta 7 giorni; alla cieca fino alle due risposte o ai 7 giorni
  bolliniDopo: 3, // bollini sul profilo solo dopo almeno 3 incontri valutati
});

// Controlla le risposte arrivate dal telefono e tiene solo i 4 campi previsti (qualunque altro campo si scarta).
export function controllaRisposte(corpo) {
  if (!corpo || typeof corpo !== "object") return { ok: false, motivo: "risposta_non_valida" };
  const risposte = {};
  for (const d of VALUTAZIONE.domande) {
    if (!d.risposte.includes(corpo[d.id])) return { ok: false, motivo: "risposta_non_valida" };
    risposte[d.id] = corpo[d.id];
  }
  if (typeof corpo.sicuro !== "boolean") return { ok: false, motivo: "risposta_non_valida" };
  risposte.sicuro = corpo.sicuro;
  return { ok: true, risposte };
}
