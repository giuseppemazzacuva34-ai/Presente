// Chiavi e sera delle porte (Fase 2, issue #5, spec v1.1 del CPO; D14 A, D51 A). Passo 1: solo calcoli.
// Riceve dati già letti (stanza, chiavi, durate delle chiamate, blocchi) e decide: si può dare o riprendere una chiave?
// la frase va bene? quali porte si aprono domenica alle 21? Nessuna lettura o scrittura qui: le faranno il database
// (regole per riga) e il Worker nei passi successivi. Il diario non entra mai: nessuna funzione di questo file lo riceve.
// «Nessuno scopre un no»: le funzioni non restituiscono mai chi ha dato chiavi non ricambiate né quante se ne ricevono.

import { CHIAVI, chiavePermessa } from "./regole.js";
import { coppia } from "./stanze.js";

const CHIUSURA_CHIAVI_MS = 60 * 1000; // dalle 20:59:00 alle 21:00 le chiavi sono bloccate (spec, passo 7)
export const FRASE_MASSIMO = 140;

export const TESTI_CHIAVI = Object.freeze({
  chiuse: "Le chiavi sono chiuse. Tra poco le porte.",
  contatti: "La frase non può contenere contatti. Ve li scambierete dopo esservi visti.",
  troppoLunga: `La frase può avere al massimo ${FRASE_MASSIMO} caratteri.`,
  nessunaPorta: "Stasera nessuna porta si è aperta. Lunedì alle 9 apre una nuova stanza.",
  finite: "Hai già dato le tue 2 chiavi. Puoi riprenderne una.",
  nonChiamato: "Puoi dare una chiave solo a chi hai già chiamato in questa stanza.",
});

const no = (motivo, testo = null) => ({ ok: false, motivo, testo });

// true dalle 20:59:00 di domenica (ora del server) in poi: niente chiavi date, riprese o frasi cambiate.
export function chiaviChiuse(chiusuraStanza, adesso) {
  return adesso.getTime() >= chiusuraStanza.getTime() - CHIUSURA_CHIAVI_MS;
}

// Frase facoltativa: niente numeri di telefono, email, link o nomi di social (regole della community, D9).
const CONTATTI = [
  /(?:\d[\s.\-/]*){6,}/, // 6 o più cifre di fila, anche separate da spazi o punti
  /@/, /https?:/i, /\bwww\b/i, /\.(?:com|it|net|org|eu|me|ly|link)\b/i,
  /\b(?:instagram|insta|ig|facebook|fb|tiktok|telegram|whatsapp|wa|snapchat|snap|twitter|threads|onlyfans|signal|linkedin)\b/i,
];

export function controllaFrase(frase) {
  const testo = String(frase ?? "").replace(/\s+/g, " ").trim();
  if (!testo) return { ok: true, frase: null };
  if ([...testo].length > FRASE_MASSIMO) return no("troppo_lunga", TESTI_CHIAVI.troppoLunga);
  if (CONTATTI.some((r) => r.test(testo))) return no("contatti", TESTI_CHIAVI.contatti);
  return { ok: true, frase: testo };
}

const bloccati = (blocchi, x, y) => blocchi.some(([p, q]) => coppia(p, q) === coppia(x, y));

// Dare una chiave. stanza = { chiude: Date, membri: Set }, chiavi = chiavi già date nella stanza ({ da, a }),
// durateTra(x, y) = durate in secondi delle chiamate tra i due in questa stanza, blocchi = coppie [x, y].
// Con un blocco la risposta è la stessa di «non è più nella stanza»: non si dice perché.
export function puoDareChiave({ chi, a, adesso, stanza, chiavi = [], durateTra, blocchi = [] }) {
  if (chiaviChiuse(stanza.chiude, adesso)) return no("chiuse", TESTI_CHIAVI.chiuse);
  if (!chi || !a || chi === a) return no("non_valida");
  if (!stanza.membri.has(chi) || !stanza.membri.has(a) || bloccati(blocchi, chi, a)) return no("non_nella_stanza");
  const mie = chiavi.filter((k) => k.da === chi);
  if (mie.some((k) => k.a === a)) return no("gia_data");
  if (mie.length >= CHIAVI.perSettimana) return no("finite", TESTI_CHIAVI.finite);
  if (!chiavePermessa(durateTra(chi, a))) return no("non_chiamato", TESTI_CHIAVI.nonChiamato);
  return { ok: true };
}

// Riprendere una chiave (o cambiarne la frase): solo la propria e solo prima delle 20:59.
export function puoRiprendere({ chi, a, adesso, stanza, chiavi = [] }) {
  if (chiaviChiuse(stanza.chiude, adesso)) return no("chiuse", TESTI_CHIAVI.chiuse);
  if (!chiavi.some((k) => k.da === chi && k.a === a)) return no("non_data");
  return { ok: true };
}

// Blocco da una parte o dall'altra: le chiavi tra i due spariscono in silenzio.
export function annullaPerBlocco(chiavi, x, y) {
  return chiavi.filter((k) => coppia(k.da, k.a) !== coppia(x, y));
}

// Domenica alle 21:00: un solo calcolo per tutta la stanza. Porta = chiave reciproca.
// Restituisce le porte (tutte aperte nello stesso istante), le chiavi da cancellare (non ricambiate, con le frasi)
// e solo conteggi aggregati per i report.
export function seraDellePorte(chiavi, chiusura) {
  const date = new Map(chiavi.map((k) => [`${k.da}>${k.a}`, k]));
  const porte = [];
  const viste = new Set();
  for (const k of chiavi) {
    const ritorno = date.get(`${k.a}>${k.da}`);
    const id = coppia(k.da, k.a);
    if (!ritorno || viste.has(id)) continue;
    viste.add(id);
    const [a, b] = [k.da, k.a].sort((x, y) => x.localeCompare(y, "en", { numeric: true }));
    porte.push({ a, b, aperta: new Date(chiusura.getTime()), frasi: { [a]: date.get(`${a}>${b}`).frase ?? null, [b]: date.get(`${b}>${a}`).frase ?? null } });
  }
  porte.sort((p, q) => p.a.localeCompare(q.a, "en", { numeric: true }) || p.b.localeCompare(q.b, "en", { numeric: true }));
  const daCancellare = chiavi.filter((k) => !viste.has(coppia(k.da, k.a)));
  const conPorta = new Set(porte.flatMap((p) => [p.a, p.b]));
  return {
    porte,
    daCancellare,
    conteggi: { chiaviDate: chiavi.length, porteAperte: porte.length },
    // Chi non ha porte vede sempre lo stesso testo; con una porta il testo ha il nome e lo compone l'app.
    testoPer: (persona) => (conPorta.has(persona) ? null : TESTI_CHIAVI.nessunaPorta),
  };
}
