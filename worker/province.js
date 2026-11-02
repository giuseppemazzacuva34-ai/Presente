// Province italiane per la lista d'attesa (D84 = A, 1/11): al posto della città si chiede la PROVINCIA.
// Tabella fissa sigla → nome e regione (elenco ISTAT delle 107 province e città metropolitane, sigle automobilistiche),
// più «EE» = «Vivo all'estero». Serve per aprire le stanze per provincia, province vicine o regione.
// La stessa tabella la userà l'app (#2: provincia obbligatoria al primo accesso, precompilata dalla lista d'attesa).

export const ESTERO = "EE";

// [sigla, nome, regione]
export const PROVINCE = [
  ["AG", "Agrigento", "Sicilia"], ["AL", "Alessandria", "Piemonte"], ["AN", "Ancona", "Marche"],
  ["AO", "Aosta", "Valle d'Aosta"], ["AP", "Ascoli Piceno", "Marche"], ["AQ", "L'Aquila", "Abruzzo"],
  ["AR", "Arezzo", "Toscana"], ["AT", "Asti", "Piemonte"], ["AV", "Avellino", "Campania"],
  ["BA", "Bari", "Puglia"], ["BG", "Bergamo", "Lombardia"], ["BI", "Biella", "Piemonte"],
  ["BL", "Belluno", "Veneto"], ["BN", "Benevento", "Campania"], ["BO", "Bologna", "Emilia-Romagna"],
  ["BR", "Brindisi", "Puglia"], ["BS", "Brescia", "Lombardia"], ["BT", "Barletta-Andria-Trani", "Puglia"],
  ["BZ", "Bolzano", "Trentino-Alto Adige"], ["CA", "Cagliari", "Sardegna"], ["CB", "Campobasso", "Molise"],
  ["CE", "Caserta", "Campania"], ["CH", "Chieti", "Abruzzo"], ["CL", "Caltanissetta", "Sicilia"],
  ["CN", "Cuneo", "Piemonte"], ["CO", "Como", "Lombardia"], ["CR", "Cremona", "Lombardia"],
  ["CS", "Cosenza", "Calabria"], ["CT", "Catania", "Sicilia"], ["CZ", "Catanzaro", "Calabria"],
  ["EN", "Enna", "Sicilia"], ["FC", "Forlì-Cesena", "Emilia-Romagna"], ["FE", "Ferrara", "Emilia-Romagna"],
  ["FG", "Foggia", "Puglia"], ["FI", "Firenze", "Toscana"], ["FM", "Fermo", "Marche"],
  ["FR", "Frosinone", "Lazio"], ["GE", "Genova", "Liguria"], ["GO", "Gorizia", "Friuli-Venezia Giulia"],
  ["GR", "Grosseto", "Toscana"], ["IM", "Imperia", "Liguria"], ["IS", "Isernia", "Molise"],
  ["KR", "Crotone", "Calabria"], ["LC", "Lecco", "Lombardia"], ["LE", "Lecce", "Puglia"],
  ["LI", "Livorno", "Toscana"], ["LO", "Lodi", "Lombardia"], ["LT", "Latina", "Lazio"],
  ["LU", "Lucca", "Toscana"], ["MB", "Monza e Brianza", "Lombardia"], ["MC", "Macerata", "Marche"],
  ["ME", "Messina", "Sicilia"], ["MI", "Milano", "Lombardia"], ["MN", "Mantova", "Lombardia"],
  ["MO", "Modena", "Emilia-Romagna"], ["MS", "Massa-Carrara", "Toscana"], ["MT", "Matera", "Basilicata"],
  ["NA", "Napoli", "Campania"], ["NO", "Novara", "Piemonte"], ["NU", "Nuoro", "Sardegna"],
  ["OR", "Oristano", "Sardegna"], ["PA", "Palermo", "Sicilia"], ["PC", "Piacenza", "Emilia-Romagna"],
  ["PD", "Padova", "Veneto"], ["PE", "Pescara", "Abruzzo"], ["PG", "Perugia", "Umbria"],
  ["PI", "Pisa", "Toscana"], ["PN", "Pordenone", "Friuli-Venezia Giulia"], ["PO", "Prato", "Toscana"],
  ["PR", "Parma", "Emilia-Romagna"], ["PT", "Pistoia", "Toscana"], ["PU", "Pesaro e Urbino", "Marche"],
  ["PV", "Pavia", "Lombardia"], ["PZ", "Potenza", "Basilicata"], ["RA", "Ravenna", "Emilia-Romagna"],
  ["RC", "Reggio Calabria", "Calabria"], ["RE", "Reggio Emilia", "Emilia-Romagna"], ["RG", "Ragusa", "Sicilia"],
  ["RI", "Rieti", "Lazio"], ["RM", "Roma", "Lazio"], ["RN", "Rimini", "Emilia-Romagna"],
  ["RO", "Rovigo", "Veneto"], ["SA", "Salerno", "Campania"], ["SI", "Siena", "Toscana"],
  ["SO", "Sondrio", "Lombardia"], ["SP", "La Spezia", "Liguria"], ["SR", "Siracusa", "Sicilia"],
  ["SS", "Sassari", "Sardegna"], ["SU", "Sud Sardegna", "Sardegna"], ["SV", "Savona", "Liguria"],
  ["TA", "Taranto", "Puglia"], ["TE", "Teramo", "Abruzzo"], ["TN", "Trento", "Trentino-Alto Adige"],
  ["TO", "Torino", "Piemonte"], ["TP", "Trapani", "Sicilia"], ["TR", "Terni", "Umbria"],
  ["TS", "Trieste", "Friuli-Venezia Giulia"], ["TV", "Treviso", "Veneto"], ["UD", "Udine", "Friuli-Venezia Giulia"],
  ["VA", "Varese", "Lombardia"], ["VB", "Verbano-Cusio-Ossola", "Piemonte"], ["VC", "Vercelli", "Piemonte"],
  ["VE", "Venezia", "Veneto"], ["VI", "Vicenza", "Veneto"], ["VR", "Verona", "Veneto"],
  ["VT", "Viterbo", "Lazio"], ["VV", "Vibo Valentia", "Calabria"],
];

const PER_SIGLA = new Map(PROVINCE.map(([sigla, nome, regione]) => [sigla, { sigla, nome, regione }]));

export const REGIONI = [...new Set(PROVINCE.map((p) => p[2]))].sort((a, b) => a.localeCompare(b, "it"));

// Province con la zona (stanza di città prevista) del modulo di prima: così contatori e frase «mancano N» restano uguali.
const ZONA_DELLA_PROVINCIA = {
  MI: "milano", RM: "roma", NA: "napoli", TO: "torino", BO: "bologna", FI: "firenze", GE: "genova",
  VE: "venezia-padova", PD: "venezia-padova", VR: "verona", BS: "brescia-bergamo", BG: "brescia-bergamo",
  BA: "bari", PA: "palermo", CT: "catania", CA: "cagliari",
};

// Valore del menu → { provincia, regione, zona, citta } oppure null. Solo le sigle dell'elenco (maiuscole) ed «EE».
export function daSigla(valore) {
  const sigla = String(valore || "").trim();
  if (sigla === ESTERO) return { provincia: ESTERO, regione: null, zona: "estero", citta: null };
  const p = PER_SIGLA.get(sigla);
  if (!p) return null;
  const zona = ZONA_DELLA_PROVINCIA[sigla] || "altra-citta-italia";
  // Per le altre province il nome (semplificato) va in «citta», così il contatore per città continua a funzionare.
  const citta = zona === "altra-citta-italia" ? semplificaNome(p.nome) : null;
  return { provincia: sigla, regione: p.regione, zona, citta };
}

export function nomeProvincia(sigla) {
  if (sigla === ESTERO) return "Vivo all'estero";
  return (PER_SIGLA.get(sigla) || {}).nome || "";
}

function semplificaNome(nome) {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['\-]+/g, " ").replace(/\s+/g, " ").trim();
}

// Iscritti già in lista (prima della provincia): la zona o la città scritta → provincia, solo quando è sicuro.
// venezia-padova e brescia-bergamo restano senza provincia (due province insieme) finché la persona non la indica.
const CITTA_A_SIGLA = new Map([
  ...PROVINCE.map(([sigla, nome]) => [semplificaNome(nome), sigla]),
  ["monza", "MB"], ["pesaro", "PU"], ["urbino", "PU"], ["forli", "FC"], ["cesena", "FC"], ["massa", "MS"], ["carrara", "MS"],
  ["barletta", "BT"], ["andria", "BT"], ["trani", "BT"], ["bolzano bozen", "BZ"], ["aosta aoste", "AO"],
]);
export function provinciaDaZona(zona, citta) {
  if (zona === "estero") return ESTERO;
  if (zona === "venezia-padova" || zona === "brescia-bergamo") return null;
  if (zona && zona !== "altra-citta-italia" && zona !== "non-indicata") return CITTA_A_SIGLA.get(zona) || null;
  if (zona === "altra-citta-italia" && citta) return CITTA_A_SIGLA.get(semplificaNome(citta)) || null;
  return null;
}

// Risposta scritta o scelta in un altro modulo (es. modulo Meta con la provincia): sigla, nome o «estero» → sigla.
export function siglaDaTesto(valore) {
  const v = String(valore || "").trim();
  if (/^[A-Z]{2}$/.test(v) && (v === ESTERO || PER_SIGLA.has(v))) return v;
  const s = semplificaNome(v).replace(/^(provincia|citta metropolitana) di /, "");
  if (/estero/.test(s)) return ESTERO;
  return CITTA_A_SIGLA.get(s) || null;
}

export function regioneDi(sigla) {
  return (PER_SIGLA.get(sigla) || {}).regione || null;
}

// Le <option> del menu (in ordine alfabetico per nome, «Vivo all'estero» in fondo): generate qui e controllate dal test,
// così il menu della pagina e la tabella non possono andare fuori passo.
export function opzioniMenu() {
  const ordinate = [...PROVINCE].sort((a, b) => a[1].localeCompare(b[1], "it"));
  return ordinate.map(([sigla, nome]) => `<option value="${sigla}">${nome.replace(/'/g, "&#39;")}</option>`)
    .concat(`<option value="${ESTERO}">Vivo all&#39;estero</option>`);
}

// Totali per /conteggio: { per_regione: { Lazio: n, … }, per_provincia: { RM: n, …, altre: n } }. Solo numeri.
// /conteggio è pubblico: una provincia compare con la sua sigla solo da MINIMO_PROVINCIA iscritti in su (stessa soglia
// delle città scritte a mano, MINIMO_CITTA_LIBERA); sotto si somma in «altre». per_regione senza soglia (CFO, 2/11).
export const MINIMO_PROVINCIA = 10;
export async function perProvincia(env) {
  const vuoto = { per_regione: {}, per_provincia: {} };
  if (!env.DB) return vuoto;
  try {
    const righe = await env.DB.prepare("SELECT provincia, COUNT(*) AS n FROM iscrizioni WHERE provincia IS NOT NULL GROUP BY provincia").all();
    const per_provincia = {};
    const per_regione = {};
    for (const r of righe.results || []) {
      if (r.provincia !== ESTERO && !PER_SIGLA.has(r.provincia)) continue;
      const chiave = (r.n || 0) >= MINIMO_PROVINCIA ? r.provincia : "altre";
      per_provincia[chiave] = (per_provincia[chiave] || 0) + (r.n || 0);
      const regione = r.provincia === ESTERO ? "Estero" : regioneDi(r.provincia);
      per_regione[regione] = (per_regione[regione] || 0) + (r.n || 0);
    }
    return { per_regione, per_provincia };
  } catch {
    return vuoto; // colonna non ancora creata
  }
}
