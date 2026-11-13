// La migrazione delle sospensioni (issue #7) usa gli stessi valori di api/regole.js e api/segnalazioni.js.
// Si legge solo il testo della migrazione: nessun database (i test veri sono in supabase/test/prova_sospensioni.sql).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { MOTIVI_SOSPENSIONE_IMMEDIATA, SEGNALAZIONI } from "../api/regole.js";
import { LIMITI } from "../api/segnalazioni.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_sospensioni\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";

test("la migrazione delle sospensioni esiste", () => assert.ok(file, "manca supabase/migrations/*_sospensioni.sql"));

test("motivi della sospensione cautelare uguali a regole.js (D51 A)", () => {
  const m = sql.match(/new\.motivo in \(([^)]*)\)/);
  assert.ok(m, "manca l'elenco dei motivi cautelari");
  assert.deepEqual([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]), [...MOTIVI_SOSPENSIONE_IMMEDIATA]);
});

test("tempi uguali a regole.js e segnalazioni.js", () => {
  assert.match(sql, new RegExp(`now\\(\\) \\+ interval '${SEGNALAZIONI.revisioneEntroOre} hours'`));
  assert.match(sql, new RegExp(`interval '${SEGNALAZIONI.nuovoAvvisoOgniOre} hours'`));
  assert.match(sql, new RegExp(`interval '${LIMITI.nuovoAvvisoDopoMinuti} minutes'`));
  assert.match(sql, new RegExp(`interval '${LIMITI.finestraAutomaticaGiorni} days'\\) >= ${LIMITI.graviPerSospensioneAutomatica}`));
});

test("regole per riga attive e tabelle chiuse al telefono", () => {
  for (const t of ["sospensioni", "avvisi_sicurezza"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.doesNotMatch(sql, new RegExp(`grant [^;]* on [^;]*public\\.${t}[^;]* to (anon|authenticated)`));
  }
  assert.match(sql, /revoke all on public\.sospensioni, public\.avvisi_sicurezza from public, anon, authenticated/);
});
