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

// Cambio da «Il mio profilo» (spec v1.3): vale dalla stanza del lunedì dopo, come il questionario. Stesso calcolo di
// public.prossima_apertura() sul database: le stanze aprono il lunedì alle 9:00 di Roma. Serve solo a scriverlo
// alla persona: la data vera la decide il server (provincia_in_vigore_dal).
const GIORNI = { lun: 0, mar: 1, mer: 2, gio: 3, ven: 4, sab: 5, dom: 6 };
export function lunediCambio(adesso = new Date()) {
  const parti = Object.fromEntries(new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(adesso).map((p) => [p.type, p.value]));
  const giorno = GIORNI[parti.weekday.slice(0, 3).toLowerCase()];
  const avanti = giorno === 0 && Number(parti.hour) < 9 ? 0 : 7 - giorno;
  // Mezzogiorno UTC della data di Roma: aggiungere giorni così non risente del cambio d'ora.
  const d = new Date(Date.UTC(Number(parti.year), Number(parti.month) - 1, Number(parti.day) + avanti, 12));
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function testoCambio(adesso = new Date()) {
  return `Il cambio vale dalla stanza di lunedì ${lunediCambio(adesso)}: quella in corso non cambia. Poi potrai cambiarla di nuovo dopo 7 giorni.`;
}
