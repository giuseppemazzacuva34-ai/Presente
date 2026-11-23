// Coin e regali nelle stanze (Fase 2, issue #331, spec v1 del CPO del 21/11; decisioni_giuseppe_20_11_evoluzione,
// D145 A). Passo 1 della linea «sviluppatore-c»: solo regole e testi, nessuna lettura o scrittura.
// I dati (saldo, stanza, blocchi, segnalazioni, sospensioni, regali di oggi) li legge il server: il database li
// ricontrollerà da solo nel passo successivo, così nemmeno una chiamata diretta all'API può aggirarli.
// In beta i Coin sono un CONTATORE INTERNO di prova: niente pagamenti veri (Stripe/Gomry solo con una decisione di
// Giuseppe). Chi riceve un regalo non riceve Coin (regola D9 «Niente affari»). I regali non entrano mai negli
// algoritmi (suggerimenti, stanze, chiavi): nessuna funzione di quei moduli riceve questi dati.

export const COIN = Object.freeze({
  perEuro: 10, // 1 € = 10 Coin
  stanzaAlBuio: 80, // dalla seconda stanza; la prima è in regalo
  regaliAllaPersonaAlGiorno: 3,
  regaliAlGiorno: 10,
});

// D145 A. «articolo» e «mandato» servono ai testi della spec («una rosa», «Rosa mandata»).
export const REGALI = Object.freeze([
  Object.freeze({ id: "rosa", nome: "Rosa", coin: 5, conArticolo: "una rosa", mandato: "mandata" }),
  Object.freeze({ id: "spumante", nome: "Bicchiere di spumante", coin: 10, conArticolo: "un bicchiere di spumante", mandato: "mandato" }),
  Object.freeze({ id: "fiori", nome: "Mazzo di fiori", coin: 20, conArticolo: "un mazzo di fiori", mandato: "mandato" }),
]);

export const TESTI_COIN = Object.freeze({
  manda: "Manda un regalo",
  conferma: "Manda",
  annulla: "Annulla",
  stanzaChiusa: "La stanza è chiusa.",
  nonPuoi: "Non puoi mandare regali a questa persona.",
});

const regaloDa = (id) => REGALI.find((r) => r.id === id) ?? null;
const intero = (n) => Number.isInteger(n) && n >= 0;
const chi = (nome) => (typeof nome === "string" && nome.trim() ? nome.trim() : "questa persona");

export const coin = (n) => (n === 1 ? "1 credito" : `${n} crediti`); // decisioni_giuseppe_23_11_crediti
const mancano = (n) => (n === 1 ? "Ti manca 1 credito" : `Ti mancano ${n} crediti`);
const no = (motivo, testo = null) => ({ ok: false, motivo, testo });

// Testi dei due limiti giornalieri (CPO, 22/11; giorno di calendario di Roma). <nome> = nome di battesimo nella stanza.
export function testoLimite(motivo, nome) {
  if (motivo === "limite_persona") return `Oggi hai già mandato ${COIN.regaliAllaPersonaAlGiorno} regali a ${chi(nome)}. Domani puoi mandargliene altri.`;
  if (motivo === "limite_giorno") return "Per oggi hai mandato tutti i regali. Domani puoi mandarne altri.";
  return null;
}

// Decide se un regalo può partire. Ordine: dati validi, stanza, persona, limiti, saldo.
// Per i limiti la spec non dà un testo: testo null finché il CPO non lo scrive.
export function regaloPermesso(d = {}) {
  const r = regaloDa(d.regalo);
  if (!r) return no("regalo_sconosciuto");
  const booleani = ["stessaStanza", "compatibili", "bloccati", "segnalati", "sospeso"];
  if (!booleani.every((k) => typeof d[k] === "boolean")
      || !intero(d.saldo) || !intero(d.oggiAllaPersona) || !intero(d.oggiInTutto)
      || !(d.adesso instanceof Date) || !(d.chiusuraStanza instanceof Date)
      || Number.isNaN(d.adesso.getTime()) || Number.isNaN(d.chiusuraStanza.getTime())) {
    return no("dati_mancanti");
  }
  if (d.adesso.getTime() >= d.chiusuraStanza.getTime()) return no("stanza_chiusa", TESTI_COIN.stanzaChiusa);
  if (!d.stessaStanza) return no("non_nella_stanza", TESTI_COIN.nonPuoi);
  if (!d.compatibili) return no("non_compatibile", TESTI_COIN.nonPuoi);
  if (d.bloccati) return no("blocco", TESTI_COIN.nonPuoi);
  if (d.segnalati) return no("segnalazione", TESTI_COIN.nonPuoi);
  if (d.sospeso) return no("sospensione", TESTI_COIN.nonPuoi);
  if (d.oggiAllaPersona >= COIN.regaliAllaPersonaAlGiorno) return no("limite_persona");
  if (d.oggiInTutto >= COIN.regaliAlGiorno) return no("limite_giorno");
  if (d.saldo < r.coin) return no("saldo", mancano(r.coin - d.saldo));
  return { ok: true, costo: r.coin, aChiRiceve: 0 };
}

export function conferma(id, nome) {
  const r = regaloDa(id);
  return r ? `Mandi ${r.conArticolo} a ${chi(nome)}? Costa ${coin(r.coin)}.` : null;
}

export function fatto(id, nome) {
  const r = regaloDa(id);
  return r ? `${r.nome} ${r.mandato} a ${chi(nome)}.` : null;
}

export function avvisoRegalo(id, nome) {
  const r = regaloDa(id);
  return r ? `${chi(nome)} ti ha mandato ${r.conArticolo}.` : null;
}

// Il foglio con i tre regali: ogni regalo ha un'etichetta di testo (non solo un'icona) e, se il saldo non basta,
// è disattivato con «Ti mancano N Coin».
export function foglioRegali(saldo) {
  const s = Number.isInteger(saldo) && saldo > 0 ? saldo : 0;
  return {
    regali: REGALI.map((r) => ({
      id: r.id,
      etichetta: `${r.nome} · ${coin(r.coin)}`,
      attivo: s >= r.coin,
      mancano: s >= r.coin ? null : mancano(r.coin - s),
    })),
    saldo: `Hai ${coin(s)}`,
  };
}

// «Ti mancano N Coin» anche per le richieste del Worker (stesso testo del foglio).
export const tiMancano = (n) => mancano(n);

// Nella scheda, solo per chi riceve: «Ti ha mandato: 1 rosa, 1 bicchiere di spumante» (spec, parte C).
// Ordine del catalogo; regali sconosciuti o conteggi non validi si ignorano; niente regali = nessuna riga.
const PLURALI = Object.freeze({ rosa: "rose", spumante: "bicchieri di spumante", fiori: "mazzi di fiori" });
export function ricevutiTesto(lista) {
  const quanti = new Map((Array.isArray(lista) ? lista : [])
    .filter((x) => x && regaloDa(x.regalo) && Number.isInteger(x.quanti) && x.quanti > 0)
    .map((x) => [x.regalo, x.quanti]));
  const pezzi = REGALI.filter((r) => quanti.has(r.id)).map((r) => {
    const n = quanti.get(r.id);
    return `${n} ${n === 1 ? r.nome.toLowerCase() : PLURALI[r.id]}`;
  });
  return pezzi.length ? `Ti ha mandato: ${pezzi.join(", ")}` : null;
}
