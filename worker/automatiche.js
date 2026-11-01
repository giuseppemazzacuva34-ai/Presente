// Riconosce le richieste che NON sono una persona che apre la pagina: anteprime dei link (Meta, WhatsApp, Telegram...),
// robot dei motori di ricerca, programmi automatici, richieste HEAD e caricamenti anticipati (prefetch).
// Serve solo a non gonfiare i contatori delle visite (D43): lo user agent si legge e si butta, non viene mai salvato.

// Firme dei programmi automatici più comuni. Il browser interno di Instagram e Facebook (FBAN/FBAV, "Instagram")
// NON è in elenco: sono persone vere che hanno cliccato.
const FIRME = /facebookexternalhit|facebot|facebookcatalog|meta-external|bot\b|bot\/|crawl|spider|slurp|preview|whatsapp|telegram|skype|discord|slack|linkedin|pinterest|embedly|vkshare|headless|lighthouse|pagespeed|gtmetrix|curl\/|wget|python|go-http-client|java\/|okhttp|axios|node-fetch|\bnode\b|undici|httpclient|libwww|scrapy|monitor|uptime|checkly/i;

// Intestazioni dei caricamenti anticipati: Chrome e Safari (Sec-Purpose / Purpose: prefetch), Firefox (X-Moz),
// Facebook e Instagram che precaricano le pagine delle inserzioni (X-Purpose: preview).
const ANTICIPATE = ["sec-purpose", "purpose", "x-purpose", "x-moz"];

// Tipo di richiesta: "persona", "precaricata" o "automatica".
// "precaricata" = un telefono vero (non un robot) che carica la pagina in anticipo: è il caso delle inserzioni di Meta,
// che precaricano la landing (X-Purpose: preview) e poi, quando la persona tocca l'inserzione, mostrano la copia già
// scaricata SENZA una seconda richiesta. Per questo le precaricate si contano a parte: non sono sicuramente persone,
// ma per le sponsorizzate sono la stima migliore delle visite vere (dal 30/10, richiesta di growth/coordinatore).
export function tipoRichiesta(request) {
  if (request.method !== "GET") return "automatica";
  const ua = request.headers.get("user-agent") || "";
  if (!ua.trim() || FIRME.test(ua)) return "automatica";
  for (const nome of ANTICIPATE) {
    const valore = (request.headers.get(nome) || "").toLowerCase();
    if (valore.includes("prefetch") || valore.includes("preview") || valore.includes("prerender")) return "precaricata";
  }
  return "persona";
}

// Vero per tutto ciò che non è una persona che apre la pagina adesso (robot, anteprime e precaricamenti).
export function richiestaAutomatica(request) {
  return tipoRichiesta(request) !== "persona";
}
