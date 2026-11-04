// Pulizia dei gettoni scaduti (informativa 1.5, richiesta CISO del 3/11): nel lavoro orario. Solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pulisciGettoniScaduti } from "../worker/gettoni.js";

function dbFinto(righe) {
  const query = [];
  return {
    righe, query,
    prepare(sql) {
      const stmt = { args: [], bind(...a) { this.args = a; return this; } };
      stmt.run = async () => {
        query.push(sql);
        if (/^UPDATE iscrizioni SET gettone = NULL, gettone_scade = NULL WHERE gettone_scade < \?$/.test(sql)) {
          let n = 0;
          for (const r of righe) if (r.gettone_scade !== null && r.gettone_scade < stmt.args[0]) { r.gettone = null; r.gettone_scade = null; n++; }
          return { meta: { changes: n } };
        }
        return { meta: { changes: 0 } };
      };
      stmt.all = async () => ({ results: [] });
      return stmt;
    },
  };
}

test("toglie solo i gettoni scaduti, con il filtro sulla scadenza", async () => {
  const ora = new Date("2026-11-04T22:00:00Z");
  const db = dbFinto([
    { id: 1, gettone: "aaa", gettone_scade: "2026-11-04T21:00:00.000Z" },
    { id: 2, gettone: "bbb", gettone_scade: "2026-11-04T23:00:00.000Z" },
    { id: 3, gettone: null, gettone_scade: null },
  ]);
  const n = await pulisciGettoniScaduti({ DB: db }, ora);
  assert.equal(n, 1);
  assert.equal(db.righe[0].gettone, null);
  assert.equal(db.righe[1].gettone, "bbb");
  assert.ok(db.query.every((q) => /WHERE gettone_scade < \?/.test(q)), "mai un UPDATE senza filtro");
});

test("senza database o con errore non lancia eccezioni", async () => {
  assert.equal(await pulisciGettoniScaduti({}), 0);
  const rotto = { prepare() { return { bind() { return this; }, run: async () => { throw new Error("giù"); } }; } };
  assert.equal(await pulisciGettoniScaduti({ DB: rotto }), 0);
});

test("il lavoro orario del Worker pulisce anche i gettoni", async () => {
  const { default: worker } = await import("../worker/index.js");
  const db = dbFinto([{ id: 9, gettone: "ccc", gettone_scade: "2000-01-01T00:00:00.000Z", codice: "ABCDEF" }]);
  const attese = [];
  await worker.scheduled({ cron: "23 * * * *" }, { DB: db }, { waitUntil: (p) => attese.push(p) });
  await Promise.all(attese);
  assert.equal(db.righe[0].gettone, null);
});
