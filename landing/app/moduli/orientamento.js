// Orientamento facoltativo nella schermata 05 «Chi sei» (issue #471, spec v1 del CPO, parte A; richiesta di Giuseppe
// del 25/11). Più scelte possibili; «Preferisco non dirlo» toglie le altre e viceversa. Non è mai obbligatorio.
// Finché Giuseppe non decide D155 l'etichetta NON si salva: resta nella memoria della pagina e serve solo a
// precompilare «Voglio incontrare» nella 06 (l'utente può sempre cambiarlo). Nessuno la vede, mai nei log o fuori dal telefono.

import { VOGLIO_INCONTRARE, toccaCerco, cercoComeElenco } from "./voglio_incontrare.js";
export { VOGLIO_INCONTRARE, toccaCerco, cercoComeElenco };

export const ORIENTAMENTI = Object.freeze([
  ["etero", "Eterosessuale"], ["gay", "Gay"], ["lesbica", "Lesbica"], ["bisessuale", "Bisessuale"],
  ["pansessuale", "Pansessuale"], ["queer", "Queer"], ["descrivo", "Preferisco descrivermi"], ["non_dirlo", "Preferisco non dirlo"],
]);

export const TESTI_ORIENTAMENTO = Object.freeze({
  etichetta: "Il mio orientamento · facoltativo",
  nota: "Nessuno lo vede. Ci aiuta a proporti la stanza giusta.",
  descrivo: "Come descrivi il tuo orientamento",
});

const CERCHI = VOGLIO_INCONTRARE.map(([v]) => v);

const VALORI = new Set(ORIENTAMENTI.map(([v]) => v));

// Tocco su una scelta: la aggiunge o la toglie; «non_dirlo» esclude tutte le altre.
export function toccaOrientamento(scelti, valore) {
  const ora = Array.isArray(scelti) ? scelti.filter((v) => VALORI.has(v)) : [];
  if (!VALORI.has(valore)) return ora;
  if (ora.includes(valore)) return ora.filter((v) => v !== valore);
  if (valore === "non_dirlo") return ["non_dirlo"];
  return [...ora.filter((v) => v !== "non_dirlo"), valore];
}

// Tabella della spec #471: precompila «Voglio incontrare»; [] = niente precompilato.
// Bisessuale, pansessuale o queer (anche insieme ad altre scelte) → tutte e tre. Altri casi o scelte in contrasto → niente.
const AMPIE = new Set(["bisessuale", "pansessuale", "queer"]);
export function cercoDaOrientamento(presento, scelti) {
  const s = Array.isArray(scelti) ? scelti.filter((v) => VALORI.has(v)) : [];
  if (s.some((v) => AMPIE.has(v))) return [...CERCHI];
  if (s.length !== 1) return [];
  const [o] = s;
  if (presento === "uomo") return o === "etero" ? ["donne"] : o === "gay" ? ["uomini"] : [];
  if (presento === "donna") return o === "etero" ? ["uomini"] : o === "lesbica" ? ["donne"] : [];
  return [];
}
