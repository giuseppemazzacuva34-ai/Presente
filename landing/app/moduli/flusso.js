// Iscrizione alla web app (issue #2, specifica v1 e v1.1 del CPO): benvenuto → email → maggiore età → regole →
// chi sei → chi cerchi → voce → tre risposte a voce → questionario → foto → fatto.
//
// MODALITÀ ANTEPRIMA: finché l'informativa privacy dell'app (T08) e la revisione di sicurezza (T15) non sono pronte,
// questa è solo una bozza da provare. Niente viene inviato né salvato: voce, foto e risposte restano nella memoria
// della pagina e spariscono quando la si chiude. Nessuna email viene mandata.
// CON L'ACCESSO ACCESO (ACCESSO_APP = «si»): ogni «Continua» salva il passo su Supabase (salvataggio.js) e chi esce
// a metà, al rientro, riparte dal passo lasciato.

import { DOMANDE, TEMI, IMPORTANZA, testoImportanza, DOMANDE_VOCE, erroreRisposta } from "./domande.js";
import { registra, registrazioneSupportata, MINIMO_SECONDI } from "./registratore.js";
import { preparaFoto } from "./foto.js";
import { MESSAGGI } from "./accesso.js";
import { profiloDaStato, filtriDaStato, statoDaSalvato, FILE_VOCE, fileRisposta, fileFoto } from "./salvataggio.js";
import { MENU_PROVINCE, ESTERO, cercaProvincia, suggerimenti, nomeMenu, nomeVisibile, testoCambio, lunediCambio } from "./province.js";
import { testoZona, etichettaRaggio } from "./aree.js";
import { testoConferma, chiediItalia, contatoreSoloZona } from "./stanza.js";
import { moduloSegnala, corpoSegnala, confermaSegnala, testoErroreSegnala } from "./segnala.js";
import { schermataDifficolta, inviaDifficolta, personeDifficolta } from "./difficolta.js";
import { confermaBlocco, menuScheda, nomeScheda } from "./blocca.js";
import { ORARI_DALLE, ORARI_ALLE, TESTI as TESTI_FASCIA, daProfilo, campiDaSalvare, testoSalvato } from "./disponibilita.js";
import { vistaChiavi, vistaSchedaChiave, vistaSera } from "./chiavi_stanza.js";
import { TESTI_STORICO, segnalaDaStorico } from "./storico_chiamate.js";
import { vistaAppunti } from "./appunti_stanza.js";
import { vistaRegaliScheda } from "./regali_stanza.js";
import { vistaRegaloChiamata } from "./regalo_chiamata.js";
import { creaSchermoRegali, TESTI_STORICO as TESTI_REGALI_PROFILO } from "./storico_regali.js";
import { TESTI_ESITO } from "./esiti_segnalazioni.js";
import { TESTI_SANZIONE } from "./sanzioni.js";
import { vistaPorta, segnalaDaPorta } from "./svelamento.js";
import { vistaAvvisiPorte } from "./avvisi_porte.js";
import { TESTI_AIUTO, DOMANDE_FREQUENTI, moduloScrivici, corpoScrivici, confermaScrivici, contatore as contatoreAiuto, filtraDomande, testoErroreAiuto, statoMessaggio } from "./aiuto.js";
import { vistaIncontro } from "./incontro.js";
import { vistaValutazione } from "./valutazione.js";
import { vistaVostriIncontri } from "./vostri_incontri.js";
import { settimanaHome, vistaSettimanaHome, vistaCerchioHome, TESTI_SETTIMANA } from "./settimana_home.js";
import { vistaSeraFilo } from "./filo_domenica.js"; // schermata 36 del Filo (#360, linea C)
import { vistaStanzaFilo } from "./filo_lunedi.js"; // schermata 18 del Filo (#360, linea C)
import { vistaFiloRiascolto } from "./filo_riascolto.js"; // voce «Il vocale del Filo» (#360, linea C)
import { apriSchermataUscita, creaUscita, TESTI_APP as TESTI_USCITA } from "./lascia_stanza.js"; // schermata 22 (#381, linea B)
import { ORIENTAMENTI, TESTI_ORIENTAMENTO, toccaOrientamento, cercoDaOrientamento, VOGLIO_INCONTRARE, toccaCerco } from "./orientamento.js"; // schermata 05 (#471)
import { creaSchermoProfilo, collegaCerchio, statoProfilo, vistaProfilo } from "./profilo.js"; // schermata 23 (#349, linea B)
import { vistaNotifiche, vistaPrivacy } from "./preferenze_profilo.js"; // schermata 23: Notifiche e Privacy (#349, linea B)
import { apriTuoiCoin } from "./tuoi_coin.js"; // schermata 13 da «Ricarica» del profilo (#349, linea B)
import { schermataTuoiCoin } from "./saldo_coin.js";
import { disponiStanza, vistaCerchioStanza, testoChiamate } from "./stanza_viva.js"; // schermata 19 (#380, linea A)
import { TESTI_FISSA, azioneRiga, rigaStato, giorniEOre, avvisiAppuntamenti, creaStanzaViva, creaBattito } from "./appuntamenti_stanza.js"; // schermate 19-20 (#380)
import { creaDomenicaSera, vistaDomenicaSera } from "./domenica_sera.js"; // schermata 35 (#349, linea C)
import { TESTI_CONTESTA, LIMITI_CONTESTA, rigaContesta, testoValido } from "./contesta_no.js"; // #6 v1.3 punto 2 (linea B)
import { TESTI_RIEPILOGO } from "./riepilogo_valutazioni.js"; // #6 v1.3 punto 2 (linea B)
// Chiavi nella stanza (#5, linea «sviluppatore-c»): solo con il telefono acceso (accesso vero).
let chiaviStanza = null;
// «I tuoi appunti» sulla scheda (#5 passo 3, linea «sviluppatore-c»): solo con il telefono acceso.
let appuntiStanza = null;
// «Manda un regalo» sulla scheda (#331 parte C, linea «sviluppatore-c»): solo con il telefono acceso, solo stanza aperta.
let regaliStanza = null;
let regaliProfilo = null; // «I tuoi regali» dal profilo (#349, linea B)
let regaloRicevuto = null; // regalo ricevuto in chiamata, schermata 27 (#349, linea B)
let schermoProfilo = null; // «Il profilo» dal cerchio in alto a destra, schermata 23 (#349, linea B)
let opzioniCoin = null; // lettore del saldo (coinProfilo dell'avvio): schermata 13 dopo l'iscrizione (#349, linea B)
let filoDomenica = null; // schermata 36 «Il Filo · le porte aperte» (#360, linea C)
let filoLunedi = null; // schermata 18 «Il Filo apre la stanza» (#360, linea C)
const domenicaSera = creaDomenicaSera(); // schermata 35 «Domenica sera» (#349, linea C)
let filoRiascolto = null; // voce «Il vocale del Filo» nella stanza (#360, linea C)
let uscitaStanza = null; // «Lascia la stanza», schermata 22 (#381, linea B)
// Stanza viva e «Fissa una chiamata» (#380, linea A, schermate 19-20): stati e appuntamenti dal battito ogni 30 s;
// «fissa» = schermata 20 aperta (resta tra un ridisegno e l'altro). Solo in memoria, mai salvati sul telefono.
let stanzaViva = null;
let battito = null;
let battitoAvviato = false;
const viva = { letto: false, persa: false, stati: new Map(), appuntamenti: [], nascosti: new Set(), fissa: null, invio: false, avviso: "", errore: "" };
const uscita = { nodo: null, fatto: "" }; // schermata aperta (resta tra un ridisegno e l'altro) e testo dopo l'uscita
// Apre lo svelamento di una porta (#65, linea del CTO): finché non c'è, la sera mostra le porte senza pulsante.
let svelamento = null;
// Schermata della porta (#65 passi 1-2, svelamento.js): nome, età, 48 ore e caparra. Solo con il telefono acceso.
let portaSvelamento = null;
// Avvisi delle porte nella home (#65 passo 4, avvisi_porte.js): «è pronta», 10 minuti prima, «inizia ora»; la porta resta
// raggiungibile fino alla scadenza delle 48 ore. Solo con il telefono acceso e la schermata della porta.
let avvisiPorte = null;
let avvisiAvviati = false;

// ---------------------------------------------------------------------------------------------------------------
// Piccolo aiuto per creare elementi senza HTML in stringa (niente innerHTML: niente codice iniettabile).
// Gli elementi SVG (cerchio della stanza, #380) nascono nel loro spazio dei nomi: con createElement non si disegnerebbero.
const SVG = new Set(["svg", "line", "circle"]);
function h(tag, attributi = {}, ...figli) {
  const el = SVG.has(tag) ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);
  for (const [nome, valore] of Object.entries(attributi || {})) {
    if (valore === false || valore === null || valore === undefined) continue;
    if (nome.startsWith("on") && typeof valore === "function") el.addEventListener(nome.slice(2), valore);
    else if (nome === "classe") el.className = valore;
    else if (valore === true) el.setAttribute(nome, "");
    else el.setAttribute(nome, valore);
  }
  for (const figlio of figli.flat(Infinity)) {
    if (figlio === null || figlio === undefined || figlio === false) continue;
    el.append(figlio instanceof Node ? figlio : document.createTextNode(String(figlio)));
  }
  return el;
}

// Stato dell'iscrizione, solo in memoria.
const stato = {
  passo: 0,
  email: "",
  dataNascita: "", giorno: "", mese: "", anno: "", minorenne: false,
  regole: false,
  // Provincia (spec v1.3): sigla scelta, testo nel campo, sigla arrivata dalla lista d'attesa (solo la sigla, dal server).
  nome: "", provincia: "", provinciaTesto: "", provinciaLista: "", provinciaSalvata: "", miPresento: "", miDescrivo: "",
  orientamento: [], orientamentoTesto: "", // #471: solo in memoria fino a D155, mai salvato
  cerco: [], cercoToccato: false, consensoCerco: false, etaMin: 25, etaMax: 40, raggio: "citta", cosaCerco: "", figli: "", fumo: "",
  voce: null,                 // { url, secondi }
  domandeVoce: [],            // indici scelti in DOMANDE_VOCE
  rispostaInCorso: null,      // tre risposte a voce: null = scelta delle 3 domande, 0–2 = schermata della domanda
  risposteVoce: {},           // indice → { url, secondi }
  questionario: { domanda: 1, risposte: {}, importanza: {} },
  foto: [null, null, null],   // { url }
};

const PASSI = [
  { id: "benvenuto", titolo: "Benvenuto" },
  { id: "email", titolo: "Email" },
  { id: "eta", titolo: "Maggiore età" },
  { id: "regole", titolo: "Regole" },
  { id: "chi", titolo: "Chi sei" },
  { id: "cerchi", titolo: "Chi cerchi" },
  { id: "voce", titolo: "La tua voce" },
  { id: "risposte", titolo: "Tre risposte a voce" },
  { id: "questionario", titolo: "Questionario privato" },
  { id: "foto", titolo: "Foto" },
  { id: "fatto", titolo: "Fatto" },
];

let radice;
let registrazioneInCorso = null;
// Accesso vero con email (accesso.js). null = anteprima: nessuna email, si passa direttamente al passo dopo.
let accesso = null;
// Salvataggio su Supabase (salvataggio.js). null = anteprima: niente lascia il telefono.
let archivio = null;
// Provincia dalla lista d'attesa (lista.js): solo con l'accesso vero; una sola richiesta per sessione.
let lista = null;
let listaChiesta = false;
// Contatore della zona nella home (zona.js): solo con l'accesso vero; una richiesta per sessione, il testo resta.
let zona = null;
const contatore = { chiesto: false, testo: null };
// «Entra nella stanza» (stanza.js): conferma scritta dal database; una lettura per sessione.
let stanza = null;
// Modulo di segnalazione #7 (segnala.js, linea «sviluppatore-b»): scelte solo in memoria, si azzerano a ogni modulo nuovo.
let segnalatore = null;
const segnalazione = { chiave: "", motivo: "", testo: "", blocca: true, invio: false, errore: "", esito: null };
// «Sono in difficoltà» dal menu dell'app (#7 punto 6, passo 7b): solo in memoria, si azzera alla chiusura.
const difficolta = { aperta: false, contro: "", invio: false, errore: "", conferma: null };
// Menu ⋯ della scheda (#7 punto 1 e 5, passo 8b): menu aperto, conferma del blocco, segnalazione dalla scheda.
// Le persone bloccate in questa sessione spariscono subito dall'elenco (al prossimo caricamento lo fa il database).
let bloccatore = null;
const scheda = { menu: "", conferma: "", invio: false, errore: "", segnala: null, bloccate: new Set() };
// «Le tue chiamate» (#7, caso limite «Persona già bloccata», passo 9c): elenco e segnalazione solo in memoria.
let storicoChiamate = null;
const storico = { aperto: false, carica: false, voci: [], errore: "", menu: "", segnala: null };
// Esito per chi segnala (#7 passo 4, passo 10c): letto una volta per sessione, solo in memoria.
let esitiSegnalazioni = null;
const esiti = { chiesti: false, voci: [] };
// Sanzione e «Contesta» (#7 punti 7-8, passo 12d): lette una volta per sessione, solo in memoria.
let sanzioniMie = null;
const sanzioniStato = { chieste: false, voci: [], aperta: "", testo: "", invio: false, errore: "", inviata: "" };
// Pagina Aiuto (#10 parte A, linea «sviluppatore-c»): domande frequenti, «Scrivici» e «I miei messaggi», solo in memoria.
let supporto = null;
const aiuto = { aperta: false, cerca: "", categoria: "", testo: "", invio: false, errore: "", conferma: null, carica: false, email: "", messaggi: [], erroreMiei: "" };
// Testo del diario mentre si scrive (resta tra un ridisegno e l'altro; si svuota appena si lascia la schermata).
const notaDiario = { testo: "" };
const ingresso = { chiesto: false, letto: false, apreIl: null, inCorso: false, errore: "", avviso: "" };
// «Vuoi entrare intanto nella Stanza Italia?»: «Aspetto la mia zona» la nasconde per questa sessione.
const italia = { aspetto: false, inCorso: false, errore: "", avviso: "" };
// Chiamate (telefono.js + sentinella.js, issue #4 passo 3c-3b-2): «La tua stanza» nella home e schermo della chiamata.
// Solo con l'accesso vero; la sentinella parte la prima volta che si arriva alla home.
let telefono = null;
// Alle 21:00 della domenica (sera delle chiavi) la stanza si rilegge una volta: diventa «Chiusa» in sola lettura.
let stanzaRilettaDiSera = false;
let sentinella = null;
let sentinellaAvviata = false;
let ultimaFirma = "";
const MESSAGGI_STANZA = {
  accesso: "La sessione è scaduta: rientra con la tua email.",
  rete: "Non riusciamo a collegarci. Controlla la connessione e riprova.",
  salvataggio: "Non siamo riusciti a salvare. Riprova tra poco.",
  scaduta: "Le conferme per questo lunedì sono chiuse: ci vediamo nella stanza.",
};
const salvataggio = { inCorso: false, errore: "" };
let passoMassimo = 0;
const email = { inviata: false, codice: "", errore: "", attesa: false };
// «Cambia provincia» da «Il mio profilo»: dopo «Chi sei» si torna al profilo invece di rifare tutti i passi.
const cambio = { daProfilo: false, avviso: "" };
// «Il mio profilo › Quando posso ricevere chiamate» (spec #4 v1.3 § 1). Solo con l'accesso vero.
const disponibilita = { aperta: false, da: "", a: "", pausa: false, inCorso: false, errore: "", avviso: "" };

const MESSAGGI_SALVATAGGIO = {
  accesso: "La sessione è scaduta: rientra con la tua email.",
  rete: "Non riusciamo a collegarci. Controlla la connessione e riprova.",
  salvataggio: "Non siamo riusciti a salvare. Riprova tra poco.",
};

export function avvia(elemento, opzioni = {}) {
  radice = elemento;
  accesso = opzioni.accesso || null;
  archivio = (accesso && opzioni.archivio) || null;
  lista = (archivio && opzioni.lista) || null;
  zona = (archivio && opzioni.zona) || null;
  stanza = (archivio && opzioni.stanza) || null;
  telefono = (archivio && opzioni.telefono) || null;
  sentinella = (telefono && opzioni.sentinella) || null;
  segnalatore = (telefono && opzioni.segnala) || null;
  bloccatore = (telefono && opzioni.blocca) || null;
  chiaviStanza = (telefono && opzioni.chiavi) || null;
  portaSvelamento = (telefono && opzioni.porta) || null;
  svelamento = portaSvelamento ? (id) => portaSvelamento.apri(id) : null;
  avvisiPorte = (portaSvelamento && opzioni.avvisiPorte) || null;
  storicoChiamate = (telefono && opzioni.storico) || null;
  appuntiStanza = (telefono && opzioni.appunti) || null;
  regaliStanza = (telefono && opzioni.regali) || null;
  regaloRicevuto = (telefono && opzioni.regaloRicevuto) || null;
  regaliProfilo = telefono && opzioni.storicoRegali ? creaSchermoRegali({ storico: opzioni.storicoRegali, disegna: () => disegna(),
    errore: (m) => MESSAGGI_SALVATAGGIO[m] || "Non riusciamo a leggere i tuoi regali. Riprova tra poco." }) : null;
  schermoProfilo = telefono && opzioni.coinProfilo ? creaSchermoProfilo({ coin: opzioni.coinProfilo, storico: opzioni.storicoRegali, disegna: () => disegna() }) : null;
  opzioniCoin = opzioni.coinProfilo || null; // saldo per la schermata 13 dopo l'iscrizione (#349, linea B)
  esitiSegnalazioni = (telefono && opzioni.esiti) || null;
  sanzioniMie = (telefono && opzioni.sanzioni) || null;
  supporto = (telefono && opzioni.aiuto) || null;
  vostriIncontri = (telefono && opzioni.vostriIncontri) || null;
  incontroVostro = (telefono && opzioni.incontro) || null;
  valutazioneVostra = (telefono && opzioni.valutazione) || null;
  riepilogoMio = (telefono && opzioni.riepilogo) || null;
  contestaNo = (telefono && opzioni.riepilogo && opzioni.riepilogo.contesta) || null; // #6 spec v1.3 punto 2 (linea B)
  filoDomenica = (telefono && opzioni.filoDomenica) || null;
  filoLunedi = (telefono && opzioni.filoLunedi) || null;
  filoRiascolto = (telefono && opzioni.filoRiascolto) || null;
  uscitaStanza = telefono && accesso ? creaUscita({ token: () => accesso.token() }) : null; // col token di chi è entrato
  // #380, linea A. La prova (/app/prova.html) passa la sua stanza viva finta, con risposte in memoria.
  stanzaViva = telefono && accesso ? (opzioni.stanzaViva || creaStanzaViva({ token: () => accesso.token() })) : null;
  battito = stanzaViva ? creaBattito({ viva: stanzaViva, pagina: document, quando: battitoArrivato }) : null;
  if (opzioni.erroreLink) { stato.passo = 1; email.errore = MESSAGGI[opzioni.erroreLink] || MESSAGGI.generico; }
  // Già dentro (dal link nell'email o da una sessione precedente): si riparte dal passo salvato.
  if (accesso && accesso.connesso()) { stato.passo = 2; if (archivio) { riprendi(); return; } }
  disegna();
}

// Al rientro: legge da Supabase ciò che è già stato salvato e riparte dal passo lasciato.
async function riprendi() {
  radice.replaceChildren(h("section", { classe: "schermata" }, h("h1", {}, "Un attimo…"), h("p", { classe: "sottotitolo" }, "Riprendiamo da dove eri rimasto.")));
  const salvato = await archivio.leggi();
  if (!salvato.ok) {
    if (salvato.motivo === "accesso") { await accesso.esci(); stato.passo = 1; }
    salvataggio.errore = MESSAGGI_SALVATAGGIO[salvato.motivo] || MESSAGGI_SALVATAGGIO.salvataggio;
    disegna();
    return;
  }
  stato.passo = statoDaSalvato(stato, salvato);
  stato.provinciaSalvata = stato.provincia;
  passoMassimo = stato.passo;
  precompilaDallaLista(); // in anticipo: al passo 5 la provincia della lista è già pronta
  const q = stato.questionario;
  const mancante = DOMANDE.find((d) => erroreRisposta(d.n, q.risposte[d.n]) !== null);
  q.domanda = mancante ? mancante.n : DOMANDE.length;
  // File già caricati: si scaricano per poterli riascoltare e rivedere (solo i propri, regole per riga).
  const scarica = async (cartella, nome) => {
    const blob = await archivio.scaricaFile(cartella, nome);
    return blob ? { blob, url: URL.createObjectURL(blob), secondi: 0, salvatoCome: nome } : null;
  };
  const attese = [];
  if (salvato.voci.includes(FILE_VOCE)) attese.push(scarica("voci", FILE_VOCE).then((v) => { stato.voce = v; }));
  stato.domandeVoce.forEach((i, k) => {
    if (salvato.voci.includes(fileRisposta(k))) attese.push(scarica("voci", fileRisposta(k)).then((v) => { if (v) stato.risposteVoce[i] = v; }));
  });
  [0, 1, 2].forEach((i) => {
    if (salvato.foto.includes(fileFoto(i))) attese.push(scarica("foto", fileFoto(i)).then((v) => { stato.foto[i] = v; }));
  });
  await Promise.all(attese);
  disegna();
}

// Salva (se l'accesso è acceso) e poi va al passo indicato. In anteprima va subito avanti.
async function salvaEVai(passo, ...operazioni) {
  if (!archivio) { vai(passo); return; }
  if (salvataggio.inCorso) return;
  salvataggio.inCorso = true; salvataggio.errore = ""; disegna();
  let esito = { ok: true };
  // Il passo salvato non torna mai indietro: chi modifica il profilo completo resta «completo».
  const raggiunto = Math.max(passo, passoMassimo);
  for (const operazione of [...operazioni, () => archivio.salvaProfilo({ passo: raggiunto })]) {
    esito = await operazione();
    if (!esito.ok) break;
  }
  salvataggio.inCorso = false;
  if (!esito.ok) {
    salvataggio.errore = esito.motivo === "regola" ? esito.messaggio : (MESSAGGI_SALVATAGGIO[esito.motivo] || MESSAGGI_SALVATAGGIO.salvataggio);
    // Cambio della provincia rifiutato (entro 7 giorni): il campo torna com'era.
    if (esito.motivo === "regola" && stato.provinciaSalvata) {
      stato.provincia = stato.provinciaSalvata; stato.provinciaTesto = nomeMenu(stato.provinciaSalvata);
    }
    if (esito.motivo === "accesso") { await accesso.esci(); stato.passo = 1; }
    disegna();
    return;
  }
  const primaVoltaFatto = passoMassimo < PASSI.length - 1 && raggiunto === PASSI.length - 1;
  passoMassimo = raggiunto;
  // La provincia sul server è quella del «Continua» di «Chi sei» (gli altri passi salvano solo il loro pezzo):
  // così una provincia solo precompilata dalla lista non risulta già salvata.
  if (PASSI[stato.passo].id === "chi" && stato.provincia) {
    if (stato.provinciaSalvata && stato.provincia !== stato.provinciaSalvata) {
      cambio.avviso = `Provincia cambiata: ${nomeVisibile(stato.provincia)}. Vale dalla stanza di lunedì ${lunediCambio()}.`;
    }
    stato.provinciaSalvata = stato.provincia;
  }
  vai(passo);
  if (primaVoltaFatto) apriCreditiDopoIscrizione();
}

// Carica un file solo se è nuovo o se deve cambiare nome (es. una risposta a voce passata da 2ª a 1ª).
function caricaSeServe(cartella, nome, voce) {
  return async () => {
    if (!voce || voce.salvatoCome === nome) return { ok: true };
    if (!voce.blob) return { ok: false, motivo: "salvataggio" };
    const r = await archivio.caricaFile(cartella, nome, voce.blob);
    if (r.ok) voce.salvatoCome = nome;
    return r;
  };
}

function vai(passo) {
  if (registrazioneInCorso) { registrazioneInCorso.ferma(); registrazioneInCorso = null; }
  if (PASSI[passo] && PASSI[passo].id === "fatto") cambio.daProfilo = false;
  else if (!PASSI[passo] || PASSI[passo].id !== "chi") cambio.avviso = "";
  salvataggio.errore = "";
  stato.passo = Math.max(0, Math.min(PASSI.length - 1, passo));
  disegna();
  window.scrollTo(0, 0);
  const titolo = radice.querySelector("h1");
  if (titolo) { titolo.setAttribute("tabindex", "-1"); titolo.focus({ preventScroll: true }); }
}

// Onda grande del benvenuto (design v4, .onda-grande.attesa): 27 barre nei toni del rosso, più alte al centro. Solo
// decorazione (aria-hidden); altezze e colori via CSSOM (la CSP style-src 'self' vieta solo gli attributi style).
const ROSSI_ONDA = ["#8F2414", "#B83220", "#C7361F", "#D63A22", "#E8432B", "#F05A43", "#F46A53", "#FF7A62"];
function ondaGrande() {
  const n = 27;
  const barre = Array.from({ length: 27 }, (_, k) => {
    const e = Math.sin(((k + 0.5) / n) * Math.PI);
    const span = h("span");
    const d = Math.abs(k - (n - 1) / 2) / ((n - 1) / 2);
    const tono = ROSSI_ONDA[Math.max(0, Math.min(ROSSI_ONDA.length - 1, Math.round((1 - d) * (ROSSI_ONDA.length - 1))))];
    span.style.height = `${12 + Math.round(88 * Math.pow(e, 1.5) * (0.7 + 0.3 * Math.sin(k * 0.9 + 1)))}px`;
    span.style.background = `linear-gradient(180deg, ${tono}, #8F2414)`;
    span.style.animationDelay = `${(-k * 0.16).toFixed(2)}s`;
    return span;
  });
  return h("div", { classe: "onda-grande", "aria-hidden": "true" }, barre);
}
function conClasse(el, classe) { el.className = classe; return el; }

// Tre risposte a voce: si cambia domanda restando nello stesso passo (ferma una registrazione in corso, titolo a fuoco).
function vaiRisposta() { vai(stato.passo); }

// Spec v1.3: se la lista d'attesa ha la provincia (stessa email del login) il campo arriva già scelto, da confermare.
// Solo se il campo è ancora vuoto e la persona non ha iniziato a scrivere; se il Worker tarda (2 s) si resta col campo vuoto.
function precompilaDallaLista() {
  if (!lista || listaChiesta || stato.provincia || stato.provinciaSalvata) return;
  listaChiesta = true;
  lista.leggi().then((sigla) => {
    if (!sigla || stato.provincia || stato.provinciaTesto.trim()) return;
    stato.provincia = sigla; stato.provinciaTesto = nomeMenu(sigla); stato.provinciaLista = sigla;
    if (PASSI[stato.passo] && PASSI[stato.passo].id === "chi") disegna();
  });
}

// Al «Continua» del passo 5: provincia della lista confermata senza cambi → la salva il server con origine «lista».
// Non blocca mai: se non riesce, il salvataggio normale scrive la provincia con origine «scelta».
async function confermaDallaLista() {
  if (lista && !stato.provinciaSalvata && stato.provinciaLista && stato.provincia === stato.provinciaLista) {
    await lista.conferma(stato.provincia);
  }
  return { ok: true };
}

// Spec #3 v1.2: nella home, se l'area non è ancora accesa, «Milano e dintorni: mancano 7 persone…». Il testo lo prepara
// il server; se tarda o non c'è, la home resta com'è.
function chiediContatore() {
  if (!zona || contatore.chiesto) return;
  contatore.chiesto = true;
  zona.leggi().then((testo) => {
    contatore.testo = testo;
    if (testo && PASSI[stato.passo] && PASSI[stato.passo].id === "fatto") disegna();
  });
}

// Spec #3 v1: la conferma già data si legge una volta; se tarda o non c'è, resta il pulsante.
function chiediConferma() {
  if (!stanza || ingresso.chiesto) return;
  ingresso.chiesto = true;
  stanza.leggi().then((r) => {
    if (r.ok) ingresso.apreIl = r.apreIl;
    ingresso.letto = true;
    if (PASSI[stato.passo] && PASSI[stato.passo].id === "fatto") disegna();
  });
}

async function entraNellaStanza() {
  if (!stanza || ingresso.inCorso) return;
  ingresso.inCorso = true; ingresso.errore = ""; ingresso.avviso = ""; disegna();
  const r = await stanza.entra();
  ingresso.inCorso = false;
  if (r.ok && r.apreIl) ingresso.apreIl = r.apreIl;
  else ingresso.errore = MESSAGGI_STANZA[r.motivo] || MESSAGGI_STANZA.salvataggio;
  disegna();
}

async function ciRipenso() {
  if (!stanza || ingresso.inCorso || !ingresso.apreIl) return;
  ingresso.inCorso = true; ingresso.errore = ""; ingresso.avviso = ""; disegna();
  const r = await stanza.ritira(ingresso.apreIl);
  ingresso.inCorso = false;
  if (r.ok) { ingresso.apreIl = null; ingresso.avviso = "Va bene: questa settimana non entri. Puoi cambiare idea fino a domenica alle 23:59."; }
  else ingresso.errore = MESSAGGI_STANZA[r.motivo] || MESSAGGI_STANZA.salvataggio;
  disegna();
}

// Spec #3 v1.1: il raggio passa ad «Anche altre città» solo se la persona tocca «Sì, allarga il raggio».
async function allargaIlRaggio() {
  if (!archivio || italia.inCorso) return;
  italia.inCorso = true; italia.errore = ""; disegna();
  const r = await archivio.salvaFiltri({ raggio: "italia" });
  italia.inCorso = false;
  if (r.ok) { stato.raggio = "italia"; italia.avviso = "Fatto: entri nella Stanza Italia. Puoi cambiare il raggio da «Modifica il profilo»."; }
  else italia.errore = MESSAGGI_STANZA[r.motivo] || MESSAGGI_STANZA.salvataggio;
  disegna();
}

function bloccoItalia() {
  if (!archivio || !chiediItalia({ raggio: stato.raggio, contatore: contatore.testo, aspetto: italia.aspetto })) return null;
  return h("div", { classe: "domanda-italia", role: "group", "aria-labelledby": "domanda-italia" },
    h("p", { id: "domanda-italia" }, "Vuoi entrare intanto nella Stanza Italia?"),
    h("div", { classe: "scelte-italia" },
      h("button", { classe: "bottone-secondario", type: "button", disabled: italia.inCorso, onclick: allargaIlRaggio }, "Sì, allarga il raggio"),
      h("button", { classe: "bottone-secondario", type: "button", disabled: italia.inCorso, onclick: () => { italia.aspetto = true; disegna(); } }, "Aspetto la mia zona")),
    errore(italia.errore));
}

function bloccoStanza() {
  if (!stanza) return null;
  chiediConferma();
  const conferma = ingresso.apreIl ? testoConferma(ingresso.apreIl) : null;
  return h("div", { classe: "ingresso-stanza" },
    conferma
      ? [h("p", { role: "status", id: "conferma-stanza" }, conferma),
        h("button", { classe: "link", type: "button", disabled: ingresso.inCorso, onclick: ciRipenso }, "Ci ripenso")]
      : [h("button", { classe: "bottone", type: "button", disabled: ingresso.inCorso || !ingresso.letto, onclick: entraNellaStanza }, "Entra nella stanza"),
        h("p", { classe: "nota" }, "La prima stanza è in regalo, poi 80 crediti a stanza. Si conferma entro domenica alle 23:59.")],
    ingresso.inCorso ? h("p", { classe: "nota", role: "status" }, "Un attimo…") : null,
    ingresso.avviso ? h("p", { classe: "nota", role: "status" }, ingresso.avviso) : null,
    errore(ingresso.errore));
}

// Il telefono avvisa a ogni cambio. Si ridisegna solo se cambia la struttura (firma); timer e conti si aggiornano
// sul posto, così il fuoco della tastiera e del lettore di schermo non salta ogni secondo. Fuori dalla home, senza
// chiamata, la pagina non si tocca (si potrebbe star scrivendo).
export function telefonoCambiato() {
  if (!telefono || !radice) return;
  const firma = telefono.firma();
  const m = telefono.modello();
  if (firma === ultimaFirma) { aggiornaSulPosto(m); return; }
  const prima = ultimaFirma;
  ultimaFirma = firma;
  const senzaChiamata = (f) => !f || JSON.parse(f).schermo.tipo === "nessuna";
  if (PASSI[stato.passo].id !== "fatto" && senzaChiamata(prima) && m.schermo.tipo === "nessuna") return;
  disegna();
}

function aggiornaSulPosto(m) {
  const sc = m.schermo;
  const metti = (id, testo) => { const el = radice.querySelector(`#${id}`); if (el && testo && el.textContent !== testo) el.textContent = testo; };
  metti("chiamata-timer", sc.timer);
  // Design v4 (#349): il conto alla rovescia della home si aggiorna sul posto a ogni giro della sentinella.
  const conto = radice.querySelector("#conto-settimana");
  if (conto) {
    const c = settimanaDellaHome().conto;
    if (c && conto.textContent !== c) { conto.textContent = c; conto.setAttribute("aria-label", `${TESTI_SETTIMANA.manca} ${c}`); }
  }
  if (domenicaSera.aggiornaSulPosto(radice, new Date())) disegna(); // schermata 35: conto, alle 21 sparisce
  if (sc.tipo === "squillo_in_uscita") metti("chiamata-testo", sc.testo);
  if (sc.carte) metti("chiamata-carte", sc.carte.etichetta);
}

function avviaSentinella() {
  if (!sentinella || sentinellaAvviata) return;
  sentinellaAvviata = true;
  sentinella.avvia();
}

// «Quando posso ricevere chiamate» (spec #4 v1.3 § 1): due selettori a passo di 30 minuti, l'interruttore della pausa
// e «Salva». Vale subito; i controlli sono gli stessi del server (disponibilita.js) e li ripete il database.
function apriDisponibilita() {
  Object.assign(disponibilita, daProfilo({ fascia_da: stato.fasciaDa, fascia_a: stato.fasciaA, pausa_il: stato.pausaIl }),
    { aperta: true, inCorso: false, errore: "", avviso: "" });
  disegna();
  window.scrollTo(0, 0);
  const titolo = radice.querySelector("h1");
  if (titolo) { titolo.setAttribute("tabindex", "-1"); titolo.focus({ preventScroll: true }); }
}

function chiudiDisponibilita() {
  disponibilita.aperta = false;
  disegna();
}

async function salvaDisponibilita() {
  if (disponibilita.inCorso) return;
  const c = campiDaSalvare(disponibilita);
  disponibilita.avviso = "";
  if (!c.ok) { disponibilita.errore = c.errore; disegna(); return; }
  disponibilita.inCorso = true; disponibilita.errore = ""; disegna();
  const r = await archivio.salvaDisponibilita(c.campi);
  disponibilita.inCorso = false;
  if (r.ok) {
    stato.fasciaDa = c.campi.fascia_da; stato.fasciaA = c.campi.fascia_a; stato.pausaIl = c.campi.pausa_il || "";
    disponibilita.avviso = testoSalvato(disponibilita);
  } else if (r.motivo === "accesso") {
    disponibilita.aperta = false; await accesso.esci(); stato.passo = 1;
  } else {
    disponibilita.errore = r.motivo === "regola" ? r.messaggio : (MESSAGGI_SALVATAGGIO[r.motivo] || MESSAGGI_SALVATAGGIO.salvataggio);
  }
  disegna();
}

function schermoDisponibilita() {
  const d = disponibilita;
  const selettore = (id, etichetta, orari, valore, imposta) => h("div", { classe: "campo" },
    h("label", { for: id }, etichetta),
    h("select", { id, onchange: (e) => { imposta(e.target.value); d.avviso = ""; d.errore = ""; } },
      orari.map((o) => h("option", { value: o, selected: o === valore }, o))));
  return h("section", { classe: "schermata" },
    h("h1", {}, TESTI_FASCIA.titolo),
    h("p", { classe: "sottotitolo" }, TESTI_FASCIA.sottotitolo),
    h("div", { classe: "corpo" },
      selettore("fascia-da", TESTI_FASCIA.dalle, ORARI_DALLE, d.da, (v) => { d.da = v; }),
      selettore("fascia-a", TESTI_FASCIA.alle, ORARI_ALLE, d.a, (v) => { d.a = v; }),
      h("div", { classe: "campo" },
        h("label", { for: "pausa-oggi" },
          h("input", { id: "pausa-oggi", type: "checkbox", role: "switch", checked: d.pausa, "aria-describedby": "pausa-nota",
            onchange: (e) => { d.pausa = e.target.checked; d.avviso = ""; } }),
          " ", TESTI_FASCIA.pausa),
        h("p", { classe: "nota", id: "pausa-nota" }, TESTI_FASCIA.notaPausa))),
    errore(d.errore),
    d.inCorso ? h("p", { classe: "nota", role: "status" }, "Salvataggio…") : null,
    d.avviso ? h("p", { classe: "nota", role: "status" }, d.avviso) : null,
    h("div", { classe: "azioni" },
      h("button", { classe: "bottone", type: "button", disabled: d.inCorso, onclick: salvaDisponibilita }, "Salva"),
      h("button", { classe: "bottone-secondario", type: "button", onclick: chiudiDisponibilita }, "Torna al profilo")));
}

// «La tua stanza» nella home: le persone della stanza con la scheda e «Chiama».
function bloccoTuaStanza() {
  if (!telefono) return null;
  telefono.caricaPersone();
  avviaSentinella();
  if (avvisiPorte && !avvisiAvviati) { avvisiAvviati = true; avvisiPorte.avvia(); }
  const m = telefono.modello();
  const st = m.stanza;
  // #360 passo 9b: lunedì, la prima volta che si apre la stanza, la schermata 18 del Filo al posto della stanza.
  const filo = st.stato === "pronta" && !st.chiusa && filoLunedi
    ? vistaStanzaFilo(h, filoLunedi, { persone: st.persone.filter((p) => !scheda.bloccate.has(p.id)), mioNome: nomeMio(), entra: dopoBenvenutoFilo })
    : null;
  if (filo) return filo;
  let contenuto;
  if (chiaviStanza) chiaviStanza.prepara();
  if (chiaviStanza && chiaviStanza.modello().sera && st.stato === "pronta" && !st.chiusa && !stanzaRilettaDiSera) {
    stanzaRilettaDiSera = true;
    telefono.ricaricaPersone();
  }
  if (appuntiStanza && st.stato === "pronta") appuntiStanza.prepara(st.persone.map((p) => p.id));
  if (regaliStanza && st.stato === "pronta" && !st.chiusa) regaliStanza.prepara(st.persone.map((p) => p.id));
  if (st.stato === "pronta" && st.chiusa) {
    // #5 spec v1.1 passo 9: stanza «Chiusa» fino a lunedì 9:00. Schede in sola lettura (con i tuoi appunti), senza
    // pulsanti Chiama o Chiave; il menu ⋯ resta per segnalare o bloccare.
    contenuto = h("ul", { classe: "compagni" }, st.persone.filter((p) => !scheda.bloccate.has(p.id)).map((p) =>
      h("li", { classe: "compagno" },
        h("div", {}, h("strong", {}, p.titolo), p.sottotitolo ? h("span", { classe: "nota" }, p.sottotitolo) : null),
        menuDellaScheda(p),
        appuntiStanza ? vistaAppunti(h, appuntiStanza, p.id, nomeScheda(p)) : null)));
  } else if (st.stato === "pronta") {
    // Con un testo della spec v1.3 il pulsante è spento ma resta raggiungibile da tastiera e lettore di schermo
    // (aria-disabled); il tocco non chiama (telefono.chiama controlla di nuovo). Mentre si è in chiamata: disabled.
    // #380 (schermata 19): con gli stati del battito, cerchio diviso, stato scritto sotto il nome e CHIAMA o FISSA.
    if (battito && !battitoAvviato) { battitoAvviato = true; battito.avvia(); }
    const persone = st.persone.filter((p) => !scheda.bloccate.has(p.id));
    const nomi = new Map(persone.map((p) => [p.id, nomeScheda(p)]));
    const adesso = new Date();
    const aperti = new Map(viva.appuntamenti.filter((a) => a.stato === "proposto" || a.stato === "confermato").map((a) => [a.altra, a]));
    const riga = (p) => {
      const conTesto = !p.chiama && Boolean(p.etichetta) && p.etichetta !== "Chiama";
      const sp = viva.letto ? viva.stati.get(p.id) : null;
      const statoScritto = sp && !viva.persa ? rigaStato(sp, nomi) : "";
      const az = viva.letto ? azioneRiga({ etichetta: p.etichetta, stato: sp ? sp.stato : "", adesso, appuntamento: aperti.get(p.id) || null }) : null;
      let pulsante;
      if (az && az.tipo === "fissa") {
        pulsante = h("button", { classe: "bottone-secondario", type: "button", disabled: m.attesa,
          "aria-label": `${TESTI_FISSA.titolo(nomeScheda(p))}${az.motivo ? ` (${az.motivo})` : ""}`, onclick: () => apriFissa(p) }, TESTI_FISSA.fissa);
      } else if (az && az.tipo === "testo") {
        pulsante = h("button", { classe: "bottone-secondario", type: "button", "aria-label": `${p.titolo}: ${az.testo}`, "aria-disabled": "true",
          disabled: m.attesa, onclick: () => {} }, az.testo);
      } else if (az) {
        pulsante = h("button", { classe: "bottone-secondario", type: "button", "aria-label": p.chiama ? p.descrizione : `${TESTI_FISSA.chiama} ${p.titolo}`, disabled: m.attesa,
          onclick: () => telefono.chiama(p.id) }, TESTI_FISSA.chiama);
      } else {
        pulsante = h("button", { classe: "bottone-secondario", type: "button", "aria-label": p.descrizione,
          "aria-disabled": conTesto ? "true" : null, disabled: m.attesa || (!p.chiama && !conTesto),
          onclick: () => telefono.chiama(p.id) }, p.etichetta || "Chiama");
      }
      return h("li", { classe: "compagno" },
        h("div", {},
          h("strong", {}, sp && !viva.persa ? h("span", { classe: `punto-stato ${sp.stato}`, "aria-hidden": "true" }) : null, p.titolo),
          h("span", { classe: "nota" }, [p.sottotitolo, statoScritto, testoChiamate(p.chiamate)].filter(Boolean).join(" · "))),
        pulsante, menuDellaScheda(p),
        chiaviStanza ? vistaSchedaChiave(h, chiaviStanza, p.id, nomeScheda(p)) : null,
        appuntiStanza ? vistaAppunti(h, appuntiStanza, p.id, nomeScheda(p)) : null,
        regaliStanza ? vistaRegaliScheda(h, regaliStanza, p.id, nomeScheda(p)) : null);
    };
    if (viva.letto && persone.length) {
      const PRESENTO = { uomini: "uomo", donne: "donna" };
      const gruppo = (id) => (viva.stati.get(id) || {}).gruppo;
      const disp = disponiStanza(persone.map((p) => ({ id: p.id, presento: PRESENTO[gruppo(p.id)] || "altre" })),
        { id: "tu", presento: stato.miPresento });
      const perId = new Map(persone.map((p) => [p.id, p]));
      const stati = viva.persa ? {} : Object.fromEntries(persone.map((p) => [p.id, (viva.stati.get(p.id) || {}).stato]));
      contenuto = [
        viva.persa ? h("p", { classe: "nota connessione-persa", role: "status" }, TESTI_FISSA.connessione) : null,
        vistaCerchioStanza(h, disp, { stati }),
        h("p", { classe: "legenda-stati", "aria-hidden": "true" },
          h("span", {}, h("span", { classe: "punto-stato online" }), "online"),
          h("span", {}, h("span", { classe: "punto-stato in_chiamata" }), "in chiamata"),
          h("span", {}, h("span", { classe: "punto-stato non_in_linea" }), "non in linea")),
        vistaAvvisiAppuntamenti(nomi, adesso),
        disp.elenco.map((g) => [g.titolo ? h("h3", { classe: "gruppo-stanza" }, g.titolo) : null,
          h("ul", { classe: "compagni" }, g.persone.map((x) => riga(perId.get(x.id))))]),
      ];
    } else {
      contenuto = h("ul", { classe: "compagni" }, persone.map(riga));
    }
  } else if (st.stato === "vuota") {
    contenuto = h("p", { classe: "nota" }, "Qui troverai le persone della tua stanza quando apre, il lunedì alle 9:00.");
  } else if (st.stato === "errore") {
    contenuto = [errore(st.errore), h("button", { classe: "link", type: "button", onclick: () => telefono.caricaPersone() }, "Riprova")];
  } else {
    contenuto = h("p", { classe: "nota", role: "status" }, "Un attimo…");
  }
  return h("section", { classe: "tua-stanza", "aria-labelledby": "tua-stanza-titolo" },
    h("h2", { id: "tua-stanza-titolo" }, "La tua stanza", st.chiusa ? h("span", { classe: "etichetta-chiusa" }, " · Chiusa") : null),
    chiaviStanza ? vistaSeraFilo(h, filoDomenica, chiaviStanza, () => vistaSera(h, chiaviStanza, { svelamento })) : null,
    avvisiPorte ? vistaAvvisiPorte(h, avvisiPorte, { apri: svelamento, soloUrgenti: seraConPorte() }) : null,
    chiaviStanza && st.stato === "pronta" && !st.chiusa ? vistaChiavi(h, chiaviStanza) : null,
    st.stato === "pronta" && !st.chiusa && filoRiascolto ? vistaFiloRiascolto(h, filoRiascolto) : null,
    contenuto,
    st.stato === "pronta" && st.chiusa ? h("p", { classe: "nota" }, "La stanza è chiusa: puoi rileggere le schede e i tuoi appunti fino a lunedì alle 9:00, quando apre una nuova stanza.") : null,
    st.stato === "pronta" && !st.chiusa ? h("p", { classe: "nota" }, "Chiamate solo voce da 15 minuti. Niente numeri, cognomi o social prima della porta.") : null,
    st.stato === "pronta" && !st.chiusa && uscitaStanza ? h("button", { classe: "link", type: "button", disabled: m.attesa, onclick: apriUscita }, TESTI_USCITA.lascia) : null,
    uscita.fatto ? h("p", { classe: "nota", role: "status" }, uscita.fatto) : null,
    viva.avviso ? h("p", { classe: "nota", role: "status" }, viva.avviso) : null,
    errore(viva.errore),
    m.attesa ? h("p", { classe: "nota", role: "status" }, "Un attimo…") : null,
    errore(m.errore));
}

// Schermo della chiamata (spec #4 v1 punti 3-5): prende tutta la pagina finché la chiamata non è chiusa.
function schermoChiamata(m) {
  const sc = m.schermo;
  const t = telefono;
  if (sc.tipo !== "diario") notaDiario.testo = "";
  const bottone = (testo, onclick, { classe = "bottone-secondario", disabled = false, ...altri } = {}) =>
    h("button", { classe, type: "button", disabled: disabled || m.attesa, onclick, ...altri }, testo);
  let parti;
  if (sc.tipo === "squillo_in_arrivo") {
    parti = [h("h1", {}, sc.titolo), h("p", { classe: "sottotitolo" }, sc.testo),
      h("div", { classe: "azioni-chiamata" }, bottone("Rifiuta", () => t.rifiuta()), bottone("Rispondi", () => t.rispondi(), { classe: "bottone" }))];
  } else if (sc.tipo === "squillo_in_uscita") {
    parti = [h("h1", {}, sc.titolo), h("p", { classe: "sottotitolo", id: "chiamata-testo" }, sc.testo),
      h("div", { classe: "azioni-chiamata" }, bottone("Chiudi", () => t.chiudi(false)))];
  } else if (sc.tipo === "in_corso") {
    if (regaloRicevuto) regaloRicevuto.avvia(() => telefono && telefono.modello().inCorsoCon);
    parti = [
      sc.banner ? h("p", { classe: "banner-chiamata", role: "note" }, sc.banner) : null,
      h("h1", {}, m.nome || "In chiamata"),
      h("p", { classe: "timer timer-chiamata", id: "chiamata-timer", role: "timer", "aria-label": "Tempo che resta" }, sc.timer),
      sc.avviso ? h("p", { classe: "avviso-chiamata", role: "alert" }, sc.avviso) : null,
      sc.riconnessione ? h("p", { classe: "nota", role: "status" }, sc.riconnessione) : null,
      m.riconnetti ? [h("p", { classe: "errore", role: "alert" }, "Hai perso la connessione: hai 30 secondi per rientrare"),
        bottone("Riconnetti", () => t.riconnetti(), { classe: "bottone" })] : null,
      sc.carta ? h("figure", { classe: "carta-chiamata" }, h("blockquote", {}, sc.carta.testo), h("figcaption", { classe: "nota" }, sc.carta.da)) : null,
      sc.suggerimento && !sc.carta ? h("p", { classe: "nota" }, sc.suggerimento) : null,
      h("div", { classe: "azioni-chiamata" },
        bottone(m.muto ? "Microfono spento" : "Microfono acceso", () => t.microfono(), { "aria-pressed": m.muto ? "true" : "false", disabled: m.riconnetti }),
        sc.carte ? bottone(sc.carte.etichetta, () => t.carta(), { id: "chiamata-carte", disabled: !sc.carte.attiva }) : null,
        vistaRegaloChiamata(h, regaliStanza, { a: m.inCorsoCon, nome: m.nome }),
        bottone("Chiudi", () => t.chiudi(false)),
        bottone("Chiudi e segnala", () => t.chiudi(true), { classe: "bottone-pericolo" })),
    ];
  } else if (sc.tipo === "richiameresti") {
    // Spec v1.3 § 3: Sì / No / Salta, nota segreta sotto, «Segnala un problema» in fondo. Nessuna risposta obbligata.
    parti = [sc.testo ? h("p", { classe: "sottotitolo", role: "status" }, sc.testo) : null,
      h("h1", { id: "domanda-dopo" }, sc.titolo),
      h("div", { classe: "azioni-chiamata", role: "group", "aria-labelledby": "domanda-dopo" },
        sc.risposte.map(([valore, testo]) => bottone(testo, () => t.richiameresti(valore), { classe: valore === "salta" ? "link" : "bottone-secondario" }))),
      h("p", { classe: "nota" }, sc.nota),
      bottone("Segnala un problema", () => t.segnalaProblema(), { classe: "link" })];
  } else if (sc.tipo === "diario") {
    // #5 spec v1.1 passo 2: «Lo leggi solo tu. Non lo usiamo per niente.» Salva o Salta, nessun obbligo.
    parti = [h("h1", {}, sc.titolo),
      h("label", { for: "testo-diario" }, sc.suggerimento),
      h("textarea", { id: "testo-diario", classe: "racconto-segnala", maxlength: String(sc.massimo), rows: "5", disabled: m.attesa,
        oninput: (e) => { notaDiario.testo = e.target.value; } }, notaDiario.testo),
      h("p", { classe: "nota" }, sc.nota),
      // Design v4 (schermata 32, confronto del 25/11): «Salta» e «Salva» sulla stessa riga.
      h("div", { classe: "azioni-chiamata azioni-diario" },
        bottone(sc.salta, () => t.saltaDiario(), { classe: "bottone-secondario" }),
        bottone(sc.salva, () => t.salvaDiario(notaDiario.testo), { classe: "bottone" }))];
  } else if (sc.tipo === "dopo_fine") {
    parti = [h("h1", {}, sc.titolo),
      sc.testo ? h("p", { classe: "sottotitolo" }, sc.testo) : null,
      h("div", { classe: "azioni-chiamata" }, bottone("Torna alla stanza", () => t.torna(), { classe: "bottone" })),
      bottone("Segnala un problema", () => t.segnalaProblema(), { classe: "link" })];
  } else if (sc.tipo === "segnala") {
    parti = schermoSegnala(m);
  } else {
    parti = [h("h1", {}, sc.titolo || "Chiamata finita"),
      h("div", { classe: "azioni-chiamata" }, bottone("Torna alla stanza", () => t.torna(), { classe: "bottone" }))];
  }
  return h("section", { classe: "schermata chiamata", "aria-label": "Chiamata" }, parti, errore(m.errore));
}

// Modulo di segnalazione (#7 spec v1.1 punti 2-3): motivo, racconto facoltativo, «Blocca anche», conferma con il 112.
function schermoSegnala(m, alla = () => telefono.torna()) {
  const sg = m.segnala || {};
  const chiave = `${sg.contro || ""}|${sg.origine || ""}`;
  const st = segnalazione;
  if (st.chiave !== chiave) Object.assign(st, { chiave, motivo: "", testo: "", blocca: true, invio: false, errore: "", esito: null });
  const torna = () => { const inviata = !!st.esito; Object.assign(st, { chiave: "", esito: null }); alla(inviata); };
  if (st.esito) {
    const c = confermaSegnala(st.esito, m.nome);
    return [h("h1", { tabindex: "-1" }, c.titolo), h("p", { classe: "sottotitolo", role: "status" }, c.testo),
      c.pericolo ? [h("p", { classe: "avviso-chiamata", role: "alert" }, c.pericolo), h("a", { classe: "bottone-pericolo", href: c.telefono }, "Chiama il 112")] : null,
      h("div", { classe: "azioni-chiamata" }, h("button", { classe: "bottone", type: "button", onclick: torna }, "Torna alla stanza"))];
  }
  const mod = moduloSegnala(sg, m.nome);
  const invia = async () => {
    const c = corpoSegnala(sg, st);
    if (!c.ok) { st.errore = c.errore; disegna(); return; }
    if (!segnalatore) { st.errore = testoErroreSegnala("spento"); disegna(); return; }
    st.invio = true; st.errore = ""; disegna();
    const r = await segnalatore.invia(c.corpo).catch(() => ({ ok: false, motivo: "rete" }));
    st.invio = false;
    if (r.ok) st.esito = { ore: r.ore, pericolo: r.pericolo }; else st.errore = testoErroreSegnala(r.motivo);
    disegna();
  };
  return [h("h1", {}, titoloSegnala(m)),
    h("fieldset", { classe: "motivi-segnala" }, h("legend", {}, mod.titolo),
      mod.motivi.map(([valore, testo]) => h("label", { classe: "casella" },
        h("input", { type: "radio", name: "motivo-segnala", value: valore, checked: st.motivo === valore, disabled: st.invio,
          onchange: () => { st.motivo = valore; st.errore = ""; } }), testo))),
    h("label", { for: "racconto-segnala" }, mod.etichettaTesto),
    h("textarea", { id: "racconto-segnala", classe: "racconto-segnala", maxlength: String(mod.massimo), rows: "4", disabled: st.invio,
      oninput: (e) => { st.testo = e.target.value; } }, st.testo),
    h("label", { classe: "casella" },
      h("input", { type: "checkbox", checked: mod.bloccoFisso || st.blocca, disabled: mod.bloccoFisso || st.invio,
        onchange: (e) => { st.blocca = e.target.checked; } }), mod.casella),
    h("p", { classe: "nota" }, mod.anonimato),
    st.errore ? h("p", { classe: "errore", role: "alert" }, st.errore) : null,
    h("div", { classe: "azioni-chiamata" },
      h("button", { classe: "bottone", type: "button", disabled: st.invio, onclick: invia }, st.invio ? "Invio…" : mod.invia),
      h("button", { classe: "link", type: "button", disabled: st.invio, onclick: torna }, "Torna alla stanza"))];
}
const titoloSegnala = (m) => (m.schermo && m.schermo.titolo) || "Segnala un problema";

function disegna() {
  collegaCerchio(document, { nome: nomeMio(), apri: profiloApribile() ? () => schermoProfilo.apri() : null }); // schermata 23 (#349, linea B)
  if (telefono) {
    ultimaFirma = telefono.firma();
    const m = telefono.modello();
    if (m.schermo.tipo !== "nessuna") { radice.replaceChildren(schermoChiamata(m)); return; }
  }
  // Schermata 22 (#381): sempre lo stesso nodo, così scelta e testo restano anche se la pagina si ridisegna.
  if (uscita.nodo) { if (radice.firstChild !== uscita.nodo || radice.childNodes.length !== 1) radice.replaceChildren(uscita.nodo); return; }
  if (viva.fissa && stanzaViva) { radice.replaceChildren(schermoFissa()); return; } // schermata 20 (#380)
  if (difficolta.aperta) { radice.replaceChildren(schermoDifficolta()); return; }
  if (scheda.segnala) { radice.replaceChildren(schermoSegnalaScheda()); return; }
  if (storico.aperto) { radice.replaceChildren(schermoStorico()); return; }
  if (regaliProfilo && regaliProfilo.aperto()) { radice.replaceChildren(regaliProfilo.schermo(h)); return; }
  if (schermoProfilo && schermoProfilo.aperto()) { radice.replaceChildren(schermoIlProfilo()); return; }
  profiloSotto = null; // profilo chiuso: la prossima volta si riapre dalla sua pagina, non da Notifiche o Privacy
  if (aiuto.aperta) { radice.replaceChildren(schermoAiuto()); return; }
  if (portaSvelamento && segnalaDaPorta(portaSvelamento.modello().segnala)) { radice.replaceChildren(schermoSegnalaPorta()); return; }
  if (portaSvelamento && portaSvelamento.modello().aperta) { radice.replaceChildren(vistaPorta(h, portaSvelamento)); return; }
  if (valutazioneVostra && valutazioneVostra.modello().porta) { radice.replaceChildren(schermoValutazioneVostra()); return; }
  if (incontroVostro && (incontroVostro.modello().porta || incontroVostro.modello().errore)) { radice.replaceChildren(schermoIncontroVostro()); return; }
  if (disponibilita.aperta && archivio) { radice.replaceChildren(schermoDisponibilita()); return; }
  // Schermata 35 «Domenica sera» (#349, linea C): domenica 20:00-20:59 con la stanza aperta, al posto della home.
  if (PASSI[stato.passo].id === "fatto") {
    const sera35 = vistaDomenicaSera(h, domenicaSera.modello(new Date(), { inStanza: inStanzaAperta() }), { rivedi: rivediStanza });
    if (sera35) { radice.replaceChildren(sera35); return; }
  }
  const passo = PASSI[stato.passo];
  const contenuto = SCHERMATE[passo.id]();
  const parti = [
    archivio ? null : h("div", { classe: "anteprima", role: "note" }, accesso
      ? "Prova: l'accesso con email è vero, il resto del profilo non viene ancora salvato. Voce e foto restano su questo telefono."
      : "Anteprima: niente viene inviato né salvato. Voce e foto restano su questo telefono finché non chiudi la pagina."),
    stato.passo > 0 && stato.passo < PASSI.length - 1 && !cambio.daProfilo ? barra() : null,
    contenuto,
  ];
  radice.replaceChildren(...parti.filter(Boolean));
}

function barra() {
  const totale = PASSI.length - 2;
  const fatto = stato.passo - 1;
  const riempimento = h("span");
  riempimento.style.width = `${Math.round((fatto / totale) * 100)}%`;
  return h("div", { classe: "avanzamento" },
    h("div", { classe: "avanzamento-testo" }, `Passo ${stato.passo} di ${totale + 1} · ${PASSI[stato.passo].titolo}`),
    h("div", { classe: "avanzamento-barra", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(totale), "aria-valuenow": String(fatto) }, riempimento));
}

// Design v4 (#349): la home, con la settimana al posto del titolo.
function inStanzaAperta() {
  if (!telefono) return false;
  const st = telefono.modello().stanza;
  return !!st && st.stato === "pronta" && !st.chiusa;
}
const settimanaDellaHome = () => settimanaHome(new Date(), { nome: stato.nome, inStanza: inStanzaAperta() });

function schermataHome(testa, corpo, azioni) {
  return h("section", { classe: "schermata" },
    testa,
    h("div", { classe: "corpo" }, corpo),
    errore(salvataggio.errore),
    salvataggio.inCorso ? h("p", { classe: "nota", role: "status" }, "Salvataggio…") : null,
    h("div", { classe: "azioni" }, azioni));
}

function schermata(titolo, sottotitolo, corpo, azioni) {
  return h("section", { classe: "schermata" },
    h("h1", {}, titolo),
    sottotitolo ? h("p", { classe: "sottotitolo" }, sottotitolo) : null,
    h("div", { classe: "corpo" }, corpo),
    errore(salvataggio.errore),
    salvataggio.inCorso ? h("p", { classe: "nota", role: "status" }, "Salvataggio…") : null,
    h("div", { classe: "azioni" }, azioni));
}

// «quando» può essere una funzione: allora il pulsante si riaccende/spegne con ricontrolla(), senza ridisegnare
// la schermata. Serve sui campi di testo: ridisegnare mentre si scrive (o al primo tocco fuori dal campo) su iPhone
// fa perdere il tocco sul pulsante.
let pulsanteAvanti = null;
let condizioneAvanti = null;
function avanti(testo, quando, onclick) {
  const condizione = typeof quando === "function" ? quando : () => Boolean(quando);
  const pronto = () => condizione() && !salvataggio.inCorso;
  const bottone = h("button", { classe: "bottone", type: "button", disabled: !pronto(), onclick: () => { if (pronto()) onclick(); } }, testo);
  pulsanteAvanti = bottone;
  condizioneAvanti = condizione;
  return bottone;
}
function ricontrolla() {
  if (pulsanteAvanti && condizioneAvanti) pulsanteAvanti.disabled = !condizioneAvanti() || salvataggio.inCorso;
}
function indietro() {
  return h("button", { classe: "bottone-secondario", type: "button", onclick: () => vai(stato.passo - 1) }, "Indietro");
}
// Da «Cambia provincia»: si torna al profilo senza salvare e la provincia torna quella salvata.
function tornaAlProfilo() {
  return h("button", { classe: "bottone-secondario", type: "button", onclick: () => {
    stato.provincia = stato.provinciaSalvata; stato.provinciaTesto = nomeMenu(stato.provinciaSalvata); vai(PASSI.length - 1);
  } }, "Annulla");
}
function errore(testo) {
  return testo ? h("p", { classe: "errore", role: "alert" }, testo) : null;
}

// Gruppo di scelte a pulsante (radio o caselle). valori: [[valore, etichetta]].
function scelte(nome, valori, scelto, onScelta, { multipla = false, etichetta = null, descrizione = null } = {}) {
  return h("div", { classe: "scelte", role: multipla ? "group" : "radiogroup",
    ...(etichetta ? { "aria-labelledby": etichetta } : {}), ...(descrizione ? { "aria-describedby": descrizione } : {}) },
    valori.map(([valore, etichetta]) => {
      const attivo = multipla ? scelto.includes(valore) : scelto === valore;
      return h("button", {
        type: "button", classe: attivo ? "scelta scelta-attiva" : "scelta",
        role: multipla ? "checkbox" : "radio", "aria-checked": attivo ? "true" : "false", "data-nome": nome,
        onclick: () => onScelta(valore),
      }, etichetta);
    }));
}

function etaDa(data) {
  const n = new Date(data + "T12:00:00");
  if (Number.isNaN(n.getTime())) return null;
  const oggi = new Date();
  let eta = oggi.getFullYear() - n.getFullYear();
  const m = oggi.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && oggi.getDate() < n.getDate())) eta--;
  return eta;
}

// Passo 2 con l'accesso acceso: manda l'email (link + codice di 6 cifre) e, se serve, chiede il codice.
function emailVera() {
  const valida = () => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(stato.email) && !email.attesa;
  const manda = async () => {
    email.attesa = true; email.errore = ""; disegna();
    const r = await accesso.mandaLink(stato.email, location.origin + "/app/");
    email.attesa = false;
    if (r.ok) { email.inviata = true; email.codice = ""; } else email.errore = MESSAGGI[r.motivo] || MESSAGGI.generico;
    disegna();
  };
  if (!email.inviata) {
    const campo = h("input", { type: "email", id: "email", autocomplete: "email", inputmode: "email", autocapitalize: "off", value: stato.email,
      placeholder: "nome@esempio.it", oninput: (e) => { stato.email = e.target.value.trim(); ricontrolla(); } });
    return schermata("La tua email",
      "Ti mandiamo un link: lo apri e sei dentro. Niente password.",
      [h("label", { for: "email" }, "Email"), campo, errore(email.errore)],
      [indietro(), avanti(email.attesa ? "Invio…" : "Mandami il link", valida, manda)]);
  }
  const entra = async () => {
    email.attesa = true; email.errore = ""; disegna();
    const r = await accesso.verificaCodice(stato.email, email.codice);
    email.attesa = false;
    if (r.ok) { email.inviata = false; if (archivio) riprendi(); else vai(2); } else { email.errore = MESSAGGI[r.motivo] || MESSAGGI.codice; disegna(); }
  };
  const codice = h("input", { type: "text", id: "codice", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", value: email.codice,
    placeholder: "123456", oninput: (e) => { email.codice = e.target.value.replace(/[^\d]/g, ""); ricontrolla(); } });
  return schermata("Ti abbiamo mandato un link",
    `Apri l'email che abbiamo mandato a ${stato.email} e tocca il link. Se hai aggiunto Presente alla schermata Home, scrivi qui il codice di 6 cifre della stessa email.`,
    [h("label", { for: "codice" }, "Codice"), codice, errore(email.errore),
      h("p", { classe: "nota" }, "Non è arrivata? Guarda nello spam, oppure ",
        h("button", { classe: "link", type: "button", disabled: email.attesa, onclick: manda }, "mandala di nuovo"), ".")],
    [h("button", { classe: "bottone-secondario", type: "button", onclick: () => { email.inviata = false; email.errore = ""; disegna(); } }, "Cambia email"),
      avanti(email.attesa ? "Controllo…" : "Entra", () => /^\d{6}$/.test(email.codice) && !email.attesa, entra)]);
}

// ---------------------------------------------------------------------------------------------------------------
const SCHERMATE = {
  benvenuto() {
    // Design v4, schermata 01 (Giuseppe, 24/11): onda grande al centro, una frase sola e «Entra» grande.
    return h("section", { classe: "schermata benvenuto-v4" },
      ondaGrande(),
      h("h1", {}, "Prima la voce.", h("br"), h("em", {}, "Poi il resto.")),
      h("p", { classe: "sottotitolo" }, "Una stanza di 12 persone vicine a te.", h("br"), "Chiamate solo voce da 15 minuti.", h("br"), "Le foto, solo dopo il sì di entrambi."),
      h("p", { classe: "nota" }, h("a", { href: "/privacy" }, "Informativa privacy"), " · Regole della community (in arrivo)"),
      h("div", { classe: "azioni" }, conClasse(avanti("Entra", true, () => vai(1)), "bottone grande")));
  },

  email() {
    if (accesso) return emailVera();
    const campo = h("input", { type: "email", id: "email", autocomplete: "email", inputmode: "email", autocapitalize: "off", value: stato.email,
      placeholder: "nome@esempio.it", oninput: (e) => { stato.email = e.target.value.trim(); ricontrolla(); } });
    const bottone = avanti("Mandami il link", () => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(stato.email), () => vai(2));
    return schermata("La tua email",
      "Ti mandiamo un link: lo apri e sei dentro. Niente password.",
      [h("label", { for: "email" }, "Email"), campo,
        h("p", { classe: "nota" }, "Nell'anteprima non mandiamo nessuna email: si passa direttamente al passo dopo.")],
      [indietro(), bottone]);
  },

  eta() {
    if (stato.minorenne) {
      return schermata("Presente è solo per maggiorenni.",
        "Ci dispiace: per entrare devi avere almeno 18 anni. Non abbiamo salvato nessun tuo dato.",
        [], [h("button", { classe: "bottone-secondario", type: "button", onclick: () => {
          stato.minorenne = false; stato.giorno = stato.mese = stato.anno = ""; stato.dataNascita = ""; stato.email = ""; vai(0); } }, "Torna all'inizio")]);
    }
    // Tre menu (giorno, mese, anno) invece del calendario del browser: su iPhone il campo data vuoto a volte
    // non si apre o non si vede, e con tre menu la data si sceglie allo stesso modo su ogni telefono.
    const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
    const annoOggi = new Date().getFullYear();
    const componi = () => {
      const { giorno, mese, anno } = stato;
      if (!giorno || !mese || !anno) { stato.dataNascita = ""; return; }
      const d = new Date(Number(anno), Number(mese) - 1, Number(giorno));
      stato.dataNascita = d.getMonth() === Number(mese) - 1
        ? `${anno}-${String(mese).padStart(2, "0")}-${String(giorno).padStart(2, "0")}` : "";
    };
    const avviso = h("p", { classe: "errore", role: "alert", hidden: true }, "Questa data non esiste: controlla giorno e mese.");
    const cambia = (campo) => (e) => {
      stato[campo] = e.target.value;
      componi();
      avviso.hidden = !(stato.giorno && stato.mese && stato.anno && !stato.dataNascita);
      ricontrolla();
    };
    const menu = (id, etichetta, campo, opzioni) => h("select", { id, "aria-label": etichetta, onchange: cambia(campo) },
      h("option", { value: "" }, etichetta),
      opzioni.map(([v, t]) => h("option", { value: String(v), selected: String(stato[campo]) === String(v) }, t)));
    const giorni = Array.from({ length: 31 }, (_, i) => [i + 1, String(i + 1)]);
    const mesi = MESI.map((m, i) => [i + 1, m]);
    const anni = Array.from({ length: annoOggi - 1920 + 1 }, (_, i) => [annoOggi - i, String(annoOggi - i)]);
    return schermata("Quando sei nato o nata?",
      "Serve per l'età che vedranno gli altri (mai la data). Dopo non si può più cambiare.",
      [h("p", { classe: "etichetta" }, "Data di nascita"),
        h("div", { classe: "data" }, menu("giorno", "Giorno", "giorno", giorni), menu("mese", "Mese", "mese", mesi), menu("anno", "Anno", "anno", anni)),
        avviso],
      [indietro(), avanti("Continua", () => Boolean(stato.dataNascita), () => {
        const eta = etaDa(stato.dataNascita);
        if (eta === null || eta > 106) return;
        if (eta < 18) { stato.minorenne = true; if (archivio) eliminaAccount(); disegna(); return; }
        salvaEVai(3, () => archivio.salvaProfilo({ data_nascita: stato.dataNascita }));
      })]);
  },

  regole() {
    const regole = [
      ["Niente numeri né social prima della porta.", "Ci si scambia i contatti solo dopo il sì reciproco della domenica."],
      ["Rispetto, sempre.", "Chi manca di rispetto in una chiamata viene segnalato e bloccato."],
      ["Foto vere.", "Le tue, recenti, con il volto visibile in almeno una."],
      ["Chi dà buca paga.", "Se all'appuntamento non ti presenti, i tuoi crediti bloccati vanno a chi ti ha aspettato."],
    ];
    const casella = h("input", { type: "checkbox", id: "accetto", checked: stato.regole, onchange: (e) => { stato.regole = e.target.checked; disegna(); } });
    return schermata("Quattro regole", null,
      [h("ol", { classe: "regole" }, regole.map(([t, d]) => h("li", {}, h("strong", {}, t), " ", d))),
        h("label", { classe: "casella", for: "accetto" }, casella, "Accetto le regole")],
      [indietro(), avanti("Continua", stato.regole, () => salvaEVai(4, () => archivio.salvaProfilo({ regole_accettate_il: new Date().toISOString() })))]);
  },

  chi() {
    const nomeOk = () => /^[\p{L}][\p{L}' -]{1,19}$/u.test(stato.nome.trim());
    const provinciaOk = () => Boolean(stato.provincia);
    const presentoOk = () => stato.miPresento && (stato.miPresento !== "mi_descrivo" || stato.miDescrivo.trim().length >= 2);
    const avvisoNome = h("p", { classe: "errore", role: "alert", hidden: !stato.nome || nomeOk() }, "Da 2 a 20 lettere, senza numeri.");
    // Righe sotto il campo provincia: si aggiornano mentre si scrive, senza ridisegnare (il cursore resta dov'è).
    const nessuna = h("p", { classe: "errore", role: "alert", hidden: true }, "Nessuna provincia con questo nome. Prova con il capoluogo.");
    const dallaLista = h("p", { classe: "nota", id: "provincia-lista" }, "Dalla lista d'attesa. È giusta? Puoi cambiarla.");
    const estero = h("p", { classe: "nota" }, "Entrerai nelle stanze con chi ha scelto anche l'estero.");
    // Profilo già salvato e provincia diversa: quando vale il cambio (spec v1.3, «Cambio dopo»).
    const quando = h("p", { classe: "nota", id: "provincia-cambio" }, testoCambio());
    const aggiornaRighe = () => {
      nessuna.hidden = Boolean(stato.provincia) || stato.provinciaTesto.trim().length < 2 || suggerimenti(stato.provinciaTesto).length > 0;
      dallaLista.hidden = !(stato.provinciaLista && stato.provincia === stato.provinciaLista);
      estero.hidden = stato.provincia !== ESTERO;
      quando.hidden = !(stato.provinciaSalvata && stato.provincia && stato.provincia !== stato.provinciaSalvata);
    };
    // Menu con ricerca mentre si scrive: campo di testo con l'elenco delle 107 province + «Vivo all'estero».
    const campoProvincia = h("input", { id: "provincia", list: "elenco-province", autocomplete: "off", autocapitalize: "words",
      placeholder: "Scegli la tua provincia", value: stato.provinciaTesto, "aria-describedby": "provincia-aiuto provincia-lista",
      oninput: (e) => { stato.provinciaTesto = e.target.value; stato.provincia = cercaProvincia(e.target.value) || ""; aggiornaRighe(); ricontrolla(); },
      onchange: (e) => { const sigla = cercaProvincia(e.target.value); if (sigla) { stato.provinciaTesto = nomeMenu(sigla); e.target.value = stato.provinciaTesto; } } });
    const elenco = h("datalist", { id: "elenco-province" }, MENU_PROVINCE.map(([, nome]) => h("option", { value: nome })));
    aggiornaRighe();
    precompilaDallaLista();
    return schermata("Chi sei", "Gli altri vedranno solo nome, età e provincia.",
      [h("label", { for: "nome" }, "Nome (solo il nome di battesimo)"),
        h("input", { id: "nome", autocomplete: "given-name", autocapitalize: "words", maxlength: "20", value: stato.nome,
          oninput: (e) => { stato.nome = e.target.value; if (nomeOk()) avvisoNome.hidden = true; ricontrolla(); },
          onblur: () => { avvisoNome.hidden = !stato.nome || nomeOk(); } }),
        avvisoNome,
        h("label", { for: "provincia" }, "Dove vivi?"),
        h("p", { classe: "nota", id: "provincia-aiuto" }, "Ci serve la provincia per metterti in stanza con persone della tua zona. Non mostriamo mai il tuo indirizzo."),
        campoProvincia, elenco, nessuna, dallaLista, estero, quando,
        h("p", { classe: "etichetta" }, "Mi presento come"),
        scelte("presento", [["donna", "Donna"], ["uomo", "Uomo"], ["non_binario", "Non binario"], ["mi_descrivo", "Preferisco descrivermi"]],
          stato.miPresento, (v) => { stato.miPresento = v; disegna(); }),
        stato.miPresento === "mi_descrivo" ? h("input", { "aria-label": "Come ti descrivi", maxlength: "40", value: stato.miDescrivo,
          oninput: (e) => { stato.miDescrivo = e.target.value; ricontrolla(); } }) : null,
        // #471 parte A: facoltativo, più scelte; fino a D155 resta solo nella pagina e precompila «Cerco» nella 06.
        h("p", { classe: "etichetta", id: "orientamento-etichetta" }, TESTI_ORIENTAMENTO.etichetta),
        h("p", { classe: "nota", id: "orientamento-nota" }, TESTI_ORIENTAMENTO.nota),
        scelte("orientamento", ORIENTAMENTI, stato.orientamento, (v) => { stato.orientamento = toccaOrientamento(stato.orientamento, v); disegna(); },
          { multipla: true, etichetta: "orientamento-etichetta", descrizione: "orientamento-nota" }),
        stato.orientamento.includes("descrivo") ? h("input", { "aria-label": TESTI_ORIENTAMENTO.descrivo, maxlength: "40",
          value: stato.orientamentoTesto, oninput: (e) => { stato.orientamentoTesto = e.target.value; } }) : null],
      [cambio.daProfilo ? tornaAlProfilo() : indietro(),
        avanti(cambio.daProfilo ? "Salva" : "Continua", () => Boolean(nomeOk() && provinciaOk() && presentoOk()),
          () => salvaEVai(cambio.daProfilo ? PASSI.length - 1 : 5, confermaDallaLista, () => archivio.salvaProfilo(profiloDaStato(stato))))]);
  },

  cerchi() {
    // #471: l'orientamento della 05 precompila «Voglio incontrare» solo se è vuoto e non è stato ancora toccato;
    // si può sempre cambiare. Più scelte, almeno una (parte B).
    if (!stato.cerco.length && !stato.cercoToccato) stato.cerco = cercoDaOrientamento(stato.miPresento, stato.orientamento);
    const etaOk = () => stato.etaMin >= 18 && stato.etaMax <= 99 && stato.etaMin <= stato.etaMax;
    const tutto = () => Boolean(stato.cerco.length && stato.consensoCerco && etaOk() && stato.raggio && stato.cosaCerco && stato.figli && stato.fumo);
    const avvisoEta = h("p", { classe: "errore", role: "alert", hidden: etaOk() }, "Età da 18 a 99, e la massima non può essere minore della minima.");
    const numero = (id, valore, set) => h("input", { id, type: "text", inputmode: "numeric", pattern: "[0-9]*", maxlength: "2", value: String(valore),
      oninput: (e) => { set(Number(e.target.value.replace(/\D/g, "")) || 0); avvisoEta.hidden = etaOk(); ricontrolla(); } });
    return schermata("Chi cerchi", "Servono a comporre la tua stanza. Nessuno li vede.",
      [h("p", { classe: "etichetta", id: "cerco-etichetta" }, "Voglio incontrare"),
        scelte("cerco", VOGLIO_INCONTRARE, stato.cerco, (v) => { stato.cerco = toccaCerco(stato.cerco, v); stato.cercoToccato = true; disegna(); }, { multipla: true, etichetta: "cerco-etichetta" }),
        h("p", { classe: "errore", role: "alert", hidden: !(stato.cercoToccato && !stato.cerco.length) }, "Scegli almeno un'opzione."),
        h("div", { classe: "consenso" },
          h("label", { classe: "casella", for: "consenso-cerco" },
            h("input", { type: "checkbox", id: "consenso-cerco", checked: stato.consensoCerco, onchange: (e) => { stato.consensoCerco = e.target.checked; disegna(); } }),
            "Questo dato può rivelare il mio orientamento. Acconsento che venga usato solo per comporre le stanze."),
          h("p", { classe: "nota" }, "Senza questo consenso non possiamo trovarti una stanza. Puoi ritirarlo e cancellare tutto quando vuoi.")),
        h("p", { classe: "etichetta" }, "Età"),
        h("div", { classe: "riga" }, h("label", { for: "eta-min" }, "da"), numero("eta-min", stato.etaMin, (v) => { stato.etaMin = v; }),
          h("label", { for: "eta-max" }, "a"), numero("eta-max", stato.etaMax, (v) => { stato.etaMax = v; })),
        avvisoEta,
        h("p", { classe: "etichetta" }, "Dove"),
        // Spec #3 v1.2 (D121 A): «Solo la mia zona» = persone della stessa area vasta; il valore salvato resta «citta».
        scelte("raggio", [["citta", etichettaRaggio(stato.provincia)], ["italia", "Anche altre città"], ["estero", "Anche dall'estero, nella mia lingua"]],
          stato.raggio, (v) => { stato.raggio = v; disegna(); }),
        h("p", { classe: "etichetta" }, "Cosa cerco"),
        scelte("cosa", [["storia_seria", "Una storia seria"], ["senza_fretta", "Conoscersi senza fretta"]], stato.cosaCerco, (v) => { stato.cosaCerco = v; disegna(); }),
        h("p", { classe: "etichetta" }, "Figli"),
        scelte("figli", [["ne_voglio", "Ne voglio"], ["forse", "Forse"], ["no", "No"], ["ne_ho", "Ne ho"]], stato.figli, (v) => { stato.figli = v; disegna(); }),
        h("p", { classe: "etichetta" }, "Fumo"),
        scelte("fumo", [["si", "Sì"], ["no", "No"], ["indifferente", "Indifferente"]], stato.fumo, (v) => { stato.fumo = v; disegna(); })],
      [indietro(), avanti("Continua", tutto, () => salvaEVai(6, () => archivio.salvaFiltri(filtriDaStato(stato))))]);
  },

  voce() {
    return schermata("La tua voce",
      "Presentati come faresti a una cena tra amici. Hai 20 secondi.",
      [registratoreVoce(stato.voce, 20, (esito) => { stato.voce = esito; disegna(); })],
      [indietro(), avanti("Continua", Boolean(stato.voce), () => salvaEVai(7, caricaSeServe("voci", FILE_VOCE, stato.voce)))]);
  },

  risposte() {
    const scelte3 = stato.domandeVoce;
    if (stato.rispostaInCorso === null || scelte3[stato.rispostaInCorso] === undefined) {
      if (stato.rispostaInCorso !== null) stato.rispostaInCorso = null;
      return schermata("Tre risposte a voce",
        "Scegli 3 domande e rispondi a voce, massimo 30 secondi ciascuna.",
        [scelte("domande-voce", DOMANDE_VOCE.map((d, i) => [i, d]), scelte3, (i) => {
            if (scelte3.includes(i)) { stato.domandeVoce = scelte3.filter((x) => x !== i); delete stato.risposteVoce[i]; }
            else if (scelte3.length < 3) stato.domandeVoce = [...scelte3, i];
            disegna();
          }, { multipla: true }),
          h("p", { classe: "nota" }, `${scelte3.length} di 3 scelte`)],
        [indietro(), avanti("Registra le risposte", scelte3.length === 3, () => { stato.rispostaInCorso = 0; vaiRisposta(); })]);
    }
    // Una schermata per domanda (Giuseppe, 24/11): «Domanda 1 di 3», il testo una volta sola, Registra / Riascolta /
    // Rifai, poi Avanti. All'ultima, «Continua» salva le tre risposte (come prima) e porta al questionario.
    const k = stato.rispostaInCorso;
    const i = scelte3[k];
    const pronta = Boolean(stato.risposteVoce[i]);
    const prossima = () => {
      if (k < 2) { stato.rispostaInCorso = k + 1; vaiRisposta(); return; }
      salvaEVai(8,
        ...scelte3.map((d, n) => caricaSeServe("voci", fileRisposta(n), stato.risposteVoce[d])),
        () => archivio.salvaProfilo({ domande_voce: scelte3 }));
    };
    return h("section", { classe: "schermata risposta-una" },
      h("p", { classe: "passo-domanda" }, `Domanda ${k + 1} di 3`),
      h("h1", {}, DOMANDE_VOCE[i]),
      h("p", { classe: "sottotitolo" }, "Rispondi a voce, massimo 30 secondi."),
      h("div", { classe: "corpo" }, registratoreVoce(stato.risposteVoce[i], 30, (esito) => { stato.risposteVoce[i] = esito; disegna(); })),
      errore(salvataggio.errore),
      salvataggio.inCorso ? h("p", { classe: "nota", role: "status" }, "Salvataggio…") : null,
      h("div", { classe: "azioni" },
        h("button", { classe: "bottone-secondario", type: "button", onclick: () => { stato.rispostaInCorso = k === 0 ? null : k - 1; vaiRisposta(); } }, "Indietro"),
        avanti(k < 2 ? "Avanti" : "Continua", pronta, prossima)));
  },

  questionario() {
    const q = stato.questionario;
    const d = DOMANDE.find((x) => x.n === q.domanda);
    const valore = q.risposte[d.n];
    const ultimaDelTema = !DOMANDE.some((x) => x.tema === d.tema && x.n > d.n);
    const rispostaOk = erroreRisposta(d.n, valore) === null;
    const importanzaOk = !ultimaDelTema || [1, 2, 3].includes(q.importanza[d.tema]);
    const imposta = (v) => { q.risposte[d.n] = v; disegna(); };
    let campo;
    if (d.tipo === "multipla") {
      const scelto = Array.isArray(valore) ? valore : [];
      campo = [scelte(`q${d.n}`, d.opzioni.map((o, i) => [i, o]), scelto, (i) => {
        if (scelto.includes(i)) imposta(scelto.filter((x) => x !== i));
        else if (scelto.length < d.max) imposta([...scelto, i]);
      }, { multipla: true }), h("p", { classe: "nota" }, d.min === d.max ? `${scelto.length} di ${d.max}` : `${scelto.length} (da ${d.min} a ${d.max})`)];
    } else if (d.tipo === "scala") {
      campo = [scelte(`q${d.n}`, [1, 2, 3, 4, 5].map((v) => [v, String(v)]), valore, imposta),
        h("div", { classe: "estremi" }, h("span", {}, d.estremi[0]), h("span", {}, d.estremi[1]))];
    } else {
      campo = [scelte(`q${d.n}`, d.opzioni.map((o, i) => [i, o]), valore, imposta)];
    }
    const conta = ultimaDelTema ? h("div", { classe: "quanto-conta" },
      h("p", { classe: "etichetta-importanza", id: `imp-tema-${d.tema}` }, testoImportanza(TEMI[d.tema].nome)),
      scelte(`imp-${d.tema}`, IMPORTANZA.map((t, i) => [i + 1, t]), q.importanza[d.tema], (v) => { q.importanza[d.tema] = v; disegna(); })) : null;
    const salvaRisposte = () => archivio.salvaQuestionario(q.risposte, q.importanza);
    const prossima = async () => {
      if (d.n === DOMANDE.length) { salvaEVai(9, salvaRisposte); return; }
      // Con l'accesso acceso le risposte si salvano alla fine di ogni tema: chi esce a metà le ritrova.
      if (archivio && ultimaDelTema) {
        salvataggio.inCorso = true; salvataggio.errore = ""; disegna();
        const r = await salvaRisposte();
        salvataggio.inCorso = false;
        if (!r.ok) { salvataggio.errore = MESSAGGI_SALVATAGGIO[r.motivo] || MESSAGGI_SALVATAGGIO.salvataggio; disegna(); return; }
      }
      q.domanda = d.n + 1; salvataggio.errore = ""; disegna(); window.scrollTo(0, 0);
    };
    const precedente = () => { if (d.n > 1) { q.domanda = d.n - 1; disegna(); } else vai(7); };
    // Giuseppe, 24/11: prima il TEMA in alto (etichetta maiuscola), sotto la domanda, sotto le risposte.
    return h("section", { classe: "schermata" },
      h("p", { classe: "tema-domanda" }, h("span", {}, TEMI[d.tema].nome), h("span", {}, `${d.n} di ${DOMANDE.length}`)),
      h("h1", {}, d.testo),
      h("div", { classe: "corpo" }, campo, conta, d.n === 1 ? h("p", { classe: "nota" }, "Le risposte restano private. Servono solo a scegliere la tua stanza.") : null),
      errore(salvataggio.errore),
      salvataggio.inCorso ? h("p", { classe: "nota", role: "status" }, "Salvataggio…") : null,
      h("div", { classe: "azioni" },
        h("button", { classe: "bottone-secondario", type: "button", onclick: precedente }, "Indietro"),
        avanti(d.n < DOMANDE.length ? "Avanti" : "Fine questionario", rispostaOk && importanzaOk, prossima)));
  },

  foto() {
    const pronte = stato.foto.filter(Boolean).length;
    return schermata("Le tue foto",
      "Nessuno le vede fino a quando entrambi aprite la porta. Servono 3 foto, con il volto visibile in almeno una.",
      [h("div", { classe: "griglia-foto" }, stato.foto.map((f, i) => casellaFoto(f, i))),
        pronte ? h("p", { classe: "nota" }, "Così le vedono gli altri, fino alla porta: sfocate.") : null,
        h("p", { classe: "nota" }, "Prima di tutto il telefono toglie dalle foto i dati nascosti (posizione, modello, data).")],
      [indietro(), avanti("Continua", pronte === 3, () => salvaEVai(10, ...stato.foto.map((f, i) => caricaSeServe("foto", fileFoto(i), f))))]);
  },

  fatto() {
    chiediContatore();
    const zonaVisibile = nomeVisibile(stato.provincia);
    // Design v4 (#349, schermate 16 e 35): in cima la settimana, mai «profilo pronto».
    return schermataHome(vistaSettimanaHome(h, settimanaDellaHome()),
      [inStanzaAperta() ? null : vistaCerchioHome(h, stato.miPresento),
        contatore.testo ? h("p", { classe: "contatore-zona", id: "contatore-zona", role: "status" },
          stato.raggio === "citta" ? contatoreSoloZona(contatore.testo) : contatore.testo) : null,
        bloccoItalia(),
        italia.avviso ? h("p", { classe: "nota", role: "status" }, italia.avviso) : null,
        bloccoStanza(),
        bloccoTuaStanza(),
        bloccoEsiti(),
        bloccoSanzioni(),
        bloccoVostriIncontri(),
        h("div", { classe: "riepilogo" },
          h("p", {}, h("strong", {}, stato.nome.trim()), `, ${etaDa(stato.dataNascita)} anni, ${zonaVisibile}`),
          // Spec #3 v1.2: sotto la provincia, la zona delle stanze. Solo per te: gli altri vedono la provincia, mai l'area.
          testoZona(stato.provincia) ? h("p", { classe: "nota", id: "la-tua-zona" }, testoZona(stato.provincia)) : null,
          archivio ? h("button", { classe: "link", type: "button", onclick: () => { cambio.daProfilo = true; cambio.avviso = ""; vai(4); } }, "Cambia provincia") : null,
          archivio ? h("button", { classe: "link", type: "button", onclick: apriDisponibilita }, TESTI_FASCIA.titolo) : null,
          stato.voce ? h("audio", { controls: true, src: stato.voce.url, "aria-label": "La tua presentazione" }) : null,
          h("p", { classe: "nota" }, "Questo è ciò che vedranno gli altri della stanza: nome, età, provincia, la tua voce e le tue 3 risposte. Mai foto, questionario, filtri o email.")),
        bloccoRiepilogoMio(),
        cambio.avviso ? h("p", { classe: "nota", role: "status" }, cambio.avviso) : null,
        h("button", { classe: "link", type: "button", onclick: apriDifficolta }, "Sono in difficoltà"),
        storicoChiamate ? h("button", { classe: "link", type: "button", onclick: apriStorico }, TESTI_STORICO.titolo) : null,
        // Con il profilo (schermata 23) «I tuoi regali» sta solo lì, nella riga «Regali ricevuti»: niente link doppi in home.
        regaliProfilo && !schermoProfilo ? h("button", { classe: "link", type: "button", onclick: () => regaliProfilo.apri() }, TESTI_REGALI_PROFILO.link) : null,
        supporto ? h("button", { classe: "link", type: "button", onclick: apriAiuto }, TESTI_AIUTO.titolo) : null,
        h("p", { classe: "nota" }, archivio
          ? "Il tuo profilo è salvato. Puoi cambiarlo quando vuoi, tranne la data di nascita."
          : "Era un'anteprima: niente è stato inviato o salvato.")],
      archivio && !schermoProfilo
        ? [h("button", { classe: "bottone-secondario", type: "button", onclick: () => vai(4) }, "Modifica il profilo"),
          h("button", { classe: "link", type: "button", onclick: () => {
            if (confirm("Vuoi davvero eliminare il tuo account? Cancelliamo subito email, voce, foto, questionario e filtri.")) eliminaAccount();
          } }, "Elimina il mio account")]
        : archivio ? [] : [h("button", { classe: "bottone-secondario", type: "button", onclick: () => location.reload() }, "Ricomincia l'anteprima")]);
  },
};

// ---------------------------------------------------------------------------------------------------------------
function registratoreVoce(esistente, massimo, onFatto) {
  const box = h("div", { classe: "registratore" });
  const messaggi = {
    breve: `Troppo corta: parla almeno ${MINIMO_SECONDI} secondi.`,
    silenzio: "Non ti sentiamo bene, riprova un po' più vicino al telefono.",
    negato: "Il microfono è bloccato. Apri le impostazioni del browser, consenti il microfono per presenteincontri.app e riprova.",
    non_supportato: "Questo browser non registra audio. Su iPhone usa Safari aggiornato, su Android Chrome.",
    altro: "Non riusciamo a usare il microfono. Riprova.",
  };
  const mostra = (stato) => {
    box.replaceChildren();
    if (stato.errore) aggiungi(box, errore(messaggi[stato.errore] || messaggi.altro));
    if (esistente && !stato.registrando) {
      // «Riascolta» e «Rifai» sulla stessa riga (design v4, schermata 08): l'audio suona dal pulsante, senza i comandi del browser.
      const audio = h("audio", { src: esistente.url, preload: "metadata" });
      const riascolta = h("button", { classe: "bottone-secondario", type: "button", "aria-pressed": "false",
        onclick: () => { if (audio.paused) { audio.currentTime = 0; audio.play().catch(() => {}); } else audio.pause(); } }, "Riascolta");
      audio.addEventListener("play", () => { riascolta.textContent = "Pausa"; riascolta.setAttribute("aria-pressed", "true"); });
      const fermo = () => { riascolta.textContent = "Riascolta"; riascolta.setAttribute("aria-pressed", "false"); };
      audio.addEventListener("pause", fermo); audio.addEventListener("ended", fermo);
      aggiungi(box, audio,
        esistente.secondi ? h("p", { classe: "nota" }, `${esistente.secondi.toFixed(0)} secondi`) : null,
        h("div", { classe: "riga-registratore" }, riascolta,
          h("button", { classe: "bottone-secondario", type: "button", onclick: () => { audio.pause(); inizia(); } }, "Rifai")));
      return;
    }
    if (stato.registrando) {
      const riempimento = h("span");
      riempimento.style.width = `${Math.min(100, (stato.secondi / massimo) * 100)}%`;
      aggiungi(box, h("p", { classe: "timer", "aria-live": "off" }, `${Math.floor(stato.secondi)} / ${massimo} s`),
        h("div", { classe: "avanzamento-barra" }, riempimento),
        h("button", { classe: "bottone bottone-rec", type: "button", onclick: () => registrazioneInCorso && registrazioneInCorso.ferma() }, "Ferma"));
      return;
    }
    aggiungi(box, h("button", { classe: "bottone bottone-rec", type: "button", disabled: !registrazioneSupportata(), onclick: inizia }, "● Registra"),
      registrazioneSupportata() ? null : errore(messaggi.non_supportato));
  };
  async function inizia() {
    esistente = null;
    mostra({ registrando: true, secondi: 0 });
    const r = await registra(massimo, (s) => mostra({ registrando: true, secondi: s }));
    registrazioneInCorso = r;
    const esito = await r.finita;
    registrazioneInCorso = null;
    if (esito.errore) { mostra({ errore: esito.errore }); return; }
    onFatto({ url: esito.url, secondi: esito.secondi, blob: esito.blob });
  }
  mostra({});
  return box;
}

function casellaFoto(f, i) {
  const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/heic,image/heif", classe: "nascosto", id: `foto-${i}`,
    onchange: async (e) => {
      const file = e.target.files && e.target.files[0];
      const esito = await preparaFoto(file);
      if (esito.errore) { alert(esito.errore); return; }
      stato.foto[i] = { url: esito.url, blob: esito.blob };
      disegna();
    } });
  return h("div", { classe: "casella-foto" },
    f ? h("img", { src: f.url, alt: `Foto ${i + 1}` }) : h("span", { classe: "piu", "aria-hidden": "true" }, "+"),
    h("label", { for: `foto-${i}`, classe: "bottone-secondario" }, f ? "Cambia" : `Foto ${i + 1}`),
    input);
}

// «Elimina il mio account» (e uscita del minorenne): il server cancella file, righe e account (worker/elimina.js).
async function eliminaAccount() {
  const t = accesso && (await accesso.token());
  if (!t) { stato.passo = 1; disegna(); return; }
  salvataggio.inCorso = true; disegna();
  let ok = false;
  try {
    const r = await fetch("/app/api/elimina-account", { method: "POST", headers: { authorization: `Bearer ${t}` } });
    ok = r.ok;
  } catch { ok = false; }
  salvataggio.inCorso = false;
  if (!ok) { salvataggio.errore = "Non siamo riusciti a eliminare l'account. Riprova tra poco."; disegna(); return; }
  await accesso.esci();
  if (stato.minorenne) { disegna(); return; } // resta la schermata «solo per maggiorenni»
  location.replace("/app/");
}

// ---------------------------------------------------------------------------------------------------------------
// «Sono in difficoltà» (#7 spec v1.1 punto 6, linea «sviluppatore-b»): 112 in alto, sotto «Avvisa Presente».
// Nessuna posizione, nessun salvataggio sul telefono; l'invio passa da segnala.js (chi avvisa lo dice il token).
function apriDifficolta() {
  Object.assign(difficolta, { aperta: true, contro: "", invio: false, errore: "", conferma: null });
  disegna();
}
function chiudiDifficolta() {
  Object.assign(difficolta, { aperta: false, contro: "", invio: false, errore: "", conferma: null });
  disegna();
}
function schermoDifficolta() {
  const d = difficolta;
  const s = schermataDifficolta(telefono ? personeDifficolta(telefono.modello()) : []);
  // Spec: il 112 in alto e grande, è l'azione principale; «Avvisa Presente» viene dopo.
  const chiama = h("a", { classe: "bottone", href: s.telefono }, s.chiama);
  if (d.conferma) {
    return h("section", { classe: "schermata difficolta", "aria-label": "Sono in difficoltà" },
      h("h1", {}, s.titolo), chiama,
      h("p", { classe: "sottotitolo", role: "status" }, d.conferma.testo),
      h("p", { classe: "nota" }, d.conferma.pericolo),
      h("div", { classe: "azioni" }, h("button", { classe: "bottone-secondario", type: "button", onclick: chiudiDifficolta }, "Torna all'app")));
  }
  const avvisa = async () => {
    d.invio = true; d.errore = ""; disegna();
    const r = await inviaDifficolta(segnalatore, { contro: d.contro || null });
    d.invio = false;
    if (r.ok) d.conferma = r.conferma; else d.errore = r.errore;
    disegna();
  };
  return h("section", { classe: "schermata difficolta", "aria-label": "Sono in difficoltà" },
    h("h1", {}, s.titolo), chiama,
    s.persone ? h("fieldset", { classe: "motivi-segnala" }, h("legend", {}, s.domanda),
      s.persone.map(([valore, testo]) => h("label", { classe: "casella" },
        h("input", { type: "radio", name: "persona-difficolta", value: valore, checked: d.contro === valore, disabled: d.invio,
          onchange: () => { d.contro = valore; } }), testo))) : null,
    h("div", { classe: "azioni" },
      h("button", { classe: "bottone-secondario", type: "button", disabled: d.invio, onclick: avvisa }, d.invio ? "Invio…" : s.avvisa)),
    errore(d.errore),
    h("p", { classe: "nota" }, s.fisso),
    h("ul", { classe: "nota" }, s.consigli.map((c) => h("li", {}, c))),
    h("button", { classe: "link", type: "button", disabled: d.invio, onclick: chiudiDifficolta }, "Chiudi"));
}

// ---------------------------------------------------------------------------------------------------------------
// Menu ⋯ nella scheda della persona (#7 spec v1.1 punti 1 e 5, linea «sviluppatore-b»): «Segnala» · «Blocca».
function menuDellaScheda(p) {
  const nome = nomeScheda(p);
  const e = menuScheda(nome);
  const aperto = scheda.menu === p.id;
  const chiudi = () => { Object.assign(scheda, { menu: "", conferma: "", errore: "" }); disegna(); };
  const parti = [h("button", { classe: "link", type: "button", "aria-label": e.apri, "aria-expanded": aperto ? "true" : "false",
    disabled: scheda.invio, onclick: () => { Object.assign(scheda, { menu: aperto ? "" : p.id, conferma: "", errore: "" }); disegna(); } }, "⋯")];
  if (!aperto) return parti;
  if (scheda.conferma === p.id) {
    const c = confermaBlocco(nome);
    const blocca = async () => {
      if (!bloccatore) { scheda.errore = "Il blocco non è ancora attivo."; disegna(); return; }
      scheda.invio = true; scheda.errore = ""; disegna();
      const r = await bloccatore.blocca(p.id).catch(() => ({ ok: false, motivo: "rete" }));
      scheda.invio = false;
      if (r.ok) { scheda.bloccate.add(p.id); Object.assign(scheda, { menu: "", conferma: "" }); ricaricaStanzaDopoBlocco(); }
      else scheda.errore = MESSAGGI_STANZA[r.motivo] || "Non è andata. Riprova tra poco.";
      disegna();
    };
    parti.push(h("div", { classe: "conferma-blocco", role: "alertdialog", "aria-label": c.titolo },
      h("p", {}, h("strong", {}, c.titolo)), h("p", { classe: "nota" }, c.testo),
      errore(scheda.errore),
      h("button", { classe: "bottone-pericolo", type: "button", disabled: scheda.invio, onclick: blocca }, scheda.invio ? "Un attimo…" : c.conferma),
      h("button", { classe: "link", type: "button", disabled: scheda.invio, onclick: chiudi }, c.annulla)));
  } else {
    parti.push(h("div", { classe: "menu-scheda" },
      h("button", { classe: "link", type: "button", onclick: () => { Object.assign(scheda, { menu: "", segnala: { contro: p.id, origine: "scheda", nome } }); disegna(); } }, e.segnala),
      h("button", { classe: "link", type: "button", onclick: () => { scheda.conferma = p.id; disegna(); } }, e.blocca)));
  }
  return parti;
}

// Dopo un blocco la stanza si rilegge dal database (chiavi annullate, persona tolta): la persona è già nascosta da
// scheda.bloccate, quindi se la rilettura non riesce non cambia niente per chi usa l'app.
function ricaricaStanzaDopoBlocco() {
  if (!telefono || typeof telefono.ricaricaPersone !== "function") return;
  Promise.resolve(telefono.ricaricaPersone()).catch(() => {});
}

// «Segnala» dalla scheda: lo stesso modulo di «Segnala un problema», con origine «scheda» e la casella «Blocca anche».
function schermoSegnalaScheda() {
  const sg = scheda.segnala;
  const m = { segnala: { contro: sg.contro, origine: "scheda", chiamataIl: null }, nome: sg.nome, schermo: { titolo: "Segnala" } };
  const torna = (inviata) => {
    // Segnalazione inviata con «Blocca anche» spuntata: la persona sparisce subito dall'elenco.
    if (inviata && segnalazione.blocca) { scheda.bloccate.add(sg.contro); ricaricaStanzaDopoBlocco(); }
    scheda.segnala = null; disegna();
  };
  return h("section", { classe: "schermata chiamata", "aria-label": "Segnala" }, schermoSegnala(m, torna));
}

// «Chiudi e segnala» dal video dello svelamento (#65 passo 7d-3b-2): lo stesso modulo della #7, origine
// «chiudi_e_segnala» (blocco già fatto dal server, casella ferma). Al ritorno la porta, ormai chiusa, si chiude.
function schermoSegnalaPorta() {
  const m = segnalaDaPorta(portaSvelamento.modello().segnala);
  const torna = () => {
    portaSvelamento.fineSegnala();
    portaSvelamento.chiudi();
    ricaricaStanzaDopoBlocco();
    disegna();
  };
  return h("section", { classe: "schermata chiamata", "aria-label": "Segnala" }, schermoSegnala(m, torna));
}

// Nome di chi usa l'app, per la filigrana dello svelamento (#65): solo in memoria, mai inviato.
export const nomeMio = () => (typeof stato.nome === "string" ? stato.nome.trim() : "");

// Chiavi (#5): il modulo avvisa a ogni cambio; si ridisegna solo nella home. Con una finestra aperta il fuoco va
// al suo primo campo o pulsante, così chi usa la tastiera o il lettore di schermo non lo perde.
export function chiaviCambiate() {
  if (!radice || !chiaviStanza || !PASSI[stato.passo] || PASSI[stato.passo].id !== "fatto") return;
  disegna();
  const primo = radice.querySelector(".chiave-finestra textarea, .chiave-finestra button");
  if (primo) primo.focus({ preventScroll: true });
}

// Schermata della porta (#65): il modulo avvisa a ogni cambio; si ridisegna solo nella home, e il fuoco va al titolo
// quando la schermata si apre o si chiude, così tastiera e lettore di schermo non si perdono.
let portaEraAperta = false;
let confermaEra = null;
export function portaCambiata() {
  if (!radice || !portaSvelamento || !PASSI[stato.passo] || PASSI[stato.passo].id !== "fatto") return;
  disegna();
  const aperta = portaSvelamento.modello().aperta;
  // #65 passo 8b-3a: la conferma del sì/no. Aperta → fuoco su «Conferma»; chiusa (Annulla o risposta data) → fuoco
  // sul primo pulsante del gruppo della domanda, o sul gruppo stesso, così la tastiera non si perde.
  const conferma = portaSvelamento.modello().conferma || null;
  if (aperta && conferma !== confermaEra) {
    const prima = confermaEra;
    confermaEra = conferma;
    const dove = conferma ? radice.querySelector("#risposta-conferma-bottone")
      : prima ? (radice.querySelector(".risposta-svelamento button") || radice.querySelector(".risposta-svelamento")) : null;
    if (dove) { if (!conferma && dove.tagName !== "BUTTON") dove.setAttribute("tabindex", "-1"); dove.focus({ preventScroll: true }); }
  }
  if (!aperta) confermaEra = null;
  if (aperta !== portaEraAperta) {
    portaEraAperta = aperta;
    if (!aperta && avvisiPorte) avvisiPorte.subito();
    const titolo = radice.querySelector(aperta ? "#porta-titolo" : "#tua-stanza-titolo");
    if (titolo) { titolo.setAttribute("tabindex", "-1"); titolo.focus({ preventScroll: false }); }
  }
}

// Avvisi delle porte (#65): cambiano al massimo una volta al minuto. Si ridisegna solo nella home e mai sopra la
// schermata della porta aperta (lì il conto e i pulsanti hanno già il loro stato).
export function avvisiCambiati() {
  if (!radice || !avvisiPorte || !PASSI[stato.passo] || PASSI[stato.passo].id !== "fatto") return;
  if (portaSvelamento && portaSvelamento.modello().aperta) return;
  // Mentre si scrive (diario, appunti, «Scrivici») non si ridisegna: l'avviso compare al prossimo disegno.
  const attivo = radice.ownerDocument && radice.ownerDocument.activeElement;
  if (attivo && radice.contains(attivo) && /^(INPUT|TEXTAREA|SELECT)$/.test(attivo.tagName)) return;
  disegna();
}
// La sera delle chiavi mostra già le porte con «Vai allo svelamento»: lì gli avvisi aggiungono solo quelli urgenti.
function seraConPorte() {
  const sera = chiaviStanza && chiaviStanza.modello().sera;
  return Boolean(sera && sera.tipo === "porte");
}

// ---------------------------------------------------------------------------------------------------------------
// «Le tue chiamate» (#7 spec v1.1, caso limite «Persona già bloccata: si può ancora segnalare dallo storico delle
// chiamate («Le tue chiamate» → ⋯ → Segnala) per 30 giorni»; linea «sviluppatore-b»). I dati arrivano da
// storico_chiamate.js (solo id, nome, data e durata); la segnalazione usa lo stesso modulo di «Segnala un problema».
async function apriStorico() {
  Object.assign(storico, { aperto: true, carica: true, voci: [], errore: "", menu: "", segnala: null });
  disegna();
  const r = await storicoChiamate.leggi().catch(() => ({ ok: false, motivo: "rete" }));
  if (!storico.aperto) return;
  storico.carica = false;
  if (r.ok) storico.voci = r.chiamate; else storico.errore = MESSAGGI_SALVATAGGIO[r.motivo] || "Non riusciamo a leggere le tue chiamate. Riprova tra poco.";
  disegna();
}
function chiudiStorico() {
  Object.assign(storico, { aperto: false, carica: false, voci: [], errore: "", menu: "", segnala: null });
  disegna();
}
function schermoStorico() {
  const sg = storico.segnala;
  if (sg) {
    const torna = () => { storico.segnala = null; disegna(); };
    return h("section", { classe: "schermata chiamata", "aria-label": "Segnala" },
      schermoSegnala({ segnala: { contro: sg.contro, origine: "storico_chiamate", chiamataIl: sg.chiamataIl }, nome: sg.nome, schermo: { titolo: "Segnala" } }, torna));
  }
  const righe = storico.voci.map((v) => {
    const id = `${v.con}|${v.chiamataIl}`;
    const aperto = storico.menu === id;
    return h("li", { classe: "compagno" },
      h("p", {}, h("strong", {}, v.nome), ` · ${v.quando} · ${v.durata}`),
      h("button", { classe: "link", type: "button", "aria-label": `Altre azioni per la chiamata con ${v.nome}`, "aria-expanded": aperto ? "true" : "false",
        onclick: () => { storico.menu = aperto ? "" : id; disegna(); } }, "⋯"),
      aperto ? h("div", { classe: "menu-scheda" },
        h("button", { classe: "link", type: "button", onclick: () => { Object.assign(storico, { menu: "", segnala: segnalaDaStorico(v) }); disegna(); } }, TESTI_STORICO.segnala)) : null);
  });
  return h("section", { classe: "schermata", "aria-label": TESTI_STORICO.titolo },
    h("h1", {}, TESTI_STORICO.titolo),
    storico.carica ? h("p", { classe: "nota", role: "status" }, "Un attimo…") : null,
    errore(storico.errore),
    !storico.carica && !storico.errore && righe.length === 0 ? h("p", { classe: "nota" }, TESTI_STORICO.vuoto) : null,
    righe.length ? h("ul", { classe: "compagni" }, righe) : null,
    h("p", { classe: "nota" }, TESTI_STORICO.nota),
    h("button", { classe: "bottone-secondario", type: "button", onclick: chiudiStorico }, TESTI_STORICO.torna));
}

// «I tuoi appunti» (#5 passo 3, linea «sviluppatore-c»): si ridisegna solo nella home; con il campo aperto il fuoco
// va lì, così tastiera e lettore di schermo non lo perdono.
export function appuntiCambiati() {
  if (!radice || !appuntiStanza || !PASSI[stato.passo] || PASSI[stato.passo].id !== "fatto") return;
  disegna();
  const primo = radice.querySelector(".appunto textarea, .appunto [role=alertdialog] button");
  if (primo) primo.focus({ preventScroll: true });
}

// Esito per chi segnala (#7 spec v1.1, passo 4): «Abbiamo esaminato la tua segnalazione…», uno dei due testi della
// spec, mai il dettaglio della sanzione. Si legge una volta per sessione dalla home; «Ho capito» non lo fa tornare.
function bloccoEsiti() {
  if (!esitiSegnalazioni) return null;
  if (!esiti.chiesti) {
    esiti.chiesti = true;
    esitiSegnalazioni.leggi().then((r) => {
      if (r && r.ok && r.esiti.length) { esiti.voci = r.esiti; disegna(); }
    }).catch(() => {});
  }
  if (!esiti.voci.length) return null;
  return h("div", { classe: "esiti-segnalazioni" }, ...esiti.voci.map((v) => h("div", { classe: "riepilogo", role: "status" },
    h("p", {}, v.testo),
    h("button", { classe: "link", type: "button", onclick: () => {
      esiti.voci = esiti.voci.filter((x) => x.id !== v.id);
      disegna();
      esitiSegnalazioni.letto(v.id).catch(() => {});
    } }, TESTI_ESITO.ok))));
}

// Sanzione e «Contesta» (#7 spec v1.1, punti 7-8; D51 A): livello, regola violata, data di fine e «Contesta»; mai chi
// ha segnalato. Il ricorso si fa una volta, entro 14 giorni; la sanzione resta attiva finché una persona decide.
const ERRORI_RICORSO = {
  testo: `Scrivi perché, al massimo ${TESTI_SANZIONE.massimo} caratteri.`,
  gia_fatto: "Hai già contestato questa decisione.",
  scaduto: "Sono passati più di 14 giorni: non si può più contestare.",
};
function bloccoSanzioni() {
  if (!sanzioniMie) return null;
  const st = sanzioniStato;
  if (!st.chieste) {
    st.chieste = true;
    sanzioniMie.leggi().then((r) => {
      if (r && r.ok && r.sanzioni.length) { st.voci = r.sanzioni; disegna(); }
    }).catch(() => {});
  }
  if (!st.voci.length) return null;
  return h("div", { classe: "sanzioni" }, ...st.voci.map((v) => {
    const parti = [h("p", {}, h("strong", {}, v.titolo)),
      v.regola ? h("p", {}, v.regola) : null,
      v.fine ? h("p", {}, v.fine) : null,
      v.stato ? h("p", { classe: "nota" }, v.stato) : null,
      st.inviata === v.id ? h("p", { classe: "nota", role: "status" }, TESTI_SANZIONE.conferma) : null];
    if (v.contesta && st.aperta !== v.id && st.inviata !== v.id) {
      parti.push(h("button", { classe: "link", type: "button",
        onclick: () => { Object.assign(st, { aperta: v.id, testo: "", errore: "" }); disegna(); } }, TESTI_SANZIONE.contesta));
    }
    if (st.aperta === v.id) {
      const invia = async () => {
        st.invio = true; st.errore = ""; disegna();
        const r = await sanzioniMie.contesta(v.id, st.testo).catch(() => ({ ok: false, motivo: "rete" }));
        st.invio = false;
        if (r.ok) Object.assign(st, { aperta: "", testo: "", inviata: v.id });
        else st.errore = ERRORI_RICORSO[r.motivo] || "Non è andata. Riprova tra poco.";
        disegna();
      };
      parti.push(h("label", { for: `ricorso-${v.id}` }, TESTI_SANZIONE.domanda),
        h("textarea", { id: `ricorso-${v.id}`, classe: "racconto-segnala", maxlength: String(TESTI_SANZIONE.massimo), rows: "5",
          disabled: st.invio, oninput: (e) => { st.testo = e.target.value; } }, st.testo),
        errore(st.errore),
        h("div", { classe: "azioni" },
          h("button", { classe: "bottone", type: "button", disabled: st.invio, onclick: invia }, st.invio ? "Invio…" : "Invia"),
          h("button", { classe: "link", type: "button", disabled: st.invio,
            onclick: () => { Object.assign(st, { aperta: "", testo: "", errore: "" }); disegna(); } }, "Annulla")));
    }
    return h("div", { classe: "riepilogo", role: "region", "aria-label": v.titolo }, ...parti);
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Pagina Aiuto (#10 spec v1 del CPO, parte A, linea «sviluppatore-c»). In alto «Sono in difficoltà» a un tocco
// (schermata della #7); poi le domande frequenti con «Cerca» sul telefono (solo quando i testi sono approvati);
// in fondo «Scrivici» e «I miei messaggi». Chi scrive lo dice il token (aiuto.js → /app/api/supporto).
async function apriAiuto() {
  Object.assign(aiuto, { aperta: true, cerca: "", categoria: "", testo: "", invio: false, errore: "", conferma: null,
    carica: true, email: "", messaggi: [], erroreMiei: "" });
  disegna();
  await leggiMieiMessaggi();
}
async function leggiMieiMessaggi() {
  const r = await supporto.miei().catch(() => ({ ok: false, motivo: "rete" }));
  if (!aiuto.aperta) return;
  aiuto.carica = false;
  if (r.ok) Object.assign(aiuto, { email: r.email, messaggi: r.messaggi, erroreMiei: "" });
  else aiuto.erroreMiei = testoErroreAiuto(r.motivo);
  disegna();
}
function chiudiAiuto() {
  Object.assign(aiuto, { aperta: false, cerca: "", categoria: "", testo: "", invio: false, errore: "", conferma: null,
    carica: false, email: "", messaggi: [], erroreMiei: "" });
  disegna();
}
// Da Aiuto a «Sono in difficoltà»: chiudendo quella schermata si torna qui.
function apriDifficoltaDaAiuto() {
  apriDifficolta();
}
function domandeAiuto(cerca) {
  return h("ul", { classe: "domande-frequenti", id: "aiuto-domande" },
    filtraDomande(DOMANDE_FREQUENTI, cerca).map((d) => h("li", {}, h("details", {}, h("summary", {}, d.domanda), h("p", {}, d.risposta)))));
}
function schermoAiuto() {
  const a = aiuto;
  const m = moduloScrivici(a.email);
  const invia = async () => {
    const c = corpoScrivici({ categoria: a.categoria, testo: a.testo });
    if (!c.ok) { a.errore = c.errore; disegna(); return; }
    a.invio = true; a.errore = ""; disegna();
    const r = await supporto.invia(c.corpo).catch(() => ({ ok: false, motivo: "rete" }));
    a.invio = false;
    if (r.ok) {
      Object.assign(a, { conferma: confermaScrivici(r), categoria: "", testo: "" });
      leggiMieiMessaggi();
    } else a.errore = testoErroreAiuto(r.motivo);
    disegna();
  };
  const quando = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("it-IT"); };
  const nomeCategoria = (v) => (m.categorie.find(([c]) => c === v) || [v, ""])[1];
  return h("section", { classe: "schermata aiuto", "aria-label": TESTI_AIUTO.titolo },
    h("h1", {}, TESTI_AIUTO.titolo),
    h("p", {}, TESTI_AIUTO.sicurezza),
    h("button", { classe: "bottone", type: "button", onclick: apriDifficoltaDaAiuto }, TESTI_AIUTO.difficolta),
    DOMANDE_FREQUENTI.length ? h("div", {},
      h("h2", {}, TESTI_AIUTO.domande),
      h("label", { for: "aiuto-cerca" }, TESTI_AIUTO.cerca),
      h("input", { id: "aiuto-cerca", type: "search", value: a.cerca, "aria-controls": "aiuto-domande",
        // Filtra sul posto, senza ridisegnare: il fuoco resta nel campo.
        oninput: (e) => { a.cerca = e.target.value; const l = document.getElementById("aiuto-domande"); if (l) l.replaceWith(domandeAiuto(a.cerca)); } }),
      domandeAiuto(a.cerca)) : null,
    h("h2", {}, `${TESTI_AIUTO.nonTrovato} ${TESTI_AIUTO.scrivici}`),
    a.conferma ? h("div", { role: "status" }, h("p", {}, a.conferma.testo),
      a.conferma.difficolta ? h("button", { classe: "bottone", type: "button", onclick: apriDifficoltaDaAiuto }, a.conferma.difficolta) : null) : null,
    h("label", { for: "aiuto-categoria" }, "Categoria"),
    h("select", { id: "aiuto-categoria", disabled: a.invio, onchange: (e) => { a.categoria = e.target.value; } },
      h("option", { value: "", selected: a.categoria === "" }, "Scegli una categoria"),
      m.categorie.map(([v, t]) => h("option", { value: v, selected: a.categoria === v }, t))),
    h("label", { for: "aiuto-testo" }, "Messaggio"),
    h("textarea", { id: "aiuto-testo", classe: "racconto-segnala", maxlength: String(m.massimo), rows: "6", disabled: a.invio,
      "aria-describedby": "aiuto-contatore",
      oninput: (e) => { a.testo = e.target.value; const c = document.getElementById("aiuto-contatore"); if (c) c.textContent = contatoreAiuto(a.testo); } }, a.testo),
    h("p", { classe: "nota", id: "aiuto-contatore", "aria-live": "polite" }, contatoreAiuto(a.testo)),
    h("label", { for: "aiuto-email" }, "Email"),
    h("input", { id: "aiuto-email", readonly: true, type: "email", value: m.email }),
    errore(a.errore),
    h("div", { classe: "azioni" },
      h("button", { classe: "bottone", type: "button", disabled: a.invio, onclick: invia }, a.invio ? "Invio…" : m.invia)),
    h("h2", {}, TESTI_AIUTO.miei),
    a.carica ? h("p", { classe: "nota", role: "status" }, "Un attimo…") : null,
    errore(a.erroreMiei),
    a.messaggi.length ? h("ul", { classe: "compagni" }, a.messaggi.map((x) => h("li", { classe: "riepilogo" },
      h("p", {}, h("strong", {}, nomeCategoria(x.categoria)), ` · ${quando(x.creatoIl)} · ${statoMessaggio(x)}`),
      h("p", {}, x.testo),
      x.risposta ? h("p", { classe: "nota" }, x.risposta) : null))) : null,
    h("button", { classe: "bottone-secondario", type: "button", disabled: a.invio, onclick: chiudiAiuto }, "Chiudi"));
}

// Come h(): salta null, undefined e false (Element.append(null) scriverebbe «null» sullo schermo).
function aggiungi(el, ...figli) {
  el.append(...figli.filter((f) => f !== null && f !== undefined && f !== false));
}

// «I vostri incontri» (#6 passo 3n, linea «sviluppatore-b»): riquadro nella home (vostri_incontri.js), schermata
// «Il vostro incontro» (incontro.js) e valutazione (valutazione.js). Elenco letto una volta, riletto tornando alla home.
let vostriIncontri = null;
let incontroVostro = null;
let valutazioneVostra = null;
const vostri = { chiesti: false, righe: [] };
export function incontroCambiato() {
  disegna();
}
function bloccoVostriIncontri() {
  if (!vostriIncontri || !incontroVostro) return null;
  if (!vostri.chiesti) {
    vostri.chiesti = true;
    vostriIncontri.leggi().then((r) => { if (r && r.ok) { vostri.righe = r.righe; disegna(); } }).catch(() => {});
  }
  return vistaVostriIncontri(h, vostri.righe, { apri: (porta, opz) => { incontroVostro.apri(porta, opz).catch(() => {}); } });
}
function schermoIncontroVostro() {
  const m = incontroVostro.modello();
  const valuta = valutazioneVostra && m.porta ? () => valutazioneVostra.apri(m.porta, { nome: m.nome }) : null;
  return h("section", { classe: "schermata" },
    vistaIncontro(h, incontroVostro, { valuta }),
    h("button", { classe: "link", type: "button", onclick: () => { vostri.chiesti = false; incontroVostro.chiudi(); } }, "Torna alla home"));
}
function schermoValutazioneVostra() {
  return h("section", { classe: "schermata" }, vistaValutazione(h, valutazioneVostra));
}

// Regali ricevuti sulla scheda (#331, linea «sviluppatore-c»): dopo la lettura si ridisegna solo nella home.
export function regaliCambiati() {
  if (!radice || !regaliStanza || !PASSI[stato.passo] || PASSI[stato.passo].id !== "fatto") return;
  disegna();
}

// Riepilogo alla cieca delle valutazioni nel profilo (#6 passo 3o, D20 A): solo frasi già pronte del modulo
// riepilogo_valutazioni.js (bollini dal terzo incontro, «no» senza nome né data). Letto una volta, solo in memoria.
let riepilogoMio = null;
const riepilogoStato = { chiesto: false, righe: { bollini: [], no: [] } };
function bloccoRiepilogoMio() {
  if (!riepilogoMio) return null;
  if (!riepilogoStato.chiesto) {
    riepilogoStato.chiesto = true;
    riepilogoMio.leggi().then((r) => { if (r && r.ok) { riepilogoStato.righe = r.righe; disegna(); } }).catch(() => {});
  }
  if (contestaNo && !contesta.chiesto) {
    contesta.chiesto = true;
    contestaNo.leggi().then((r) => { if (r && r.ok) { contesta.stato = r.contestazioni; disegna(); } }).catch(() => {});
  }
  const righeNo = righeNoContestabili();
  const esiti = ORDINE_NO.map((k) => (righeNo.some((x) => x.k === k) ? null : rigaContesta(contesta.stato, k).esito)).filter(Boolean);
  const righe = [...riepilogoStato.righe.bollini.map((t) => h("li", {}, t)), ...righeNo.map(rigaNo),
    ...esiti.map((t) => h("li", { classe: "nota" }, t))];
  if (!righe.length) return null;
  return h("div", { classe: "riepilogo", role: "region", "aria-label": "Dopo i tuoi incontri" },
    h("h2", {}, "Dopo i tuoi incontri"),
    h("ul", {}, righe),
    h("p", { classe: "nota" }, "Lo vedi solo tu."));
}

// «Contesta» un «No» (#6 spec v1.3 punto 2, linea B): accanto a ogni «Una persona ha risposto no a: …». Al tocco il
// foglio si apre sotto la riga: etichetta visibile, testo 10-500 caratteri, «Manda» / «Annulla». Dopo l'invio
// «In revisione». Mai nomi, date o id dell'altra persona: il server manda solo { contestabile, stato }. Solo memoria.
let contestaNo = null;
const ORDINE_NO = ["presentato", "foto_sue", "come_in_chiamata"];
const contesta = { chiesto: false, stato: {}, aperta: "", testo: "", invio: false, errore: "", inviata: "" };
function righeNoContestabili() {
  return ORDINE_NO.map((k) => ({ k, testo: TESTI_RIEPILOGO.no.replace("<domanda>", TESTI_RIEPILOGO.domande[k]) }))
    .filter((x) => riepilogoStato.righe.no.includes(x.testo));
}
function rigaNo({ k, testo }) {
  const riga = contestaNo ? rigaContesta(contesta.stato, k) : { bottone: null, esito: null };
  const parti = [h("span", {}, testo)];
  if (riga.esito) parti.push(h("p", { classe: "nota" }, riga.esito));
  if (contesta.inviata === k) parti.push(h("p", { classe: "nota", role: "status" }, TESTI_CONTESTA.inviata));
  if (riga.bottone === "in_revisione") parti.push(h("p", { classe: "nota" }, TESTI_CONTESTA.inRevisione));
  if (riga.bottone === "contesta" && contesta.aperta !== k) {
    parti.push(h("button", { classe: "link", type: "button", onclick: () => apriContesta(k) }, TESTI_CONTESTA.bottone));
  }
  if (contesta.aperta === k) {
    parti.push(h("div", { classe: "foglio-contesta", role: "group", "aria-label": TESTI_CONTESTA.bottone },
      h("label", { for: `contesta-${k}` }, TESTI_CONTESTA.domanda),
      h("p", { classe: "nota", id: `contesta-nota-${k}` }, TESTI_CONTESTA.nota),
      h("textarea", { id: `contesta-${k}`, classe: "racconto-segnala", maxlength: String(LIMITI_CONTESTA.massimo), rows: "5",
        minlength: String(LIMITI_CONTESTA.minimo), "aria-describedby": `contesta-nota-${k}`, disabled: contesta.invio,
        oninput: (e) => { contesta.testo = e.target.value; } }, contesta.testo),
      contesta.errore ? h("p", { classe: "errore", role: "alert" }, contesta.errore) : null,
      h("div", { classe: "azioni" },
        h("button", { classe: "bottone", type: "button", disabled: contesta.invio, onclick: () => mandaContesta(k) },
          contesta.invio ? "Invio…" : TESTI_CONTESTA.manda),
        h("button", { classe: "link", type: "button", disabled: contesta.invio, onclick: chiudiContesta }, TESTI_CONTESTA.annulla))));
  }
  return h("li", {}, ...parti);
}
function apriContesta(k) {
  Object.assign(contesta, { aperta: k, testo: "", errore: "", inviata: "" });
  disegna();
  const campo = radice && radice.querySelector(`#contesta-${k}`);
  if (campo) campo.focus();
}
function chiudiContesta() {
  const k = contesta.aperta;
  Object.assign(contesta, { aperta: "", testo: "", errore: "" });
  disegna();
  const b = radice && [...radice.querySelectorAll(".riepilogo button")].find((x) => x.textContent === TESTI_CONTESTA.bottone && x.closest("li")
    && x.closest("li").textContent.includes(TESTI_RIEPILOGO.domande[k]));
  if (b) b.focus();
}
async function mandaContesta(k) {
  if (contesta.invio) return;
  if (!testoValido(contesta.testo)) { contesta.errore = TESTI_CONTESTA.errori.testo_non_valido; disegna(); return; }
  contesta.invio = true; contesta.errore = ""; disegna();
  const r = await contestaNo.manda(k, contesta.testo).catch(() => ({ ok: false, testo: TESTI_CONTESTA.errori.generico }));
  contesta.invio = false;
  if (r.ok) {
    Object.assign(contesta, { aperta: "", testo: "", inviata: k });
    contesta.stato = { ...contesta.stato, [k]: { contestabile: false, stato: "in_attesa" } };
  } else contesta.errore = r.testo;
  disegna();
}

// ---------------------------------------------------------------------------------------------------------------
// «Lascia la stanza» (#381, linea «sviluppatore-b»): schermata 22 a tutta pagina dal link in fondo alla stanza.
// Il server decide (stanza aperta, nessuna chiamata in corso); dopo l'uscita la stanza si rilegge e resta il testo.
// ── Stanza viva e «Fissa una chiamata» (#380, linea A, schermate 19-20) ──
// Arrivano stati e appuntamenti (ogni 30 s, solo con l'app visibile). Si ridisegna solo se la stanza è sullo schermo,
// così un'altra schermata (o un testo che si sta scrivendo) non si tocca.
function battitoArrivato(r) {
  viva.letto = r.letto;
  viva.persa = r.persa;
  viva.stati = new Map((r.persone || []).map((p) => [p.id, p]));
  viva.appuntamenti = r.appuntamenti || [];
  if (!viva.fissa && radice && radice.querySelector("#tua-stanza-titolo")) disegna();
}

// Avvisi in cima alla stanza (spec punti 5-6): solo per le due persone dell'appuntamento.
function vistaAvvisiAppuntamenti(nomi, adesso) {
  const avvisi = avvisiAppuntamenti(viva.appuntamenti, nomi, adesso).filter((a) => !viva.nascosti.has(`${a.id}:${a.tipo}`));
  if (!avvisi.length) return null;
  return h("div", { classe: "avvisi-appuntamenti" }, avvisi.map((a) =>
    h("div", { classe: a.urgente ? "avviso-appuntamento urgente" : "avviso-appuntamento", role: a.urgente ? "alert" : null },
      h("p", {}, a.testo),
      a.messaggio ? h("p", { classe: "nota" }, `«${a.messaggio}»`) : null,
      h("div", { classe: "azioni" }, a.azioni.map((x) => h("button", {
        classe: x.azione === "conferma" || x.azione === "chiama" ? "bottone" : "bottone-secondario", type: "button",
        disabled: viva.invio, onclick: () => azioneAvviso(a, x.azione) }, x.testo))))));
}

const FATTO_AVVISO = { conferma: "Chiamata fissata.", no: "Risposta mandata.", annulla: "Appuntamento annullato." };
async function azioneAvviso(a, azione) {
  if (azione === "chiudi") { viva.nascosti.add(`${a.id}:${a.tipo}`); disegna(); return; }
  if (azione === "chiama") { telefono.chiama(a.altra); return; }
  if (azione === "altro") {
    const p = telefono.modello().stanza.persone.find((x) => x.id === a.altra);
    if (p) apriFissa(p, { modo: "altro", appuntamento: a.id });
    return;
  }
  if (viva.invio) return;
  viva.invio = true; viva.avviso = ""; viva.errore = "";
  disegna();
  const r = await stanzaViva.rispondi(a.id, azione);
  viva.invio = false;
  if (r.ok) viva.avviso = FATTO_AVVISO[azione] || ""; else viva.errore = r.testo || TESTI_FISSA.generico;
  await battito.subito();
  disegna();
}

// Schermata 20: giorno e ora solo tra quelli che il server accetterebbe, messaggio facoltativo.
function apriFissa(p, { modo = "proponi", appuntamento = null } = {}) {
  const sp = viva.stati.get(p.id);
  viva.fissa = { con: p.id, nome: nomeScheda(p), titolo: p.titolo, stato: sp ? rigaStato(sp, new Map()) : "", modo, appuntamento,
    giorni: null, giorno: "", ora: "", messaggio: "", invio: false, errore: "" };
  viva.avviso = ""; viva.errore = "";
  disegna();
  window.scrollTo(0, 0);
  const titolo = radice.querySelector("h1");
  if (titolo) { titolo.setAttribute("tabindex", "-1"); titolo.focus({ preventScroll: true }); }
  stanzaViva.ore(p.id).then((r) => {
    const f = viva.fissa;
    if (!f || f.con !== p.id) return;
    f.giorni = r.ok ? giorniEOre(r.ore, new Date()) : [];
    f.giorno = f.giorni.length ? f.giorni[0].id : "";
    if (!r.ok) f.errore = r.testo || TESTI_FISSA.generico;
    disegna();
  });
}

function chiudiFissa() {
  viva.fissa = null;
  disegna();
  const titolo = radice.querySelector("#tua-stanza-titolo");
  if (titolo) { titolo.setAttribute("tabindex", "-1"); titolo.focus(); }
}

async function inviaFissa() {
  const f = viva.fissa;
  if (!f || f.invio || !f.ora) return;
  f.invio = true; f.errore = "";
  disegna();
  const r = f.modo === "altro"
    ? await stanzaViva.rispondi(f.appuntamento, "altro", { quando: f.ora, messaggio: f.messaggio })
    : await stanzaViva.proponi({ con: f.con, quando: f.ora, messaggio: f.messaggio });
  if (viva.fissa !== f) return;
  if (!r.ok) { f.invio = false; f.errore = r.testo || TESTI_FISSA.generico; disegna(); return; }
  viva.avviso = TESTI_FISSA.fatto(f.nome);
  viva.fissa = null;
  await battito.subito();
  chiudiFissa();
}

function schermoFissa() {
  const f = viva.fissa;
  const giorno = (f.giorni || []).find((g) => g.id === f.giorno);
  const scelta = (attiva, testo, onclick) => h("button", { classe: attiva ? "scelta scelta-attiva" : "scelta", type: "button",
    "aria-pressed": attiva ? "true" : "false", disabled: f.invio, onclick }, testo);
  let corpo;
  if (f.giorni === null) corpo = h("p", { classe: "nota", role: "status" }, TESTI_FISSA.orari);
  else if (!f.giorni.length) corpo = f.errore ? null : h("p", { classe: "nota" }, TESTI_FISSA.nessunOrario);
  else {
    corpo = [
      h("p", { classe: "etichetta", id: "fissa-giorno" }, TESTI_FISSA.giorno),
      h("div", { classe: "scelte", role: "group", "aria-labelledby": "fissa-giorno" },
        f.giorni.map((g) => scelta(g.id === f.giorno, g.nome, () => { f.giorno = g.id; f.ora = ""; disegna(); }))),
      h("p", { classe: "etichetta", id: "fissa-ora" }, TESTI_FISSA.ora),
      h("div", { classe: "scelte", role: "group", "aria-labelledby": "fissa-ora" },
        (giorno ? giorno.ore : []).map((o) => scelta(o.iso === f.ora, o.testo, () => { f.ora = o.iso; disegna(); }))),
      h("div", { classe: "campo" },
        h("label", { for: "fissa-messaggio" }, TESTI_FISSA.messaggio),
        h("textarea", { id: "fissa-messaggio", rows: "3", maxlength: String(TESTI_FISSA.massimo), placeholder: TESTI_FISSA.segnaposto,
          disabled: f.invio, oninput: (e) => { f.messaggio = e.target.value; } }, f.messaggio)),
      h("p", { classe: "nota" }, TESTI_FISSA.spiega(f.nome)),
    ];
  }
  return h("section", { classe: "schermata fissa-chiamata" },
    h("p", { classe: "sopratitolo" }, [f.titolo, f.stato].filter(Boolean).join(" · ")),
    h("h1", {}, "Fissa una chiamata ", h("em", {}, `con ${f.nome}.`)),
    corpo,
    errore(f.errore),
    f.invio ? h("p", { classe: "nota", role: "status" }, "Un attimo…") : null,
    h("div", { classe: "azioni" },
      h("button", { classe: "bottone-secondario", type: "button", disabled: f.invio, onclick: chiudiFissa }, TESTI_FISSA.annulla),
      h("button", { classe: "bottone", type: "button", disabled: f.invio || !f.ora, onclick: inviaFissa }, TESTI_FISSA.proponi)));
}

function apriUscita() {
  if (!uscitaStanza || uscita.nodo) return;
  const chiudi = () => { uscita.nodo = null; disegna(); };
  uscita.nodo = apriSchermataUscita(radice, {
    uscita: uscitaStanza,
    alResto: chiudi,
    alAiuto: supporto ? () => { uscita.nodo = null; apriAiuto(); } : null,
    alFatto: (testo) => { uscita.fatto = testo; uscita.nodo = null; telefono.ricaricaPersone(); disegna(); },
  }).nodo;
  disegna();
}

// Il Filo della stanza (#360 passo 9b, linea C): la schermata 18 si ridisegna quando arrivano i dati o si entra.
export function filoCambiato() {
  if (!radice || (!filoLunedi && !filoRiascolto) || !PASSI[stato.passo] || PASSI[stato.passo].id !== "fatto") return;
  disegna();
}

// Dopo «Entra nella stanza» il fuoco va sul titolo «La tua stanza», così la tastiera non si perde.
function dopoBenvenutoFilo() {
  const titolo = radice && radice.querySelector("#tua-stanza-titolo");
  if (titolo) { titolo.tabIndex = -1; titolo.focus({ preventScroll: true }); }
}

// «Il profilo» (schermata 23 del design v4, #349, linea B): si apre dal cerchio in alto a destra solo nella home a
// profilo completo e fuori dalle chiamate. Le righe riportano ai passi dell'iscrizione già esistenti (risposte, foto,
// chi cerchi); «Elimina il mio account» sta solo qui. Saldo e regali li legge creaSchermoProfilo dal server.
function profiloApribile() {
  if (!schermoProfilo || PASSI[stato.passo].id !== "fatto") return false;
  try { return !telefono || telefono.modello().schermo.tipo === "nessuna"; } catch { return false; }
}
// «Notifiche» e «Privacy» del profilo (spec del CPO del 25/11, #349, linea B): si aprono al posto del profilo;
// «Indietro» riporta al profilo. Il fuoco va sul titolo, così la tastiera non si perde.
let profiloSotto = null;
function fuocoSu(id) {
  const t = radice && radice.querySelector(`#${id}`);
  if (t) { t.tabIndex = -1; t.focus({ preventScroll: true }); }
}
function apriSottoProfilo(quale) { profiloSotto = quale; disegna(); fuocoSu(`${quale}-titolo`); }
function chiudiSottoProfilo() { profiloSotto = null; disegna(); fuocoSu("profilo-titolo"); }
function schermoIlProfilo() {
  if (profiloSotto === "notifiche") return vistaNotifiche(h, { indietro: chiudiSottoProfilo });
  if (profiloSotto === "privacy") return vistaPrivacy(h, { indietro: chiudiSottoProfilo, aiuto: supporto ? () => { profiloSotto = null; schermoProfilo.chiudi(); apriAiuto(); } : null });
  const d = schermoProfilo.dati();
  const daQui = (id) => () => { schermoProfilo.chiudi(); vai(PASSI.findIndex((p) => p.id === id)); };
  return vistaProfilo(h, statoProfilo({ nome: stato.nome, eta: etaDa(stato.dataNascita), citta: nomeVisibile(stato.provincia),
    voce: stato.voce, saldo: d.saldo, regali: d.regali, inStanza: inStanzaAperta() }), {
    onda: ondaGrande(), risposte: daQui("risposte"), foto: daQui("foto"), preferenze: daQui("cerchi"),
    notifiche: () => apriSottoProfilo("notifiche"), privacy: () => apriSottoProfilo("privacy"),
    regali: regaliProfilo ? () => regaliProfilo.apri() : null,
    ricarica: d.saldo === null ? null : () => apriCreditiDalProfilo(d.saldo),
    elimina: () => {
      if (confirm("Vuoi davvero eliminare il tuo account? Cancelliamo subito email, voce, foto, questionario e filtri.")) eliminaAccount();
    },
    torna: () => schermoProfilo.chiudi(), errore: salvataggio.errore });
}
// «Ricarica» del profilo (#349, linea B, passo 3; spec #331 v1.1 punto 5): la schermata 13 si apre sotto la testata al
// posto di #app, che resta il profilo; «Più tardi» riporta al profilo. In beta «Paga» resta spento nella 13.
function apriCreditiDalProfilo(saldo) {
  if (document.querySelector(".tuoi-coin")) return;
  apriTuoiCoin(document.querySelector(".pagina.app"), schermataTuoiCoin(saldo, { primaStanzaUsata: schermoProfilo.primaStanzaUsata() !== false }),
    { principale: document.getElementById("app") });
}

// Schermata 13 «I tuoi crediti» una volta sola dopo l'iscrizione (passo 10 di 10, dopo le foto; #349, linea B, passo 4;
// spec #331 v1.1 punto 3). «Una volta» la decide il passo massimo salvato sul server. Si apre al posto della home, quindi
// «Più tardi» porta alla home. Saldo letto dal server; se non arriva, la 13 non si apre. In beta «Paga» resta spento.
async function apriCreditiDopoIscrizione() {
  if (!opzioniCoin) return;
  let c = null;
  try { c = await opzioniCoin.saldo(); } catch { c = null; }
  if (!c || c.ok !== true || !Number.isInteger(c.saldo) || document.querySelector(".tuoi-coin")) return;
  apriTuoiCoin(document.querySelector(".pagina.app"), schermataTuoiCoin(c.saldo, { primaStanzaUsata: c.primaStanzaUsata === true }),
    { principale: document.getElementById("app") });
}

// Schermata 35 (#349, linea C): «Rivedi la tua stanza» la toglie per questa domenica e porta il fuoco su «La tua stanza».
function rivediStanza() {
  domenicaSera.rivedi(new Date());
  disegna();
  const titolo = radice && radice.querySelector("#tua-stanza-titolo");
  if (titolo) { titolo.tabIndex = -1; titolo.focus({ preventScroll: true }); }
}
