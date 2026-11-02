// CODICI DELLE PRESENTATRICI (D88 = A, 2/11; regole in plancia progetto/gara-presentatrici, «meccanica A»).
// Ogni creator con accordo firmato ha un codice maiuscolo senza dati personali (es. ROMA01) in CODICI_INVITO.
// Qui si contano gli «iscritti validi» per codice, solo come numeri, con i filtri contro le iscrizioni finte:
// - email di domini usa e getta escluse (elenco qui sotto);
// - email già in lista: conta solo la prima iscrizione della stessa persona; gli alias (nome+1@, e per Gmail i punti)
//   valgono come la stessa email;
// - picco: più di PICCO_MASSIMO iscrizioni con lo stesso codice in un'ora → «sospeso: true», il CTO verifica a mano (solo totali);
// - «non cancellata entro 7 giorni»: chi si cancella sparisce dalla lista; «confermati_7_giorni» conta solo chi è in lista
//   da almeno 7 giorni, «validi» anche i più recenti.
// Nessun IP, cookie o impronta del browser: si usano solo email (mai mostrata), codice e data già salvati.
import { codiciConfigurati, pulisciCodice } from "./invito.js";

export const PICCO_MASSIMO = 15;
const ORA = 60 * 60 * 1000;
const SETTE_GIORNI = 7 * 24 * ORA;

// Domini di caselle temporanee più usati (si allunga quando ne troviamo altri; solo il dominio, mai l'indirizzo).
export const DOMINI_USA_E_GETTA = new Set([
  "mailinator.com", "yopmail.com", "yopmail.fr", "yopmail.net", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamailblock.com", "sharklasers.com", "grr.la", "pokemail.net", "spam4.me", "10minutemail.com", "10minutemail.net",
  "temp-mail.org", "temp-mail.io", "tempmail.com", "tempmail.net", "tempmailo.com", "tempail.com", "tempr.email", "trashmail.com",
  "trashmail.de", "trashmail.net", "getnada.com", "nada.email", "maildrop.cc", "dispostable.com", "throwawaymail.com",
  "mailnesia.com", "fakeinbox.com", "mintemail.com", "emailondeck.com", "spamgourmet.com", "mohmal.com", "burnermail.io",
  "mailcatch.com", "mytemp.email", "moakt.com", "tmail.ws", "tmpmail.org", "tmpmail.net", "emailfake.com", "fakemail.net",
  "inboxkitten.com", "harakirimail.com", "mailpoof.com", "33mail.com", "spambox.us", "discard.email", "discardmail.com",
  "jetable.org", "mail-temp.com", "minuteinbox.com", "luxusmail.org", "1secmail.com", "1secmail.org", "1secmail.net",
  "byom.de", "wegwerfmail.de", "einrot.com", "cuvox.de", "dayrep.com", "fleckens.hu", "gustr.com", "jourrapide.com",
  "rhyta.com", "superrito.com", "teleworm.us", "armyspy.com", "mvrht.net", "trbvm.com", "mailnull.com", "spamex.com",
]);

export function dominio(email) {
  return String(email || "").trim().toLowerCase().split("@")[1] || "";
}

export function usaEGetta(email) {
  const d = dominio(email);
  if (!d) return true;
  for (let x = d; x.includes("."); x = x.slice(x.indexOf(".") + 1)) if (DOMINI_USA_E_GETTA.has(x)) return true;
  return false;
}

// La stessa persona scritta in modi diversi: tolto «+qualcosa»; per Gmail anche i punti e googlemail.com.
export function emailNormalizzata(email) {
  const [locale = "", d = ""] = String(email || "").trim().toLowerCase().split("@");
  let nome = locale.split("+")[0];
  let dom = d;
  if (dom === "googlemail.com") dom = "gmail.com";
  if (dom === "gmail.com") nome = nome.replace(/\./g, "");
  return `${nome}@${dom}`;
}

const ms = (data) => {
  const t = Date.parse(data || "");
  return Number.isNaN(t) ? 0 : t;
};

// righe: [{ email, invito, consenso_il }] di TUTTA la lista (serve a riconoscere chi c'era già).
// Restituisce { CODICE: { validi, confermati_7_giorni, esclusi_usa_e_getta, esclusi_gia_in_lista, sospeso, ultimo_valido } }.
export function contaValidi(righe, codici, adesso = Date.now()) {
  const risultato = {};
  for (const c of codici) {
    risultato[c] = { validi: 0, confermati_7_giorni: 0, esclusi_usa_e_getta: 0, esclusi_gia_in_lista: 0, sospeso: false, ultimo_valido: null };
  }
  if (!codici.size) return risultato;
  const ordinate = [...righe].sort((a, b) => ms(a.consenso_il) - ms(b.consenso_il));
  const viste = new Set();
  const orari = {};
  for (const r of ordinate) {
    const persona = emailNormalizzata(r.email);
    const prima = !viste.has(persona);
    viste.add(persona);
    const codice = pulisciCodice(r.invito);
    if (!codici.has(codice)) continue;
    const voce = risultato[codice];
    const quando = ms(r.consenso_il);
    (orari[codice] ||= []).push(quando);
    if (usaEGetta(r.email)) { voce.esclusi_usa_e_getta++; continue; }
    if (!prima) { voce.esclusi_gia_in_lista++; continue; }
    voce.validi++;
    if (quando && adesso - quando >= SETTE_GIORNI) voce.confermati_7_giorni++;
    voce.ultimo_valido = quando ? new Date(quando).toISOString().slice(0, 10) : voce.ultimo_valido;
  }
  // Picco: in una qualsiasi finestra di un'ora, più di PICCO_MASSIMO iscrizioni con lo stesso codice (anche quelle escluse).
  for (const [codice, t] of Object.entries(orari)) {
    for (let i = 0, j = 0; j < t.length; j++) {
      while (t[j] - t[i] >= ORA) i++;
      if (j - i + 1 > PICCO_MASSIMO) { risultato[codice].sospeso = true; break; }
    }
  }
  return risultato;
}

export async function perCodiceValidi(env, adesso = Date.now()) {
  const codici = codiciConfigurati(env);
  if (!codici.size || !env.DB) return contaValidi([], codici, adesso);
  try {
    const righe = await env.DB.prepare("SELECT email, invito, consenso_il FROM iscrizioni").all();
    return contaValidi(righe.results || [], codici, adesso);
  } catch {
    return contaValidi([], codici, adesso);
  }
}
