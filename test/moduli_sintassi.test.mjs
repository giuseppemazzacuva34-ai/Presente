// Ogni file JavaScript della web app e della landing deve essere un modulo valido per il browser.
// Perché: un nome dichiarato due volte in flusso.js (import di «contatore» da aiuto.js e un «const contatore») faceva
// fallire l'intero modulo nel browser, e l'app restava bianca, mentre i test con node --test passavano perché
// flusso.js non si importa fuori dal browser. Qui ogni file si controlla come modulo ES, senza eseguirlo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const radice = new URL("../landing/", import.meta.url).pathname;
function fileJs(cartella, out = []) {
  for (const nome of readdirSync(cartella)) {
    const p = path.join(cartella, nome);
    if (statSync(p).isDirectory()) fileJs(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

const tutti = fileJs(radice);

test("ci sono i moduli della web app da controllare", () => {
  assert.ok(tutti.some((p) => p.endsWith(path.join("app", "moduli", "flusso.js"))));
  assert.ok(tutti.some((p) => p.endsWith(path.join("app", "avvio.js"))));
});

for (const p of tutti) {
  test(`modulo valido: ${path.relative(radice, p)}`, () => {
    const r = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: readFileSync(p), encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr.split("\n").slice(0, 5).join("\n"));
  });
}
