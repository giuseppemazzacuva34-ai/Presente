// Codice invito personale per OGNI iscritto (D98 A): chi è arrivato dal modulo Meta non l'aveva. Solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assegnaCodiciMancanti } from "../worker/codici_mancanti.js";
import { CODICE_PERSONALE } from "../worker/invito.js";

// D1 finto: righe in memoria, indice unico sul codice come quello vero.
function dbFinto(righe) {
  const query = [];
  return {
    righe, query,
    prepare(sql) {
      const stmt = { args: [], bind(...a) { this.args = a; return this; } };
      stmt.all = async () => {
        query.push(sql);
        if (/SELECT id FROM iscrizioni WHERE codice IS NULL/.test(sql)) return { results: righe.filter((r) => !r.codice).slice(0, 500).map((r) => ({ id: r.id })) };
        return { results: [] };
      };
      stmt.run = async () => {
        query.push(sql);
        if (/^UPDATE iscrizioni SET codice/.test(sql)) {
          const [codice, id] = stmt.args;
          if (righe.some((r) => r.codice === codice)) throw new Error("D1_ERROR: UNIQUE constraint failed: iscrizioni.codice");
          const r = righe.find((x) => x.id === id && !x.codice);
          if (r) r.codice = codice;
          return { meta: { changes: r ? 1 : 0 } };
        }
        return { meta: { changes: 0 } };
      };
      return stmt;
    },
  };
}

test("dà un codice a chi non ce l'ha e non tocca chi ce l'ha già", async () => {
  const db = dbFinto([{ id: 1, codice: "ABCDEF" }, { id: 2, codice: null }, { id: 3, codice: null }]);
  const n = await assegnaCodiciMancanti({ DB: db, CODICI_INVITO: "" });
  assert.equal(n, 2);
  assert.equal(db.righe[0].codice, "ABCDEF");
  for (const r of db.righe) assert.match(r.codice, CODICE_PERSONALE);
  assert.notEqual(db.righe[1].codice, db.righe[2].codice);
  // l'aggiornamento tocca solo righe ancora senza codice
  assert.ok(db.query.some((q) => /WHERE id = \? AND codice IS NULL/.test(q)));
});

test("collisione con un codice esistente: ne genera un altro", async () => {
  const db = dbFinto([{ id: 1, codice: "AAAAAA" }, { id: 2, codice: null }]);
  const sequenza = ["AAAAAA", "BBBBBB"];
  const n = await assegnaCodiciMancanti({ DB: db }, () => sequenza.shift());
  assert.equal(n, 1);
  assert.equal(db.righe[1].codice, "BBBBBB");
});

test("mai uguale a un codice delle presentatrici", async () => {
  const db = dbFinto([{ id: 1, codice: null }]);
  const sequenza = ["ROMA22", "CCCCCC"];
  await assegnaCodiciMancanti({ DB: db, CODICI_INVITO: "ROMA22" }, () => sequenza.shift());
  assert.equal(db.righe[0].codice, "CCCCCC");
});

test("senza database o con errore non lancia eccezioni", async () => {
  assert.equal(await assegnaCodiciMancanti({}), 0);
  const rotto = { prepare() { return { bind() { return this; }, all: async () => { throw new Error("giù"); }, run: async () => ({}) }; } };
  assert.equal(await assegnaCodiciMancanti({ DB: rotto }), 0);
});

test("nessuna query con le email nel codice del Worker (CISO 3/11, D107)", async () => {
  const modulo = await import("../worker/codici_mancanti.js");
  assert.equal(modulo.QUERY_LINK_PERSONALI, undefined);
});

test("il Worker ha il lavoro programmato e il cron in wrangler.jsonc", async () => {
  const { default: worker } = await import("../worker/index.js");
  assert.equal(typeof worker.scheduled, "function");
  const db = dbFinto([{ id: 7, codice: null }]);
  const attese = [];
  await worker.scheduled({ cron: "23 * * * *" }, { DB: db }, { waitUntil: (p) => attese.push(p) });
  await Promise.all(attese);
  assert.match(db.righe[0].codice, CODICE_PERSONALE);
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"), /"crons":\s*\[\s*"23 \* \* \* \*"\s*\]/);
});
