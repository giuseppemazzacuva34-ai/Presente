// Dopo la chiamata (Fase 2, issue #4 spec v1.3 § 3 del CPO, collegata a #5 e #7): passo 3c-4a.
// Questo file gira SOLO sul server e fa solo calcoli: nessun database, nessun servizio esterno.
// La risposta a «La richiameresti?» la legge solo il server (suggerimenti, #3) e si cancella alla chiusura della stanza
// (migrazione 20261113220000_richiameresti.sql). Non la vedono mai l'altra persona, il pannello delle segnalazioni (#7)
// né gli algoritmi del diario (che non esiste per gli algoritmi).

import { CHIAMATA } from "./chiamate.js";

export const RISPOSTE = Object.freeze(["si", "no", "salta"]);

export const TESTI_DOPO = Object.freeze({
  domanda: "La richiameresti?",
  risposte: Object.freeze({ si: "Sì", no: "No", salta: "Salta" }),
  breve: "La chiamata è durata poco e non conta nei limiti.",
  segnala: "Segnala un problema",
  torna: "Torna alla stanza",
});

export const notaSegreta = (nome) =>
  `Resta tra te e Presente. ${String(nome || "").trim() || "L'altra persona"} non lo saprà mai.`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const durataValida = (d) => Number.isInteger(d) && d >= 0 && d <= CHIAMATA.durataMassima;

// Cosa mostrare quando la chiamata è finita. «passi» in ordine; «fine» = link «Segnala un problema» + «Torna alla stanza».
// Il diario (#5 passo 2) è un passo a sé: finché #5 non c'è, l'app lo salta.
export function schermataDopo(chiamata) {
  const { esito, durata } = chiamata || {};
  if (esito === "chiudi_e_segnala") return { tipo: "segnala", passi: ["segnala"], origine: "chiudi_e_segnala", segnala: true, testo: null };
  const valida = durataValida(durata);
  if (valida && durata >= CHIAMATA.minimoPerContare && (esito === "tempo_scaduto" || esito === "chiusa")) {
    return { tipo: "richiameresti", passi: ["richiameresti", "diario", "fine"], segnala: true, testo: null };
  }
  // Sotto i 60 secondi: il testo della spec. Caduta lunga senza rientro: niente testo «durata poco» (sarebbe falso).
  const breve = valida && durata < CHIAMATA.minimoPerContare;
  return { tipo: "breve", passi: ["fine"], segnala: true, testo: breve ? TESTI_DOPO.breve : null };
}

// Corpo della richiesta «La richiameresti?»: la chiamata si riconosce da chi l'ha aperta e dall'istante di inizio
// (chiave del registro). Nient'altro: niente nomi, niente testo libero. Restituisce null se qualcosa non va.
export function leggiRisposta(corpo) {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return null;
  const chiavi = Object.keys(corpo).sort().join(",");
  if (chiavi !== "chi,inizio,risposta") return null;
  const { chi, inizio, risposta } = corpo;
  if (!UUID.test(chi || "") || !RISPOSTE.includes(risposta)) return null;
  if (typeof inizio !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(inizio)) return null;
  const t = new Date(inizio);
  if (Number.isNaN(t.getTime())) return null;
  return { chi, inizio: t.toISOString(), risposta };
}

// --- Passo 3c-4b-1: le richieste /app/api/chiamata/dopo e /app/api/chiamata/richiameresti -------------------------
// Il telefono non sa come è finita la chiamata (per tempo, chiusa dall'altra persona, caduta): appena la vede finire
// chiede «dopo» e il server risponde leggendo il registro. Una chiamata che conta e non ha ancora la domanda la
// propone richiameresti_da_riproporre() (che la segna: la domanda compare una volta sola, anche al rientro).
// d: { riproponi(per) → { chi, con, inizio } | null, ultima(per) → riga del registro | null,
//      salva({ per, chi, inizio, risposta }) → true | false }   (undefined = il database non risponde)

export const APPENA_FINITA_MS = 2 * 60 * 1000;

const istante = (x) => {
  if (typeof x !== "string") return null;
  const t = new Date(x);
  return Number.isNaN(t.getTime()) ? null : t;
};
const altraDi = (riga, per) => {
  if (!riga || !UUID.test(riga.chi || "") || !UUID.test(riga.con || "") || riga.chi === riga.con) return null;
  if (riga.chi === per) return riga.con;
  return riga.con === per ? riga.chi : null;
};

export async function dopoChiamata({ per, appena, adesso }, d) {
  const proposta = await d.riproponi(per);
  if (proposta === undefined) return { ok: false, motivo: "riprova" };
  if (proposta) {
    const altra = altraDi(proposta, per);
    const inizio = istante(proposta.inizio);
    if (!altra || !inizio) return { ok: true, dopo: null };
    const s = schermataDopo({ esito: "chiusa", durata: CHIAMATA.minimoPerContare });
    // Passo «diario» (#5): persona, inizio ESATTO come lo dà il database (la tabella lo confronta con chiamate.inizio)
    // e durata vera; null se la durata non c'è o non conta, e l'app salta il passo.
    const conta = Number.isInteger(proposta.durata) && proposta.durata >= CHIAMATA.minimoPerContare && durataValida(proposta.durata);
    const diario = conta ? { con: altra, chiamataIl: proposta.inizio, durata: proposta.durata } : null;
    return { ok: true, dopo: { tipo: s.tipo, passi: s.passi, testo: s.testo, altra, chiamata: { chi: proposta.chi, inizio: inizio.toISOString() }, diario } };
  }
  if (appena !== true) return { ok: true, dopo: null };
  const ultima = await d.ultima(per);
  if (ultima === undefined) return { ok: false, motivo: "riprova" };
  const altra = altraDi(ultima, per);
  const inizio = istante(ultima && ultima.inizio);
  if (!altra || !inizio || !durataValida(ultima.durata)) return { ok: true, dopo: null };
  const finita = inizio.getTime() + ultima.durata * 1000;
  if (adesso.getTime() - finita > APPENA_FINITA_MS) return { ok: true, dopo: null };
  // «Chiudi e segnala» lo sa solo chi l'ha premuto (la sua app apre già il modulo #7): per l'altra persona vale come
  // una chiamata chiusa o caduta, così non scopre di essere stata segnalata.
  const esito = ultima.esito === "chiudi_e_segnala" ? (ultima.durata < CHIAMATA.minimoPerContare ? "chiusa" : "caduta") : ultima.esito;
  const s = schermataDopo({ esito, durata: ultima.durata });
  // Una chiamata che conta senza proposta ha già avuto la domanda (risposta o riproposta): non si chiede di nuovo.
  if (s.tipo !== "breve") return { ok: true, dopo: null };
  return { ok: true, dopo: { tipo: s.tipo, passi: s.passi, testo: s.testo, altra, chiamata: null, diario: null } };
}

export async function rispondiRichiameresti({ per, corpo }, d) {
  const x = leggiRisposta(corpo);
  if (!x) return { ok: false, motivo: "dati" };
  const salvata = await d.salva({ per, ...x });
  if (salvata === undefined) return { ok: false, motivo: "riprova" };
  return { ok: true, salvata: salvata === true };
}
