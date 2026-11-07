// Aree vaste (issue #3, spec v1.2, D121 A) per i calcoli del server. La mappa e i calcoli puri stanno in
// landing/app/moduli/aree.js (una sola copia, la usa anche la web app per i testi): qui si aggiungono solo i conteggi.
// Solo calcoli: nessun database, nessun dato personale.

import { areaDi } from "../landing/app/moduli/aree.js";

export { ACCENSIONE, AREE, areaDi, accesa, mancano, testoContatore, testoZona, etichettaRaggio } from "../landing/app/moduli/aree.js";

// Profili completi → { codiceArea: { totale, donne } }. Solo numeri: è ciò che possono vedere i contatori della plancia.
// profili: [{ provincia, presento }]. Estero e senza provincia non contano in nessuna area.
export function conteggiPerArea(profili) {
  const conto = {};
  for (const p of profili || []) {
    const a = areaDi(p.provincia);
    if (!a) continue;
    const c = (conto[a.codice] ||= { totale: 0, donne: 0 });
    c.totale++;
    if (p.presento === "donna") c.donne++;
  }
  return conto;
}
