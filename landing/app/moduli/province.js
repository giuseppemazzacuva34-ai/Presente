// Province per il passo 5 «Chi sei» dell'app (#2, specifica v1.3 del CPO, D84 A).
// Stesso elenco e stesso ordine del menu del sito (worker/province.js › opzioniMenu): un test li confronta.
// Qui ci sono solo sigla e nome: la regione la scrive il server, mai il telefono.

export const ESTERO = "EE";

// [sigla, nome] in ordine alfabetico, «Vivo all'estero» in fondo.
export const MENU_PROVINCE = [
  ["AG", "Agrigento"], ["AL", "Alessandria"], ["AN", "Ancona"], ["AO", "Aosta"], ["AR", "Arezzo"],
  ["AP", "Ascoli Piceno"], ["AT", "Asti"], ["AV", "Avellino"], ["BA", "Bari"], ["BT", "Barletta-Andria-Trani"],
  ["BL", "Belluno"], ["BN", "Benevento"], ["BG", "Bergamo"], ["BI", "Biella"], ["BO", "Bologna"], ["BZ", "Bolzano"],
  ["BS", "Brescia"], ["BR", "Brindisi"], ["CA", "Cagliari"], ["CL", "Caltanissetta"], ["CB", "Campobasso"],
  ["CE", "Caserta"], ["CT", "Catania"], ["CZ", "Catanzaro"], ["CH", "Chieti"], ["CO", "Como"], ["CS", "Cosenza"],
  ["CR", "Cremona"], ["KR", "Crotone"], ["CN", "Cuneo"], ["EN", "Enna"], ["FM", "Fermo"], ["FE", "Ferrara"],
  ["FI", "Firenze"], ["FG", "Foggia"], ["FC", "Forlì-Cesena"], ["FR", "Frosinone"], ["GE", "Genova"], ["GO", "Gorizia"],
  ["GR", "Grosseto"], ["IM", "Imperia"], ["IS", "Isernia"], ["AQ", "L'Aquila"], ["SP", "La Spezia"], ["LT", "Latina"],
  ["LE", "Lecce"], ["LC", "Lecco"], ["LI", "Livorno"], ["LO", "Lodi"], ["LU", "Lucca"], ["MC", "Macerata"],
  ["MN", "Mantova"], ["MS", "Massa-Carrara"], ["MT", "Matera"], ["ME", "Messina"], ["MI", "Milano"], ["MO", "Modena"],
  ["MB", "Monza e Brianza"], ["NA", "Napoli"], ["NO", "Novara"], ["NU", "Nuoro"], ["OR", "Oristano"], ["PD", "Padova"],
  ["PA", "Palermo"], ["PR", "Parma"], ["PV", "Pavia"], ["PG", "Perugia"], ["PU", "Pesaro e Urbino"], ["PE", "Pescara"],
  ["PC", "Piacenza"], ["PI", "Pisa"], ["PT", "Pistoia"], ["PN", "Pordenone"], ["PZ", "Potenza"], ["PO", "Prato"],
  ["RG", "Ragusa"], ["RA", "Ravenna"], ["RC", "Reggio Calabria"], ["RE", "Reggio Emilia"], ["RI", "Rieti"],
  ["RN", "Rimini"], ["RM", "Roma"], ["RO", "Rovigo"], ["SA", "Salerno"], ["SS", "Sassari"], ["SV", "Savona"],
  ["SI", "Siena"], ["SR", "Siracusa"], ["SO", "Sondrio"], ["SU", "Sud Sardegna"], ["TA", "Taranto"], ["TE", "Teramo"],
  ["TR", "Terni"], ["TO", "Torino"], ["TP", "Trapani"], ["TN", "Trento"], ["TV", "Treviso"], ["TS", "Trieste"],
  ["UD", "Udine"], ["VA", "Varese"], ["VE", "Venezia"], ["VB", "Verbano-Cusio-Ossola"], ["VC", "Vercelli"],
  ["VR", "Verona"], ["VV", "Vibo Valentia"], ["VI", "Vicenza"], ["VT", "Viterbo"],
  [ESTERO, "Vivo all'estero"],
];

const PER_SIGLA = new Map(MENU_PROVINCE);
// Per confrontare quello che si scrive: minuscole, senza accenti, trattini e apostrofi come spazi.
const semplice = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[-'’]/g, " ").replace(/\s+/g, " ").trim();
const PER_NOME = new Map(MENU_PROVINCE.map(([s, n]) => [semplice(n), s]));

// Testo scritto (o scelto dai suggerimenti) → sigla, solo se è esattamente il nome di una provincia.
export function cercaProvincia(testo) {
  return PER_NOME.get(semplice(testo)) || null;
}

// Province con una parola che inizia con il testo («Mil» → Milano, «Bria» → Monza e Brianza). Vuoto = nessun risultato.
export function suggerimenti(testo) {
  const t = semplice(testo);
  if (!t) return MENU_PROVINCE;
  return MENU_PROVINCE.filter(([, n]) => { const x = semplice(n); return x.startsWith(t) || x.includes(" " + t); });
}

export const nomeMenu = (sigla) => PER_SIGLA.get(sigla) || "";

// Ciò che vedono gli altri: il nome della provincia, «Dall'estero» per chi vive fuori. Mai la sigla.
export function nomeVisibile(sigla) {
  if (sigla === ESTERO) return "Dall'estero";
  return PER_SIGLA.get(sigla) || "";
}
