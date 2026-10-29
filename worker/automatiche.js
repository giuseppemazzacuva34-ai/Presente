// Riconosce le richieste che NON sono una persona che apre la pagina: anteprime dei link (Meta, WhatsApp, Telegram...),
// robot dei motori di ricerca, programmi automatici, richieste HEAD e caricamenti anticipati (prefetch).
// Serve solo a non gonfiare i contatori delle visite (D43): lo user agent si legge e si butta, non viene mai salvato.

// Firme dei programmi automatici più comuni. Il browser interno di Instagram e Facebook (FBAN/FBAV, "Instagram")
// NON è in elenco: sono persone vere che hanno cliccato.
const FIRME = /facebookexternalhit|facebot|facebookcatalog|meta-external|bot\b|bot\/|crawler|spider|slurp|preview|whatsapp|telegram|skype|discord|slack|linkedin|pinterest|embedly|vkshare|headless|lighthouse|pagespeed|gtmetrix|curl\/|wget|python|go-http-client|java\/|okhttp|axios|node-fetch|undici|httpclient|libwww|scrapy|monitor|uptime|checkly/i;

// Intestazioni dei caricamenti anticipati: Chrome e Safari (Sec-Purpose / Purpose: prefetch), Firefox (X-Moz),
// Facebook e Instagram che precaricano le pagine delle inserzioni (X-Purpose: preview).
const ANTICIPATE = ["sec-purpose", "purpose", "x-purpose", "x-moz"];

export function richiestaAutomatica(request) {
  if (request.method !== "GET") return true;
  for (const nome of ANTICIPATE) {
    const valore = (request.headers.get(nome) || "").toLowerCase();
    if (valore.includes("prefetch") || valore.includes("preview") || valore.includes("prerender")) return true;
  }
  const ua = request.headers.get("user-agent") || "";
  if (!ua.trim()) return true;
  return FIRME.test(ua);
}
