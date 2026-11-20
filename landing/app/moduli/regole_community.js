// Le 10 Regole della community (issue #7, spec v1.2 del CPO del 20/11; titoli approvati da Giuseppe con D9 A).
// Linea «sviluppatore-b», passo 15a. Una sola copia: la usano il pannello di chi decide, il Worker (controllo della
// regola scelta) e il messaggio a chi riceve una sanzione («Regola violata: <testo>»). Nel database si salva l'id.
// I titoli non si cambiano qui: cambiarli è una decisione di Giuseppe. Nessun dato personale.

export const REGOLE_COMMUNITY = Object.freeze([
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
].map(Object.freeze));

export const ID_REGOLE = Object.freeze(REGOLE_COMMUNITY.map(([id]) => id));
const TESTI = new Map(REGOLE_COMMUNITY);

// Regola proposta per prima dal motivo della segnalazione: è solo un suggerimento, chi decide può cambiarla.
// «Altro» non propone nulla: la regola si sceglie a mano.
const PROPOSTE = Object.freeze({
  contatti_prima_porta: "al_buio",
  insulti: "rispetto",
  contenuti_sessuali: "consenso",
  minacce_pericolo: "sicurezza",
  sembra_minorenne: "maggiorenne",
  profilo_falso: "maggiorenne",
  soldi: "affari",
  diffusione_immagini: "al_buio",
  sono_in_difficolta: "sicurezza",
  non_al_sicuro: "sicurezza",
});

// Testo da mostrare per un id. Una riga vecchia con un testo scritto a mano (prima della v1.2) si mostra com'è.
export function testoRegola(regola) {
  if (typeof regola !== "string") return "";
  const r = regola.trim();
  return TESTI.get(r) || r;
}

export function regolaProposta(motivo) {
  return typeof motivo === "string" && Object.hasOwn(PROPOSTE, motivo) ? PROPOSTE[motivo] : "";
}
