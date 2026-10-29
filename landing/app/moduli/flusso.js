// Iscrizione alla web app (issue #2, specifica v1 e v1.1 del CPO): benvenuto → email → maggiore età → regole →
// chi sei → chi cerchi → voce → tre risposte a voce → questionario → foto → fatto.
//
// MODALITÀ ANTEPRIMA: finché l'informativa privacy dell'app (T08) e la revisione di sicurezza (T15) non sono pronte,
// questa è solo una bozza da provare. Niente viene inviato né salvato: voce, foto e risposte restano nella memoria
// della pagina e spariscono quando la si chiude. Nessuna email viene mandata.

import { DOMANDE, TEMI, IMPORTANZA, DOMANDA_IMPORTANZA, DOMANDE_VOCE, erroreRisposta } from "./domande.js";
import { registra, registrazioneSupportata, MINIMO_SECONDI } from "./registratore.js";
import { preparaFoto } from "./foto.js";
import { MESSAGGI } from "./accesso.js";

// ---------------------------------------------------------------------------------------------------------------
// Piccolo aiuto per creare elementi senza HTML in stringa (niente innerHTML: niente codice iniettabile).
function h(tag, attributi = {}, ...figli) {
  const el = document.createElement(tag);
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

const CITTA = ["Milano", "Roma", "Napoli", "Torino", "Bologna", "Firenze", "Palermo", "Bari", "Genova", "Venezia",
  "Verona", "Catania", "Padova", "Brescia", "Bergamo", "Parma", "Modena", "Cagliari", "Trieste", "Pescara"];

// Stato dell'iscrizione, solo in memoria.
const stato = {
  passo: 0,
  email: "",
  dataNascita: "", giorno: "", mese: "", anno: "", minorenne: false,
  regole: false,
  nome: "", citta: "", cittaAltra: "", estero: false, miPresento: "", miDescrivo: "",
  cerco: "", consensoCerco: false, etaMin: 25, etaMax: 40, raggio: "citta", cosaCerco: "", figli: "", fumo: "",
  voce: null,                 // { url, secondi }
  domandeVoce: [],            // indici scelti in DOMANDE_VOCE
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
const email = { inviata: false, codice: "", errore: "", attesa: false };

export function avvia(elemento, opzioni = {}) {
  radice = elemento;
  accesso = opzioni.accesso || null;
  if (opzioni.erroreLink) { stato.passo = 1; email.errore = MESSAGGI[opzioni.erroreLink] || MESSAGGI.generico; }
  // Già dentro (dal link nell'email o da una sessione precedente): si riparte dalla maggiore età.
  if (accesso && accesso.connesso()) stato.passo = 2;
  disegna();
}

function vai(passo) {
  if (registrazioneInCorso) { registrazioneInCorso.ferma(); registrazioneInCorso = null; }
  stato.passo = Math.max(0, Math.min(PASSI.length - 1, passo));
  disegna();
  window.scrollTo(0, 0);
  const titolo = radice.querySelector("h1");
  if (titolo) { titolo.setAttribute("tabindex", "-1"); titolo.focus({ preventScroll: true }); }
}

function disegna() {
  const passo = PASSI[stato.passo];
  const contenuto = SCHERMATE[passo.id]();
  const parti = [
    h("div", { classe: "anteprima", role: "note" }, accesso
      ? "Prova: l'accesso con email è vero, il resto del profilo non viene ancora salvato. Voce e foto restano su questo telefono."
      : "Anteprima: niente viene inviato né salvato. Voce e foto restano su questo telefono finché non chiudi la pagina."),
    stato.passo > 0 && stato.passo < PASSI.length - 1 ? barra() : null,
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

function schermata(titolo, sottotitolo, corpo, azioni) {
  return h("section", { classe: "schermata" },
    h("h1", {}, titolo),
    sottotitolo ? h("p", { classe: "sottotitolo" }, sottotitolo) : null,
    h("div", { classe: "corpo" }, corpo),
    h("div", { classe: "azioni" }, azioni));
}

// «quando» può essere una funzione: allora il pulsante si riaccende/spegne con ricontrolla(), senza ridisegnare
// la schermata. Serve sui campi di testo: ridisegnare mentre si scrive (o al primo tocco fuori dal campo) su iPhone
// fa perdere il tocco sul pulsante.
let pulsanteAvanti = null;
let condizioneAvanti = null;
function avanti(testo, quando, onclick) {
  const condizione = typeof quando === "function" ? quando : () => Boolean(quando);
  const bottone = h("button", { classe: "bottone", type: "button", disabled: !condizione(), onclick: () => { if (condizione()) onclick(); } }, testo);
  pulsanteAvanti = bottone;
  condizioneAvanti = condizione;
  return bottone;
}
function ricontrolla() {
  if (pulsanteAvanti && condizioneAvanti) pulsanteAvanti.disabled = !condizioneAvanti();
}
function indietro() {
  return h("button", { classe: "bottone-secondario", type: "button", onclick: () => vai(stato.passo - 1) }, "Indietro");
}
function errore(testo) {
  return testo ? h("p", { classe: "errore", role: "alert" }, testo) : null;
}

// Gruppo di scelte a pulsante (radio o caselle). valori: [[valore, etichetta]].
function scelte(nome, valori, scelto, onScelta, { multipla = false } = {}) {
  return h("div", { classe: "scelte", role: multipla ? "group" : "radiogroup" },
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
    if (r.ok) { email.inviata = false; vai(2); } else { email.errore = MESSAGGI[r.motivo] || MESSAGGI.codice; disegna(); }
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
    return schermata("Ci si conosce prima con la voce.",
      "Niente foto da scorrere, niente swipe. Una stanza di 12 persone compatibili, chiamate solo voce da 15 minuti, e domenica sera le porte si aprono solo dove la chiave è reciproca.",
      [h("p", { classe: "nota" }, h("a", { href: "/privacy" }, "Informativa privacy"), " · Regole della community (in arrivo)")],
      [avanti("Entra", true, () => vai(1))]);
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
        if (eta < 18) { stato.minorenne = true; disegna(); return; }
        vai(3);
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
      [indietro(), avanti("Continua", stato.regole, () => vai(4))]);
  },

  chi() {
    const nomeOk = () => /^[\p{L}][\p{L}' -]{1,19}$/u.test(stato.nome.trim());
    const cittaOk = () => stato.estero || (stato.citta && (stato.citta !== "altra" || stato.cittaAltra.trim().length >= 2));
    const presentoOk = () => stato.miPresento && (stato.miPresento !== "mi_descrivo" || stato.miDescrivo.trim().length >= 2);
    const avvisoNome = h("p", { classe: "errore", role: "alert", hidden: !stato.nome || nomeOk() }, "Da 2 a 20 lettere, senza numeri.");
    const selezione = h("select", { id: "citta", onchange: (e) => {
      stato.estero = e.target.value === "estero"; stato.citta = e.target.value; disegna(); } },
      h("option", { value: "" }, "Scegli la tua città"),
      CITTA.map((c) => h("option", { value: c, selected: stato.citta === c }, c)),
      h("option", { value: "altra", selected: stato.citta === "altra" }, "Un'altra città italiana"),
      h("option", { value: "estero", selected: stato.citta === "estero" }, "Vivo all'estero"));
    return schermata("Chi sei", "Gli altri vedranno solo nome, età e città.",
      [h("label", { for: "nome" }, "Nome (solo il nome di battesimo)"),
        h("input", { id: "nome", autocomplete: "given-name", autocapitalize: "words", maxlength: "20", value: stato.nome,
          oninput: (e) => { stato.nome = e.target.value; if (nomeOk()) avvisoNome.hidden = true; ricontrolla(); },
          onblur: () => { avvisoNome.hidden = !stato.nome || nomeOk(); } }),
        avvisoNome,
        h("label", { for: "citta" }, "Città"), selezione,
        stato.citta === "altra" ? h("input", { id: "citta-altra", "aria-label": "Nome della città", placeholder: "Scrivi la città", value: stato.cittaAltra,
          oninput: (e) => { stato.cittaAltra = e.target.value; ricontrolla(); } }) : null,
        h("p", { classe: "etichetta" }, "Mi presento come"),
        scelte("presento", [["donna", "Donna"], ["uomo", "Uomo"], ["non_binario", "Non binario"], ["mi_descrivo", "Preferisco descrivermi"]],
          stato.miPresento, (v) => { stato.miPresento = v; disegna(); }),
        stato.miPresento === "mi_descrivo" ? h("input", { "aria-label": "Come ti descrivi", maxlength: "40", value: stato.miDescrivo,
          oninput: (e) => { stato.miDescrivo = e.target.value; ricontrolla(); } }) : null],
      [indietro(), avanti("Continua", () => Boolean(nomeOk() && cittaOk() && presentoOk()), () => vai(5))]);
  },

  cerchi() {
    const etaOk = () => stato.etaMin >= 18 && stato.etaMax <= 99 && stato.etaMin <= stato.etaMax;
    const tutto = () => Boolean(stato.cerco && stato.consensoCerco && etaOk() && stato.raggio && stato.cosaCerco && stato.figli && stato.fumo);
    const avvisoEta = h("p", { classe: "errore", role: "alert", hidden: etaOk() }, "Età da 18 a 99, e la massima non può essere minore della minima.");
    const numero = (id, valore, set) => h("input", { id, type: "text", inputmode: "numeric", pattern: "[0-9]*", maxlength: "2", value: String(valore),
      oninput: (e) => { set(Number(e.target.value.replace(/\D/g, "")) || 0); avvisoEta.hidden = etaOk(); ricontrolla(); } });
    return schermata("Chi cerchi", "Servono a comporre la tua stanza. Nessuno li vede.",
      [h("p", { classe: "etichetta" }, "Cerco"),
        scelte("cerco", [["donne", "Donne"], ["uomini", "Uomini"], ["tutti", "Tutti"]], stato.cerco, (v) => { stato.cerco = v; disegna(); }),
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
        scelte("raggio", [["citta", "Solo la mia città"], ["italia", "Anche altre città italiane"], ["estero", "Anche dall'estero, nella mia lingua"]],
          stato.raggio, (v) => { stato.raggio = v; disegna(); }),
        h("p", { classe: "etichetta" }, "Cosa cerco"),
        scelte("cosa", [["storia_seria", "Una storia seria"], ["senza_fretta", "Conoscersi senza fretta"]], stato.cosaCerco, (v) => { stato.cosaCerco = v; disegna(); }),
        h("p", { classe: "etichetta" }, "Figli"),
        scelte("figli", [["ne_voglio", "Ne voglio"], ["forse", "Forse"], ["no", "No"], ["ne_ho", "Ne ho"]], stato.figli, (v) => { stato.figli = v; disegna(); }),
        h("p", { classe: "etichetta" }, "Fumo"),
        scelte("fumo", [["si", "Sì"], ["no", "No"], ["indifferente", "Indifferente"]], stato.fumo, (v) => { stato.fumo = v; disegna(); })],
      [indietro(), avanti("Continua", tutto, () => vai(6))]);
  },

  voce() {
    return schermata("La tua voce",
      "Presentati come faresti a una cena tra amici. Hai 20 secondi.",
      [registratoreVoce(stato.voce, 20, (esito) => { stato.voce = esito; disegna(); })],
      [indietro(), avanti("Continua", Boolean(stato.voce), () => vai(7))]);
  },

  risposte() {
    const scelte3 = stato.domandeVoce;
    const tutteFatte = scelte3.length === 3 && scelte3.every((i) => stato.risposteVoce[i]);
    return schermata("Tre risposte a voce",
      "Scegli 3 domande e rispondi a voce, massimo 30 secondi ciascuna.",
      [scelte("domande-voce", DOMANDE_VOCE.map((d, i) => [i, d]), scelte3, (i) => {
          if (scelte3.includes(i)) { stato.domandeVoce = scelte3.filter((x) => x !== i); delete stato.risposteVoce[i]; }
          else if (scelte3.length < 3) stato.domandeVoce = [...scelte3, i];
          disegna();
        }, { multipla: true }),
        h("p", { classe: "nota" }, `${scelte3.length} di 3 scelte`),
        scelte3.map((i) => h("div", { classe: "risposta-voce" },
          h("p", { classe: "etichetta" }, DOMANDE_VOCE[i]),
          registratoreVoce(stato.risposteVoce[i], 30, (esito) => { stato.risposteVoce[i] = esito; disegna(); })))],
      [indietro(), avanti("Continua", tutteFatte, () => vai(8))]);
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
      h("p", { classe: "etichetta" }, `${DOMANDA_IMPORTANZA} · ${TEMI[d.tema].nome}`),
      scelte(`imp-${d.tema}`, IMPORTANZA.map((t, i) => [i + 1, t]), q.importanza[d.tema], (v) => { q.importanza[d.tema] = v; disegna(); })) : null;
    const prossima = () => {
      if (d.n < DOMANDE.length) { q.domanda = d.n + 1; disegna(); window.scrollTo(0, 0); } else vai(9);
    };
    const precedente = () => { if (d.n > 1) { q.domanda = d.n - 1; disegna(); } else vai(7); };
    return schermata(d.testo,
      `${TEMI[d.tema].nome} · domanda ${d.n} di ${DOMANDE.length}`,
      [campo, conta, d.n === 1 ? h("p", { classe: "nota" }, "Le risposte restano private. Servono solo a scegliere la tua stanza.") : null],
      [h("button", { classe: "bottone-secondario", type: "button", onclick: precedente }, "Indietro"),
        avanti(d.n < DOMANDE.length ? "Avanti" : "Fine questionario", rispostaOk && importanzaOk, prossima)]);
  },

  foto() {
    const pronte = stato.foto.filter(Boolean).length;
    return schermata("Le tue foto",
      "Nessuno le vede fino a quando entrambi aprite la porta. Servono 3 foto, con il volto visibile in almeno una.",
      [h("div", { classe: "griglia-foto" }, stato.foto.map((f, i) => casellaFoto(f, i))),
        h("p", { classe: "nota" }, "Prima di tutto il telefono toglie dalle foto i dati nascosti (posizione, modello, data).")],
      [indietro(), avanti("Continua", pronte === 3, () => vai(10))]);
  },

  fatto() {
    const citta = stato.estero ? "all'estero" : (stato.citta === "altra" ? stato.cittaAltra : stato.citta);
    return schermata("Il tuo profilo è pronto.",
      "La prossima stanza apre lunedì alle 9:00.",
      [h("div", { classe: "riepilogo" },
          h("p", {}, h("strong", {}, stato.nome.trim()), `, ${etaDa(stato.dataNascita)} anni, ${citta}`),
          stato.voce ? h("audio", { controls: true, src: stato.voce.url, "aria-label": "La tua presentazione" }) : null,
          h("p", { classe: "nota" }, "Questo è ciò che vedranno gli altri della stanza: nome, età, città, la tua voce e le tue 3 risposte. Mai foto, questionario, filtri o email.")),
        h("p", { classe: "nota" }, "Era un'anteprima: niente è stato inviato o salvato.")],
      [h("button", { classe: "bottone-secondario", type: "button", onclick: () => location.reload() }, "Ricomincia l'anteprima")]);
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
    if (stato.errore) box.append(errore(messaggi[stato.errore] || messaggi.altro));
    if (esistente && !stato.registrando) {
      box.append(h("audio", { controls: true, src: esistente.url }),
        h("p", { classe: "nota" }, `${esistente.secondi.toFixed(0)} secondi`),
        h("button", { classe: "bottone-secondario", type: "button", onclick: inizia }, "Rifai"));
      return;
    }
    if (stato.registrando) {
      const riempimento = h("span");
      riempimento.style.width = `${Math.min(100, (stato.secondi / massimo) * 100)}%`;
      box.append(h("p", { classe: "timer", "aria-live": "off" }, `${Math.floor(stato.secondi)} / ${massimo} s`),
        h("div", { classe: "avanzamento-barra" }, riempimento),
        h("button", { classe: "bottone bottone-rec", type: "button", onclick: () => registrazioneInCorso && registrazioneInCorso.ferma() }, "Ferma"));
      return;
    }
    box.append(h("button", { classe: "bottone bottone-rec", type: "button", disabled: !registrazioneSupportata(), onclick: inizia }, "● Registra"),
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
    onFatto({ url: esito.url, secondi: esito.secondi });
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
      stato.foto[i] = { url: esito.url };
      disegna();
    } });
  return h("div", { classe: "casella-foto" },
    f ? h("img", { src: f.url, alt: `Foto ${i + 1}` }) : h("span", { classe: "piu", "aria-hidden": "true" }, "+"),
    h("label", { for: `foto-${i}`, classe: "bottone-secondario" }, f ? "Cambia" : `Foto ${i + 1}`),
    input);
}
