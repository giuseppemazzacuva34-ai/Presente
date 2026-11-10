// Svelamento dopo la porta (Fase 2, issue #65, spec v1 del CPO; D48 A, D12 A, D18 A, D32 A).
// Questo file gira SOLO sul server: nessuna chiamata a database, a Cloudflare Realtime o ad altri servizi, solo regole
// su dati già letti, così si prova tutto con dati inventati. Nessuna registrazione di audio o video, nessuna immagine,
// nessuna analisi dei volti: qui non entra mai nulla di tutto questo. Le singole risposte sì/no non escono mai da qui
// verso l'utente, e il registro finale non le contiene (spec v1, «Regole»).
// In beta i crediti sono un contatore interno, senza soldi veri (Stripe in Fase 4).

export const SVELAMENTO = Object.freeze({
  caparra: 10, // crediti a testa
  finestraOre: 48, // dall'apertura della porta (domenica 21:00 → martedì 21:00)
  rispostaOre: 48, // dalla fine dello svelamento
  durata: 10, // secondi di video
  sfocato: 3, // secondi in cui il video torna nitido (da confermare con Giuseppe, valore in configurazione)
  attesaOraMinuti: 5, // «Sono pronto ora»: l'altro ha 5 minuti per entrare
  attesaMinuti: 10, // nella sala: attesa massima dell'altro
  maxFasce: 3,
  fasciaMinuti: 30,
  riprovaSecondi: 120,
  tentativi: 3,
  giorniStessaArea: 10,
  giorniAreeDiverse: 30,
});

export const TESTI_SVELAMENTO = Object.freeze({
  aspetta: "Aspettiamo <nome>…",
  nonArrivato: "<nome> non è arrivata. Proponi un altro momento.",
  ecco: "Ecco <nome>.",
  caduta: "La connessione è caduta.",
  inAttesa: "Hai risposto. Ti avvisiamo quando sapremo.",
  chiusa: "Questa volta non vi incontrerete. I tuoi 10 crediti sono di nuovo disponibili.",
  scaduta: "Il tempo per lo svelamento è finito. I tuoi crediti sono di nuovo disponibili.",
});

const ORA = 3600000;
const no = (motivo, extra = {}) => ({ ok: false, motivo, ...extra });
const t = (d) => new Date(d).getTime();
const nellaPorta = (porta, id) => id === porta.a || id === porta.b;
const altro = (porta, id) => (id === porta.a ? porta.b : porta.a);
const chiave = (porta, id) => (id === porta.a ? "a" : "b");

export const scadenzaPorta = (aperta) => new Date(t(aperta) + SVELAMENTO.finestraOre * ORA);
export const giorniAppuntamento = (stessaArea) => (stessaArea ? SVELAMENTO.giorniStessaArea : SVELAMENTO.giorniAreeDiverse);

// porta: { a, b, aperta, caparre: { a: bool, b: bool }, svelata: Date|null, chiusa: bool }
function controlliPorta(porta, chi, adesso) {
  if (!nellaPorta(porta, chi)) return no("non_nella_porta");
  if (porta.chiusa) return no("porta_chiusa");
  if (t(adesso) >= t(scadenzaPorta(porta.aperta))) return no("porta_scaduta");
  return null;
}

// «Blocca 10 crediti». crediti = saldo disponibile di «chi» (già letto dal server).
export function bloccaCaparra({ porta, chi, crediti, adesso }) {
  const errore = controlliPorta(porta, chi, adesso);
  if (errore) return errore;
  if (porta.caparre?.[chiave(porta, chi)]) return no("gia_bloccata");
  const disponibili = Number.isFinite(crediti) ? crediti : 0;
  if (disponibili < SVELAMENTO.caparra) {
    const mancano = SVELAMENTO.caparra - disponibili;
    return no("crediti_insufficienti", { mancano, testo: `Ti mancano ${mancano} ${mancano === 1 ? "credito" : "crediti"}` });
  }
  return { ok: true, blocca: SVELAMENTO.caparra };
}

// Senza caparra di entrambi lo svelamento non si avvia: il server lo controlla a ogni richiesta, non solo il pulsante.
// Uno svelamento iniziato prima della scadenza si completa: questo controllo vale solo per l'avvio.
export function puoAvviare({ porta, chi, adesso }) {
  const errore = controlliPorta(porta, chi, adesso);
  if (errore) return errore;
  if (porta.svelata) return no("gia_svelata");
  const mancante = [porta.a, porta.b].find((id) => !porta.caparre?.[chiave(porta, id)]);
  if (mancante) return no("manca_caparra", { attesa: mancante });
  return { ok: true };
}

// «Preferisco le foto» di uno solo vale per entrambi; senza scelta vale il video (predefinito).
export const tipoSvelamento = (sceltaA, sceltaB) => (sceltaA === "foto" || sceltaB === "foto" ? "foto" : "video");

// «Scegli un orario»: ognuno segna fino a 3 inizi di fascia da 30 minuti. Vale la prima fascia comune che inizia
// da adesso in poi e finisce entro la scadenza della porta. null = nessuna fascia comune valida.
export function primaFasciaComune({ fasceA = [], fasceB = [], aperta, adesso }) {
  if (fasceA.length > SVELAMENTO.maxFasce || fasceB.length > SVELAMENTO.maxFasce) throw new Error("massimo 3 fasce a testa");
  const fine = t(scadenzaPorta(aperta));
  const durata = SVELAMENTO.fasciaMinuti * 60000;
  const diB = new Set(fasceB.map(t));
  const comuni = fasceA.map(t).filter((x) => diB.has(x) && x >= t(adesso) && x >= t(aperta) && x + durata <= fine);
  return comuni.length ? new Date(Math.min(...comuni)) : null;
}

// Timer dei 10 secondi: parte solo quando arrivano entrambi i video. sfocatura 1 = molto sfocato, 0 = nitido.
// arrivoA / arrivoB: istante in cui il server ha ricevuto il video di ciascuno (null se non ancora).
export function timerSvelamento({ arrivoA, arrivoB, adesso }) {
  if (!arrivoA || !arrivoB) {
    const primo = arrivoA || arrivoB;
    if (primo && t(adesso) - t(primo) >= SVELAMENTO.attesaMinuti * 60000) return { stato: "non_arrivato", testo: TESTI_SVELAMENTO.nonArrivato };
    return { stato: "attesa", testo: TESTI_SVELAMENTO.aspetta };
  }
  const inizio = Math.max(t(arrivoA), t(arrivoB));
  const passati = Math.max(0, (t(adesso) - inizio) / 1000);
  const restano = Math.max(0, SVELAMENTO.durata - passati);
  if (passati >= SVELAMENTO.durata) return { stato: "finito", restano: 0, sfocatura: 0, testo: TESTI_SVELAMENTO.ecco };
  const sfocatura = passati >= SVELAMENTO.sfocato ? 0 : 1 - passati / SVELAMENTO.sfocato;
  return { stato: sfocatura > 0 ? "sfocato" : "nitido", restano, sfocatura };
}

// Connessione caduta. secondiFatti = secondi del timer già trascorsi; tentativi = svelamenti avviati finora (1 = il primo).
export function dopoCaduta({ secondiFatti, tentativi }) {
  if (secondiFatti >= SVELAMENTO.durata) return { esito: "valido" };
  if (tentativi >= SVELAMENTO.tentativi) return { esito: "scegli_quando" };
  return { esito: "riprova", finestraSecondi: SVELAMENTO.riprovaSecondi, ripartDa: SVELAMENTO.durata, testo: TESTI_SVELAMENTO.caduta };
}

// Sì/no segreto. L'esito si decide quando hanno risposto entrambi o dopo 48 ore dalla fine dello svelamento.
// Il risultato non contiene mai le singole risposte: «un no» e «il silenzio» danno esattamente lo stesso oggetto.
export function esitoRisposte({ rispostaA, rispostaB, fineSvelamento, adesso, stessaArea = true, a = "a", b = "b" }) {
  const scaduto = t(adesso) >= t(fineSvelamento) + SVELAMENTO.rispostaOre * ORA;
  if (rispostaA === "si" && rispostaB === "si") {
    const giorni = giorniAppuntamento(stessaArea);
    return { esito: "doppio_si", caparre: "bloccate", giorni, testo: `Vi incontrate! Avete ${giorni} giorni per vedervi` };
  }
  const entrambe = rispostaA != null && rispostaB != null;
  if (!entrambe && !scaduto) return { esito: "in_attesa", testo: TESTI_SVELAMENTO.inAttesa };
  return { esito: "chiusa", restituisci: [a, b], testo: TESTI_SVELAMENTO.chiusa };
}

// Porta che scade senza svelamento: crediti restituiti a chi li aveva bloccati, nessuna penale.
export function portaScaduta({ porta, adesso }) {
  if (porta.svelata || t(adesso) < t(scadenzaPorta(porta.aperta))) return { scaduta: false };
  const restituisci = [porta.a, porta.b].filter((id) => porta.caparre?.[chiave(porta, id)]);
  return { scaduta: true, restituisci, penale: 0, testo: TESTI_SVELAMENTO.scaduta };
}

// Chiusure prima dell'esito. «Chiudi e segnala» e blocco: crediti a entrambi (spec, «Casi limite»).
// Sospensione di «da» durante le 48 ore: crediti restituiti all'altro (testo della spec v1).
export function chiusuraForzata({ porta, motivo, da }) {
  const bloccati = [porta.a, porta.b].filter((id) => porta.caparre?.[chiave(porta, id)]);
  if (motivo === "chiudi_e_segnala") return { chiusa: true, restituisci: bloccati, blocca: true, segnalazione: true, penale: 0 };
  if (motivo === "blocco") return { chiusa: true, restituisci: bloccati, blocca: true, segnalazione: false, penale: 0 };
  if (motivo === "sospensione") return { chiusa: true, restituisci: bloccati.filter((id) => id === altro(porta, da)), blocca: false, segnalazione: false, penale: 0 };
  throw new Error(`motivo sconosciuto: ${motivo}`);
}

// Riga del registro dopo l'esito: solo i campi permessi dalla spec. Le singole risposte sì/no non passano mai.
const CAMPI_REGISTRO = ["porta", "aperta", "caparraA", "caparraB", "svelata", "tipo", "durata", "fine", "rispostaAQuando", "rispostaBQuando", "esito"];
export function registroFinale(dati) {
  return Object.fromEntries(CAMPI_REGISTRO.map((k) => [k, dati[k] ?? null]));
}
