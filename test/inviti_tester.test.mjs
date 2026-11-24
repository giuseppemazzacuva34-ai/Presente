// Codici d'invito del test interno (issue #8, spec v1 del CPO; D154 = B, Giuseppe 24/11).
// Passo 1: regole pure del codice. Ogni codice è casuale, si usa una sola volta e scade il 29/11 alle 23:59 (ora di Roma).
// Nel database finisce solo l'impronta SHA-256 del codice, mai il codice. Con ACCESSO_APP = «tester» passa chi è in
// EMAIL_TESTER oppure chi ha usato un invito (segno «tester_invito» nell'app_metadata, scritto solo dal server).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generaCodiceInvito, formatoInvito, pulisciInvito, improntaInvito, invitoScaduto, SCADENZA_INVITI, LUNGHEZZA_INVITO,
} from "../worker/inviti_tester.js";
import { personaAmmessa } from "../worker/accesso_tester.js";

test("il codice ha 10 simboli leggibili (senza 0, O, 1, I) e rispetta il formato", () => {
  assert.equal(LUNGHEZZA_INVITO, 10);
  for (let i = 0; i < 200; i++) {
    const c = generaCodiceInvito();
    assert.match(c, /^[A-HJ-NP-Z2-9]{10}$/);
    assert.equal(formatoInvito(c), true);
  }
});

test("il codice viene dal generatore crittografico: stessi byte, stesso codice", () => {
  const byte = () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 31]);
  assert.equal(generaCodiceInvito(byte), "ABCDEFGHJ9");
  const alto = () => new Uint8Array(10).fill(255);
  assert.equal(generaCodiceInvito(alto), "9999999999");
});

test("200 codici di fila sono tutti diversi", () => {
  const visti = new Set(Array.from({ length: 200 }, () => generaCodiceInvito()));
  assert.equal(visti.size, 200);
});

test("pulisciInvito toglie spazi e trattini, porta in maiuscolo, tronca a 10", () => {
  assert.equal(pulisciInvito(" abcd-efgh 23 "), "ABCDEFGH23");
  assert.equal(pulisciInvito("ABCDEFGH23XYZ"), "ABCDEFGH23");
  assert.equal(pulisciInvito(null), "");
  assert.equal(pulisciInvito("<script>"), "SCRIPT");
});

test("formati non validi: lunghezza sbagliata, simboli confondibili, vuoto", () => {
  for (const c of ["", "ABC", "ABCDEFGH2", "ABCDEFGH234", "ABCDEFGH20", "ABCDEFGHO2", "ABCDEFGH1A", "ABCDEFGHIA", "abcdefgh23", null, 12345])
    assert.equal(formatoInvito(c), false, String(c));
});

test("l'impronta è SHA-256 in esadecimale, sempre uguale per lo stesso codice e non contiene il codice", async () => {
  const a = await improntaInvito("ABCDEFGH23");
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, await improntaInvito("ABCDEFGH23"));
  assert.notEqual(a, await improntaInvito("ABCDEFGH24"));
  assert.equal(a.includes("ABCDEFGH23"), false);
  // valore noto: sha256("ABCDEFGH23")
  const atteso = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ABCDEFGH23"))).toString("hex");
  assert.equal(a, atteso);
});

test("l'impronta rifiuta i codici fuori formato (niente impronte di testo libero)", async () => {
  await assert.rejects(() => improntaInvito("ciao"));
});

test("scadenza: 29/11/2026 23:59:59 ora di Roma (22:59:59 UTC); dalla mezzanotte il codice non vale più", () => {
  assert.equal(new Date(SCADENZA_INVITI).toISOString(), "2026-11-29T22:59:59.999Z");
  assert.equal(invitoScaduto(Date.parse("2026-11-24T12:00:00Z")), false);
  assert.equal(invitoScaduto(Date.parse("2026-11-29T22:59:59Z")), false);
  assert.equal(invitoScaduto(Date.parse("2026-11-29T23:00:00Z")), true);
  assert.equal(invitoScaduto(Date.parse("2026-12-06T09:00:00Z")), true);
});

const TESTER = { ACCESSO_APP: "tester", EMAIL_TESTER: "giuseppe@example.com" };

test("con «tester» passa anche chi ha usato un invito (app_metadata.tester_invito, email confermata)", () => {
  const persona = { email: "invitata@example.com", email_confirmed_at: "2026-11-26T10:00:00Z", app_metadata: { tester_invito: true } };
  assert.equal(personaAmmessa(TESTER, persona), true);
});

test("il segno dell'invito vale solo nell'app_metadata (scritto dal server), mai nello user_metadata", () => {
  const persona = { email: "furbo@example.com", email_confirmed_at: "2026-11-26T10:00:00Z", user_metadata: { tester_invito: true }, app_metadata: {} };
  assert.equal(personaAmmessa(TESTER, persona), false);
});

test("il segno dell'invito deve essere proprio true (non «si», non 1) e serve l'email confermata", () => {
  const base = { email: "x@example.com", email_confirmed_at: "2026-11-26T10:00:00Z" };
  assert.equal(personaAmmessa(TESTER, { ...base, app_metadata: { tester_invito: "si" } }), false);
  assert.equal(personaAmmessa(TESTER, { ...base, app_metadata: { tester_invito: 1 } }), false);
  assert.equal(personaAmmessa(TESTER, { email: "x@example.com", app_metadata: { tester_invito: true } }), false);
});

test("con «no» l'invito non apre niente; con «si» resta tutto come prima", () => {
  const persona = { email: "invitata@example.com", email_confirmed_at: "2026-11-26T10:00:00Z", app_metadata: { tester_invito: true } };
  assert.equal(personaAmmessa({ ACCESSO_APP: "no" }, persona), false);
  assert.equal(personaAmmessa({ ACCESSO_APP: "si" }, persona), true);
});

test("EMAIL_TESTER continua a valere per l'accesso di Giuseppe (PR #416)", () => {
  assert.equal(personaAmmessa(TESTER, { email: "giuseppe@example.com", email_confirmed_at: "2026-11-26T10:00:00Z" }), true);
});
