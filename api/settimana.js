// Lavoro del lunedì (Fase 2, issue #3, specifica v1 e v1.1 del CPO), terzo passo: dalle righe del database alle stanze.
// Solo calcoli, come api/stanze.js: riceve righe già lette (profili, filtri, questionario, iscrizioni, blocchi, stanze
// delle ultime 4 settimane) e restituisce le righe da scrivere in `stanze` e `membri_stanza`, più chi resta in attesa e
// perché. Nessuna lettura o scrittura qui: le fa il lavoro programmato (passo successivo), così tutto si prova con dati
// inventati. Il diario non entra mai: nessuna funzione di questo file lo riceve.

import { STANZA, FUSO, coppia, componi, gruppi, contaPerZona, zoneAccese, settimanaStanza, oraDiRoma, costoStanza, affinitaDaQuestionari }
  from "./stanze.js";
import { areaDi, mancano } from "./aree.js";
import { questionarioCompleto } from "./questionario.js";

// Passo finale dell'iscrizione nella web app (profilo completo).
export const PASSO_COMPLETO = 11;

// Nome della città come chiave di confronto: «  Reggio nell'Emilia » e «reggio nell’emilia» sono la stessa città.
export function chiaveCitta(citta) {
  if (!citta) return null;
  return String(citta).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’`´]/g, "'")
    .toLowerCase().replace(/\s+/g, " ").trim() || null;
}

// Anni compiuti a una certa data (giorno di calendario di Roma). dataNascita: "AAAA-MM-GG".
export function etaAl(dataNascita, istante) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataNascita || "");
  if (!m) return null;
  const [a, me, g] = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(istante).split("-").map(Number);
  let eta = a - Number(m[1]);
  if (me < Number(m[2]) || (me === Number(m[2]) && g < Number(m[3]))) eta--;
  return eta;
}

// La versione del questionario che vale per la stanza: l'ultima riga con in_vigore_dal ≤ apertura.
// Le modifiche fatte in settimana valgono dal lunedì dopo (vedi tabella questionario).
export function questionarioInVigore(righe, apertura) {
  let scelta = null;
  for (const r of righe || []) {
    const dal = new Date(r.in_vigore_dal);
    if (dal <= apertura && (!scelta || dal > new Date(scelta.in_vigore_dal))) scelta = r;
  }
  return scelta ? { versione: scelta.versione, risposte: scelta.risposte || {}, importanza: scelta.importanza || {} } : null;
}

// Da righe di profili + filtri + questionario a «persona» per api/stanze.js, oppure il motivo per cui non entra.
export function persona({ profilo, filtri, questionario }, apertura, stanzePrecedenti = 0) {
  if (!profilo || profilo.passo !== PASSO_COMPLETO) return { motivo: "profilo_incompleto" };
  if (!profilo.data_nascita) return { motivo: "senza_data_nascita" }; // requisito 2 del CISO
  const eta = etaAl(profilo.data_nascita, apertura);
  if (eta === null || eta < 18) return { motivo: "senza_data_nascita" };
  // Dall'estero (provincia «EE») la città è vuota per costruzione: basta la provincia.
  if (!profilo.nome || !(profilo.citta || profilo.provincia) || !profilo.mi_presento_come) return { motivo: "profilo_incompleto" };
  if (!filtri?.cerco || !filtri.consenso_cerco_il || !filtri.raggio) return { motivo: "filtri_incompleti" };
  if (!questionarioCompleto(questionario)) return { motivo: "questionario_incompleto" };
  // Zona = area vasta ricavata qui dalla provincia (D121 A): eventuali campi «zona» o «area» nella riga non contano.
  // Senza provincia (righe di prima) la zona è la città; dall'estero nessuna zona.
  const citta = chiaveCitta(profilo.citta);
  const zona = profilo.provincia ? areaDi(profilo.provincia)?.codice ?? null : citta;
  return {
    id: profilo.id, eta, presento: profilo.mi_presento_come, zona, citta, paese: profilo.paese || "IT",
    cerco: filtri.cerco, eta_min: filtri.eta_min ?? 18, eta_max: filtri.eta_max ?? 99, raggio: filtri.raggio, stanzePrecedenti,
  };
}

// Ultimo momento per confermare l'ingresso: domenica 23:59 (Roma) prima dell'apertura del lunedì.
export function scadenzaIscrizione(apertura) {
  const domenica = new Date(apertura.getTime() - 86400000);
  const [a, m, g] = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(domenica).split("-").map(Number);
  return new Date(oraDiRoma(a, m, g, 23, 59).getTime() + 59999);
}

// Coppie da non mettere insieme: chi si è bloccato (in un verso o nell'altro) e chi è stato nella stessa stanza
// nelle ultime 4 settimane. storico: righe { stanza_id, utente_id, apre_il } delle stanze passate.
export function coppieEscluse({ blocchi = [], storico = [] }, apertura) {
  const esclusi = new Set();
  for (const b of blocchi) esclusi.add(coppia(b.chi, b.bloccato));
  const limite = apertura.getTime() - STANZA.settimaneSenzaRipetere * 7 * 86400000;
  const perStanza = new Map();
  for (const r of storico) {
    if (new Date(r.apre_il).getTime() < limite) continue;
    if (!perStanza.has(r.stanza_id)) perStanza.set(r.stanza_id, []);
    perStanza.get(r.stanza_id).push(r.utente_id);
  }
  for (const membri of perStanza.values())
    for (let i = 0; i < membri.length; i++) for (let j = i + 1; j < membri.length; j++) esclusi.add(coppia(membri[i], membri[j]));
  return esclusi;
}

// Il lavoro del lunedì in un'unica funzione.
// righe: [{ profilo, filtri, questionario: [righe della tabella] }] di chi ha confermato l'ingresso.
// iscrizioni: Map id → istante della conferma. stanzePrecedenti: Map id → quante stanze ha già fatto (per i crediti).
// Aree accese: si contano TUTTI i profili completi (anche chi questa settimana non entra), come il contatore «mancano N».
// completiPerZona: { codiceArea: { totale, donne } } dal database (solo numeri); senza, si contano le persone di questa settimana.
export function preparaSettimana({ righe, iscrizioni = new Map(), stanzePrecedenti = new Map(), blocchi = [], storico = [],
  completiPerZona = null, adesso = new Date() }) {
  const { apre, chiude } = settimanaStanza(adesso);
  const scadenza = scadenzaIscrizione(apre);
  const attesa = [];
  const persone = [];
  const questionari = new Map();
  for (const r of righe) {
    const id = r.profilo?.id;
    if (!id) continue;
    const conferma = iscrizioni.get(id);
    if (!conferma || new Date(conferma) > scadenza) { attesa.push({ utente_id: id, motivo: "non_iscritto" }); continue; }
    const q = questionarioInVigore(r.questionario, apre);
    const p = persona({ profilo: r.profilo, filtri: r.filtri, questionario: q }, apre, stanzePrecedenti.get(id) || 0);
    if (p.motivo) { attesa.push({ utente_id: id, motivo: p.motivo }); continue; }
    persone.push(p);
    questionari.set(id, q);
  }

  const conto = completiPerZona || contaPerZona(persone);
  const aperte = zoneAccese(conto);
  const esclusi = coppieEscluse({ blocchi, storico }, apre);
  const affinitaDi = affinitaDaQuestionari(questionari);
  const perId = new Map(persone.map((p) => [p.id, p]));
  const stanze = [];

  for (const [chiave, gruppo] of Object.entries(gruppi(persone, aperte))) {
    if (chiave === "attesa_citta") {
      // mancano: { persone, donne } per il testo della home (testoContatore in api/aree.js).
      for (const p of gruppo) attesa.push({ utente_id: p.id, motivo: "citta_non_aperta", zona: p.zona, mancano: mancano(conto[p.zona]) });
      continue;
    }
    const { stanze: composte, inAttesa } = componi(gruppo, { esclusi, affinitaDi });
    const [tipo, citta] = chiave === "italia" ? ["italia", null] : ["citta", chiave.slice("citta:".length)];
    for (const membri of composte) {
      stanze.push({
        tipo, citta, apre_il: apre.toISOString(), chiude_il: chiude.toISOString(),
        membri: membri.map((id) => {
          const precedenti = perId.get(id).stanzePrecedenti;
          return { utente_id: id, gratis: precedenti === 0, crediti: costoStanza(precedenti, true) };
        }),
      });
    }
    // Sotto i 4 compatibili nessuna stanza e nessun credito scalato: posto tenuto per lunedì prossimo.
    for (const id of inAttesa) attesa.push({ utente_id: id, motivo: "pochi_compatibili" });
  }
  return { apre_il: apre.toISOString(), chiude_il: chiude.toISOString(), stanze, attesa };
}
