// Test dell'import dei contatti del modulo Meta (D53 = A). Solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodifica, leggiCsv, prepara, sql, zonaDa, dataConsenso, SORGENTE } from "../scripts/importa_meta.mjs";

const CSV = [
  "id\tcreated_time\tform_name\tis_organic\tplatform\temail\tin_quale_città_vivi?\thai_almeno_18_anni?",
  "l:1\t2026-10-31T10:12:33+0000\tLista\tfalse\tig\tAnna.Prova@Example.com \tMilano\tSì",
  "l:2\t2026-10-31T11:00:00+0000\tLista\tfalse\tfb\tanna.prova@example.com\tMilano\tSì",
  "l:3\t2026-10-31T12:00:00+0000\tLista\tfalse\tfb\tnon-una-email\tRoma\tSì",
  "l:4\t2026-10-31T13:00:00+0000\tLista\tfalse\tfb\tminore@example.com\tRoma\tNo",
  "l:5\t2026-10-31T14:00:00+0000\tLista\tfalse\tfb\t<test lead: dummy data for email>\tRoma\tSì",
  "l:6\t2026-10-31T15:00:00+0000\tLista\tfalse\tfb\to'neil@example.com\tVenezia / Padova\tSì",
  "l:7\t2026-10-31T16:00:00+0000\tLista\tfalse\tfb\tluca@example.com\tLecce\tSì",
].join("\r\n");

test("legge il CSV di Meta in UTF-16 con tabulazioni", () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(CSV, "utf16le")]);
  const righe = leggiCsv(decodifica(utf16));
  assert.equal(righe.length, 7);
  assert.equal(righe[0]["in_quale_città_vivi?"], "Milano");
});

test("legge anche UTF-8 con virgole e virgolette", () => {
  const righe = leggiCsv('﻿email,città,"maggiorenne, conferma"\n"a@example.com","Roma","si"\n');
  assert.deepEqual(righe, [{ email: "a@example.com", "città": "Roma", "maggiorenne, conferma": "si" }]);
});

test("solo email valide, maggiorenni, senza doppioni né contatti di prova", () => {
  const { iscrizioni, riepilogo } = prepara(leggiCsv(CSV));
  assert.deepEqual(iscrizioni.map((i) => i.email), ["anna.prova@example.com", "o'neil@example.com", "luca@example.com"]);
  assert.deepEqual(riepilogo, { righe: 7, da_importare: 3, email_non_valida: 1, prova_meta: 1, senza_18: 1, doppione_nel_file: 1 });
  assert.equal(iscrizioni[0].zona, "milano");
  assert.equal(iscrizioni[1].zona, "venezia-padova");
  assert.equal(iscrizioni[2].zona, "altra-citta-italia");
  assert.equal(iscrizioni[0].consenso_il, "2026-10-31T10:12:33.000Z");
  assert.ok(iscrizioni.every((i) => i.sorgente === SORGENTE && i.versione_informativa === "1.2-2026-10-30"));
});

test("senza conferma dei 18 anni si ferma, salvo dichiarazione obbligatoria nel modulo", () => {
  const righe = [{ email: "a@example.com", city: "Torino", created_time: "" }];
  assert.throws(() => prepara(righe), /18 anni/);
  const { iscrizioni } = prepara(righe, { maggiorenneNelModulo: true, adesso: new Date("2026-11-01T00:00:00Z") });
  assert.deepEqual(iscrizioni[0], { email: "a@example.com", zona: "torino", consenso_il: "2026-11-01T00:00:00.000Z", versione_informativa: "1.2-2026-10-30", sorgente: "meta_modulo" });
  assert.throws(() => prepara([{ telefono: "1" }], { maggiorenneNelModulo: true }), /email/);
});

test("SQL: solo email nuove (ON CONFLICT DO NOTHING) e apici protetti", () => {
  const { iscrizioni } = prepara(leggiCsv(CSV));
  const testo = sql(iscrizioni);
  assert.equal(testo.trim().split("\n").length, 3);
  assert.ok(testo.split("\n").filter(Boolean).every((r) => r.startsWith("INSERT INTO iscrizioni ") && r.endsWith("ON CONFLICT(email) DO NOTHING;")));
  assert.ok(testo.includes("'o''neil@example.com'"));
  assert.ok(!/DROP|DELETE|UPDATE/.test(testo));
  assert.equal(sql([]), "");
});

test("città e date", () => {
  assert.equal(zonaDa("BERGAMO"), "brescia-bergamo");
  assert.equal(zonaDa("vivo all'estero"), "estero");
  assert.equal(zonaDa(""), "altra-citta-italia");
  assert.equal(dataConsenso("2026-10-31T10:12:33+0200"), "2026-10-31T08:12:33.000Z");
});
