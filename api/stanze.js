// Stanze della settimana (Fase 2, issue #3, specifica v1 + v1.1 del CPO; D16 B, D19, D18, D31 B, D35 A).
// Questo file gira SOLO sul server (lavoro del lunedì nel Worker «presente-api»): nessuna chiamata a database o servizi,
// solo calcoli su dati già letti, così si prova tutto con profili inventati.
//
// Persona (come la passa il lavoro del lunedì, dopo aver letto profili e filtri):
//   { id, eta, presento: "donna" | "uomo" | "non_binario" | "mi_descrivo", citta: "milano", paese: "IT",
//     cerco: "donne" | "uomini" | "tutti", eta_min, eta_max, raggio: "citta" | "italia" | "estero", stanzePrecedenti: 0 }
// Il diario NON entra mai qui: nessuna funzione di questo file lo riceve (D51 A, «il diario non entra mai nei calcoli»).

import { affinita as affinitaQuestionario } from "./questionario.js";

export const STANZA = Object.freeze({ massimo: 12, minimo: 6, compatibiliMinimi: 4, cittaApreA: 36, settimaneSenzaRipetere: 4, costoCrediti: 9 });
export const FUSO = "Europe/Rome";

// ── Filtri reciproci rigidi: A con B solo se B rientra nei filtri di A E A in quelli di B. Mai eccezioni. ──
// «cerco» confronta «mi presento come»: donne → donna, uomini → uomo; chi si presenta non binario o si descrive
// rientra solo in «tutti» (confermato dal CPO il 3/11).
const CERCO = { donne: new Set(["donna"]), uomini: new Set(["uomo"]) };
function rientra(chi, altro) {
  if (!chi.cerco || !altro.presento) return false;
  if (chi.cerco !== "tutti" && !CERCO[chi.cerco]?.has(altro.presento)) return false;
  if (!(altro.eta >= (chi.eta_min ?? 18) && altro.eta <= (chi.eta_max ?? 99))) return false;
  if (chi.raggio === "citta") return altro.paese === chi.paese && altro.citta === chi.citta;
  if (chi.raggio === "italia") return altro.paese === "IT";
  return chi.raggio === "estero";
}

const coppia = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// esclusi: Set di coppie (coppia(a, b)) già in stanza insieme nelle ultime 4 settimane o bloccate (in un verso o nell'altro).
export function compatibili(a, b, esclusi = new Set()) {
  return a.id !== b.id && !esclusi.has(coppia(a.id, b.id)) && rientra(a, b) && rientra(b, a);
}
export { coppia };

// Chi può stare nella stessa stanza (criterio «nessuna coppia fuori dai filtri reciproci», «mai nessuno fuori dai filtri
// di ciascuno»). Due persone stanno insieme solo se:
// - sono compatibili (filtri reciproci rispettati: possono chiamarsi), oppure
// - nessuna delle due cerca il genere dell'altra (es. due donne che cercano uomini: non sono una «coppia» possibile).
// Mai nella stessa stanza chi è escluso (bloccati, già insieme nelle ultime 4 settimane), né chi interessa a uno dei due
// per genere ma è fuori dai suoi filtri di età o raggio. Confermato dal CPO il 3/11.
const generePossibile = (chi, altro) => chi.cerco === "tutti" || Boolean(CERCO[chi.cerco]?.has(altro.presento));
export function ammessiInsieme(a, b, esclusi = new Set()) {
  if (a.id === b.id || esclusi.has(coppia(a.id, b.id))) return false;
  return compatibili(a, b, esclusi) || (!generePossibile(a, b) && !generePossibile(b, a));
}

// Chi vedi nella tua stanza (risposta del CPO del 3/11): solo le persone reciprocamente compatibili. Solo loro compaiono
// nella schermata, si possono chiamare, ricevere la chiave ed entrare nei suggerimenti; il contatore «Nella tua stanza:
// N persone per te» è perTe(...).length. Lo stesso controllo lo fa il database in compagni_di_stanza() (anche via API).
export function perTe(io, stanza, esclusi = new Set()) {
  return stanza.filter((altro) => compatibili(io, altro, esclusi)).map((altro) => altro.id);
}

// ── Stanza Italia o stanza della città (D19 e spec v1.1). ──
// Una città con almeno 36 profili completi apre stanze sue: ci vanno i suoi abitanti. Tutti gli altri con raggio
// «italia» o «estero» vanno nella Stanza Italia. Chi ha «solo la mia città» e la città non è aperta resta in attesa
// (riceve la domanda «Vuoi entrare intanto nella Stanza Italia?»): il raggio lo cambia solo l'utente toccando «Sì».
export function cittaAperte(persone) {
  const conto = {};
  for (const p of persone) if (p.paese === "IT" && p.citta) conto[p.citta] = (conto[p.citta] || 0) + 1;
  return new Set(Object.keys(conto).filter((c) => conto[c] >= STANZA.cittaApreA));
}

export function mancanoPerCitta(completiInCitta) {
  return Math.max(0, STANZA.cittaApreA - (completiInCitta || 0));
}

export function gruppi(persone, aperte = cittaAperte(persone)) {
  const risultato = { italia: [], attesa_citta: [] };
  for (const p of persone) {
    if (p.paese === "IT" && aperte.has(p.citta)) (risultato[`citta:${p.citta}`] ||= []).push(p);
    else if (p.raggio === "citta") risultato.attesa_citta.push(p);
    else risultato.italia.push(p);
  }
  return risultato;
}

// ── Composizione delle stanze di un gruppo (lavoro del lunedì). ──
// Greedy deterministico: parte da chi ha meno compatibili (il più difficile da sistemare), aggiunge chi ha più legami
// con chi è già dentro (a parità: affinità media più alta), fino a 12. Poi toglie chi ha meno di 4 compatibili nella stanza;
// sotto 6 la stanza non si forma e le persone restano per un altro tentativo o in attesa per lunedì prossimo.
// affinitaDi(a, b): numero 0–100 (di solito la funzione del questionario, la stessa testata nella #2).
export function componi(persone, { esclusi = new Set(), affinitaDi = () => 50 } = {}) {
  const perId = new Map(persone.map((p) => [p.id, p]));
  const vicini = new Map(persone.map((p) => [p.id, new Set()]));
  const ammessi = new Map(persone.map((p) => [p.id, new Set()]));
  for (let i = 0; i < persone.length; i++) {
    for (let j = i + 1; j < persone.length; j++) {
      const a = persone[i], b = persone[j];
      if (compatibili(a, b, esclusi)) { vicini.get(a.id).add(b.id); vicini.get(b.id).add(a.id); }
      if (ammessiInsieme(a, b, esclusi)) { ammessi.get(a.id).add(b.id); ammessi.get(b.id).add(a.id); }
    }
  }
  const memo = new Map();
  const aff = (x, y) => {
    const k = coppia(x, y);
    if (!memo.has(k)) memo.set(k, affinitaDi(perId.get(x), perId.get(y)) ?? 0);
    return memo.get(k);
  };

  const liberi = new Set(persone.map((p) => p.id));
  const scartatiComeSeme = new Set();
  const stanze = [];
  const legamiLiberi = (id) => [...vicini.get(id)].filter((v) => liberi.has(v)).length;

  for (;;) {
    const semi = [...liberi].filter((id) => !scartatiComeSeme.has(id) && legamiLiberi(id) >= STANZA.compatibiliMinimi);
    if (!semi.length) break;
    semi.sort((x, y) => legamiLiberi(x) - legamiLiberi(y) || String(x).localeCompare(String(y)));
    const seme = semi[0];
    const dentro = [seme];
    while (dentro.length < STANZA.massimo) {
      let migliore = null, punti = -1, media = -1;
      for (const c of liberi) {
        if (dentro.includes(c) || !dentro.every((d) => ammessi.get(c).has(d))) continue;
        const legami = dentro.filter((d) => vicini.get(c).has(d)).length;
        if (!legami) continue;
        const m = dentro.reduce((s, d) => s + (vicini.get(c).has(d) ? aff(c, d) : 0), 0) / legami;
        if (legami > punti || (legami === punti && (m > media || (m === media && String(c) < String(migliore))))) {
          migliore = c; punti = legami; media = m;
        }
      }
      if (migliore === null) break;
      dentro.push(migliore);
    }
    // Ognuno deve avere almeno 4 compatibili nella stanza: si toglie chi ne ha meno, finché serve.
    let stanza = dentro;
    for (;;) {
      const debole = stanza.find((id) => stanza.filter((d) => vicini.get(id).has(d)).length < STANZA.compatibiliMinimi);
      if (debole === undefined) break;
      stanza = stanza.filter((id) => id !== debole);
    }
    if (stanza.length >= STANZA.minimo) {
      stanze.push(stanza);
      for (const id of stanza) liberi.delete(id);
    } else {
      scartatiComeSeme.add(seme);
    }
  }
  return { stanze, inAttesa: [...liberi] };
}

// ── Orari: apertura lunedì 9:00 e chiusura domenica 21:00, ora di Roma, anche con il cambio d'ora. ──
function offsetRoma(istante) {
  const parti = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: FUSO, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(istante).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  const comeUtc = Date.UTC(parti.year, parti.month - 1, parti.day, parti.hour, parti.minute, parti.second);
  return comeUtc - Math.floor(istante.getTime() / 1000) * 1000;
}

// Istante (Date) di un'ora di Roma in un certo giorno (anno, mese 1–12, giorno).
export function oraDiRoma(anno, mese, giorno, ora, minuti = 0) {
  const ingenuo = Date.UTC(anno, mese - 1, giorno, ora, minuti);
  let t = ingenuo - offsetRoma(new Date(ingenuo));
  t = ingenuo - offsetRoma(new Date(t)); // seconda passata: giusto anche a cavallo del cambio d'ora
  return new Date(t);
}

// La settimana di stanza che contiene «adesso» o, se siamo tra domenica 21:00 e lunedì 9:00, la prossima.
export function settimanaStanza(adesso = new Date()) {
  const romaOra = new Date(adesso.getTime() + offsetRoma(adesso)); // campi UTC = ora di Roma
  const giornoSett = (romaOra.getUTCDay() + 6) % 7; // lunedì = 0
  const lunedi = new Date(Date.UTC(romaOra.getUTCFullYear(), romaOra.getUTCMonth(), romaOra.getUTCDate() - giornoSett));
  const apre = (l) => oraDiRoma(l.getUTCFullYear(), l.getUTCMonth() + 1, l.getUTCDate(), 9);
  const chiude = (l) => { const d = new Date(l.getTime() + 6 * 86400000); return oraDiRoma(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 21); };
  let l = lunedi;
  if (adesso >= chiude(l)) l = new Date(l.getTime() + 7 * 86400000);
  return { apre: apre(l), chiude: chiude(l), aperta: adesso >= apre(l) && adesso < chiude(l) };
}

// ── Crediti (D18, spec v1): la prima stanza è gratis; dalla seconda 9 crediti, scalati solo se la stanza si forma. ──
export function costoStanza(stanzePrecedenti, formata) {
  if (!formata) return 0;
  return stanzePrecedenti > 0 ? STANZA.costoCrediti : 0;
}

// ── Suggerimenti del giorno: 2 nomi. ──
// Punteggio: affinità del questionario + 30 se entrambi hanno detto «sì, la richiamerei» dopo una chiamata;
// esclusi chi è già stato chiamato 3 volte (limite #4) e chi ho segnato io con «no». Il «no» dell'altro non toglie
// nessuno (toglie solo il bonus): così dai suggerimenti non si può indovinare la risposta segreta dell'altro.
// Mai mostrato a nessuno. A parità, ordine stabile per il giorno (cambia da un giorno all'altro, sempre uguale nello stesso giorno).
// altri: [{ id, affinita, chiamate, richiamerei: { mio: true|false|null, suo: true|false|null } }]
export const BONUS_SI_RECIPROCO = 30;
export function suggerimenti(altri, giorno, quanti = 2) {
  const mescola = (id) => {
    let h = 2166136261;
    for (const c of `${giorno}|${id}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  };
  return altri
    .filter((a) => (a.chiamate || 0) < 3 && a.richiamerei?.mio !== false)
    .map((a) => ({ id: a.id, punti: (a.affinita ?? 0) + (a.richiamerei?.mio === true && a.richiamerei?.suo === true ? BONUS_SI_RECIPROCO : 0), ordine: mescola(a.id) }))
    .sort((x, y) => y.punti - x.punti || x.ordine - y.ordine)
    .slice(0, quanti)
    .map((a) => a.id);
}

// Affinità del questionario per il lavoro del lunedì: la stessa funzione testata nella #2 (spec v1.1).
export const affinitaDaQuestionari = (questionari) => (a, b) => affinitaQuestionario(questionari.get(a.id), questionari.get(b.id)) ?? 0;
