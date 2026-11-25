// Email di prova degli avvisi di sicurezza (Fase 2, #7 spec v1.1; D139 A). Linea «sviluppatore-b».
// Richiesta del Coordinatore del 25/11, dopo che Giuseppe ha inserito BREVO_API_KEY ed EMAIL_SICUREZZA (az-brevo-chiave):
// controllare che gli avvisi arrivino davvero alla casella della sicurezza prima della beta.
// Il cron di ogni minuto (CRON_AVVISI) manda UNA email solo nel minuto scritto in AVVISO_PROVA (wrangler.jsonc,
// formato AAAA-MM-GGThh:mmZ, ora UTC): passato quel minuto non parte più nulla. Funziona anche con l'app spenta perché
// non tocca il database né gli utenti: solo la casella della sicurezza. Nel testo nessun dato; nei log solo codici.

const ATTESA_MS = 10000;
const MITTENTE = { name: "Presente · sicurezza", email: "ciao@presenteincontri.app" }; // come avvisi_sicurezza.js
const MINUTO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;

export const TESTO_PROVA = Object.freeze({
  oggetto: "Presente · avviso di sicurezza (prova)",
  testo: [
    "Questa è un'email di prova degli avvisi di sicurezza di Presente.",
    "Non c'è niente da guardare: serve solo a controllare che gli avvisi arrivino a questa casella.",
    "",
    "Se qualcuno è in pericolo, il riferimento resta il 112.",
  ].join("\n"),
});

// quando: ms dell'evento del cron. Restituisce { esito: "spento" | "segreti_mancanti" | "spedito" | "errore" }.
export async function avvisoDiProva(env, quando, f = fetch) {
  const prova = env && typeof env.AVVISO_PROVA === "string" ? env.AVVISO_PROVA.trim() : "";
  if (!MINUTO.test(prova) || !Number.isFinite(quando)) return { esito: "spento" };
  if (Math.floor(quando / 60000) !== Math.floor(Date.parse(prova.replace("Z", ":00Z")) / 60000)) return { esito: "spento" };
  if (!env.BREVO_API_KEY || !env.EMAIL_SICUREZZA) {
    console.error("avviso di prova: segreti mancanti");
    return { esito: "segreti_mancanti" };
  }
  try {
    const r = await f("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ sender: MITTENTE, to: [{ email: String(env.EMAIL_SICUREZZA).trim() }], subject: TESTO_PROVA.oggetto, textContent: TESTO_PROVA.testo }),
      signal: AbortSignal.timeout(ATTESA_MS),
    });
    if (!r.ok) {
      console.error(`avviso di prova: brevo risposta ${r.status}`);
      return { esito: "errore" };
    }
    console.log("avviso di prova: spedito");
    return { esito: "spedito" };
  } catch (e) {
    console.error("avviso di prova: errore", e && e.name);
    return { esito: "errore" };
  }
}
