// Stanza viva e «Fissa una chiamata» (Fase 2, issue #380, spec v1 del CPO del 23/11; design v4 D149, schermate 19-20).
// Passo 1: solo regole su dati già letti, come api/chiamate.js e api/chiavi.js. Nessuna lettura o scrittura qui: le
// faranno il database (regole per riga) e il Worker nei passi successivi.
// - Lo stato tiene solo l'ultimo segnale: niente storico degli accessi, e mai l'ora esatta nei testi.
// - La pausa («Oggi non ricevo chiamate») non si scopre mai: nessuna funzione la restituisce o la nomina.
// - Appuntamenti e messaggi non entrano negli algoritmi (suggerimenti, stanze, chiavi): nessuno di quei file li riceve.

import { FUSO, oraDiRoma } from "./stanze.js";
import { controllaFascia, FASCIA_DEFAULT } from "./chiamate.js";
import { controllaFrase } from "./chiavi.js";

export const APPUNTAMENTI = Object.freeze({
  segnaleOgni: 30, // secondi: il telefono con l'app aperta e visibile manda un segnale
  nonInLineaDopo: 60, // secondi senza segnale → non in linea
  passo: 30, // minuti tra un orario e l'altro
  anticipo: 30, // minuti minimi tra adesso e l'orario proposto
  primaDellaChiusura: 30, // domenica l'ultimo orario è 20:30 e «FISSA» sparisce dalle 20:30
  messaggioMassimo: 120,
  apertiPerPersona: 3,
  conStessaPersona: 1,
  controproposte: 2, // in tutto per appuntamento
  promemoria: 10, // minuti prima, solo con l'app aperta
  finestraChiama: 15, // minuti dall'ora fissata in cui «CHIAMA» è attivo
});

export const TESTI_APPUNTAMENTI = Object.freeze({
  contatti: "Niente numeri, link o social prima della porta.",
  troppoLungo: `Il messaggio può avere al massimo ${APPUNTAMENTI.messaggioMassimo} caratteri.`,
  treAperti: "Hai già 3 appuntamenti aperti.",
  nonDisponibile: "Ora non si può fissare una chiamata con questa persona.",
  scaduta: "Nessuna risposta: la proposta è scaduta.",
  annullato: "L'appuntamento è annullato.",
  treChiamate: "Avete già parlato 3 volte. Ora tocca alle chiavi",
});

const APERTI = new Set(["proposto", "confermato"]);
const no = (motivo, testo = null) => ({ ok: false, motivo, testo });
const MIN = 60000;

// ── 1. Stato di una persona per chi è nella stessa stanza aperta. Restituisce solo { stato }. ──
export function statoPresenza({ ultimoSegnale = null, inChiamata = false, adesso }) {
  if (inChiamata) return { stato: "in_chiamata" };
  const t = ultimoSegnale ? new Date(ultimoSegnale).getTime() : NaN;
  if (Number.isFinite(t) && adesso.getTime() - t <= APPUNTAMENTI.nonInLineaDopo * 1000) return { stato: "online" };
  return { stato: "non_in_linea" };
}

// «non in linea · da poco / da N h / da ieri / da N giorni»: mai l'ora esatta.
export function testoNonInLinea(ultimoSegnale, adesso) {
  const t = ultimoSegnale ? new Date(ultimoSegnale).getTime() : NaN;
  if (!Number.isFinite(t)) return "non in linea";
  const ore = Math.floor(Math.max(0, adesso.getTime() - t) / 3600000);
  if (ore < 1) return "non in linea · da poco";
  if (ore < 24) return `non in linea · da ${ore} h`;
  if (ore < 48) return "non in linea · da ieri";
  return `non in linea · da ${Math.floor(ore / 24)} giorni`;
}

// ── 3. «FISSA» al posto di «CHIAMA». chiama = risultato di puoChiamare() per la coppia; stato = statoPresenza() dell'altra
// persona; segnalati = uno dei due ha segnalato l'altro. Il motivo del pulsante resta quello di TESTI_PULSANTE.
const MOTIVI_FISSA = new Set(["occupato", "fuori_fascia"]);
export function mostraFissa({ chiama, stato, adesso, stanza, segnalati = false }) {
  if (segnalati) return false;
  if (adesso.getTime() >= stanza.chiude.getTime() - APPUNTAMENTI.primaDellaChiusura * MIN) return false;
  if (chiama?.ok) return stato === "non_in_linea" || stato === "in_chiamata";
  return MOTIVI_FISSA.has(chiama?.motivo);
}

// ── 4. Orari proponibili: passi di 30 minuti di Roma, dentro le fasce di tutte e due, ≥ 30 minuti da adesso, dentro la
// settimana della stanza, al massimo 30 minuti prima della chiusura (domenica 20:30). La pausa non conta: non si scopre.
const minutiFascia = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const fasciaValida = (f) => (f && controllaFascia(f.da, f.a).ok ? f : FASCIA_DEFAULT);
const giornoRoma = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });

export function oreProponibili({ adesso, stanza, fasciaMia = null, fasciaSua = null }) {
  const a = fasciaValida(fasciaMia), b = fasciaValida(fasciaSua);
  const da = Math.max(minutiFascia(a.da), minutiFascia(b.da));
  const fino = Math.min(minutiFascia(a.a), minutiFascia(b.a));
  const primo = adesso.getTime() + APPUNTAMENTI.anticipo * MIN;
  const ultimo = stanza.chiude.getTime() - APPUNTAMENTI.primaDellaChiusura * MIN;
  const [y, m, d] = giornoRoma.format(adesso).split("-").map(Number);
  const orari = [];
  for (let g = 0; g < 8; g++) {
    const giorno = new Date(Date.UTC(y, m - 1, d + g));
    for (let x = da; x < fino; x += APPUNTAMENTI.passo) {
      const t = oraDiRoma(giorno.getUTCFullYear(), giorno.getUTCMonth() + 1, giorno.getUTCDate(), Math.floor(x / 60), x % 60);
      if (t.getTime() >= primo && t.getTime() >= stanza.apre.getTime() && t.getTime() <= ultimo) orari.push(t);
    }
  }
  return orari;
}

// Messaggio facoltativo: stesso controllo dei contatti della frase della chiave (#5), massimo 120 caratteri.
export function controllaMessaggio(messaggio) {
  const testo = String(messaggio ?? "").replace(/\s+/g, " ").trim();
  if (!testo) return { ok: true, messaggio: null };
  if ([...testo].length > APPUNTAMENTI.messaggioMassimo) return no("troppo_lungo", TESTI_APPUNTAMENTI.troppoLungo);
  const frase = controllaFrase(testo);
  if (!frase.ok) return no("contatti", TESTI_APPUNTAMENTI.contatti);
  return { ok: true, messaggio: testo };
}

// ── Proposta (o controproposta) controllata dal server. fissa = mostraFissa() per la coppia adesso; aperti = appuntamenti
// della stanza { chi, con, stato } in cui compare almeno uno dei due. I limiti dell'altra persona non si dicono.
export function controllaProposta({ chi, con, adesso, stanza, quando, fasciaMia = null, fasciaSua = null, messaggio = "",
  aperti = [], fissa }) {
  if (!chi || !con || chi === con) return no("non_valida");
  if (!fissa) return no("non_disponibile", TESTI_APPUNTAMENTI.nonDisponibile);
  const vivi = aperti.filter((x) => APERTI.has(x.stato));
  const di = (id) => vivi.filter((x) => x.chi === id || x.con === id);
  if (di(chi).some((x) => x.chi === con || x.con === con)) return no("gia_con_lei");
  if (di(chi).length >= APPUNTAMENTI.apertiPerPersona) return no("tre_aperti", TESTI_APPUNTAMENTI.treAperti);
  if (di(con).length >= APPUNTAMENTI.apertiPerPersona) return no("non_disponibile", TESTI_APPUNTAMENTI.nonDisponibile);
  const t = new Date(quando).getTime();
  if (!Number.isFinite(t) || !oreProponibili({ adesso, stanza, fasciaMia, fasciaSua }).some((o) => o.getTime() === t)) return no("orario");
  const msg = controllaMessaggio(messaggio);
  if (!msg.ok) return msg;
  return { ok: true, quando: new Date(t), messaggio: msg.messaggio };
}

export const puoControproporre = ({ controproposte = 0 }) => controproposte < APPUNTAMENTI.controproposte;

// ── 5–6. Fase di un appuntamento adesso. Proposto: in attesa fino all'ora proposta, poi scaduto. Confermato: fissato,
// promemoria da −10 min (solo nell'app aperta), «CHIAMA» per 15 minuti dall'ora fissata, poi finito senza penalità.
export function faseAppuntamento({ stato, quando }, adesso) {
  const t = new Date(quando).getTime(), ora = adesso.getTime();
  if (stato === "proposto") return ora < t ? { fase: "in_attesa" } : { fase: "scaduto", testo: TESTI_APPUNTAMENTI.scaduta };
  if (stato !== "confermato") return { fase: "finito" };
  if (ora < t - APPUNTAMENTI.promemoria * MIN) return { fase: "fissato" };
  if (ora < t) return { fase: "promemoria" };
  if (ora < t + APPUNTAMENTI.finestraChiama * MIN) return { fase: "chiama" };
  return { fase: "finito" };
}
