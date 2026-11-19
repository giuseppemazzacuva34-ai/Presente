// Prova finta dell'app (D141 A, linea «sviluppatore-c»): le schermate vere di flusso.js con il «server finto» di
// prova.js al posto del database e del Worker. Niente rete, niente salvataggi sul telefono: ricaricando la pagina
// si ricomincia da capo. Pagina non linkata e non indicizzata: /app/prova.html.
import { avvia, telefonoCambiato, chiaviCambiate } from "/app/moduli/flusso.js";
import { creaProva } from "/app/moduli/prova.js";

const prova = creaProva({ cambiato: () => telefonoCambiato(), pagina: document,
  aggiorna: { chiavi: () => chiaviCambiate(), conto: (testo) => { const el = document.getElementById("chiavi-conto"); if (el) el.textContent = testo; } },
  // Sera delle chiavi: porte che si aprono per 3 secondi, saltabili; niente animazione per chi chiede meno movimento.
  animazioneMs: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 3000 });

// Comandi della prova (in cima alla pagina): fanno succedere subito ciò che nell'app vera richiede tempo.
const esito = document.getElementById("esito-comando");
const app = document.getElementById("app");
const COMANDI = {
  // Profilo finto già completo: si riparte dalla home (flusso.js rilegge il profilo come al rientro vero).
  "comando-profilo": [() => { prova.regista.profiloPronto(); avvia(app, prova); return true; }, "Profilo finto pronto: sei nella home.", ""],
  "comando-chiamata": [() => prova.regista.chiamaMe(), "Squilla: guarda la tua stanza.", "Sei già in una chiamata."],
  "comando-porte": [() => { const fatto = prova.regista.apriPorte(); if (fatto) avvia(app, prova); return fatto; },
    "Sono le 21 di domenica: guarda in cima alla tua stanza.", "Prima entra nell'app; la sera si apre una volta sola (ricarica la pagina per rifarla)."],
  "comando-minuto": [() => prova.regista.ultimoMinuto(), "Fatto: resta un minuto.", "Serve una chiamata in corso."],
};
for (const [id, [fai, si, no]] of Object.entries(COMANDI)) {
  const bottone = document.getElementById(id);
  if (bottone) bottone.addEventListener("click", () => { esito.textContent = fai() ? si : no; });
}

avvia(app, prova);
