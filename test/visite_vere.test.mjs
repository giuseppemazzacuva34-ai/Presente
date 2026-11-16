// Visite vere della home (richiesta del coordinatore 16/11, D137): le aperture di "/" che arrivano da server
// (data center) o da programmi che si fingono browser senza le intestazioni di un browser vero finiscono in
// «automatiche», con il motivo, così la riga «home» conta solo persone. Nessun dato salvato oltre ai totali.
import test from "node:test";
import assert from "node:assert/strict";
import { contaVisitaPagina, perVisite } from "../worker/visite.js";
import { motivoAutomatica } from "../worker/automatiche.js";

const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const IPHONE_IG = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0";
const BROWSER = { "accept-language": "it-IT,it;q=0.9", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

function richiesta(headers, cf) {
  const r = new Request("https://presente.example/", { headers });
  if (cf) Object.defineProperty(r, "cf", { value: cf });
  return r;
}
async function riga(headers, cf) {
  const query = [];
  const DB = { prepare(sql) { const v = { sql, valori: [] }; query.push(v); return { bind(...x) { v.valori = x; return this; }, async run() { return {}; } }; } };
  await contaVisitaPagina(richiesta(headers, cf), { DB });
  const ins = query.find((q) => q.sql.startsWith("INSERT INTO visite_pagina"));
  return { pagina: ins.valori[0], tutto: JSON.stringify(query) };
}

test("telefono vero con le intestazioni del browser: conta in home", async () => {
  assert.equal((await riga({ "user-agent": CHROME_ANDROID, ...BROWSER }, { asn: 1267 })).pagina, "home");
  assert.equal((await riga({ "user-agent": IPHONE_IG, "accept-language": "it-IT" }, { asn: 30722 })).pagina, "home");
});

test("richiesta da un data center (Amazon, Google Cloud, Microsoft, Hetzner...): automatiche:server", async () => {
  for (const asn of [16509, 14618, 15169, 396982, 8075, 24940, 16276, 14061]) {
    assert.equal((await riga({ "user-agent": CHROME_ANDROID, ...BROWSER }, { asn })).pagina, "automatiche:server", `asn ${asn}`);
  }
});

test("iCloud Relay privato e Cloudflare WARP non sono data center: restano persone", async () => {
  for (const asn of [13335, 20940, 16625, 54113, 36183]) {
    assert.equal((await riga({ "user-agent": IPHONE_IG, ...BROWSER }, { asn })).pagina, "home", `asn ${asn}`);
  }
});

test("finto browser senza Accept-Language: automatiche:intestazioni", async () => {
  const { pagina, tutto } = await riga({ "user-agent": CHROME_ANDROID });
  assert.equal(pagina, "automatiche:intestazioni");
  assert.ok(!tutto.includes("Chrome/130"), "lo user agent non si salva");
});

test("finto Chrome senza Sec-Fetch-Mode (Chrome vero lo manda dal 2019): automatiche:intestazioni", async () => {
  assert.equal((await riga({ "user-agent": CHROME_ANDROID, "accept-language": "it" })).pagina, "automatiche:intestazioni");
});

test("Safari/Instagram su iPhone senza Sec-Fetch ma con la lingua: persona (iPhone vecchi non lo mandano)", async () => {
  assert.equal(motivoAutomatica(richiesta({ "user-agent": IPHONE_IG, "accept-language": "it-IT" })), "");
});

test("perVisite: le righe automatiche:<motivo> sommano in automatiche e nel dettaglio dei motivi", async () => {
  const righe = [
    { pagina: "automatiche", giorno: "2026-11-17", sorgente: "", campagna: "", n: 10 },
    { pagina: "automatiche:server", giorno: "2026-11-17", sorgente: "", campagna: "", n: 40 },
    { pagina: "automatiche:intestazioni", giorno: "2026-11-17", sorgente: "", campagna: "", n: 20 },
    { pagina: "home", giorno: "2026-11-17", sorgente: "", campagna: "", n: 5 },
  ];
  const v = await perVisite({ DB: { prepare: () => ({ async all() { return { results: righe }; } }) } });
  assert.equal(v.automatiche, 70);
  assert.deepEqual(v.automatiche_motivi, { robot: 10, server: 40, intestazioni: 20 });
  assert.equal(v.per_giorno["2026-11-17"].automatiche, 70);
  assert.equal(v.home, 5);
});
