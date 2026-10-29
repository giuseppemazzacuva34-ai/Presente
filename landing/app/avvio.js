// Avvio della web app (Fase 2): registra il service worker (app installabile) e apre l'iscrizione.
// Nessuna libreria esterna. Se /app/config.json dice «accesso: true» l'accesso con email è vero (accesso.js);
// altrimenti l'app resta in anteprima e nessun dato lascia il telefono.
import { avvia } from "/app/moduli/flusso.js";
import { creaAccesso } from "/app/moduli/accesso.js";

const stato = document.getElementById("stato");
function mostra(testo) {
  stato.textContent = testo;
  stato.hidden = false;
}

const installata = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
if (installata) mostra("App aggiunta alla schermata Home: ci siamo.");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch(() => {});
}

function memoria() {
  try { return window.localStorage; } catch { return null; }
}

async function preparaAccesso() {
  try {
    const risposta = await fetch("/app/config.json", { cache: "no-store" });
    const config = await risposta.json();
    if (!config.pronta || config.accesso !== true) return {};
    const accesso = creaAccesso({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey, fetch: window.fetch.bind(window), memoria: memoria() });
    // Arrivo dal link nell'email: si leggono i token e si tolgono subito dall'indirizzo e dalla cronologia.
    const dalLink = accesso.daLink(location.href);
    if (dalLink) history.replaceState(null, "", dalLink.indirizzo);
    return { accesso, erroreLink: dalLink && !dalLink.ok ? dalLink.motivo : null };
  } catch {
    return {}; // senza configurazione si resta in anteprima
  }
}

preparaAccesso().then((opzioni) => avvia(document.getElementById("app"), opzioni));
