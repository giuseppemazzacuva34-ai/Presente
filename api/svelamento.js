// Svelamento dopo la porta (Fase 2, issue #65, spec v1 del CPO; D48 A, D12 A, D18 A, D32 A).
// Questo file gira SOLO sul server: nessuna chiamata a database, a Cloudflare Realtime o ad altri servizi, solo regole
// su dati già letti, così si prova tutto con dati inventati. Nessuna registrazione di audio o video, nessuna immagine,
// nessuna analisi dei volti: qui non entra mai nulla di tutto questo. Le singole risposte sì/no non escono mai da qui
// verso l'utente, e il registro finale non le contiene (spec v1, «Regole»).
// In beta i crediti sono un contatore interno, senza soldi veri (Stripe in Fase 4).

export const SVELAMENTO = Object.freeze({
  caparra: 100, // Coin a testa (#331: 1 € = 10 Coin)
  finestraOre: 48, // dall'apertura della porta (domenica 21:00 → martedì 21:00)
  rispostaOre: 48, // dalla fine dello svelamento
  durata: 10, // secondi di video
  sfocato: 3, // secondi in cui il video torna nitido (da confermare con Giuseppe, valore in configurazione)
  attesaOraMinuti: 5, // «Ci sono adesso»: l'altro ha 5 minuti per entrare
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
  nonArrivato: "<nome> non c'è. Proponi un altro momento.",
  ecco: "Ecco <nome>.",
  caduta: "La connessione è caduta.",
  // Sì/no segreto (regola del CPO del 21/11 sulla #65). <quando> = giorno e ora di Roma della fine delle 48 ore.
  domanda: "Vuoi incontrare <nome>?",
  confermaSi: "Rispondi sì? Non potrai cambiarla.",
  confermaNo: "Rispondi no? Non potrai cambiarla.",
  conferma: "Conferma",
  annulla: "Annulla",
  inAttesa: "Hai risposto. Saprai com'è andata entro <quando>.",
  doppioSi: "Vi siete detti sì. Ora fissate l'incontro.",
  chiusa: "Questa volta non vi incontrerete. I tuoi 100 Coin sono tornati nel tuo saldo.",
  scaduta: "Il tempo per lo svelamento è finito. I tuoi Coin sono di nuovo disponibili.",
  // Caparra (spec v1, passo 2). Per una porta chiusa da un blocco o da una sospensione non si dice mai il motivo.
  blocca: "Blocca 100 Coin",
  spiegazioneCaparra: "I tuoi 100 Coin restano bloccati. Se uno dei due dice no o non risponde, tornano a entrambi. Li perdi solo se dai buca a un appuntamento confermato.",
  aspettaCaparra: "Aspettiamo che anche <nome> blocchi la caparra.",
  ricarica: "Ricarica",
  beta: "In beta i Coin sono di prova",
  portaChiusa: "Questa porta si è chiusa.",
  // «Come vuoi lo svelamento» (spec v1, passo 3). Si cambia fino all'inizio dello svelamento.
  sceltaVideo: "Videochiamata di 10 secondi",
  sceltaFoto: "Preferisco le foto",
  // «Quando» (spec v1, passo 4).
  prontoOra: "Ci sono adesso",
  scegliOrario: "Scegli un orario",
  prontaAltro: "<nome> ti aspetta per lo svelamento",
  fasciaFissata: "Lo svelamento è fissato",
  nessunaFascia: "Ancora nessun orario in comune.",
});

const ORA = 3600000;
const no = (motivo, extra = {}) => ({ ok: false, motivo, ...extra });
const t = (d) => new Date(d).getTime();
const nellaPorta = (porta, id) => id === porta.a || id === porta.b;
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

// «Blocca 100 Coin». crediti = saldo disponibile in Coin di «chi» (già letto dal server).
export function bloccaCaparra({ porta, chi, crediti, adesso }) {
  const errore = controlliPorta(porta, chi, adesso);
  if (errore) return errore;
  if (porta.caparre?.[chiave(porta, chi)]) return no("gia_bloccata");
  const disponibili = Number.isFinite(crediti) ? crediti : 0;
  if (disponibili < SVELAMENTO.caparra) {
    const mancano = SVELAMENTO.caparra - disponibili;
    return no("crediti_insufficienti", { mancano, testo: mancano === 1 ? "Ti manca 1 Coin" : `Ti mancano ${mancano} Coin` });
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

// «Scegli un orario» (passo 5a): il server accetta da 1 a 3 inizi di fascia da 30 minuti (allineati a :00 o :30),
// non ancora iniziati, dentro le 48 ore della porta (la fascia deve finire entro la scadenza). Doppioni tolti, in ordine.
const FASCIA_MS = SVELAMENTO.fasciaMinuti * 60000;
export function fasceValide({ fasce, aperta, adesso }) {
  const nonValide = no("fasce_non_valide");
  if (!Array.isArray(fasce) || fasce.length < 1 || fasce.length > SVELAMENTO.maxFasce) return nonValide;
  const fine = t(scadenzaPorta(aperta));
  const inizi = [];
  for (const f of fasce) {
    if (typeof f !== "string" || f.length > 40) return nonValide;
    const x = Date.parse(f);
    if (!Number.isFinite(x) || x % FASCIA_MS !== 0 || x < t(adesso) || x < t(aperta) || x + FASCIA_MS > fine) return nonValide;
    if (!inizi.includes(x)) inizi.push(x);
  }
  return { ok: true, fasce: inizi.sort((p, q) => p - q).map((x) => new Date(x).toISOString()) };
}

// «Ci sono adesso» (passo 5a): vale 5 minuti, il tempo che l'altro ha per entrare. mio / suo = quando ciascuno ha
// toccato il pulsante (null se mai). «entrambi» = si può passare alla sala d'attesa.
export function prontoValido({ mio, suo, adesso }) {
  const finestra = SVELAMENTO.attesaOraMinuti * 60000;
  const vivo = (x) => x != null && t(adesso) - t(x) < finestra && t(x) <= t(adesso);
  const m = vivo(mio), s = vivo(suo);
  return { mio: m, suo: s, entrambi: m && s, scade: m ? new Date(t(mio) + finestra) : null };
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

// Sì/no segreto (regola del CPO del 21/11 sulla #65, D48 A). Doppio sì → esito subito. Ogni altro caso (un no, due no,
// uno che non risponde) → esito SOLO alla fine delle 48 ore dalla fine dello svelamento, uguale per entrambi, caparre
// restituite a entrambi nello stesso momento. Prima delle 48 ore chi aspetta riceve sempre lo stesso oggetto, che
// l'altra persona abbia risposto o no: nessun indizio. Il risultato non contiene mai le singole risposte.
export function esitoRisposte({ rispostaA, rispostaB, fineSvelamento, adesso, stessaArea = true, a = "a", b = "b" }) {
  const esitoIl = new Date(t(fineSvelamento) + SVELAMENTO.rispostaOre * ORA);
  if (rispostaA === "si" && rispostaB === "si") {
    const giorni = giorniAppuntamento(stessaArea);
    return { esito: "doppio_si", caparre: "bloccate", giorni, testo: TESTI_SVELAMENTO.doppioSi };
  }
  if (t(adesso) < t(esitoIl)) return { esito: "in_attesa", esitoIl, testo: TESTI_SVELAMENTO.inAttesa };
  return { esito: "chiusa", restituisci: [a, b], testo: TESTI_SVELAMENTO.chiusa };
}

// Porta che scade senza svelamento: crediti restituiti a chi li aveva bloccati, nessuna penale.
export function portaScaduta({ porta, adesso }) {
  if (porta.svelata || t(adesso) < t(scadenzaPorta(porta.aperta))) return { scaduta: false };
  const restituisci = [porta.a, porta.b].filter((id) => porta.caparre?.[chiave(porta, id)]);
  return { scaduta: true, restituisci, penale: 0, testo: TESTI_SVELAMENTO.scaduta };
}

// Chiusure prima dell'esito. «Chiudi e segnala» e blocco: crediti a entrambi (spec, «Casi limite»).
// Sospensione di uno dei due durante le 48 ore: porta chiusa e crediti bloccati restituiti a ENTRAMBI, anche a chi è
// sospeso (risposta del CPO del 13/11 su #65): la sospensione è una sanzione sull'account, non sui crediti.
export function chiusuraForzata({ porta, motivo, da }) {
  const bloccati = [porta.a, porta.b].filter((id) => porta.caparre?.[chiave(porta, id)]);
  if (motivo === "chiudi_e_segnala") return { chiusa: true, restituisci: bloccati, blocca: true, segnalazione: true, penale: 0 };
  if (motivo === "blocco") return { chiusa: true, restituisci: bloccati, blocca: true, segnalazione: false, penale: 0 };
  if (motivo === "sospensione") return { chiusa: true, restituisci: bloccati, blocca: false, segnalazione: false, penale: 0 };
  throw new Error(`motivo sconosciuto: ${motivo}`);
}

// Riga del registro dopo l'esito: solo i campi permessi dalla spec. Le singole risposte sì/no non passano mai.
const CAMPI_REGISTRO = ["porta", "aperta", "caparraA", "caparraB", "svelata", "tipo", "durata", "fine", "rispostaAQuando", "rispostaBQuando", "esito"];
export function registroFinale(dati) {
  return Object.fromEntries(CAMPI_REGISTRO.map((k) => [k, dati[k] ?? null]));
}
