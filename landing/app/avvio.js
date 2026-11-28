// Avvio della web app (Fase 2): registra il service worker (app installabile) e apre l'iscrizione.
// Nessuna libreria esterna. Se /app/config.json dice «accesso: true» l'accesso con email è vero (accesso.js);
// altrimenti l'app resta in anteprima e nessun dato lascia il telefono.
import { avvia, telefonoCambiato, chiaviCambiate, appuntiCambiati, portaCambiata, avvisiCambiati, nomeMio, incontroCambiato, regaliCambiati } from "/app/moduli/flusso.js";
import { filoCambiato } from "/app/moduli/flusso.js"; // schermata 18 del Filo (#360, linea C)
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
import { creaBlocca } from "/app/moduli/blocca.js";
import { creaStorico } from "/app/moduli/storico_chiamate.js";
import { creaChiavi } from "/app/moduli/chiavi.js";
import { creaChiaviStanza } from "/app/moduli/chiavi_stanza.js";
import { creaAppuntiStanza } from "/app/moduli/appunti_stanza.js";
import { creaEsiti } from "/app/moduli/esiti_segnalazioni.js";
import { creaSanzioni } from "/app/moduli/sanzioni.js";
import { creaAiuto } from "/app/moduli/aiuto.js";
import { creaSvelamento, creaPortaSvelamento } from "/app/moduli/svelamento.js";
import { creaAvvisiPorte } from "/app/moduli/avvisi_porte.js";
import { creaSalaAttesa } from "/app/moduli/sala_attesa.js";
import { fabbricaSchermata } from "/app/moduli/schermata_svelamento.js";
import { conAttesa } from "/app/moduli/in_attesa.js";
import { creaIncontro } from "/app/moduli/incontro.js";
import { creaValutazione } from "/app/moduli/valutazione.js";
import { creaVostriIncontri } from "/app/moduli/vostri_incontri.js";
import { creaRegali } from "/app/moduli/regali.js";
import { creaRegaliStanza } from "/app/moduli/regali_stanza.js";
import { creaStoricoRegali } from "/app/moduli/storico_regali.js";
import { creaRiepilogo } from "/app/moduli/riepilogo_valutazioni.js";
import { creaContesta } from "/app/moduli/contesta_no.js";
import { creaContestaBuca, creaFoglioBuca } from "/app/moduli/contesta_buca.js";
import { creaClientCambio, creaFoglioCambio } from "/app/moduli/cambia_luogo.js";
import { creaClientAvviso, creaFoglioAvviso } from "/app/moduli/avvisa_qui.js";
import { creaSaldo, collegaSaldo } from "/app/moduli/saldo_coin.js";
import { aggiornaTestata } from "/app/moduli/testata.js";
import { apriFoglioQuasiFiniti, quasiFiniti } from "/app/moduli/saldo_coin.js";
import { creaCoinServer, momentoApp } from "/app/moduli/saldo_coin.js";
import { mostraAvvisoRegalo } from "/app/moduli/regali.js"; // regalo ricevuto in chiamata (#349, linea B)
import { creaRegaloRicevuto } from "/app/moduli/regalo_ricevuto.js";
import { creaFiloDomenica } from "/app/moduli/filo_domenica.js"; // schermata 36 del Filo (#360, linea C)
import { creaFiloLunedi } from "/app/moduli/filo_lunedi.js"; // schermata 18 del Filo (#360, linea C)
import { creaFiloRiascolto } from "/app/moduli/filo_riascolto.js"; // voce «Il vocale del Filo» (#360, linea C)
import { apriTuoiCoin } from "/app/moduli/tuoi_coin.js"; // schermata 13 «I tuoi crediti» (#349, linea B)
import { schermataTuoiCoin } from "/app/moduli/saldo_coin.js";

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
    const accesso = creaAccesso({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey, fetch: window.fetch.bind(window), memoria: memoria(),
      viaServer: config.modo === "tester" });
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
    // Senza connessione segnalazione e blocco restano nella memoria della pagina e partono al rientro (#7 Offline).
    const segnala = conAttesa(creaSegnala({ token: () => accesso.token(), fetch: window.fetch.bind(window) }), "invia", { finestra: window });
    // Blocco dalla scheda (#7 punto 5): solo la propria riga in blocchi, con il proprio token (regole per riga).
    const blocca = conAttesa(creaBlocca({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey,
      token: () => accesso.token(), utenteId: () => accesso.utenteId(), fetch: window.fetch.bind(window) }),
      "blocca", { finestra: window, inAttesa: { ok: true, inAttesa: true } });
    // Chiavi (#5): le regole le decide il Worker (/app/api/chiavi); chi dà la chiave lo dice solo il token.
    const chiavi = creaChiaviStanza({ chiavi: creaChiavi({ token: () => accesso.token(), fetch: window.fetch.bind(window) }),
      aggiorna: () => chiaviCambiate(),
      // Il conto alla rovescia delle 20:00 cambia sul posto ogni minuto, senza ridisegnare la pagina.
      conto: (testo) => { const el = document.getElementById("chiavi-conto"); if (el) el.textContent = testo; },
      // Sera delle chiavi: porte che si aprono per 3 secondi, saltabili; niente animazione per chi chiede meno movimento.
      animazioneMs: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 3000 });
    // «Le tue chiamate» (#7): solo le proprie chiamate degli ultimi 30 giorni, con il proprio token.
    const storico = creaStorico({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey,
      token: () => accesso.token(), fetch: window.fetch.bind(window) });
    // «I tuoi appunti» (#5): le proprie note, direttamente su Supabase col proprio token; il Worker non le vede.
    let appunti = null;
    try {
      appunti = creaAppuntiStanza({ diario: creaDiario({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey,
        token: () => accesso.token(), fetch: window.fetch.bind(window) }), aggiorna: () => appuntiCambiati() });
    } catch { appunti = null; }
    quandoNotaNuova = () => appunti && appunti.rileggi();
    // Esito per chi segnala (#7 passo 4): solo le proprie segnalazioni chiuse, con il proprio token.
    const esiti = creaEsiti({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey,
      token: () => accesso.token(), fetch: window.fetch.bind(window) });
    // Sanzione e «Contesta» (#7 punti 7-8): solo le proprie sanzioni, con il proprio token.
    const sanzioni = creaSanzioni({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey,
      token: () => accesso.token(), fetch: window.fetch.bind(window) });
    // Pagina Aiuto (#10): «Scrivici» e «I miei messaggi» via Worker; chi scrive lo dice solo il token.
    const aiuto = creaAiuto({ token: () => accesso.token(), fetch: window.fetch.bind(window) });
    // Schermata della porta (#65 passi 1-2): caparra via Worker (/app/api/svelamento); chi blocca lo dice solo il token.
    const sv = creaSvelamento({ token: () => accesso.token(), fetch: window.fetch.bind(window) });
    // Sala d'attesa (#65 passo 6b): anteprima della propria fotocamera frontale, sfocata, muta, solo nel telefono.
    // Lo schermo è sempre lo stesso <video>: i ridisegni della pagina non interrompono l'anteprima.
    const schermo = document.createElement("video");
    schermo.muted = true;
    schermo.autoplay = true;
    schermo.setAttribute("playsinline", "");
    schermo.setAttribute("aria-hidden", "true");
    const md = navigator.mediaDevices;
    // Video dello svelamento (#65 passo 7d-3b-2): solo dopo «iniziato» + «video» dal server. La fotocamera gira in una
    // sorgente muta e nascosta fuori da #app; l'altra persona si vede e si sente nello schermo (sempre lo stesso <video>).
    const sorgente = document.createElement("video");
    sorgente.muted = true;
    sorgente.setAttribute("playsinline", "");
    sorgente.hidden = true;
    document.body.append(sorgente);
    const schermoVideo = document.createElement("video");
    schermoVideo.autoplay = true;
    schermoVideo.setAttribute("playsinline", "");
    const porta = creaPortaSvelamento({ svelamento: sv, aggiorna: () => portaCambiata(),
      sala: (passaAlleFoto, aggiorna) => creaSalaAttesa({ getUserMedia: md && md.getUserMedia ? md.getUserMedia.bind(md) : undefined,
        schermo, passaAlleFoto, aggiorna }),
      video: fabbricaSchermata({ svelamento: sv, getUserMedia: md && md.getUserMedia ? md.getUserMedia.bind(md) : undefined,
        RTCPeerConnection: window.RTCPeerConnection, MediaStream: window.MediaStream,
        creaTela: () => document.createElement("canvas"), sorgente, schermo: schermoVideo,
        nomeMio: () => nomeMio(), aggiorna: () => portaCambiata() }) });
    // Avvisi delle porte nella home (#65 passo 4, senza push finché non c'è D24): una lettura al minuto, solo con porte aperte.
    const avvisiPorte = creaAvvisiPorte({ svelamento: sv, aggiorna: () => avvisiCambiati(), pagina: document });
    // «I vostri incontri» (#6 passo 3n): elenco, «Il vostro incontro» e valutazione via Worker; chi chiede lo dice il token.
    const vostriIncontri = creaVostriIncontri({ token: () => accesso.token(), fetch: window.fetch.bind(window) });
    const incontro = creaIncontro({ token: () => accesso.token(), fetch: window.fetch.bind(window), aggiorna: () => incontroCambiato() });
    const valutazione = creaValutazione({ token: () => accesso.token(), fetch: window.fetch.bind(window), aggiorna: () => incontroCambiato(),
      finito: () => incontro.riprova() });
    // Riepilogo alla cieca nel profilo (#6 passo 3o): solo le proprie valutazioni ricevute, via Worker col proprio token.
    const riepilogo = creaRiepilogo({ token: () => accesso.token(), fetch: window.fetch.bind(window) });
    // «Contesta» un «No» (#6 spec v1.3 punto 2, linea B): stato e invio via Worker col proprio token, insieme al riepilogo.
    riepilogo.contesta = creaContesta({ token: () => accesso.token(), fetch: window.fetch.bind(window) });
    // «Ero lì» / «Non riesco a fare il check-in» (#6 spec v1.4, linea B): foglio dentro «Il vostro incontro».
    incontro.buca = creaFoglioBuca({ client: creaContestaBuca({ token: () => accesso.token(), fetch: window.fetch.bind(window) }),
      aggiorna: () => incontroCambiato() });
    // «Cambia luogo» (#6 spec v1, casi limite, linea B): foglio dentro «Il vostro incontro», poi si rilegge lo stato.
    incontro.cambio = creaFoglioCambio({ client: creaClientCambio({ token: () => accesso.token(), fetch: window.fetch.bind(window) }),
      ricarica: () => incontro.riprova(), aggiorna: () => incontroCambiato() });
    // «Avvisa <nome> che sei qui» (#6 spec v1 punto 6, linea B): foglio dentro «Il vostro incontro», poi si rilegge lo stato.
    incontro.avviso = creaFoglioAvviso({ client: creaClientAvviso({ token: () => accesso.token(), fetch: window.fetch.bind(window) }),
      ricarica: () => incontro.riprova(), aggiorna: () => incontroCambiato() });
    // Regali (#331 parte C): «Manda un regalo» sulla scheda; il foglio sta in .pagina.app, fuori da #app che si ridisegna.
    const regali = creaRegaliStanza({ regali: creaRegali({ token: () => accesso.token(), fetch: window.fetch.bind(window) }),
      contenitore: document.querySelector(".pagina.app"), aggiorna: () => regaliCambiati() });
    // Regalo ricevuto in chiamata (#349, schermata 27, linea B): avviso sopra la chiamata, fuori da #app.
    const regaloRicevuto = creaRegaloRicevuto({ regali: creaRegali({ token: () => accesso.token(), fetch: window.fetch.bind(window) }),
      mostra: (avviso) => mostraAvvisoRegalo(document.querySelector(".pagina.app"), avviso) });
    // «I tuoi regali» nel profilo (#349, linea B): GET /app/api/regali/storico col proprio token.
    const storicoRegali = creaStoricoRegali({ token: () => accesso.token(), fetch: window.fetch.bind(window) });
    // «Il profilo» (#349, schermata 23, linea B): saldo letto col proprio token quando si apre il profilo.
    const coinProfilo = creaCoinServer({ token: () => accesso.token(), fetch: window.fetch.bind(window) });
    // Saldo dei Coin nella testata (#349, linea B): dal server col proprio token, all'avvio e al ritorno sull'app.
    // Passo 5c: nuovo indirizzo /app/api/coin (saldo + prima stanza usata) e momento (mai in chiamata, svelamento, porte).
    collegaSaldo({ saldo: creaSaldo({ coin: creaCoinServer({ token: () => accesso.token(), fetch: window.fetch.bind(window) }),
      testata: (dati) => aggiornaTestata(document, dati) }), pagina: document,
      avviso: (n) => apriFoglioQuasiFiniti(document.querySelector(".pagina.app"), quasiFiniti(n),
        { alRicarica: () => apriTuoiCoin(document.querySelector(".pagina.app"), schermataTuoiCoin(n, { primaStanzaUsata: true }), { principale: document.getElementById("app") }) }),
      momento: () => momentoApp({ telefono, porta, chiavi }) });
    // Il Filo della stanza (#360, linea C): schermata 36 prima della sera delle porte; numero e vocale via Worker.
    const filoDomenica = creaFiloDomenica({ token: () => accesso.token(), fetch: window.fetch.bind(window), aggiorna: () => chiaviCambiate() });
    const filoLunedi = creaFiloLunedi({ token: () => accesso.token(), fetch: window.fetch.bind(window), aggiorna: () => filoCambiato() });
    const filoRiascolto = creaFiloRiascolto({ token: () => accesso.token(), fetch: window.fetch.bind(window), aggiorna: () => filoCambiato() });
    return { aiuto, accesso, archivio, lista, zona, stanza, telefono, sentinella, segnala, blocca, chiavi, storico, appunti, esiti, sanzioni, erroreLink: dalLink && !dalLink.ok ? dalLink.motivo : null, porta, avvisiPorte, vostriIncontri, incontro, valutazione, riepilogo, regali, storicoRegali, coinProfilo, regaloRicevuto, filoDomenica, filoLunedi, filoRiascolto };
  } catch {
    return {}; // senza configurazione si resta in anteprima
  }
}

// Dopo una nota nuova del diario la scheda rilegge «I tuoi appunti» (#5): si collega quando gli appunti esistono.
let quandoNotaNuova = () => {};

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
  try { diario = creaDiario({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey, token, fetch,
    dopoSalva: () => quandoNotaNuova() }); } catch { diario = null; }
  telefono = creaTelefono({ compagni, linea: collegaVoce({ chiamata, voce }), chiamata, voce, diario,
    subito: () => sentinella && sentinella.subito(), cambiato: () => telefonoCambiato() });
  sentinella = creaSentinella({ leggi: () => chiamata.stato(), quando: (r) => telefono.aggiorna(r), pagina: document });
  return { telefono, sentinella };
}

preparaAccesso().then((opzioni) => avvia(document.getElementById("app"), opzioni));
