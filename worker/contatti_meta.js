// Regole comuni per i contatti del modulo dentro Facebook e Instagram (D53 = A).
// Le usano sia l'import a mano dal CSV (scripts/importa_meta.mjs) sia l'import diretto senza AI (worker/meta.js, D85 = A):
// così le due strade salvano le stesse cose, nello stesso modo.
import { EMAIL, VERSIONE_INFORMATIVA, RISPOSTE } from "./iscrizione.js";
import { pulisciCodice, CODICE_PERSONALE } from "./invito.js";
import { siglaDaTesto, daSigla } from "./province.js";

export const SORGENTE = "meta_modulo";

export const semplice = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Le città del modulo del sito (worker/iscrizione.js, campo «zona»). Il resto d'Italia va in «altra-citta-italia».
const CITTA = [
  ["venezia-padova", ["venezia", "padova", "mestre"]],
  ["brescia-bergamo", ["brescia", "bergamo"]],
  ["milano", ["milano"]], ["roma", ["roma"]], ["napoli", ["napoli"]], ["torino", ["torino"]],
  ["bologna", ["bologna"]], ["firenze", ["firenze"]], ["genova", ["genova"]], ["verona", ["verona"]],
  ["bari", ["bari"]], ["palermo", ["palermo"]], ["catania", ["catania"]], ["cagliari", ["cagliari"]],
  ["estero", ["estero", "abroad", "fuori italia"]],
];
export function zonaDa(valore) {
  const v = ` ${semplice(valore)} `;
  for (const [zona, nomi] of CITTA) if (nomi.some((n) => v.includes(` ${n} `))) return zona;
  return "altra-citta-italia";
}

export const SI = new Set(["si", "yes", "true", "1", "vero", "ho almeno 18 anni", "confermo"]);
export const colonna = (intestazioni, prove) => intestazioni.find((h) => prove.some((p) => semplice(h).includes(p)));

// Data d'invio del modulo (es. 2026-10-31T10:12:33+0000) in formato ISO; se manca o è strana, adesso.
export function dataConsenso(valore, adesso = new Date()) {
  const d = new Date(String(valore || "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? adesso.toISOString() : d.toISOString();
}

// «Mi presento come» del modulo Meta → stessi valori del sito; qualunque altra cosa = nessuna risposta.
const PRESENTO = { donna: "donna", uomo: "uomo", "non binario": "non_binario", "non binaria": "non_binario", altro: "altro" };
export function presentoDa(valore) {
  const v = PRESENTO[semplice(valore)] || null;
  return v && RISPOSTE.presento.includes(v) ? v : null;
}

export function contattoDiProva(email) {
  return /test lead|dummy data|^test@(fb|meta)\.com$/.test(email);
}

// Campo facoltativo «codice» del modulo Meta (D88 A): si salva solo un codice delle presentatrici (CODICI_INVITO)
// o un codice personale «porta un'amica» (6 caratteri). Un nome o un testo qualsiasi scritto lì non si salva mai.
export function codiceDa(valore, codiciAmmessi = new Set()) {
  const c = pulisciCodice(valore);
  return c && (codiciAmmessi.has(c) || CODICE_PERSONALE.test(c)) ? c : null;
}

// Un contatto (oggetto { nome colonna: valore }) → { iscrizione } oppure { scarto: motivo }.
// colonne: i nomi delle colonne già trovati (email, città, 18 anni, «mi presento come»).
export function contatto(r, colonne, { maggiorenneNelModulo = false, adesso = new Date(), codiciAmmessi = new Set() } = {}) {
  const email = String(r[colonne.email] || "").trim().toLowerCase();
  if (contattoDiProva(email) || r.is_test_lead === "true") return { scarto: "prova_meta" };
  if (email.length > 254 || !EMAIL.test(email)) return { scarto: "email_non_valida" };
  if (colonne.eta ? !SI.has(semplice(r[colonne.eta])) : !maggiorenneNelModulo) return { scarto: "senza_18" };
  const iscrizione = {
    email,
    zona: zonaDa(colonne.citta ? r[colonne.citta] : ""),
    consenso_il: dataConsenso(r.created_time, adesso),
    versione_informativa: VERSIONE_INFORMATIVA,
    sorgente: SORGENTE,
  };
  const presento = colonne.presento ? presentoDa(r[colonne.presento]) : null;
  if (presento) iscrizione.presento = presento;
  const codice = colonne.codice ? codiceDa(r[colonne.codice], codiciAmmessi) : null;
  if (codice) iscrizione.invito = codice;
  // Modulo con la provincia (D84 A): la provincia decide anche zona e città, come nel passo 2 del sito.
  const sigla = colonne.provincia ? siglaDaTesto(r[colonne.provincia]) : null;
  if (sigla) {
    const p = daSigla(sigla);
    Object.assign(iscrizione, { zona: p.zona, provincia: p.provincia, regione: p.regione });
    if (p.citta) iscrizione.citta = p.citta;
  }
  return { iscrizione };
}

export function trovaColonne(intestazioni) {
  return {
    email: intestazioni.find((h) => semplice(h) === "email") || colonna(intestazioni, ["email", "e mail"]),
    citta: colonna(intestazioni, ["citta", "city", "zona"]),
    provincia: colonna(intestazioni, ["provincia", "province"]),
    eta: colonna(intestazioni, ["18", "maggiorenn", "maggiore eta"]),
    presento: colonna(intestazioni, ["presento", "presenti", "genere", "gender"]),
    codice: colonna(intestazioni, ["codice", "invito", "code"]),
  };
}
