// Correzioni tecniche del controllo del sito del 3/11 (contrasto AA, cache, HSTS, www, accessibilità). Nessun testo cambia.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { conPasso2 } from "../worker/grazie.js";

const leggi = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const css = leggi("landing/stile.css");
const regola = (sel) => (css.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`)) || [])[2] || "";

test("pulsanti rossi con testo scuro (contrasto AA almeno 4,5:1)", () => {
  for (const sel of [".bottone", ".bottone-piccolo", "a.bottone"]) {
    assert.match(regola(sel), /color: var\(--nero\)/, sel);
  }
  for (const sel of [".bottone:hover", ".bottone-piccolo:hover"]) assert.match(regola(sel), /background: #f05a43/, sel);
  assert.doesNotMatch(css, /\.bottone-eroe \{[^}]*#fff/);
  assert.doesNotMatch(css, /\.chiusura \.bottone \{[^}]*#fff/);
  assert.match(regola(".bottone-chiaro"), /color: var\(--avorio\)/);
});

test("note del modulo più scure, casella del consenso da 24 px, schede scorrevoli da tastiera", () => {
  assert.match(regola(".modulo .nota"), /color: #5b5751/);
  assert.match(regola(".spunta input"), /width: 1\.5rem; height: 1\.5rem/);
  assert.match(leggi("landing/index.html"), /<ol class="schede" tabindex="0"/);
});

test("passo 2: il titolo della provincia è l'h1, «Sei in lista» diventa h2", () => {
  const html = leggi("landing/grazie.html");
  const con = conPasso2(html, "0123456789abcdef0123456789abcdef", "", "");
  assert.equal((con.match(/<h1/g) || []).length, 1);
  assert.match(con, /<h1 id="passo2-titolo"[^>]*>Ultimo passo: <em>la tua provincia\?<\/em><\/h1>/);
  assert.match(con, /<h2 class="in-lista">Sei in lista\./);
  const senza = conPasso2(html, "", "", "");
  assert.equal((senza.match(/<h1/g) || []).length, 1);
  assert.match(senza, /<h1 class="in-lista">Sei in lista\./);
});

test("stesso ?v= di stile.css in tutte le pagine e cache lunga per i fogli di stile", () => {
  const pagine = [];
  const giro = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) giro(p); else if (p.endsWith(".html")) pagine.push(p); } };
  giro(new URL("../landing", import.meta.url).pathname);
  const versioni = new Set();
  for (const p of pagine) for (const m of readFileSync(p, "utf8").matchAll(/href="\/stile\.css(\?v=[^"]*)?"/g)) versioni.add(m[1] || "nessuna");
  for (const f of ["worker/dameta.js", "worker/pagina.js"]) for (const m of leggi(f).matchAll(/href="\/stile\.css(\?v=[^"]*)?"/g)) versioni.add(m[1] || "nessuna");
  assert.equal(versioni.size, 1, [...versioni].join(" "));
  assert.notEqual([...versioni][0], "nessuna");
  const intestazioni = leggi("landing/_headers");
  assert.match(intestazioni, /\/\*\.css\n {2}Cache-Control: public, max-age=31536000, immutable/);
  assert.match(intestazioni, /Strict-Transport-Security: max-age=31536000/);
});

test("www porta a presenteincontri.app con 301; workers.dev spento", async () => {
  const { default: worker } = await import("../worker/index.js");
  const r = await worker.fetch(new Request("https://www.presenteincontri.app/grazie?x=1"), {}, {});
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), "https://presenteincontri.app/grazie?x=1");
  assert.match(leggi("wrangler.jsonc"), /"workers_dev": false/);
});

test("carattere Instrument Sans solo larghezza 100% e poster del video alla risoluzione del video", () => {
  assert.doesNotMatch(css, /font-stretch: 75% 100%/);
  const jpg = readFileSync(new URL("../landing/media/presente-v3-leggero-poster.jpg", import.meta.url));
  // dimensioni dal marcatore SOF0 del JPEG
  const i = jpg.indexOf(Buffer.from([0xff, 0xc0]));
  assert.deepEqual([jpg.readUInt16BE(i + 7), jpg.readUInt16BE(i + 5)], [540, 960]);
});
