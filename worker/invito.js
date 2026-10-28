// Link d'invito dei creator: https://presenteincontri.app/?invito=CODICE precompila il campo «Chi ti ha invitato?».
// La pagina resta senza script: è il Worker a scrivere il codice dentro l'HTML prima di mandarlo al browser.
// Il codice viene ripulito: solo lettere e numeri, massimo 20 caratteri, in maiuscolo. Nient'altro entra nella pagina.

const SEGNAPOSTO = '<input id="invito" name="invito"';

export function pulisciCodice(valore) {
  return String(valore || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 20).toUpperCase();
}

// Serve la home; se l'indirizzo ha ?invito=CODICE valido, restituisce la stessa pagina con il campo già compilato.
export async function homeConInvito(request, env) {
  const risposta = await env.ASSETS.fetch(request);
  const codice = pulisciCodice(new URL(request.url).searchParams.get("invito"));
  const tipo = risposta.headers.get("content-type") || "";
  if (!codice || risposta.status !== 200 || !tipo.includes("text/html")) return risposta;

  const html = await risposta.text();
  if (!html.includes(SEGNAPOSTO)) return new Response(html, risposta);
  const nuova = new Response(html.replace(SEGNAPOSTO, `${SEGNAPOSTO} value="${codice}"`), risposta);
  // Pagina personalizzata: nessuna copia in cache condivisa.
  nuova.headers.set("cache-control", "private, no-store");
  nuova.headers.delete("etag");
  nuova.headers.delete("content-length");
  return nuova;
}

// Codici dei creator da contare in /conteggio (variabile CODICI_INVITO in wrangler.jsonc, separati da virgola).
// Solo questi codici compaiono nei totali: i nomi liberi scritti nel campo invito non escono mai.
export function codiciConfigurati(env) {
  return new Set(String(env.CODICI_INVITO || "").split(",").map(pulisciCodice).filter(Boolean));
}
