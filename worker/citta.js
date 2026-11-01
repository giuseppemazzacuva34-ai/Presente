// Città scritta a mano nel modulo della lista d'attesa (decisione D64, punto 1).
// Il campo si chiama ancora «zona» (stesso nome dal 26/10, così l'informativa e i controlli non cambiano):
// la persona scrive la sua città, il telefono suggerisce i nomi dell'elenco <datalist> della pagina (niente script),
// e qui il Worker la riporta a una delle zone che usiamo per contare e per aprire le stanze.
// Non raccoglie dati nuovi: è la stessa città di prima, solo scritta invece che scelta.

// Zone con una stanza di città già prevista (stesso elenco di prima).
export const ZONE = new Set([
  "milano", "roma", "napoli", "torino", "bologna", "firenze", "genova", "venezia-padova", "verona",
  "brescia-bergamo", "bari", "palermo", "catania", "cagliari", "altra-citta-italia", "estero",
]);

// Nome da mostrare per ogni zona.
export const NOMI_ZONE = {
  milano: "Milano", roma: "Roma", napoli: "Napoli", torino: "Torino", bologna: "Bologna", firenze: "Firenze",
  genova: "Genova", "venezia-padova": "Venezia e Padova", verona: "Verona", "brescia-bergamo": "Brescia e Bergamo",
  bari: "Bari", palermo: "Palermo", catania: "Catania", cagliari: "Cagliari",
};

// Modi diversi di scrivere la stessa zona: sigle di provincia, nomi stranieri, frazioni comuni.
const SINONIMI = {
  mi: "milano", milan: "milano", mailand: "milano", "milano citta": "milano",
  rm: "roma", rome: "roma", "roma capitale": "roma",
  na: "napoli", naples: "napoli", neapel: "napoli",
  to: "torino", turin: "torino",
  bo: "bologna",
  fi: "firenze", florence: "firenze",
  ge: "genova", genoa: "genova",
  ve: "venezia-padova", venezia: "venezia-padova", venice: "venezia-padova", mestre: "venezia-padova",
  pd: "venezia-padova", padova: "venezia-padova", padua: "venezia-padova", "venezia padova": "venezia-padova", "venezia e padova": "venezia-padova",
  vr: "verona",
  bs: "brescia-bergamo", brescia: "brescia-bergamo", bg: "brescia-bergamo", bergamo: "brescia-bergamo",
  "brescia bergamo": "brescia-bergamo", "brescia e bergamo": "brescia-bergamo",
  ba: "bari", pa: "palermo", ct: "catania", ca: "cagliari",
  estero: "estero", "fuori dall italia": "estero", "fuori italia": "estero", "all estero": "estero",
  "altra citta italia": "altra-citta-italia", "un altra citta italiana": "altra-citta-italia",
};

// Toglie accenti, maiuscole e segni: «Forlì», «FORLI'» e « forli » diventano tutti «forli».
export function semplifica(valore) {
  return String(valore || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`´.\-_/,]+/g, " ")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
}

// Restituisce { zona, citta } oppure null se il testo non contiene una città.
// citta è valorizzata solo per «altra-citta-italia»: la città semplificata (es. «reggio emilia»), per contarla a parte.
export function normalizzaCitta(valore) {
  const grezzo = String(valore || "").trim();
  if (ZONE.has(grezzo)) return { zona: grezzo, citta: null }; // valori del vecchio menu (pagine rimaste in cache)
  const s = semplifica(grezzo);
  if (s.length < 2) return null;
  const zona = SINONIMI[s] || (ZONE.has(s) ? s : null);
  if (zona) return { zona, citta: null };
  if (s.length < 3) return null; // sigle sconosciute: meglio chiedere di scrivere la città per intero
  return { zona: "altra-citta-italia", citta: s };
}

// Chiave con cui si conta una città: la zona, oppure la città scritta per le «altre città italiane».
export function chiaveCitta(zona, citta) {
  if (zona === "altra-citta-italia" && citta) return citta;
  return zona;
}

// Nome leggibile da una chiave: «reggio emilia» → «Reggio Emilia».
export function nomeCitta(chiave) {
  if (NOMI_ZONE[chiave]) return NOMI_ZONE[chiave];
  if (!chiave || chiave === "altra-citta-italia" || chiave === "estero") return "";
  return chiave
    .replace(/(^|\s)([a-z])/g, (_, spazio, lettera) => spazio + lettera.toUpperCase())
    .replace(/(^|\s)(L|D) (?=[A-Z])/g, "$1$2'"); // «l aquila» → «L'Aquila»
}

// Iscritti per città (solo totali): { chiave: n }. Le righe con zona «altra-citta-italia» senza città restano lì.
export async function perCitta(env) {
  if (!env.DB) return {};
  const conta = (righe) => {
    const totali = {};
    for (const r of righe.results || []) {
      if (r.zona === "non-indicata") continue; // passo 2 non ancora fatto (D79 A): fuori da contatori e classifiche
      const k = chiaveCitta(r.zona, r.citta);
      totali[k] = (totali[k] || 0) + (r.n || 0);
    }
    return totali;
  };
  try {
    return conta(await env.DB.prepare("SELECT zona, citta, COUNT(*) AS n FROM iscrizioni GROUP BY zona, citta").all());
  } catch {
    try {
      // Database senza la colonna citta (prima della prima iscrizione con città scritta).
      return conta(await env.DB.prepare("SELECT zona, COUNT(*) AS n FROM iscrizioni GROUP BY zona").all());
    } catch {
      return {};
    }
  }
}
