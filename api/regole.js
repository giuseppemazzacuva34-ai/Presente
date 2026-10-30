// Valori delle regole dell'esperimento decisi da Giuseppe (D51 = A, 30/10/2026), in un solo posto.
// Li useranno le issue #5 (chiavi e diario) e #7 (segnalazioni e sicurezza). Cambiarli = nuova decisione di Giuseppe.
// Nessun dato personale qui: solo numeri e scelte.

export const DECISIONE = "D51-A-2026-10-30";

// #5 · Chiavi e diario
export const CHIAVI = Object.freeze({
  perSettimana: 2, // D14
  // Una chiave si può dare solo a chi hai chiamato almeno una volta in quella stanza (spec #5 v1.1:
  // conta una chiamata durata almeno 60 secondi).
  chiamateMinimeConLaPersona: 1,
  secondiMinimiPerChiamataValida: 60,
});

export const DIARIO = Object.freeze({
  // Conservato finché l'utente non lo cancella (o non cancella l'account). Mai letto dagli algoritmi.
  conservazioneGiorni: null,
  cancellabileDallUtente: true,
  usatoDagliAlgoritmi: false,
});

// #7 · Segnalazioni
// Motivi per cui UNA sola segnalazione basta a sospendere subito, in via cautelare, chi è segnalato.
// Nomi dei motivi come nel modulo di segnalazione della spec #7 v1.1.
export const MOTIVI_SOSPENSIONE_IMMEDIATA = Object.freeze(["minacce_pericolo", "sembra_minorenne", "diffusione_immagini"]);

export const SEGNALAZIONI = Object.freeze({
  segnalazioniPerSospensioneCautelare: 1,
  revisioneEntroOre: 48, // una persona controlla sempre
  // Se le 48 ore scadono senza revisione: nuovo avviso all'amministratore ogni 12 ore; la sospensione resta.
  nuovoAvvisoOgniOre: 12,
  // In beta i ricorsi li decide Giuseppe.
  ricorsiDecideInBeta: "giuseppe",
});

// Chiave ammessa solo se c'è stata almeno una chiamata valida (≥ 60 s) con quella persona.
// Accetta l'elenco delle durate in secondi delle chiamate tra i due.
export function chiavePermessa(durateChiamate) {
  if (!Array.isArray(durateChiamate)) return false;
  const valide = durateChiamate.filter((s) => Number.isFinite(s) && s >= CHIAVI.secondiMinimiPerChiamataValida).length;
  return valide >= CHIAVI.chiamateMinimeConLaPersona;
}

// La segnalazione fa scattare subito la sospensione cautelare? (la decisione finale resta a una persona)
export function sospensioneCautelare(motivo, segnalazioniConQuelMotivo = 1) {
  return MOTIVI_SOSPENSIONE_IMMEDIATA.includes(motivo)
    && segnalazioniConQuelMotivo >= SEGNALAZIONI.segnalazioniPerSospensioneCautelare;
}

// Quante ore dopo la scadenza delle 48 ore va mandato il prossimo avviso (0 = non ancora scaduta).
export function prossimoAvviso(sospesoIl, adesso = new Date()) {
  const scadenza = revisioneEntro(sospesoIl).getTime();
  const t = new Date(adesso).getTime();
  if (t < scadenza) return null;
  const passi = Math.floor((t - scadenza) / (SEGNALAZIONI.nuovoAvvisoOgniOre * 3600 * 1000)) + 1;
  return new Date(scadenza + passi * SEGNALAZIONI.nuovoAvvisoOgniOre * 3600 * 1000);
}

// Entro quando una persona deve rivedere la sospensione.
export function revisioneEntro(sospesoIl) {
  return new Date(new Date(sospesoIl).getTime() + SEGNALAZIONI.revisioneEntroOre * 3600 * 1000);
}
