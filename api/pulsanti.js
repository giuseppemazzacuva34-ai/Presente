// Chiamate solo voce (issue #4, spec v1.3 § 2, passo 3c-5b-2a): il testo sul pulsante «Chiama» di ogni persona della
// stanza, prima del tocco. Stesse regole di puoChiamare() (api/chiamate.js), una persona alla volta, con dati letti
// una volta sola per tutta la stanza (datiPerPulsanti, 6 letture) e le linee del Centralino.
// Al telefono va solo { id, testo } per chi ha il pulsante spento con uno dei testi della spec; tutti gli altri
// restano «Chiama» e decide il tocco (apriChiamata). Motivi senza testo (sospesi, blocchi, stanza chiusa) non danno
// mai una riga: l'altra persona non deve scoprire una sospensione o un blocco (#7 spec v1.1).
// Nulla di rete qui: tutto arriva da `d` (il Worker passa i pezzi veri, i test quelli finti).

import { puoChiamare, chiamateTra, CHIAMATA } from "./chiamate.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NESSUNO = Object.freeze({ fascia: null, pausa: null, soloConPermesso: false });

// d: { stanzaDi(chi, adesso), datiPerPulsanti({ stanza, chi }) → { ok, membri, chiamate, blocchi, profili: Map,
//      permessi: Set (chi ha dato il permesso a «per»), sospesi: Set }, centralino(idStanza) → { linea(id) } }
export async function pulsantiStanza({ per, adesso }, d) {
  if (!UUID.test(per || "")) return { ok: false, motivo: "dati" };
  const stanza = await d.stanzaDi(per, adesso);
  if (!stanza) return { ok: true, pulsanti: [], chiamate: [] };
  const dati = await d.datiPerPulsanti({ stanza, chi: per });
  if (!dati || !dati.ok) return { ok: false, motivo: "riprova" };

  const centralino = d.centralino(stanza.id);
  const altri = dati.membri.filter((id) => id !== per);
  const inChiamata = new Set();
  const linee = await Promise.all(dati.membri.map((id) => centralino.linea(id)));
  dati.membri.forEach((id, i) => { if (linee[i]) inChiamata.add(id); });

  const pulsanti = [];
  for (const verso of altri) {
    const p = dati.profili.get(verso) || NESSUNO;
    const r = puoChiamare({
      chi: per, verso, adesso,
      stanza: { apre: stanza.apre, chiude: stanza.chiude, membri: dati.membri },
      chiamate: dati.chiamate, blocchi: dati.blocchi, inChiamata, fascia: p.fascia, pausa: p.pausa,
      soloConPermesso: p.soloConPermesso, permessi: dati.permessi.has(verso) ? new Set([per]) : new Set(), sospesi: dati.sospesi,
    });
    if (!r.ok && r.testo) pulsanti.push({ id: verso, testo: r.testo });
  }
  // «chiamate N di 3» (#380 passo 6a): solo per chi ha almeno una chiamata con me. Niente righe per sospesi e
  // blocchi (nei due versi), né se sono sospeso io: non si deve scoprire una sospensione o un blocco.
  const chiamate = [];
  const fuori = (id) => dati.sospesi.has(id) || dati.blocchi.some((b) => (b.chi === per && b.bloccato === id) || (b.chi === id && b.bloccato === per));
  if (!dati.sospesi.has(per)) {
    for (const verso of altri) {
      if (fuori(verso)) continue;
      const n = Math.min(CHIAMATA.conStessaPersona, chiamateTra({ chi: per, verso, stanza, chiamate: dati.chiamate }));
      if (n > 0) chiamate.push({ id: verso, n });
    }
  }
  return { ok: true, pulsanti, chiamate };
}
