// Avvio della web app (Fase 2): registra il service worker (app installabile) e apre l'iscrizione.
// Nessuna libreria esterna. Se /app/config.json dice «accesso: true» l'accesso con email è vero (accesso.js);
// altrimenti l'app resta in anteprima e nessun dato lascia il telefono.
import { avvia, telefonoCambiato } from "/app/moduli/flusso.js";
import { creaAccesso } from "/app/moduli/accesso.js";
import { creaSalvataggio } from "/app/moduli/salvataggio.js";
import { creaLista } from "/app/moduli/lista.js";
import { creaZona } from "/app/moduli/zona.js";
import { creaStanza } from "/app/moduli/stanza.js";
import { creaChiamata } from "/app/moduli/chiamata.js";
import { creaVoce, collegaVoce } from "/app/moduli/voce.js";
import { creaCompagni } from "/app/moduli/compagni.js";
import { creaSentinella } from "/app/moduli/sentinella.js";
import { creaTelefono } from "/app/moduli/telefono.js";
import { creaSegnala } from "/app/moduli/segnala.js";
import { creaDiario } from "/app/moduli/diario.js";

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
    // Salvataggio passo per passo su Supabase, con il token dell'utente (regole per riga).
    const archivio = creaSalvataggio({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey,
      token: () => accesso.token(), utenteId: () => accesso.utenteId(), fetch: window.fetch.bind(window) });
    // Provincia dalla lista d'attesa (#2 v1.3): il Worker restituisce solo la sigla, entro 2 secondi.
    const lista = creaLista({ token: () => accesso.token(), fetch: window.fetch.bind(window) });
    // Contatore della zona nella home (#3 v1.2): il Worker manda solo il testo «mancano N persone», entro 2 secondi.
    const zona = creaZona({ token: () => accesso.token(), fetch: window.fetch.bind(window) });
    // «Entra nella stanza» (#3): la conferma la scrive il database (lunedì e ora dal server, regole per riga).
    const stanza = creaStanza({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey,
      token: () => accesso.token(), fetch: window.fetch.bind(window) });
    // Chiamate solo voce (#4): le richieste rispondono solo con ACCESSO_APP = «si»; altrimenti la sentinella si ferma.
    const { telefono, sentinella } = preparaTelefono(config, accesso);
    // Segnalazioni (#7): il modulo dopo «Chiudi e segnala» e «Segnala un problema»; chi segnala lo dice il token.
    const segnala = creaSegnala({ token: () => accesso.token(), fetch: window.fetch.bind(window) });
    return { accesso, archivio, lista, zona, stanza, telefono, sentinella, segnala, erroreLink: dalLink && !dalLink.ok ? dalLink.motivo : null };
  } catch {
    return {}; // senza configurazione si resta in anteprima
  }
}

function preparaTelefono(config, accesso) {
  const token = () => accesso.token();
  const fetch = window.fetch.bind(window);
  // L'altoparlante sta fuori da #app: i ridisegni della pagina non interrompono la voce.
  const altoparlante = document.createElement("audio");
  altoparlante.autoplay = true;
  altoparlante.setAttribute("playsinline", "");
  altoparlante.hidden = true;
  document.body.append(altoparlante);
  const chiamata = creaChiamata({ token, fetch });
  let telefono = null;
  const md = navigator.mediaDevices;
  const voce = creaVoce({
    getUserMedia: md && md.getUserMedia ? md.getUserMedia.bind(md) : undefined,
    RTCPeerConnection: window.RTCPeerConnection,
    altoparlante,
    quandoCade: () => telefono && telefono.caduta(),
  });
  const compagni = creaCompagni({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey, token, fetch });
  let sentinella = null;
  // Diario privato (#5): la nota va dritta su Supabase col proprio token; senza configurazione il passo si salta.
  let diario = null;
  try { diario = creaDiario({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey, token, fetch }); } catch { diario = null; }
  telefono = creaTelefono({ compagni, linea: collegaVoce({ chiamata, voce }), chiamata, voce, diario,
    subito: () => sentinella && sentinella.subito(), cambiato: () => telefonoCambiato() });
  sentinella = creaSentinella({ leggi: () => chiamata.stato(), quando: (r) => telefono.aggiorna(r), pagina: document });
  return { telefono, sentinella };
}

preparaAccesso().then((opzioni) => avvia(document.getElementById("app"), opzioni));
