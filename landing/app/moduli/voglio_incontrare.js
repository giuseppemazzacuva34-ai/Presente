// «Voglio incontrare» nella schermata 06 «Chi cerchi» (issue #471, spec v1 del CPO, parte B): più scelte tra
// Donne · Uomini · Persone non binarie, almeno una. Nel database «cerco» è un elenco (donne, uomini, non_binari);
// il testo di prima «tutti» vale tutte e tre. Nessuno lo vede: serve solo a comporre le stanze.

// «Voglio incontrare» nella 06 (#471 parte B): elenco di valori tra donne · uomini · non_binari, almeno uno.
export const VOGLIO_INCONTRARE = Object.freeze([["donne", "Donne"], ["uomini", "Uomini"], ["non_binari", "Persone non binarie"]]);
const CERCHI = VOGLIO_INCONTRARE.map(([v]) => v);
export function toccaCerco(scelti, valore) {
  const ora = Array.isArray(scelti) ? scelti.filter((v) => CERCHI.includes(v)) : [];
  if (!CERCHI.includes(valore)) return ora;
  return ora.includes(valore) ? ora.filter((v) => v !== valore) : [...ora, valore];
}
// Il testo di prima («donne», «uomini», «tutti») come elenco; null o valori sconosciuti → [].
export function cercoComeElenco(cerco) {
  if (cerco === "tutti") return [...CERCHI];
  const elenco = Array.isArray(cerco) ? cerco : cerco ? [cerco] : [];
  return [...new Set(elenco.flatMap((v) => (v === "tutti" ? CERCHI : CERCHI.includes(v) ? [v] : [])))];
}

