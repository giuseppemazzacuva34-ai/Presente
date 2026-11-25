// Prova finta dell'app (D141 A, linea «sviluppatore-c»): le schermate vere di flusso.js con il «server finto» di
// prova.js al posto del database e del Worker. Niente rete, niente salvataggi sul telefono: ricaricando la pagina
// si ricomincia da capo. Pagina non linkata e non indicizzata: /app/prova.html.
import { avvia, telefonoCambiato, chiaviCambiate, portaCambiata, avvisiCambiati, appuntiCambiati } from "/app/moduli/flusso.js";
import { creaProva } from "/app/moduli/prova.js";
import { creaSalaAttesa } from "/app/moduli/sala_attesa.js";
// Saldo, profilo, crediti, regali, Filo e stanza viva con le API finte in memoria (richiesta del coordinatore del 25/11).
import { moduliProva } from "/app/moduli/prova_api.js";
import { filoCambiato, regaliCambiati } from "/app/moduli/flusso.js";

// Sala d'attesa dello svelamento, come nell'app vera: anteprima della propria fotocamera frontale, sfocata, muta,
// visibile solo a sé; niente lascia il telefono. Con «Preferisco le foto» la fotocamera non si accende mai.
const schermo = document.createElement("video");
schermo.muted = true;
schermo.autoplay = true;
schermo.setAttribute("playsinline", "");
schermo.setAttribute("aria-hidden", "true");
const md = navigator.mediaDevices;
const sala = (passaAlleFoto, aggiorna) => creaSalaAttesa({ getUserMedia: md && md.getUserMedia ? md.getUserMedia.bind(md) : undefined,
  schermo, passaAlleFoto, aggiorna });

const prova = creaProva({ cambiato: () => telefonoCambiato(), pagina: document,
  sala,
  aggiorna: { chiavi: () => chiaviCambiate(), porta: () => portaCambiata(), avvisi: () => avvisiCambiati(), appunti: () => appuntiCambiati(), conto: (testo) => { const el = document.getElementById("chiavi-conto"); if (el) el.textContent = testo; } },
  // Sera delle chiavi: porte che si aprono per 3 secondi, saltabili; niente animazione per chi chiede meno movimento.
  animazioneMs: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 3000 });

Object.assign(prova, moduliProva({ pagina: document, contenitore: document.querySelector(".pagina.app"),
  aggiorna: { chiavi: () => chiaviCambiate(), filo: () => filoCambiato(), regali: () => regaliCambiati() } }));

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
