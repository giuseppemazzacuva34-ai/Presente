// Aree vaste (issue #3, spec v1.2 del CPO del 6/11; decisione D121 A di Giuseppe).
// Una «città» per le stanze è un'AREA: provincia + province vicine della stessa regione entro circa 60 km.
// La mappa è fissa (plancia › progetto/aree-vaste): ogni provincia sta in una sola area; una provincia non elencata è
// un'area da sola, con il nome della provincia. L'utente sceglie solo la provincia: l'area la ricava sempre il server
// da qui (mai dalla richiesta). Cambi della mappa solo con una decisione di Giuseppe, validi dal lunedì dopo.
// Solo calcoli: nessun database, nessun dato personale.

import { PROVINCE, ESTERO } from "../worker/province.js";

// Soglia di accensione (D19 + D121 A): 36 profili completi e almeno il 40% che si presenta come «donna».
// «Non binario» e «mi descrivo» contano nei 36 ma non nel 40%.
export const ACCENSIONE = Object.freeze({ profili: 36, donneSuDieci: 4 });

// Mappa iniziale del CPO (6/11). Ordine delle province = ordine del testo «La tua zona: …».
export const AREE = Object.freeze([
  { codice: "roma", nome: "Roma e dintorni", province: ["RM", "LT"] },
  { codice: "milano", nome: "Milano e dintorni", province: ["MI", "MB", "LO", "PV", "CO", "VA", "LC"] },
  { codice: "brescia-bergamo", nome: "Brescia e Bergamo", province: ["BS", "BG", "CR"] },
  { codice: "torino", nome: "Torino e dintorni", province: ["TO", "AT"] },
  { codice: "napoli", nome: "Napoli e dintorni", province: ["NA", "CE", "SA", "AV", "BN"] },
  { codice: "firenze", nome: "Firenze e dintorni", province: ["FI", "PO", "PT", "SI", "AR"] },
  { codice: "bologna", nome: "Bologna e dintorni", province: ["BO", "MO", "FE"] },
  { codice: "bari", nome: "Bari e dintorni", province: ["BA", "BT"] },
  { codice: "venezia-padova", nome: "Venezia e Padova", province: ["VE", "PD", "TV", "VI", "RO"] },
].map((a) => Object.freeze({ ...a, province: Object.freeze(a.province) })));

const NOME = new Map(PROVINCE.map(([sigla, nome]) => [sigla, nome]));
const AREA_DELLA_PROVINCIA = new Map();
for (const a of AREE) for (const s of a.province) AREA_DELLA_PROVINCIA.set(s, a);

// Sigla → { codice, nome, province } oppure null (estero, vuoto, sigla sconosciuta).
export function areaDi(sigla) {
  if (!sigla || sigla === ESTERO || !NOME.has(sigla)) return null;
  const a = AREA_DELLA_PROVINCIA.get(sigla);
  if (a) return { codice: a.codice, nome: a.nome, province: [...a.province] };
  return { codice: sigla.toLowerCase(), nome: NOME.get(sigla), province: [sigla] };
}

// Calcoli in numeri interi (niente virgola mobile): donne / totale ≥ 4/10 ⇔ donne · 10 ≥ totale · 4.
export function accesa({ totale = 0, donne = 0 } = {}) {
  return totale >= ACCENSIONE.profili && donne * 10 >= totale * ACCENSIONE.donneSuDieci;
}

// Quanti mancano: persone = profili che mancano a 36; donne = il minimo di donne in più che, da sole, accendono l'area
// (quindi donne ≥ persone). Mai negativi.
export function mancano({ totale = 0, donne = 0 } = {}) {
  const persone = Math.max(0, ACCENSIONE.profili - totale);
  let d = 0;
  while (!accesa({ totale: totale + d, donne: donne + d })) d++;
  return { persone, donne: d };
}

// Testo della home quando l'area non è accesa (spec v1.2, «Cosa vede l'utente»); null se l'area è accesa.
// Si mostra il numero più alto tra i due mancanti: se servono più donne che persone, il testo parla di donne.
export function testoContatore(area, conto) {
  if (!area || accesa(conto)) return null;
  const m = mancano(conto);
  if (m.donne > m.persone) {
    const quante = m.donne === 1 ? "Serve ancora 1 donna" : `Servono ancora ${m.donne} donne`;
    return `${area.nome}: ci siete quasi. ${quante} per aprire le stanze. Invita un'amica.`;
  }
  const quanti = m.persone === 1 ? "manca 1 persona" : `mancano ${m.persone} persone`;
  return `${area.nome}: ${quanti} per aprire le stanze della tua zona. Intanto entri nella Stanza Italia.`;
}

// Sotto la provincia nel profilo: «La tua zona: Milano e dintorni (Milano, Monza e Brianza, …)».
export function testoZona(sigla) {
  const a = areaDi(sigla);
  if (!a) return null;
  if (a.province.length === 1) return `La tua zona: ${a.nome}`;
  return `La tua zona: ${a.nome} (${a.province.map((s) => NOME.get(s)).join(", ")})`;
}

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
