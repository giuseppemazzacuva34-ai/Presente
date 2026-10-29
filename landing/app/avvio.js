// Avvio della web app (Fase 2, issue #1): registra il service worker che la rende installabile.
// Nessuna libreria esterna, nessun dato personale: per ora la pagina dice solo se l'app è installata.
const stato = document.getElementById("stato");

function mostra(testo) {
  stato.textContent = testo;
  stato.hidden = false;
}

const installata = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
if (installata) mostra("App aggiunta alla schermata Home: ci siamo.");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch(() => {
    if (!installata) mostra("Questo browser non permette di installare l'app: potrai usarla comunque da qui.");
  });
}
