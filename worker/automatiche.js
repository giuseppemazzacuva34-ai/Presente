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

// VISITE VERE DELLA HOME (16/11, richiesta del coordinatore su domanda di Giuseppe, D137): ~65 aperture al giorno di "/"
// con uno user agent da browser ma senza l'immagine 1×1. Qui si riconoscono, solo per le aperture delle pagine contate,
// due segnali che un telefono vero non dà. Si leggono e si buttano: nel database va solo il motivo, mai IP, ASN o user agent.
// 1) «server»: la richiesta parte da un data center (numero di rete ASN di Amazon, Google Cloud, Microsoft, Hetzner,
//    OVH, DigitalOcean...). Le reti che usano anche le persone (iCloud Relay privato su Akamai/Cloudflare/Fastly,
//    Cloudflare WARP) NON sono in elenco.
const ASN_SERVER = new Set([
  16509, 14618, 8987, // Amazon AWS
  15169, 396982, 19527, // Google e Google Cloud
  8075, // Microsoft Azure
  14061, // DigitalOcean
  24940, 213230, // Hetzner
  16276, // OVH
  63949, // Linode
  31898, // Oracle Cloud
  45102, 37963, // Alibaba Cloud
  132203, // Tencent Cloud
  51167, 40021, // Contabo
  20473, // Vultr
  60781, 28753, // Leaseweb
  12876, // Scaleway
  9009, // M247
  212238, // Datacamp
  36352, // ColoCrossing
  136907, // Huawei Cloud
  197540, // netcup
]);
// 2) «intestazioni»: ogni browser vero manda Accept-Language; Chrome e i browser interni Android (Chromium) mandano
//    anche Sec-Fetch-Mode. Chi dice di essere Chrome e non li manda è un programma che si finge browser.
//    Safari e WebView degli iPhone vecchi possono non mandare Sec-Fetch: per loro basta la lingua.
export function motivoAutomatica(request) {
  const asn = Number(request.cf && request.cf.asn);
  if (asn && ASN_SERVER.has(asn)) return "server";
  const ua = request.headers.get("user-agent") || "";
  if (!request.headers.get("accept-language")) return "intestazioni";
  if (/Chrome\/\d/.test(ua) && !request.headers.get("sec-fetch-mode")) return "intestazioni";
  return "";
}
