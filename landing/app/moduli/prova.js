// Prova finta dell'app (D141 A di Giuseppe, linea «sviluppatore-c»): un «server finto» che risponde al posto di
// Supabase e del Worker, così si clicca tutta l'app con persone e dati finti. Le schermate sono quelle vere
// (flusso.js e i moduli delle tre linee); qui si fingono solo i pezzi che parlano con la rete, con la stessa forma
// delle risposte vere. REGOLE: niente rete, niente salvataggi sul telefono (tutto sparisce chiudendo la pagina),
// nomi chiaramente inventati. La pagina che la usa è /app/prova.html (non linkata, noindex).
//
// Passo 1: accesso con email, iscrizione salvata in memoria, provincia della lista, contatore della zona,
// «Entra nella stanza». Passo 2: stanza di 12 (tu + 11 persone finte) e chiamate simulate con il «telefono» vero
// (telefono.js, sentinella.js): squillo, timer di 15 minuti, carte, «La richiameresti?», diario. Niente microfono,
// niente audio. Passo 3: chiavi (chiavi_stanza.js vero, regole di api/chiavi.js) e sera delle porte con il comando
// «Domenica sera: apri le porte». Passo 4: porta e svelamento (svelamento.js e avvisi_porte.js veri) fino alla sala
// d'attesa; la persona finta blocca la caparra e si dice pronta subito. Passo 5: segnala e blocca, «Sono in
// difficoltà», «Le tue chiamate», «I tuoi appunti», Aiuto con «Scrivici» e «I miei messaggi». Passo 6: «Il vostro
// incontro» (incontro.js vero della linea B) con un /app/api/incontro finto: la persona finta accetta la tua proposta
// dopo qualche secondo; il comando «L'altra persona propone» fa provare «Accetto», «Altra data» e «Annulla».

import { creaTelefono } from "./telefono.js";
import { creaSentinella } from "./sentinella.js";
import { DOMANDE, TEMI } from "./domande.js";
import { creaChiaviStanza } from "./chiavi_stanza.js";
import { creaPortaSvelamento } from "./svelamento.js";
import { creaAvvisiPorte } from "./avvisi_porte.js";
import { appunto } from "./diario.js";
import { creaAppuntiStanza } from "./appunti_stanza.js";
import { voceStorico } from "./storico_chiamate.js";
import { creaIncontro, orariProposta } from "./incontro.js";

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
// Testi delle chiavi: gli stessi del server (api/chiavi.js).
const TESTI_CHIAVI = Object.freeze({
  chiuse: "Le chiavi sono chiuse. Tra poco le porte.",
  contatti: "La frase non può contenere contatti. Ve li scambierete dopo esservi visti.",
  troppoLunga: "La frase può avere al massimo 140 caratteri.",
  finite: "Hai già dato le tue 2 chiavi. Puoi riprenderne una.",
  nonChiamato: "Puoi dare una chiave solo a chi hai già chiamato in questa stanza.",
});
const CONTATTI = [
  /(?:\d[\s.\-/]*){6,}/, /@/, /https?:/i, /\bwww\b/i, /\.(?:com|it|net|org|eu|me|ly|link)\b/i,
  /\b(?:instagram|insta|ig|facebook|fb|tiktok|telegram|whatsapp|wa|snapchat|snap|twitter|threads|onlyfans|signal|linkedin)\b/i,
];
// Nella prova ricambiano la chiave solo alcune persone finte, sempre le stesse, con una frase inventata.
const RICAMBIANO = new Map([[0, "La tua risata mi è rimasta in testa."], [1, "Mi è piaciuto come racconti le cose."],
  [4, "Avrei parlato ancora un'ora."], [5, ""], [8, "Ci prendiamo quel caffè?"], [9, "Voce calma, idee chiare: mi piace."]]);
// Priorità delle segnalazioni in ore: le stesse di api/segnalazioni.js (1 ora = pericolo).
const ORE_SEGNALAZIONE = Object.freeze({ contatti_prima_porta: 72, insulti: 24, contenuti_sessuali: 24, minacce_pericolo: 1,
  sembra_minorenne: 1, profilo_falso: 72, soldi: 24, diffusione_immagini: 24, altro: 72, sono_in_difficolta: 1 });
// Nella prova «Scrivici» segna come urgente un messaggio con una di queste parole (nell'app vera lo decide il database).
const PAROLE_PERICOLO = /\b(paura|pericolo|minacc\w*|aggredit\w*|segui\w*|112)\b/i;
const TESTO_BREVE = "La chiamata è durata poco e non conta nei limiti.";
const testoInterrotta = (d) => `La chiamata si è interrotta dopo ${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}. Conta nei limiti di oggi.`;
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

// Il prossimo giorno «dow» (Mon, Sun…) alle «ore» di Roma dopo «adesso», in ISO.
function prossimo(adesso, dow, ore) {
  const oggi = ora(adesso);
  for (let g = 0; g <= 7; g += 1) {
    for (const scarto of [1, 2]) {
      const ms = Date.UTC(oggi.anno, oggi.mese - 1, oggi.giorno + g, ore - scarto);
      const r = ora(ms);
      if (r.dow === dow && r.ora === ore && ms > adesso) return new Date(ms).toISOString();
    }
  }
  return null;
}
export const prossimoLunedi = (adesso) => prossimo(adesso, "Mon", 9);
// Chiusura della stanza: domenica alle 21:00 di Roma (le chiavi chiudono un minuto prima).
const prossimaDomenica = (adesso) => prossimo(adesso, "Sun", 21);

// cambiato: chi ridisegna la pagina quando il telefono cambia (flusso.js › telefonoCambiato); pagina: il documento,
// per fermare la sentinella quando la scheda non si vede.
// aggiorna: { chiavi, conto } della pagina (flusso.js › chiaviCambiate e il conto alla rovescia delle 20:00).
// animazioneMs: durata delle porte che si aprono la sera (0 = niente animazione).
// sala: (passaAlleFoto, aggiorna) → sala d'attesa (sala_attesa.js) creata dalla pagina, che ha fotocamera e schermo.
// rispostaMs: dopo quanto la persona finta accetta la tua proposta d'incontro.
export function creaProva({ adesso = () => Date.now(), attesaMs = 250, cambiato = () => {}, pagina, aggiorna: daFuori = {}, animazioneMs = 0, sala = null, rispostaMs = 3000 } = {}) {
  const aggiorna = { chiavi: () => {}, conto: () => {}, porta: () => {}, avvisi: () => {}, appunti: () => {}, incontro: () => {}, ...daFuori };
  // Tutto il «database» della prova: vive solo in questa pagina.
  const mondo = { sessione: false, profilo: null, filtri: null, questionario: null, file: new Map(), conferma: null, sera: false, seraIl: 0, bloccati: new Set() };
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
      return { ok: true, pulsanti: PERSONE_PROVA.filter((p) => conLei(p.id) >= CHIAMATA.conStessaPersona).map((p) => ({ id: p.id, testo: TESTO_TRE })),
        chiamate: PERSONE_PROVA.filter((p) => conLei(p.id) > 0).map((p) => ({ id: p.id, n: Math.min(CHIAMATA.conStessaPersona, conLei(p.id)) })) };
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
        const testo = r.esito === "caduta" ? testoInterrotta(r.durata) : null; // spec v1.4
        return ok({ dopo: { tipo: "richiameresti", passi: ["richiameresti", "diario", "fine"], testo, altra: r.altra,
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
  let appunti = null;
  const riga = (n) => appunto({ chiamata_il: n.chiamataIl, durata: n.durata, testo: n.testo });
  const diario = {
    async salva({ con, chiamataIl, durata, testo }) {
      if (linea.diario.some((n) => n.chiamataIl === chiamataIl)) return { ok: false, motivo: "gia_scritta" };
      linea.diario.push({ con, chiamataIl, durata, testo: String(testo).trim() });
      if (appunti) appunti.rileggi(); // la nota compare subito in «I tuoi appunti» sulla scheda
      return ok();
    },
    async appunti(con) { return ok({ appunti: linea.diario.filter((n) => n.con === con).reverse().map(riga) }); },
    async appuntiDi(ids) {
      const perPersona = {};
      for (const n of [...linea.diario].reverse()) if (ids.includes(n.con)) (perPersona[n.con] ??= []).push(riga(n));
      return ok({ perPersona });
    },
    async modifica(chiamataIl, testo) {
      const n = linea.diario.find((x) => x.chiamataIl === chiamataIl);
      if (!n) return { ok: false, motivo: "rifiutato" };
      n.testo = String(testo).trim();
      return ok();
    },
    async cancella(chiamataIl) { linea.diario = linea.diario.filter((x) => x.chiamataIl !== chiamataIl); return ok(); },
  };
  const compagni = { async leggi() {
    await pausa();
    return { ok: true, ...(mondo.sera ? { chiusa: true } : {}),
      persone: PERSONE_PROVA.filter((p) => !mondo.bloccati.has(p.id)).map((p) => ({ ...p })) };
  } };

  // ---- Passo 5: segnala e blocca (#7), «Le tue chiamate», esiti e sanzioni, appunti, Aiuto (#10) -------------------
  const segnala = {
    async invia(corpo) {
      const ore = ORE_SEGNALAZIONE[corpo && corpo.motivo];
      if (!ore) return { ok: false, motivo: "dati" };
      if (corpo.contro && corpo.blocca !== false) mondo.bloccati.add(corpo.contro);
      return ok({ ore, pericolo: ore === 1 });
    },
  };
  const blocca = {
    async blocca(altra) {
      if (!PERSONE_PROVA.some((p) => p.id === altra)) return { ok: false, motivo: "persona" };
      mondo.bloccati.add(altra);
      return ok();
    },
  };
  const storico = {
    async leggi() {
      await pausa();
      const chiamate = [...linea.registro].reverse().filter((r) => r.durata > 0)
        .map((r) => voceStorico({ con: r.altra, nome: (PERSONE_PROVA.find((p) => p.id === r.altra) || {}).nome, inizio: r.inizio, durata: r.durata }))
        .filter(Boolean);
      return { ok: true, chiamate };
    },
  };
  const esiti = { async leggi() { return { ok: true, esiti: [] }; }, async letto() { return { ok: true }; } };
  const sanzioni = { async leggi() { return { ok: true, sanzioni: [] }; }, async contesta() { return { ok: false, motivo: "id" }; } };
  const messaggi = [];
  const aiuto = {
    async invia(corpo) {
      const testo = String((corpo && corpo.testo) || "");
      const sicurezza = PAROLE_PERICOLO.test(testo);
      const id = `00000000-0000-4000-9000-${String(messaggi.length + 1).padStart(12, "0")}`;
      messaggi.unshift({ id, categoria: corpo.categoria, testo, creatoIl: new Date(adesso()).toISOString(), stato: "inviato", risposta: null, rispostoIl: null });
      return ok({ id, sicurezza });
    },
    async miei() { await pausa(); return { ok: true, email: "prova@esempio.it", messaggi: messaggi.map((m) => ({ ...m })) }; },
  };

  // ---- Passo 3: chiavi e sera delle porte (stesse regole di api/chiavi.js) ---------------------------------------
  const chiudeIl = prossimaDomenica(adesso());
  const date = []; // { a, frase }
  const statoChiavi = () => ({ stanza: true, chiude_il: chiudeIl, chiuse: mondo.sera, restanti: 2 - date.length, date: date.map((d) => ({ ...d })) });
  const no = (motivo, testo) => ({ ok: false, motivo, testo });
  const frase = (f) => {
    const testo = String(f ?? "").replace(/\s+/g, " ").trim();
    if ([...testo].length > 140) return no("troppo_lunga", TESTI_CHIAVI.troppoLunga);
    if (CONTATTI.some((r) => r.test(testo))) return no("contatti", TESTI_CHIAVI.contatti);
    return { ok: true, frase: testo || null };
  };
  const inStanza = (a) => PERSONE_PROVA.some((p) => p.id === a);
  const chiaviServer = {
    async leggi() { await pausa(); return { ok: true, stato: statoChiavi() }; },
    async dai(a, f) {
      if (mondo.sera) return no("chiuse", TESTI_CHIAVI.chiuse);
      if (!inStanza(a)) return no("dati", "Non è più nella stanza.");
      if (conLei(a) < 1) return no("non_chiamato", TESTI_CHIAVI.nonChiamato);
      if (date.some((d) => d.a === a)) return ok({ stato: statoChiavi() });
      if (date.length >= 2) return no("finite", TESTI_CHIAVI.finite);
      const c = frase(f);
      if (!c.ok) return c;
      date.push({ a, frase: c.frase });
      return ok({ stato: statoChiavi() });
    },
    async riprendi(a) {
      if (mondo.sera) return no("chiuse", TESTI_CHIAVI.chiuse);
      const i = date.findIndex((d) => d.a === a);
      if (i >= 0) date.splice(i, 1);
      return ok({ stato: statoChiavi() });
    },
    async cambiaFrase(a, f) {
      if (mondo.sera) return no("chiuse", TESTI_CHIAVI.chiuse);
      const d = date.find((x) => x.a === a);
      if (!d) return no("dati", "Non è più nella stanza.");
      const c = frase(f);
      if (!c.ok) return c;
      d.frase = c.frase;
      return ok({ stato: statoChiavi() });
    },
    // La sera: prima delle 21 niente; dopo, una porta per ogni chiave reciproca.
    async sera() {
      await pausa();
      if (!mondo.sera) return { ok: true, stato: "prima" };
      return { ok: true, stato: "pronta", porte: porteDellaSera() };
    },
  };
  // Una porta per ogni chiave data a chi, nella prova, la ricambia.
  const porteDellaSera = () => date.map((d) => ({ d, i: PERSONE_PROVA.findIndex((p) => p.id === d.a) }))
    .filter(({ i }) => RICAMBIANO.has(i))
    .map(({ d, i }) => ({ id: finta(200 + i), con: d.a, nome: PERSONE_PROVA[i].nome, eta: PERSONE_PROVA[i].eta, frase_per_te: RICAMBIANO.get(i) || null }));

  // ---- Passo 4: porta e svelamento (stesse regole di api/svelamento.js) -------------------------------------------
  // Coin di prova: 200 (spec #331 A.4). La persona finta blocca la sua caparra e si dice pronta insieme a te.
  const svelamenti = new Map(); // porta → { mia_caparra, mia_scelta, mie_fasce, pronto_il }
  const ORE_48 = 48 * 3600 * 1000;
  let saldo = 200;
  const statoSvelamento = () => {
    const porte = mondo.sera ? porteDellaSera().map((x) => {
      const v = svelamenti.get(x.id) || {};
      const scade = mondo.seraIl + ORE_48;
      const pronto = Number.isFinite(v.pronto_il) && v.pronto_il + 5 * 60 * 1000 > adesso();
      const fissata = Array.isArray(v.mie_fasce) && v.mie_fasce.length ? v.mie_fasce[0] : null;
      const nellaFascia = fissata && adesso() >= Date.parse(fissata) && adesso() < Date.parse(fissata) + 30 * 60 * 1000;
      const momento = v.mia_caparra === true && (pronto || nellaFascia);
      return { porta: x.id, nome: x.nome, eta: x.eta, scade_il: new Date(scade).toISOString(),
        mia_caparra: v.mia_caparra === true, sua_caparra: v.mia_caparra === true,
        mia_scelta: v.mia_scelta || "video", mie_fasce: v.mie_fasce || [], fascia_fissata: fissata,
        mio_pronto: pronto, pronto_scade_il: pronto ? new Date(v.pronto_il + 5 * 60 * 1000).toISOString() : null, suo_pronto: pronto,
        momento, ...(momento ? { tipo: v.mia_scelta || "video" } : {}) };
    }) : [];
    return { saldo, porte };
  };
  const conPorta = (porta, fai) => {
    const x = statoSvelamento().porte.find((q) => q.porta === porta);
    if (!x) return no("non_trovata", "Questa porta si è chiusa.");
    const v = svelamenti.get(porta) || {};
    svelamenti.set(porta, v);
    const r = fai(v, x);
    return r || ok({ esito: "ok", stato: statoSvelamento() });
  };
  const svelamentoServer = {
    async leggi() { await pausa(); return { ok: true, stato: statoSvelamento() }; },
    async blocca(porta) {
      return conPorta(porta, (v) => {
        if (v.mia_caparra) return null;
        if (saldo < 100) return no("crediti_insufficienti", 100 - saldo === 1 ? "Ti manca 1 credito" : `Ti mancano ${100 - saldo} crediti`);
        saldo -= 100;
        v.mia_caparra = true;
        return null;
      });
    },
    async scegli(porta, scelta) { return conPorta(porta, (v) => { v.mia_scelta = scelta === "foto" ? "foto" : "video"; return null; }); },
    async pronto(porta) {
      return conPorta(porta, (v) => (v.mia_caparra ? ((v.pronto_il = adesso()), null) : no("manca_caparra", "Servono prima le due caparre.")));
    },
    async fasce(porta, fasce) {
      return conPorta(porta, (v) => (v.mia_caparra ? ((v.mie_fasce = [...fasce].sort().slice(0, 3)), null) : no("manca_caparra", "Servono prima le due caparre.")));
    },
  };
  const nuoveChiavi = () => creaChiaviStanza({ chiavi: chiaviServer, aggiorna: () => aggiorna.chiavi(), conto: (t) => aggiorna.conto(t),
    adesso: () => new Date(adesso()), animazioneMs });

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

  // ---- Passo 6: «Il vostro incontro» (stesse risposte di worker/incontro_api.js, regole di api/incontro.js) -----------
  // Ogni porta della sera ha il suo incontro: scadenza 10 giorni (stessa zona), orari da domani 10:00-23:00 ogni 30
  // minuti (orariProposta, la stessa regola del server), 3 controproposte in tutto.
  const incontri = new Map(); // porta → { stato, orario, luogo, proposta_mia, proposta_il, rimaste, esito, checkin_mio, checkin_altro, segnale }
  // Passo 7: «Sono qui» da 30 minuti prima a 30 dopo l'ora (checkin_incontro del database); il segnale è una parola
  // a caso, uguale sui due telefoni, solo dopo i due check-in (qui poche parole della stessa lista del database).
  const CHECKIN_MS = 30 * 60 * 1000;
  const SEGNALI_PROVA = ["Peonia", "Primula", "Ninfea", "Genziana", "Mandorlo", "Zinnia"];
  const GIORNI_10 = 10 * 24 * 3600 * 1000;
  const datiIncontro = (porta) => {
    if (!mondo.sera || !statoSvelamento().porte.some((x) => x.porta === porta)) return null;
    if (!incontri.has(porta)) incontri.set(porta, { stato: "da_fissare", orario: null, luogo: null, proposta_mia: false, proposta_il: null, rimaste: 3, esito: null,
      checkin_mio: false, checkin_altro: false, segnale: null });
    return incontri.get(porta);
  };
  const vistaDati = (v) => {
    const scadenza = new Date(mondo.seraIl + GIORNI_10).toISOString();
    const ricevuta = v.stato === "proposto" && !v.proposta_mia;
    const finestra = (v.stato === "confermato" || v.stato === "concluso") && v.orario;
    const da = finestra ? Date.parse(v.orario) - CHECKIN_MS : null;
    const fino = finestra ? Date.parse(v.orario) + CHECKIN_MS : null;
    const oraDelCheckin = v.stato === "confermato" && !v.esito && !v.checkin_mio && adesso() >= da && adesso() < fino;
    return { stato: v.stato, scadenza, orario: v.orario, locale: null, luogo: v.luogo, proposta_mia: v.proposta_mia,
      proposta_scade: v.stato === "proposto" ? new Date(Math.min(v.proposta_il + ORE_48, mondo.seraIl + GIORNI_10)).toISOString() : null,
      controproposte_rimaste: v.rimaste,
      azioni: v.stato === "da_fissare" ? ["proponi"] : ricevuta ? (v.rimaste > 0 ? ["accetto", "altra_data", "annulla"] : ["accetto", "annulla"])
        : oraDelCheckin ? ["sono_qui"] : [],
      ritardo_minuti: null, esito: v.esito,
      checkin_mio: v.checkin_mio, checkin_altro: v.checkin_altro,
      checkin_da: finestra ? new Date(da).toISOString() : null, checkin_fino: finestra ? new Date(fino).toISOString() : null,
      segnale: v.checkin_mio && v.checkin_altro ? v.segnale : null };
  };
  const orarioValido = (orario) => orariProposta(new Date(mondo.seraIl + GIORNI_10).toISOString(), new Date(adesso()))
    .some((g) => g.orari.some((o) => o.valore === orario));
  const risposta = (status, corpo) => ({ status, json: async () => corpo });
  let incontro = null;
  // La persona finta accetta la tua proposta dopo «rispostaMs»; la schermata la rilegge.
  const accettaDopo = (porta, v) => setTimeout(() => {
    if (v.stato !== "proposto" || !v.proposta_mia) return;
    v.stato = "confermato";
    if (incontro && incontro.modello().porta === porta) incontro.riprova();
  }, rispostaMs)?.unref?.(); // nei test con node il timer non tiene in vita il processo; nel browser non c'è unref
  async function fetchIncontro(url, { method = "GET", body } = {}) {
    await pausa();
    const corpo = method === "POST" ? JSON.parse(body || "{}") : { porta: new URL(url, "https://prova.invalid").searchParams.get("porta") };
    const v = datiIncontro(corpo.porta);
    if (!v) return risposta(404, { ok: false, motivo: "non_trovato" });
    if (method !== "POST") return risposta(200, { ok: true, incontro: vistaDati(v) });
    if (corpo.azione === "checkin") return risposta(200, sonoQui(corpo.porta, v));
    if (v.stato === "confermato" || v.stato === "concluso") return risposta(200, { ok: false, motivo: v.stato === "confermato" ? "gia_confermato" : "incontro_chiuso" });
    const ricevuta = v.stato === "proposto" && !v.proposta_mia;
    if (corpo.azione === "proponi") {
      if (v.stato === "proposto" && v.proposta_mia) return risposta(200, { ok: false, motivo: "attendi_risposta" });
      if (!orarioValido(corpo.orario)) return risposta(200, { ok: false, motivo: "orario_non_valido" });
      const luogo = typeof corpo.luogo === "string" ? corpo.luogo.trim() : "";
      if (!luogo || luogo.length > 80) return risposta(200, { ok: false, motivo: "luogo_non_valido" });
      if (ricevuta) v.rimaste -= 1;
      Object.assign(v, { stato: "proposto", orario: corpo.orario, luogo, proposta_mia: true, proposta_il: adesso() });
      accettaDopo(corpo.porta, v);
      return risposta(200, { ok: true });
    }
    if (corpo.azione === "rispondi" && ricevuta && corpo.risposta === "accetto") { v.stato = "confermato"; return risposta(200, { ok: true }); }
    if (corpo.azione === "rispondi" && ricevuta && corpo.risposta === "annulla") {
      Object.assign(v, { stato: "concluso", esito: "annullato" });
      return risposta(200, { ok: true });
    }
    return risposta(200, { ok: false, motivo: ricevuta ? "riprova" : "nessuna_proposta" });
  }
  // «Sono qui» (stesso ordine dei controlli di checkin_incontro); la persona finta arriva «rispostaMs» dopo di te.
  const avvenuto = (v) => Object.assign(v, { stato: "concluso", esito: "avvenuto",
    segnale: SEGNALI_PROVA[Math.floor(Math.random() * SEGNALI_PROVA.length)] });
  function sonoQui(porta, v) {
    if (v.esito === "avvenuto") return { ok: true, esito: "avvenuto" };
    if (v.esito) return { ok: false, motivo: "incontro_chiuso" };
    if (v.stato !== "confermato") return { ok: false, motivo: "non_confermato" };
    if (v.checkin_mio) return { ok: false, motivo: "gia_fatto" };
    const ora = Date.parse(v.orario);
    if (adesso() < ora - CHECKIN_MS) return { ok: false, motivo: "troppo_presto" };
    if (adesso() >= ora + CHECKIN_MS) return { ok: false, motivo: "troppo_tardi" };
    v.checkin_mio = true;
    if (v.checkin_altro) { avvenuto(v); return { ok: true, esito: "avvenuto" }; }
    setTimeout(() => {
      if (v.esito) return;
      v.checkin_altro = true;
      avvenuto(v);
      if (incontro && incontro.modello().porta === porta) incontro.riprova();
    }, rispostaMs)?.unref?.();
    return { ok: true, esito: "sono_qui" };
  }
  incontro = creaIncontro({ token: () => "prova", fetch: fetchIncontro, attesa: 8000, aggiorna: () => aggiorna.incontro(), adesso: () => new Date(adesso()) });
  // «L'altra persona propone»: dopodomani alle 19:00 al «Bar finto della piazza» (se l'orario è fuori dalla scadenza,
  // il primo orario valido).
  regista.propostaDallAltra = (porta) => {
    const v = datiIncontro(porta);
    if (!v || v.stato === "confermato" || v.stato === "concluso") return false;
    const giorni = orariProposta(new Date(mondo.seraIl + GIORNI_10).toISOString(), new Date(adesso()));
    const tutti = giorni.flatMap((g) => g.orari);
    if (!tutti.length) return false;
    const scelto = (giorni[1] || giorni[0]).orari.find((o) => o.testo === "19:00") || tutti[0];
    if (v.stato === "proposto" && v.proposta_mia) v.rimaste = Math.max(0, v.rimaste - 1);
    Object.assign(v, { stato: "proposto", orario: scelto.valore, luogo: "Bar finto della piazza", proposta_mia: false, proposta_il: adesso() });
    return true;
  };

  // «È l'ora dell'incontro»: nella prova l'incontro confermato si sposta a fra 10 minuti, così «Sono qui» si può
  // provare subito (nell'app vera si apre 30 minuti prima dell'ora scelta).
  regista.oraDellIncontro = (porta) => {
    const v = datiIncontro(porta);
    if (!v || v.stato !== "confermato" || v.esito) return false;
    v.orario = new Date(adesso() + 10 * 60 * 1000).toISOString();
    return true;
  };

  const porta = creaPortaSvelamento({ svelamento: svelamentoServer, aggiorna: () => aggiorna.porta(), adesso: () => new Date(adesso()), sala });
  const avvisiPorte = creaAvvisiPorte({ svelamento: svelamentoServer, aggiorna: () => aggiorna.avvisi(), pagina, adesso: () => new Date(adesso()) });
  appunti = creaAppuntiStanza({ diario, aggiorna: () => aggiorna.appunti() });
  const prova = { accesso, archivio, lista, zona, stanza, telefono, sentinella, chiamata, chiaviServer, chiavi: nuoveChiavi(),
    svelamentoServer, porta, avvisiPorte, segnala, blocca, storico, esiti, sanzioni, aiuto, appunti, incontro,
    incontroApi: fetchIncontro, // la /app/api/incontro finta (per il futuro checkin() di incontro.js e per i test)
    compagniServer: compagni, diarioServer: diario, regista };
  // «Domenica sera: apri le porte»: le chiavi si chiudono, la stanza diventa «Chiusa» e un modulo delle chiavi nuovo
  // legge la sera (la pagina poi riparte dalla home, come all'apertura dell'app dopo le 21).
  regista.apriPorte = () => {
    if (mondo.sera || !mondo.sessione) return false;
    mondo.sera = true;
    mondo.seraIl = adesso();
    prova.chiavi = nuoveChiavi();
    return true;
  };
  return prova;
}
