// La migrazione delle segnalazioni (issue #7) usa gli stessi motivi e punti di partenza di api/segnalazioni.js,
// e le stesse ore di revisione. Si legge solo il testo della migrazione: nessun database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { MOTIVI, ORIGINI, LIMITI } from "../api/segnalazioni.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_segnalazioni\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const elenco = (nome) => {
  const m = sql.match(new RegExp(`${nome} text not null check \\(${nome} in \\(([^)]*)\\)\\)`));
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : null;
};

test("la migrazione delle segnalazioni esiste", () => assert.ok(file, "manca supabase/migrations/*_segnalazioni.sql"));

test("motivi e punti di partenza uguali a quelli di api/segnalazioni.js", () => {
  assert.deepEqual(elenco("motivo"), Object.keys(MOTIVI));
  assert.deepEqual(elenco("origine"), [...ORIGINI]);
});

test("ore di revisione uguali a quelle di api/segnalazioni.js", () => {
  for (const [motivo, ore] of Object.entries(MOTIVI)) {
    const riga = sql.split("\n").find((r) => r.includes(`'${motivo}'`) && /then\s+\d+/.test(r));
    assert.ok(riga, `manca l'ora di ${motivo}`);
    assert.equal(Number(riga.match(/then\s+(\d+)/)[1]), ore, motivo);
  }
  assert.match(sql, new RegExp(`char_length\\(testo\\) <= ${LIMITI.testoSegnalazione}`));
});

test("regole per riga attive e tabella chiusa al telefono", () => {
  assert.match(sql, /alter table public\.segnalazioni enable row level security/);
  assert.match(sql, /revoke all on public\.segnalazioni from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant [^;]* on public\.segnalazioni to (anon|authenticated)/);
});
