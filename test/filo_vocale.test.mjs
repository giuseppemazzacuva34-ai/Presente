// Caricamento del vocale del Filo (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 4a della linea «sviluppatore-c».
// La logica lato server (api/filo_vocale.js) con dipendenze finte: nessuna rete.
// Ordine: controllo dei dati → la stanza è del Filo? → file nel contenitore privato → salva_vocale_filo (orari e
// durate li decide il database) → cancella il file vecchio. Se il database rifiuta, il file nuovo si cancella.
import { test } from "node:test";
import assert from "node:assert/strict";
import { caricaVocaleFilo, ESTENSIONI_AUDIO, MAX_BYTE_VOCALE } from "../api/filo_vocale.js";

const FILO = "11111111-2222-4333-8444-555555555555";
const STANZA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORA = "2026-11-30T06:00:00.000Z";
const BASE = { filo: FILO, stanza: STANZA, tipo: "lunedi", durata: 45, testo: "Ciao a tutti, sono il Filo.",
  audio: { tipo: "audio/webm;codecs=opus", byte: 30000 }, ora: ORA };

function dipendenze({ stanze = [{ id: STANZA }], carica = true, salva = null, cancella = true } = {}) {
  const fatto = { carica: [], salva: [], cancella: [] };
  return {
    fatto,
    d: {
      stanze: async (a) => { fatto.stanze = a; return stanze; },
      carica: async (a) => { fatto.carica.push(a); return carica; },
      salva: async (a) => { fatto.salva.push(a); return typeof salva === "function" ? salva(a) : salva; },
      cancella: async (p) => { fatto.cancella.push(p); return cancella; },
    },
  };
}

test("limiti: 2 MB come il contenitore, solo i cinque formati audio", () => {
  assert.equal(MAX_BYTE_VOCALE, 2097152);
  assert.deepEqual(Object.keys(ESTENSIONI_AUDIO), ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac"]);
});

test("tutto giusto: file in <stanza>/<nome casuale>.webm, poi salva_vocale_filo con lo stesso nome", async () => {
  const { d, fatto } = dipendenze({ salva: { ok: true, vecchio: null } });
  assert.deepEqual(await caricaVocaleFilo(BASE, d), { ok: true, tipo: "lunedi", durata: 45 });
  assert.deepEqual(fatto.stanze, { filo: FILO, ora: ORA });
  const [c] = fatto.carica;
  assert.match(c.percorso, new RegExp(`^${STANZA}/[A-Za-z0-9_-]{1,80}\\.webm$`));
  assert.equal(c.tipoAudio, "audio/webm");
  const [s] = fatto.salva;
  assert.deepEqual(s, { filo: FILO, stanza: STANZA, tipo: "lunedi", file: c.percorso.split("/")[1], durata: 45,
    testo: "Ciao a tutti, sono il Filo.", ora: ORA });
  assert.deepEqual(fatto.cancella, []);
});

test("due caricamenti: nomi di file diversi (mai un nome prevedibile)", async () => {
  const { d, fatto } = dipendenze({ salva: { ok: true, vecchio: null } });
  await caricaVocaleFilo(BASE, d);
  await caricaVocaleFilo(BASE, d);
  assert.notEqual(fatto.carica[0].percorso, fatto.carica[1].percorso);
});

test("vocale rifatto: il file sostituito si cancella dal contenitore", async () => {
  const vecchio = `${STANZA}/vecchio.webm`;
  const { d, fatto } = dipendenze({ salva: { ok: true, vecchio } });
  assert.equal((await caricaVocaleFilo(BASE, d)).ok, true);
  assert.deepEqual(fatto.cancella, [[vecchio]]);
});

test("stanza che non è del Filo: niente file, niente database", async () => {
  const { d, fatto } = dipendenze({ stanze: [{ id: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee" }] });
  assert.deepEqual(await caricaVocaleFilo(BASE, d), { ok: false, motivo: "non_filo" });
  assert.equal(fatto.carica.length + fatto.salva.length, 0);
});

test("il database rifiuta (fuori orario, durata…): il file nuovo si cancella e il motivo arriva al telefono", async () => {
  for (const motivo of ["fuori_orario", "durata", "testo", "non_filo"]) {
    const { d, fatto } = dipendenze({ salva: { ok: false, motivo } });
    assert.deepEqual(await caricaVocaleFilo(BASE, d), { ok: false, motivo });
    assert.deepEqual(fatto.cancella, [[fatto.carica[0].percorso]]);
  }
});

test("errori di rete: «riprova»; se il database non risponde il file nuovo si cancella", async () => {
  let x = dipendenze({ stanze: null });
  assert.deepEqual(await caricaVocaleFilo(BASE, x.d), { ok: false, motivo: "riprova" });
  x = dipendenze({ carica: false });
  assert.deepEqual(await caricaVocaleFilo(BASE, x.d), { ok: false, motivo: "riprova" });
  assert.equal(x.fatto.salva.length, 0);
  x = dipendenze({ salva: null });
  assert.deepEqual(await caricaVocaleFilo(BASE, x.d), { ok: false, motivo: "riprova" });
  assert.equal(x.fatto.cancella.length, 1);
});

test("dati sbagliati: «dati», nessuna chiamata", async () => {
  const sbagliati = [
    { filo: "x" }, { stanza: "x" }, { tipo: "sabato" }, { durata: 9 }, { durata: 91 }, { durata: 45.5 },
    { tipo: "domenica", durata: 61 }, { testo: "   " }, { testo: "a".repeat(901) }, { testo: 3 },
    { audio: { tipo: "video/mp4", byte: 100 } }, { audio: { tipo: "audio/webm", byte: 0 } },
    { audio: { tipo: "audio/webm", byte: 2097153 } }, { audio: null }, { ora: "ieri" },
  ];
  for (const s of sbagliati) {
    const { d, fatto } = dipendenze();
    assert.deepEqual(await caricaVocaleFilo({ ...BASE, ...s }, d), { ok: false, motivo: "dati" }, JSON.stringify(s));
    assert.equal(fatto.carica.length + fatto.salva.length, 0);
  }
});

test("domenica fino a 60 secondi; estensione dal formato (mp4 → m4a)", async () => {
  const { d, fatto } = dipendenze({ salva: { ok: true, vecchio: null } });
  const r = await caricaVocaleFilo({ ...BASE, tipo: "domenica", durata: 60, audio: { tipo: "audio/mp4", byte: 10 } }, d);
  assert.deepEqual(r, { ok: true, tipo: "domenica", durata: 60 });
  assert.match(fatto.carica[0].percorso, /\.m4a$/);
});
