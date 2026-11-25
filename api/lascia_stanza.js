// «Lascia la stanza» (issue #381, spec v1 del CPO del 23/11, design v4 schermata 22). Linea «sviluppatore-b».
// Testi e controllo del motivo, usati dal Worker (worker/lascia_stanza_api.js) e dall'app. Testi senza genere.
// Il motivo lo legge solo il server (tabella lasciate_stanza): mai le persone della stanza, mai il Filo.
export const MOTIVI_USCITA = Object.freeze([
  { id: "tempo", testo: "Questa settimana non ho tempo" },
  { id: "persone", testo: "Non mi trovo con le persone della stanza" },
  { id: "conosciuto", testo: "Ho conosciuto qualcuno" },
  { id: "app", testo: "Problemi con l'app" },
  { id: "altro", testo: "Altro, lo scrivo io" },
]);

export const TESTI_USCITA = Object.freeze({
  titolo: "Vuoi lasciare la stanza?",
  sotto: "Dicci il motivo. Le persone della stanza vedranno solo che hai lasciato la stanza.",
  // D153 A (finché Giuseppe non decide): i Coin non tornano. Con D153 B cambia solo questa riga.
  coin: "I crediti della stanza non tornano indietro. Le chiavi che hai dato e ricevuto si annullano.",
  resto: "Resto",
  lascia: "Lascia la stanza",
  app: "Se qualcosa non funziona, scrivici dall'Aiuto.",
  inChiamata: "Prima chiudi la chiamata.",
  fatto: "Hai lasciato la stanza. Ti aspettiamo lunedì.",
});

export const TESTO_ALTRO = Object.freeze({ minimo: 3, massimo: 300 });
const CODICI = new Set(MOTIVI_USCITA.map((m) => m.id));

// { motivo, testo } pulito oppure null. Il testo vale solo per «altro» (da 3 a 300 caratteri, spazi ai lati esclusi).
export function uscitaValida(d) {
  if (!d || typeof d !== "object" || Array.isArray(d) || !CODICI.has(d.motivo)) return null;
  if (d.motivo !== "altro") return { motivo: d.motivo, testo: null };
  const t = typeof d.testo === "string" ? d.testo.trim() : "";
  if (t.length < TESTO_ALTRO.minimo || t.length > TESTO_ALTRO.massimo) return null;
  return { motivo: "altro", testo: t };
}
