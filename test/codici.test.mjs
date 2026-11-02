// Codici delle presentatrici (D88 A): conteggio degli iscritti validi e campo «codice» del modulo Meta. Solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contaValidi, usaEGetta, emailNormalizzata, perCodiceValidi, PICCO_MASSIMO } from "../worker/codici.js";
import { contatto, trovaColonne, codiceDa } from "../worker/contatti_meta.js";
import { importaContatto } from "../worker/meta.js";
import { prepara, sql } from "../scripts/importa_meta.mjs";

const ADESSO = Date.parse("2026-11-20T12:00:00Z");
const codici = new Set(["ROMA01", "MILA01"]);

test("domini usa e getta e alias della stessa email", () => {
  assert.equal(usaEGetta("x@mailinator.com"), true);
  assert.equal(usaEGetta("x@eu.yopmail.com"), true);
  assert.equal(usaEGetta("x@gmail.com"), false);
  assert.equal(usaEGetta("senza-chiocciola"), true);
  assert.equal(emailNormalizzata("Anna.Rossi+1@Gmail.com"), "annarossi@gmail.com");
  assert.equal(emailNormalizzata("anna.rossi+lista@libero.it"), "anna.rossi@libero.it");
});

test("iscritti validi: esclude usa e getta e chi era già in lista, conta i 7 giorni", () => {
  const righe = [
    { email: "anna@libero.it", invito: null, consenso_il: "2026-11-01T10:00:00Z" },
    { email: "anna+2@libero.it", invito: "roma01", consenso_il: "2026-11-05T10:00:00Z" }, // già in lista (alias)
    { email: "bea@gmail.com", invito: "ROMA01", consenso_il: "2026-11-05T11:00:00Z" },
    { email: "carla@yopmail.com", invito: "ROMA01", consenso_il: "2026-11-05T12:00:00Z" },
    { email: "dora@outlook.it", invito: "Roma 01", consenso_il: "2026-11-18T09:00:00Z" },
    { email: "eva@gmail.com", invito: "Giulia", consenso_il: "2026-11-18T09:00:00Z" },
  ];
  const r = contaValidi(righe, codici, ADESSO);
  assert.deepEqual(r.ROMA01, { validi: 2, confermati_7_giorni: 1, esclusi_usa_e_getta: 1, esclusi_gia_in_lista: 1, sospeso: false, ultimo_valido: "2026-11-18" });
  assert.equal(r.MILA01.validi, 0);
  assert.deepEqual(Object.keys(r).sort(), ["MILA01", "ROMA01"]);
  assert.ok(!JSON.stringify(r).includes("@"), "nessuna email nel risultato");
});

test("picco: più di 15 in un'ora con lo stesso codice = sospeso", () => {
  const base = Date.parse("2026-11-10T20:00:00Z");
  const molte = (n, passo) => Array.from({ length: n }, (_, i) => ({ email: `p${i}@example.it`, invito: "MILA01", consenso_il: new Date(base + i * passo).toISOString() }));
  assert.equal(contaValidi(molte(PICCO_MASSIMO + 1, 60 * 1000), codici, ADESSO).MILA01.sospeso, true);
  assert.equal(contaValidi(molte(PICCO_MASSIMO, 60 * 1000), codici, ADESSO).MILA01.sospeso, false);
  assert.equal(contaValidi(molte(PICCO_MASSIMO + 5, 10 * 60 * 1000), codici, ADESSO).MILA01.sospeso, false);
});

test("/conteggio: senza codici configurati nessuna lettura della lista", async () => {
  let letture = 0;
  const DB = { prepare: () => ({ all: async () => { letture++; return { results: [] }; } }) };
  assert.deepEqual(await perCodiceValidi({ DB, CODICI_INVITO: "" }), {});
  assert.equal(letture, 0);
  const r = await perCodiceValidi({ DB, CODICI_INVITO: "roma01" });
  assert.equal(r.ROMA01.validi, 0);
});

test("campo codice del modulo Meta: solo codici delle presentatrici o personali, mai nomi", () => {
  assert.equal(codiceDa(" roma01 ", codici), "ROMA01");
  assert.equal(codiceDa("K7MQ2P", codici), "K7MQ2P");
  assert.equal(codiceDa("Giulia Bianchi", codici), null);
  assert.equal(codiceDa("", codici), null);
  const intest = ["email", "hai_almeno_18_anni?", "codice_invito_(facoltativo)"];
  const col = trovaColonne(intest);
  assert.equal(col.codice, "codice_invito_(facoltativo)");
  const r = { email: "a@example.it", "hai_almeno_18_anni?": "Sì", "codice_invito_(facoltativo)": "mila01" };
  assert.equal(contatto(r, col, { codiciAmmessi: codici }).iscrizione.invito, "MILA01");
  assert.equal(contatto({ ...r, "codice_invito_(facoltativo)": "mia zia" }, col, { codiciAmmessi: codici }).iscrizione.invito, undefined);
});

test("import a mano dal CSV: il codice va nel campo invito", () => {
  const righe = [{ email: "a@example.it", "hai_almeno_18_anni?": "Sì", codice: "ROMA01" }, { email: "b@example.it", "hai_almeno_18_anni?": "Sì", codice: "zia" }];
  const { iscrizioni } = prepara(righe, { codiciAmmessi: codici });
  const testo = sql(iscrizioni);
  assert.match(testo, /'a@example\.it', '[^']*', 'ROMA01'/);
  assert.match(testo, /'b@example\.it', '[^']*', NULL/);
});

test("import diretto da Meta: il codice arriva nella colonna invito", async () => {
  const scritte = [];
  const DB = { prepare: (q) => ({ bind: (...v) => ({ run: async () => { scritte.push({ q, v }); return { meta: { changes: 1 } }; } }) }) };
  const campi = [{ name: "email", values: ["c@example.it"] }, { name: "hai_almeno_18_anni?", values: ["Sì"] }, { name: "codice", values: ["roma01"] }];
  const f = async () => new Response(JSON.stringify({ created_time: "2026-11-02T08:00:00+0000", field_data: campi }));
  const esito = await importaContatto("1", { DB, META_PAGE_TOKEN: "t", CODICI_INVITO: "ROMA01" }, f);
  assert.equal(esito, "meta_nuova");
  assert.equal(scritte[0].v[2], "ROMA01");
});
