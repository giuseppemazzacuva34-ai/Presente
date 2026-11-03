// SEO v3 (2/11): controlli su indicizzazione, dati strutturati e regole del brand nelle pagine pubbliche.
// Nessuna dipendenza: legge i file di landing/ con espressioni regolari semplici.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { PAGINE_CONTATE } from "../worker/visite.js";

const LANDING = new URL("../landing/", import.meta.url);
const SITO = "https://presenteincontri.app/";
const leggi = (f) => readFileSync(new URL(f, LANDING), "utf8");
const sitemap = leggi("sitemap.xml");
const indirizzi = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const fileDi = (u) => (u === SITO ? "index.html" : u.slice(SITO.length) + ".html");
const testo = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const meta = (html, attr, nome) => (html.match(new RegExp(`<meta ${attr}="${nome}" content="([^"]*)"`)) || [])[1];
const NUOVE = ["/app-incontri-sicura", "/primo-appuntamento", "/ghosting"];

test("la sitemap contiene le pagine utili e nessuna pagina noindex", () => {
  for (const p of ["", "incontri-al-buio", ...NUOVE.map((x) => x.slice(1)), "domande", "guide"]) {
    assert.ok(indirizzi.includes(SITO + p), `manca ${SITO + p} nella sitemap`);
  }
  for (const u of indirizzi) {
    assert.ok(!/\/(grazie|privacy|app|da)(\/|$)/.test(u.slice(SITO.length - 1)), `${u} non va nella sitemap`);
    assert.ok(!u.includes("/incontri-al-buio/"), `${u}: le pagine città sono noindex, fuori dalla sitemap`);
  }
});

test("ogni pagina della sitemap: canonical, titolo e descrizione unici, un solo h1, lang it, indicizzabile", () => {
  const titoli = new Set();
  const descrizioni = new Set();
  for (const u of indirizzi) {
    const f = fileDi(u);
    assert.ok(existsSync(new URL(f, LANDING)), `manca landing/${f}`);
    const html = leggi(f);
    assert.match(html, /<html lang="it">/, `${f}: lang="it"`);
    assert.ok(html.includes(`<link rel="canonical" href="${u}">`), `${f}: canonical diverso da ${u}`);
    assert.ok(!/<meta name="robots" content="[^"]*noindex/.test(html), `${f}: è nella sitemap ma ha noindex`);
    const titolo = (html.match(/<title>([^<]+)<\/title>/) || [])[1];
    const descrizione = meta(html, "name", "description");
    assert.ok(titolo && titolo.length <= 70, `${f}: titolo mancante o troppo lungo (${titolo && titolo.length})`);
    assert.ok(descrizione && descrizione.length >= 70 && descrizione.length <= 160, `${f}: descrizione tra 70 e 160 caratteri (${descrizione && descrizione.length})`);
    assert.ok(!titoli.has(titolo), `${f}: titolo duplicato`);
    assert.ok(!descrizioni.has(descrizione), `${f}: descrizione duplicata`);
    titoli.add(titolo);
    descrizioni.add(descrizione);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, `${f}: serve esattamente un h1`);
    assert.ok(meta(html, "property", "og:url") === u, `${f}: og:url diverso dal canonical`);
  }
});

test("la meta description della home è quella approvata (accorciata a 160 caratteri)", () => {
  assert.equal(meta(leggi("index.html"), "name", "description"),
    "Prima la voce, poi il resto: app di incontri al buio in stanze di 12 persone della tua città. Le tue foto le vede solo chi scegli tu. Lista d'attesa gratis.");
});

test("JSON-LD valido; le FAQPage sono uguali alle domande visibili", () => {
  for (const u of indirizzi) {
    const f = fileDi(u);
    const html = leggi(f);
    const blocchi = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    assert.ok(blocchi.length > 0, `${f}: mancano i dati strutturati`);
    const nodi = blocchi.flatMap((b) => b["@graph"] || [b]);
    for (const n of nodi) {
      assert.ok(!("aggregateRating" in n) && !("review" in n), `${f}: niente valutazioni o recensioni inventate`);
    }
    const faq = nodi.find((n) => n["@type"] === "FAQPage");
    if (!faq) continue;
    const visibili = [...html.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)]
      .map((m) => [testo(m[1]), testo(m[2])]);
    const dati = faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]);
    assert.deepEqual(dati, visibili, `${f}: FAQPage diversa dalle domande visibili`);
  }
});

test("pagine città e pagine di servizio restano fuori dall'indice", () => {
  for (const c of readdirSync(new URL("incontri-al-buio/", LANDING))) {
    assert.match(leggi("incontri-al-buio/" + c), /<meta name="robots" content="noindex, follow">/, `${c}: serve noindex, follow`);
  }
  for (const f of ["grazie.html", "privacy.html", "app/index.html"]) {
    assert.match(leggi(f), /<meta name="robots" content="noindex/, `${f}: serve noindex`);
  }
  assert.match(readFileSync(new URL("../worker/dameta.js", import.meta.url), "utf8"), /"x-robots-tag": "noindex"/);
  assert.match(readFileSync(new URL("../worker/pagina.js", import.meta.url), "utf8"), /<meta name="robots" content="noindex">/);
});

test("robots.txt: non blocca le pagine noindex (altrimenti Google non vede il noindex) né quelle della sitemap", () => {
  const robots = leggi("robots.txt");
  const bloccati = [...robots.matchAll(/^Disallow: (\S+)/gm)].map((m) => m[1]);
  for (const b of bloccati) {
    for (const p of ["/grazie", "/da/meta", "/incontri-al-buio/milano", ...indirizzi.map((u) => u.slice(SITO.length - 1))]) {
      assert.ok(!p.startsWith(b), `robots.txt blocca ${p}`);
    }
  }
  assert.match(robots, /^Sitemap: https:\/\/presenteincontri\.app\/sitemap\.xml$/m);
});

test("regole del brand nelle pagine indicizzabili e in llms.txt", () => {
  // Testo visibile più titolo e descrizioni (anche quelle finiscono nei risultati di ricerca e nelle anteprime).
  const pagine = indirizzi.map((u) => {
    const html = leggi(fileDi(u));
    const metaTesti = [...html.matchAll(/<meta (?:name|property)="(?:description|og:description|og:title|twitter:[a-z]+)" content="([^"]*)"/g)].map((m) => m[1]);
    return [fileDi(u), testo(html.replace(/<script[\s\S]*?<\/script>/g, "")) + " " + metaTesti.join(" ")];
  });
  // In llms.txt la riga «No: ...» spiega proprio cosa NON dire: si controlla il resto.
  pagine.push(["llms.txt", leggi("llms.txt").replace(/^- No:.*$/m, "")]);
  for (const [f, t] of pagine) {
    assert.ok(!/niente foto|senza foto|vetrina di foto/i.test(t), `${f}: mai «niente foto» o «senza foto»`);
    assert.ok(!/prima app (di incontri )?al buio/i.test(t), `${f}: mai «la prima app al buio»`);
    assert.ok(!/gratis per tutti|app gratuita|app (è )?gratis/i.test(t), `${f}: «gratis» solo per la lista d'attesa`);
    assert.ok(!/\b(gennaio|febbraio|dicembre) 202[67]\b/i.test(t), `${f}: nessuna data di lancio`);
    for (const m of t.matchAll(/gratis|gratuit/gi)) {
      const intorno = t.slice(Math.max(0, m.index - 90), m.index + 40).toLowerCase();
      assert.ok(/lista d'attesa|iscriv|lista\./.test(intorno), `${f}: «${t.slice(m.index - 60, m.index + 20)}» usa gratis fuori dalla lista d'attesa`);
    }
  }
});

test("pagine nuove: misura delle visite, CTA alla lista d'attesa e link dal piè di pagina della home", () => {
  const home = leggi("index.html");
  for (const p of NUOVE) {
    const html = leggi(p.slice(1) + ".html");
    assert.ok(PAGINE_CONTATE.has(p), `${p} non è in PAGINE_CONTATE`);
    assert.ok(html.includes(`src="/p.gif?pg=${p}"`), `${p}: manca l'immagine della misura`);
    assert.ok(html.includes(`<a class="bottone" href="/#iscriviti">Iscriviti gratis alla lista d'attesa</a>`), `${p}: manca la CTA`);
    assert.ok(/<footer class="piede">[\s\S]*href="/.test(home) && home.split('<footer class="piede">')[1].includes(`href="${p}"`), `home: manca ${p} nel piè di pagina`);
  }
});

test("i caratteri woff2 esistono e stanno prima dei woff", () => {
  const css = leggi("stile.css");
  for (const f of ["InstrumentSerif-Regular", "InstrumentSerif-Italic", "InstrumentSans"]) {
    assert.ok(existsSync(new URL(`fonts/${f}.woff2`, LANDING)), `manca fonts/${f}.woff2`);
    assert.ok(css.includes(`url("/fonts/${f}.woff2") format("woff2"), url("/fonts/${f}.woff") format("woff")`), `stile.css: ${f} senza woff2`);
  }
});
