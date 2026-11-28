// «Aggiungi al calendario» (issue #6, spec v1 del CPO del 3/11, passo 4 «Confermato»: file .ics senza nome
// dell'altro; criterio «Email e .ics non contengono foto né cognomi»). Linea «sviluppatore-b».
// Il file si costruisce nel telefono dallo stato dell'incontro già letto: nessuna richiesta in più al server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { testoIcs, scaricaIcs, NOME_FILE_ICS, TESTI_CALENDARIO } from "../landing/app/moduli/calendario_incontro.js";

const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ADESSO = new Date("2026-11-28T10:00:00Z");
const base = { porta: PORTA, orario: "2026-12-03T19:30:00Z", luogo: "Bar Centrale · Via Roma 1, Milano" };
const righe = (t) => t.split("\r\n");

test("un evento valido: VCALENDAR/VEVENT, righe con CRLF, ora in UTC, due ore di durata", () => {
  const t = testoIcs(base, ADESSO);
  assert.ok(t.endsWith("\r\n"));
  const r = righe(t);
  assert.equal(r[0], "BEGIN:VCALENDAR");
  assert.ok(r.includes("VERSION:2.0"));
  assert.ok(r.some((x) => x.startsWith("PRODID:")));
  assert.ok(r.includes("BEGIN:VEVENT") && r.includes("END:VEVENT"));
  assert.ok(r.includes("DTSTART:20261203T193000Z"));
  assert.ok(r.includes("DTEND:20261203T213000Z"));
  assert.ok(r.includes("DTSTAMP:20261128T100000Z"));
  assert.ok(r.includes(`UID:incontro-${PORTA}@presenteincontri.app`));
  assert.equal(r.at(-2), "END:VCALENDAR");
});

test("titolo senza nomi, luogo dall'incontro, promemoria 2 ore prima", () => {
  const r = righe(testoIcs(base, ADESSO));
  assert.ok(r.includes(`SUMMARY:${TESTI_CALENDARIO.titolo}`));
  assert.ok(r.includes("LOCATION:Bar Centrale · Via Roma 1\\, Milano"));
  assert.ok(r.includes("BEGIN:VALARM") && r.includes("TRIGGER:-PT2H") && r.includes("ACTION:DISPLAY"));
});

test("il nome dell'altra persona non entra mai nel file, anche se arriva per sbaglio", () => {
  const t = testoIcs({ ...base, nome: "Sara Bianchi", cognome: "Bianchi" }, ADESSO);
  assert.ok(!t.includes("Sara") && !t.includes("Bianchi"));
  assert.ok(!/foto|https?:\/\/[^\s]*\.(jpe?g|png|webp)/i.test(t));
});

test("caratteri speciali del luogo protetti (RFC 5545): virgola, punto e virgola, barra, a capo", () => {
  const r = righe(testoIcs({ ...base, luogo: "Caffè; a\\b, c\nd" }, ADESSO));
  assert.ok(r.includes("LOCATION:Caffè\\; a\\\\b\\, c\\nd"));
});

test("righe lunghe piegate a 75 byte (UTF-8) con spazio all'inizio della continuazione", () => {
  const lungo = "Piazza ".repeat(20) + "è".repeat(30);
  const t = testoIcs({ ...base, luogo: lungo }, ADESSO);
  for (const x of righe(t)) assert.ok(new TextEncoder().encode(x).length <= 75, x);
  const unito = t.replace(/\r\n /g, "");
  assert.ok(unito.includes(`LOCATION:${lungo}`));
});

test("niente file se manca l'ora, se è già passata, se la porta non è un id o il luogo è vuoto", () => {
  assert.equal(testoIcs({ ...base, orario: "" }, ADESSO), null);
  assert.equal(testoIcs({ ...base, orario: "non una data" }, ADESSO), null);
  assert.equal(testoIcs({ ...base, orario: "2026-11-28T09:00:00Z" }, ADESSO), null);
  assert.equal(testoIcs({ ...base, porta: "x" }, ADESSO), null);
  assert.equal(testoIcs({ ...base, luogo: "  " }, ADESSO), null);
  assert.equal(testoIcs(null, ADESSO), null);
});

test("scaricaIcs: crea un link di download .ics, lo clicca e libera l'URL", () => {
  const fatti = [];
  const a = { click: () => fatti.push(["click", a.href, a.download]), remove: () => fatti.push(["remove"]) };
  const doc = { createElement: (t) => (assert.equal(t, "a"), a), body: { append: (x) => fatti.push(["append", x === a]) } };
  const url = { createObjectURL: (b) => (fatti.push(["blob", b.type]), "blob:finto"), revokeObjectURL: (u) => fatti.push(["revoke", u]) };
  assert.equal(scaricaIcs("BEGIN:VCALENDAR\r\n", { document: doc, URL: url, Blob, aspetta: (f) => f() }), true);
  assert.deepEqual(fatti, [["blob", "text/calendar;charset=utf-8"], ["append", true], ["click", "blob:finto", NOME_FILE_ICS], ["remove"], ["revoke", "blob:finto"]]);
  assert.ok(NOME_FILE_ICS.endsWith(".ics") && !/[A-Z ]/.test(NOME_FILE_ICS));
});

test("scaricaIcs senza testo o se il browser non ce la fa: false, nessun errore", () => {
  assert.equal(scaricaIcs(null, {}), false);
  assert.equal(scaricaIcs("x", { document: null, URL: null, Blob }), false);
  const rotto = { createObjectURL: () => { throw new Error("no"); }, revokeObjectURL: () => {} };
  assert.equal(scaricaIcs("x", { document: { createElement: () => ({}), body: { append() {} } }, URL: rotto, Blob, aspetta: (f) => f() }), false);
});
