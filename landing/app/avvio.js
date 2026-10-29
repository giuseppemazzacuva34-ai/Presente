// Avvio della web app (Fase 2): registra il service worker (app installabile) e apre l'iscrizione in anteprima.
// Nessuna libreria esterna. Nell'anteprima nessun dato lascia il telefono.
import { avvia } from "/app/moduli/flusso.js";

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

avvia(document.getElementById("app"));
