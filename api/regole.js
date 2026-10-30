// Valori delle regole dell'esperimento decisi da Giuseppe (D51 = A, 30/10/2026), in un solo posto.
// Li useranno le issue #5 (chiavi e diario) e #7 (segnalazioni e sicurezza). Cambiarli = nuova decisione di Giuseppe.
// Nessun dato personale qui: solo numeri e scelte.

export const DECISIONE = "D51-A-2026-10-30";

// #5 · Chiavi e diario
export const CHIAVI = Object.freeze({
  perSettimana: 2, // D14
  // Una chiave si può dare solo a chi hai chiamato almeno una volta in quella stanza.
  chiamateMinimeConLaPersona: 1,
});

export const DIARIO = Object.freeze({
  // Conservato finché l'utente non lo cancella (o non cancella l'account). Mai letto dagli algoritmi.
  conservazioneGiorni: null,
  cancellabileDallUtente: true,
  usatoDagliAlgoritmi: false,
});

// #7 · Segnalazioni
// Motivi per cui UNA sola segnalazione basta a sospendere subito, in via cautelare, chi è segnalato.
export const MOTIVI_SOSPENSIONE_IMMEDIATA = Object.freeze(["minacce", "minori", "immagini_diffuse"]);

export const SEGNALAZIONI = Object.freeze({
  segnalazioniPerSospensioneCautelare: 1,
  revisioneEntroOre: 48, // una persona controlla sempre
  // In beta i ricorsi li decide Giuseppe.
  ricorsiDecideInBeta: "giuseppe",
});

// Chiave ammessa solo se c'è stata almeno una chiamata con quella persona.
export function chiavePermessa(chiamateConLaPersona) {
  return Number.isInteger(chiamateConLaPersona) && chiamateConLaPersona >= CHIAVI.chiamateMinimeConLaPersona;
}

// La segnalazione fa scattare subito la sospensione cautelare? (la decisione finale resta a una persona)
export function sospensioneCautelare(motivo, segnalazioniConQuelMotivo = 1) {
  return MOTIVI_SOSPENSIONE_IMMEDIATA.includes(motivo)
    && segnalazioniConQuelMotivo >= SEGNALAZIONI.segnalazioniPerSospensioneCautelare;
}

// Entro quando una persona deve rivedere la sospensione.
export function revisioneEntro(sospesoIl) {
  return new Date(new Date(sospesoIl).getTime() + SEGNALAZIONI.revisioneEntroOre * 3600 * 1000);
}
