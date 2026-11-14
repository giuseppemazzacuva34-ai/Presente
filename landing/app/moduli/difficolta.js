// «Sono in difficoltà» nella web app (issue #7, spec v1.1 definitiva, punto 6 e casi limite; passo 7a della linea
// «sviluppatore-b»). In alto il 112 (apre il telefono, funziona anche senza rete); sotto «Avvisa Presente», che crea
// una segnalazione con priorità 1 ora e avvisa subito il responsabile della sicurezza (lo fa il database:
// nuova_segnalazione + coda degli avvisi, migrazioni 20261113145000 e 20261113195500).
// La persona è facoltativa: «Riguarda una persona di Presente?» propone solo le persone passate dall'esterno
// (stanza, porta, appuntamento); mai un id come nome. Nessuna posizione, nessun salvataggio sul telefono.
// L'invio usa creaSegnala (segnala.js): il corpo non dice mai chi avvisa, lo dice il token.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEI_ORE = 6 * 60 * 60 * 1000;
const MOTIVO = "sono_in_difficolta";

export function schermataDifficolta(persone) {
  const elenco = (Array.isArray(persone) ? persone : [])
    .filter((p) => p && UUID.test(String(p.id || "")))
    .map((p) => [p.id, typeof p.nome === "string" && p.nome.trim() ? p.nome.trim() : "Una persona della stanza"]);
  return {
    titolo: "Se sei in pericolo, chiama il 112",
    chiama: "Chiama il 112",
    telefono: "tel:112",
    avvisa: "Avvisa Presente",
    domanda: elenco.length ? "Riguarda una persona di Presente?" : null,
    persone: elenco.length ? [["", "No, nessuna in particolare"], ...elenco] : null,
    fisso: "Presente non è un servizio di emergenza e non vede dove sei.",
    consigli: ["Vai dove ci sono altre persone.", "Parla con il personale del locale."],
  };
}

// scelte = { contro } (facoltativo) → { ok, corpo } | { ok: false, errore }
export function corpoDifficolta(scelte = {}) {
  const contro = scelte && scelte.contro ? String(scelte.contro) : null;
  if (contro !== null && !UUID.test(contro)) {
    return { ok: false, errore: "Non riusciamo a collegare questa persona. Invia senza sceglierla o chiama il 112." };
  }
  // Il blocco resta una scelta del modulo «Segnala»: qui conta solo avvisare subito.
  return { ok: true, corpo: { contro, motivo: MOTIVO, origine: MOTIVO, testo: "", blocca: false } };
}

export function confermaDifficolta() {
  return {
    testo: "Abbiamo avvisato Presente. Una persona la leggerà entro 1 ora.",
    pericolo: "Se sei in pericolo ora, chiama il 112.",
    telefono: "tel:112",
  };
}

// Pulsante in evidenza nel giorno dell'appuntamento: dal check-in «Sono qui» (#6) a 6 ore dopo l'orario fissato.
// Nel menu dell'app resta sempre disponibile.
export function inEvidenza(appuntamento, adesso = new Date()) {
  if (!appuntamento || !appuntamento.checkinIl) return false;
  const da = Date.parse(appuntamento.checkinIl);
  const a = Date.parse(appuntamento.orario) + SEI_ORE;
  const ora = adesso instanceof Date ? adesso.getTime() : Date.parse(adesso);
  if (!Number.isFinite(da) || !Number.isFinite(a) || !Number.isFinite(ora)) return false;
  return ora >= da && ora <= a;
}
