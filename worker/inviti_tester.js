// Codici d'invito del test interno (issue #8, spec v1 del CPO del 6/11; D154 = B, deciso da Giuseppe il 24/11).
// I 20 tester entrano con un link personale che porta un codice: si usa una sola volta e scade il 29/11 alle 23:59,
// ora di Roma. EMAIL_TESTER resta solo per l'accesso di Giuseppe (PR #416).
//
// Passo 1 (questo file): le regole pure del codice.
// - 10 simboli dall'alfabeto senza 0/O/1/I (si leggono male): 32^10 ≈ un milione di miliardi di combinazioni.
// - Casuale con crypto.getRandomValues (mai Math.random). 256 è multiplo di 32: nessun simbolo è favorito.
// - Nel database va solo l'impronta SHA-256 del codice (tabella inviti_tester): chi legge il database non ha i codici.
// - Chi usa un invito riceve dal server il segno app_metadata.tester_invito = true (vedi personaAmmessa in
//   accesso_tester.js). L'app_metadata lo scrive solo la chiave del server; lo user_metadata non conta.
import { ALFABETO_CODICE } from "./invito.js";

export const LUNGHEZZA_INVITO = 10;
const FORMATO = /^[A-HJ-NP-Z2-9]{10}$/;

// 29/11/2026 23:59:59,999 a Roma (ora solare, UTC+1) = 22:59:59,999 UTC. Uguale alla colonna «scade» del database.
export const SCADENZA_INVITI = Date.UTC(2026, 10, 29, 22, 59, 59, 999);

export function generaCodiceInvito(casuale = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return Array.from(casuale(LUNGHEZZA_INVITO), (b) => ALFABETO_CODICE[b % 32]).join("");
}

// Dal link o da quello che la persona scrive: solo lettere e numeri, maiuscolo, al massimo 10 simboli.
export function pulisciInvito(valore) {
  return String(valore ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, LUNGHEZZA_INVITO);
}

export function formatoInvito(codice) {
  return typeof codice === "string" && FORMATO.test(codice);
}

export async function improntaInvito(codice) {
  if (!formatoInvito(codice)) throw new Error("codice d'invito fuori formato");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codice));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function invitoScaduto(ora = Date.now()) {
  return ora > SCADENZA_INVITI;
}
