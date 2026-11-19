// Prova finta dell'app (D141 A di Giuseppe, linea «sviluppatore-c»): un «server finto» che risponde al posto di
// Supabase e del Worker, così si clicca tutta l'app con persone e dati finti. Le schermate sono quelle vere
// (flusso.js e i moduli delle tre linee); qui si fingono solo i pezzi che parlano con la rete, con la stessa forma
// delle risposte vere. REGOLE: niente rete, niente salvataggi sul telefono (tutto sparisce chiudendo la pagina),
// nomi chiaramente inventati. La pagina che la usa è /app/prova.html (non linkata, noindex).
//
// Passo 1: accesso con email, iscrizione salvata in memoria, provincia della lista, contatore della zona,
// «Entra nella stanza». Passo 2: stanza di 12 (tu + 11 persone finte) e chiamate simulate con il «telefono» vero
// (telefono.js, sentinella.js): squillo, timer di 15 minuti, carte, «La richiameresti?», diario. Niente microfono,
// niente audio. I passi successivi aggiungono chiavi, sera delle porte, porta, svelamento, segnala/blocca, Aiuto.

import { creaTelefono } from "./telefono.js";
import { creaSentinella } from "./sentinella.js";
import { DOMANDE, TEMI } from "./domande.js";

export const UTENTE_PROVA = "00000000-0000-4000-8000-000000000001";
const EMAIL_VALIDA = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FILE_AMMESSI = /^(presentazione|risposta-[1-3]|foto-[1-3])$/;
const CAMPI_PROFILO = ["data_nascita", "regole_accettate_il", "nome", "provincia", "provincia_origine", "paese",
  "mi_presento_come", "mi_descrivo", "domande_voce", "passo", "fascia_da", "fascia_a", "pausa_il"];
const CAMPI_FILTRI = ["cerco", "eta_min", "eta_max", "raggio", "cosa_cerco", "figli", "fumo"];

// Regole delle chiamate: le stesse del server (api/chiamate.js, che il telefono non può importare).
const CHIAMATA = Object.freeze({ durata: 900, minimo: 60, squillo: 30, ultimoMinuto: 60, risponde: 4, conStessaPersona: 3 });
const CARTE = Object.freeze({ dopo: 10, attesa: 20, suggerimentoA: 30, suggerimentoPer: 8 });
// Alcune carte della versione v1 (le stesse della tabella carte, test/carte_v1.json).
const MAZZO = Object.freeze([
  "Qual è il suono che ti mette di buon umore?",
  "Mare o montagna? E perché proprio così?",
  "Il piatto che sapresti cucinare a occhi chiusi?",
  "Mattina presto o notte fonda?",
  "Un viaggio che rifaresti domani?",
  "Cosa ti fa ridere anche quando non dovresti?",
  "Una piccola abitudine a cui non rinunci?",
  "Che cosa ordini sempre al bar?",
]);
const TESTO_BREVE = "La chiamata è durata poco e non conta nei limiti.";
const TESTO_TRE = "Avete già parlato 3 volte. Ora tocca alle chiavi";

// La stanza della prova: 11 persone inventate (con te fanno 12). La città dice sempre che è una persona finta.
const finta = (n) => `00000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;
export const PERSONE_PROVA = Object.freeze([
  ["Aurora", 31, "Milano"], ["Bruno", 36, "Monza"], ["Celeste", 29, "Milano"], ["Dario", 41, "Pavia"],
  ["Elettra", 34, "Milano"], ["Furio", 38, "Lodi"], ["Ginevra", 27, "Milano"], ["Ivo", 45, "Bergamo"],
  ["Ludovica", 33, "Como"], ["Manfredi", 30, "Milano"], ["Ottavia", 39, "Varese"],
].map(([nome, eta, citta], i) => Object.freeze({ id: finta(i + 1), nome, eta, citta: `Persona finta · ${citta}` })));

function tieni(campi, ammessi) {
  const fuori = {};
  for (const k of ammessi) if (campi && campi[k] !== undefined) fuori[k] = campi[k];
  return fuori;
}

// Ore e minuti di Roma per un istante (serve per il lunedì delle 9:00 con l'ora legale giusta).
function ora(ms) {
  const parti = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short" })
    .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { anno: Number(parti.year), mese: Number(parti.month), giorno: Number(parti.day), ora: Number(parti.hour) % 24, dow: parti.weekday };
}

// Il prossimo lunedì alle 9:00 di Roma dopo «adesso», in ISO.
export function prossimoLunedi(adesso) {
  const oggi = ora(adesso);
  for (let g = 0; g <= 7; g += 1) {
    for (const scarto of [1, 2]) {
      const ms = Date.UTC(oggi.anno, oggi.mese - 1, oggi.giorno + g, 9 - scarto);
      const r = ora(ms);
      if (r.dow === "Mon" && r.ora === 9 && ms > adesso) return new Date(ms).toISOString();
    }
  }
  return null;
}

// cambiato: chi ridisegna la pagina quando il telefono cambia (flusso.js › telefonoCambiato); pagina: il documento,
// per fermare la sentinella quando la scheda non si vede.
export function creaProva({ adesso = () => Date.now(), attesaMs = 250, cambiato = () => {}, pagina } = {}) {
  // Tutto il «database» della prova: vive solo in questa pagina.
  const mondo = { sessione: false, profilo: null, filtri: null, questionario: null, file: new Map(), conferma: null };
  // Un attimo di attesa come una rete vera, così si vedono «Invio…» e «Un attimo…».
  const pausa = () => new Promise((fatto) => setTimeout(fatto, attesaMs));
  const ok = async (extra = {}) => { await pausa(); return { ok: true, ...extra }; };

  const accesso = {
    async mandaLink(email) {
      if (!EMAIL_VALIDA.test(String(email || "").trim())) return { ok: false, motivo: "email" };
      return ok();
    },
    // Nella prova va bene qualunque codice di 6 cifre: nessuna email parte davvero.
    async verificaCodice(email, codice) {
      if (!/^\d{6}$/.test(String(codice || "").replace(/\s+/g, ""))) return { ok: false, motivo: "codice" };
      await pausa();
      mondo.sessione = true;
      return { ok: true, sessione: { utenteId: UTENTE_PROVA } };
    },
    daLink() { return null; },
    async token() { return mondo.sessione ? "token-della-prova" : null; },
    connesso() { return mondo.sessione; },
    utenteId() { return mondo.sessione ? UTENTE_PROVA : null; },
    async esci() { mondo.sessione = false; },
  };

  const archivio = {
    async salvaProfilo(campi) { mondo.profilo = { ...(mondo.profilo || {}), ...tieni(campi, CAMPI_PROFILO) }; return ok(); },
    async salvaDisponibilita(campi) {
      mondo.profilo = { ...(mondo.profilo || {}), ...tieni(campi, ["fascia_da", "fascia_a", "pausa_il"]) };
      return ok();
    },
    async salvaFiltri(campi) { mondo.filtri = { ...(mondo.filtri || {}), ...tieni(campi, CAMPI_FILTRI) }; return ok(); },
    async salvaQuestionario(risposte, importanza) { mondo.questionario = { risposte: { ...risposte }, importanza: { ...importanza } }; return ok(); },
    async caricaFile(cartella, nome, blob) {
      if (!["voci", "foto"].includes(cartella) || !FILE_AMMESSI.test(nome)) return { ok: false, motivo: "salvataggio" };
      mondo.file.set(`${cartella}/${nome}`, blob);
      return ok();
    },
    async scaricaFile(cartella, nome) { return mondo.file.get(`${cartella}/${nome}`) || null; },
    async leggi() {
      await pausa();
      const nomi = (cartella) => [...mondo.file.keys()].filter((k) => k.startsWith(`${cartella}/`)).map((k) => k.slice(cartella.length + 1));
      return { ok: true, profilo: mondo.profilo && { ...mondo.profilo }, filtri: mondo.filtri && { ...mondo.filtri },
        questionario: mondo.questionario && { ...mondo.questionario }, voci: nomi("voci"), foto: nomi("foto") };
    },
  };

  // Nessuna lista d'attesa nella prova; la zona della prova è già accesa, quindi niente contatore.
  const lista = { async leggi() { return null; }, async conferma() { return false; } };
  const zona = { async leggi() { return null; } };

  const stanza = {
    async leggi() { await pausa(); return { ok: true, apreIl: mondo.conferma }; },
    async entra() { mondo.conferma = prossimoLunedi(adesso()); return ok({ apreIl: mondo.conferma }); },
    async ritira() { mondo.conferma = null; return ok(); },
  };

  // ---- Passo 2: stanza e chiamate -------------------------------------------------------------------------------
  // Una chiamata alla volta. «scarto» sposta l'orologio della sola chiamata (comando «Salta all'ultimo minuto»).
  const linea = { attuale: null, registro: [], dopoDa: null, pescate: 0, carta: 0, diario: [] };
  const sec = (c) => Math.floor((adesso() + c.scarto - c.inizio) / 1000);
  const vista = () => {
    const c = linea.attuale;
    if (!c) return null;
    if (c.fase === "squilla") {
      const resta = Math.ceil((c.squillaDal + CHIAMATA.squillo * 1000 - adesso()) / 1000);
      // L'altra persona risponde da sola dopo qualche secondo; chi ti chiama aspetta i 30 secondi dello squillo.
      if (c.io === "chiama" && adesso() - c.squillaDal >= CHIAMATA.risponde * 1000) {
        Object.assign(c, { fase: "in_corso", inizio: c.squillaDal + CHIAMATA.risponde * 1000, scarto: 0 });
      } else if (resta <= 0) {
        linea.attuale = null;
        return null;
      } else {
        return { fase: "squilla", io: c.io, altra: c.altra, squillo: resta };
      }
    }
    if (c.fase === "in_corso" && sec(c) >= CHIAMATA.durata) finisci("tempo_scaduto");
    if (c.fase === "finita") return { fase: "finita", io: c.io, altra: c.altra };
    const s = sec(c);
    const restanti = Math.max(0, CHIAMATA.durata - s);
    const visibile = s >= CARTE.dopo && s < CHIAMATA.durata - CHIAMATA.ultimoMinuto;
    const attesa = c.ultimaPescata === null ? 0 : Math.max(0, CARTE.attesa - (s - c.ultimaPescata));
    return {
      fase: "in_corso", io: c.io, altra: c.altra, restanti, ultimoMinuto: restanti <= CHIAMATA.ultimoMinuto,
      altraPersona: "collegata", carte: { visibile, attesa: visibile ? attesa : 0 },
      suggerimento: c.pescate === 0 && s >= CARTE.suggerimentoA && s < CARTE.suggerimentoA + CARTE.suggerimentoPer,
      carta: c.carta ? { testo: c.carta, daMe: true } : null, ascolto: "fatto",
    };
  };
  function finisci(esito) {
    const c = linea.attuale;
    if (!c || c.fase === "finita") return;
    const durata = c.fase === "in_corso" ? Math.min(CHIAMATA.durata, sec(c)) : 0;
    c.fase = "finita";
    const voce = { chi: c.io === "chiama" ? UTENTE_PROVA : c.altra, con: c.io === "chiama" ? c.altra : UTENTE_PROVA,
      altra: c.altra, inizio: new Date(c.inizio || adesso()).toISOString(), durata, esito, chiesta: false };
    linea.registro.push(voce);
  }
  const libera = () => !linea.attuale || linea.attuale.fase === "finita";
  const conLei = (id) => linea.registro.filter((r) => r.altra === id && r.durata >= CHIAMATA.minimo).length;

  const chiamata = {
    async stato() { await pausa(); return { ok: true, vista: vista() }; },
    async pulsanti() {
      return { ok: true, pulsanti: PERSONE_PROVA.filter((p) => conLei(p.id) >= CHIAMATA.conStessaPersona).map((p) => ({ id: p.id, testo: TESTO_TRE })) };
    },
    async apri(verso) {
      if (!PERSONE_PROVA.some((p) => p.id === verso)) return { ok: false, motivo: "non_in_stanza" };
      if (!libera()) return { ok: false, motivo: "gia_in_chiamata" };
      if (conLei(verso) >= CHIAMATA.conStessaPersona) return { ok: false, motivo: "tre_con_lei" };
      linea.attuale = { fase: "squilla", io: "chiama", altra: verso, squillaDal: adesso(), inizio: null, scarto: 0, pescate: 0, ultimaPescata: null, carta: "" };
      return ok({ vista: vista() });
    },
    async rispondi() {
      const c = linea.attuale;
      if (!c || c.fase !== "squilla" || c.io !== "riceve") return { ok: false, motivo: "nessuna" };
      Object.assign(c, { fase: "in_corso", inizio: adesso(), scarto: 0 });
      return ok({ vista: vista() });
    },
    async rifiuta() { linea.attuale = null; return ok({ vista: null }); },
    async chiudi(segnala = false) {
      if (!linea.attuale) return { ok: false, motivo: "nessuna" };
      vista(); // il tempo scaduto nel frattempo vale come fine naturale
      finisci(segnala === true ? "chiudi_e_segnala" : "chiusa");
      return ok({ vista: vista(), segnala: segnala === true });
    },
    async carta() {
      const c = linea.attuale;
      const v = vista();
      if (!c || !v || v.fase !== "in_corso") return { ok: false, motivo: "nessuna" };
      if (!v.carte.visibile) return { ok: false, motivo: "fuori_tempo" };
      if (v.carte.attesa > 0) return { ok: false, motivo: "troppo_presto" };
      c.carta = MAZZO[linea.carta % MAZZO.length];
      linea.carta += 1;
      c.pescate += 1;
      c.ultimaPescata = sec(c);
      return ok({ vista: vista() });
    },
    async caduta() { return ok({ vista: vista() }); },
    // Cosa mostrare dopo (come api/dopo_chiamata.js): domanda e diario solo per le chiamate da almeno 60 secondi.
    async dopo(appena = false) {
      const r = linea.registro[linea.registro.length - 1];
      if (!appena || !r || r.chiesta) return ok({ dopo: null });
      r.chiesta = true;
      if (r.esito === "chiudi_e_segnala") return ok({ dopo: null });
      if (r.durata >= CHIAMATA.minimo) {
        return ok({ dopo: { tipo: "richiameresti", passi: ["richiameresti", "diario", "fine"], testo: null, altra: r.altra,
          chiamata: { chi: r.chi, inizio: r.inizio }, diario: { con: r.altra, chiamataIl: r.inizio, durata: r.durata } } });
      }
      return ok({ dopo: { tipo: "breve", passi: ["fine"], testo: r.durata > 0 ? TESTO_BREVE : null, altra: r.altra, chiamata: null, diario: null } });
    },
    async richiameresti() { return ok({ salvata: true }); },
  };
  // Al posto della voce vera (voce.js): nessun microfono, nessun audio.
  const voce = { chiudi() {}, muto() {} };
  const lineaFinta = {
    chiama: (id) => chiamata.apri(id),
    rispondi: () => chiamata.rispondi(),
    ascolta: async () => ok({ vista: vista() }),
    riconnetti: async () => ok({ vista: vista() }),
    chiudi: (segnala) => chiamata.chiudi(segnala),
  };
  // Diario privato (#5): resta solo nella memoria della prova, nessuno lo legge.
  const diario = {
    async salva({ con, chiamataIl, durata, testo }) { linea.diario.push({ con, chiamataIl, durata, testo }); return ok(); },
  };
  const compagni = { async leggi() { await pausa(); return { ok: true, persone: PERSONE_PROVA.map((p) => ({ ...p })) }; } };

  let sentinella = null;
  const telefono = creaTelefono({ compagni, linea: lineaFinta, chiamata, voce, diario, adesso,
    subito: () => sentinella && sentinella.subito(), cambiato: () => cambiato() });
  sentinella = creaSentinella({ leggi: () => chiamata.stato(), quando: (r) => telefono.aggiorna(r), pagina });

  // Comandi della prova (pannello in cima alla pagina): fanno succedere subito ciò che altrimenti richiede tempo.
  const regista = {
    chiamaMe(id) {
      if (!libera()) return false;
      const altra = id || PERSONE_PROVA[Math.floor(adesso() / 1000) % PERSONE_PROVA.length].id;
      linea.attuale = { fase: "squilla", io: "riceve", altra, squillaDal: adesso(), inizio: null, scarto: 0, pescate: 0, ultimaPescata: null, carta: "" };
      if (sentinella) sentinella.subito();
      return true;
    },
    ultimoMinuto() {
      const c = linea.attuale;
      if (!c || c.fase !== "in_corso") return false;
      c.scarto += Math.max(0, (CHIAMATA.durata - CHIAMATA.ultimoMinuto - sec(c)) * 1000);
      if (sentinella) sentinella.subito();
      return true;
    },
    diario: () => linea.diario.map((n) => ({ ...n })),
    // «Salta l'iscrizione»: profilo finto già completo (nome «Prova», Milano), così si va dritti alla home.
    profiloPronto() {
      mondo.sessione = true;
      mondo.profilo = { data_nascita: "1990-05-12", regole_accettate_il: new Date(adesso()).toISOString(), nome: "Prova",
        provincia: "MI", provincia_origine: "scelta", paese: "IT", mi_presento_come: "uomo", mi_descrivo: null,
        domande_voce: [0, 1, 2], passo: 10 };
      mondo.filtri = { cerco: "donne", eta_min: 25, eta_max: 45, raggio: "citta", cosa_cerco: "storia_seria", figli: "forse", fumo: "no" };
      const risposta = (d) => (d.tipo === "multipla" ? [0, 1].slice(0, d.min) : d.tipo === "scala" ? d.min : 0);
      mondo.questionario = { risposte: Object.fromEntries(DOMANDE.map((d) => [d.n, risposta(d)])),
        importanza: Object.fromEntries(Object.keys(TEMI).map((t) => [t, 2])) };
      return true;
    },
  };

  return { accesso, archivio, lista, zona, stanza, telefono, sentinella, chiamata, regista };
}
