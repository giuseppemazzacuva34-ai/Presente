// Design v4 (#349, approvato da Giuseppe il 22/11), schermate 37 «La porta» e 38 «La porta · se sei un uomo».
// Linea «sviluppatore-c», passo 3 (vista e stile). Dietro le ante la sagoma di chi c'è (immagine fissa dell'app, mai
// un volto a fuoco); le ante scorrono una volta sola, morbide; con «riduci movimento» sono già aperte.
// h finto, chiavi finte: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { creaChiaviStanza, vistaSera } from "../landing/app/moduli/chiavi_stanza.js";

const PORTA = "aaaaaaaa-aaaa-4bbb-8ccc-dddddddddddd";
const LEI = "11111111-2222-4333-8444-555555555555";
const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const conClasse = (n, c) => tutti(n, (x) => String(x.a.classe || "").split(" ").includes(c));

async function sera(porte) {
  const c = creaChiaviStanza({ chiavi: { async leggi() { return { ok: true, stato: { stanza: false } }; }, async sera() { return { ok: true, stato: "pronta", porte }; } }, animazioneMs: 0 });
  await c.prepara();
  return c;
}

test("porta v4: immagine della sagoma, due ante decorative, occhiello e titolo in due righe", async () => {
  const c = await sera([{ id: PORTA, con: LEI, nome: "Marco", frase_per_te: "La tua risata mi è rimasta in testa.", sagoma: "uomo" }]);
  const v = vistaSera(h, c, { svelamento: () => {} });
  const p = conClasse(v, "porta-v4")[0];
  assert.ok(p, "una scheda v4 per porta");
  const img = tutti(p, (x) => x.tag === "img")[0];
  assert.equal(img.a.src, "/app/img/porta-uomo-rosa.jpg");
  assert.equal(img.a.alt, "", "decorativa: il nome e la frase sono nel testo");
  assert.equal(img.a.classe, "porta-v4-foto");
  const scena = conClasse(p, "porta-v4-scena")[0];
  assert.equal(scena.a["aria-hidden"], "true", "immagine, luce e ante sono solo decorazione");
  const ante = conClasse(scena, "porta-v4-ante")[0];
  assert.ok(tutti(scena, (x) => x.tag === "img").length === 1);
  assert.equal(conClasse(ante, "porta-v4-anta").length, 2);
  assert.equal(testo(conClasse(p, "passo")[0]), "Domenica · ore 21");
  const h2 = tutti(p, (x) => x.tag === "h2")[0];
  assert.equal(testo(h2), "Una portasi è aperta.");
  assert.equal(testo(tutti(h2, (x) => x.tag === "em")[0]), "si è aperta.");
});

test("porta v4: nome, frase con il testo per il lettore di schermo, «Vai allo svelamento» con la persona", async () => {
  let aperta = null;
  const c = await sera([{ id: PORTA, con: LEI, nome: "Marco", frase_per_te: "La tua risata mi è rimasta in testa.", sagoma: "uomo" }]);
  const v = vistaSera(h, c, { svelamento: (id) => { aperta = id; } });
  assert.equal(testo(conClasse(v, "porta-v4-chi")[0]), "Marco");
  const scritto = conClasse(v, "nascosto")[0];
  assert.equal(testo(scritto), "Marco ti ha scritto:");
  const frase = tutti(v, (x) => x.tag === "blockquote")[0];
  assert.equal(frase.a.classe, "frase");
  assert.equal(testo(frase), "La tua risata mi è rimasta in testa.");
  const b = tutti(v, (x) => x.tag === "button")[0];
  assert.equal(testo(b), "Vai allo svelamento");
  assert.equal(b.a["aria-label"], "Vai allo svelamento con Marco");
  assert.equal(b.a.classe, "bottone");
  b.a.onclick();
  assert.equal(aperta, PORTA);
});

test("porta v4: sagoma donna e neutra; senza frase niente citazione; senza svelamento niente pulsante", async () => {
  const c = await sera([
    { id: PORTA, con: LEI, nome: "Giulia", frase_per_te: null, sagoma: "donna" },
    { id: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee", con: LEI, nome: "Alex", frase_per_te: null, sagoma: "neutra" },
  ]);
  const v = vistaSera(h, c);
  assert.deepEqual(tutti(v, (x) => x.tag === "img").map((x) => x.a.src), ["/app/img/porta-donna-rosa.jpg", "/app/img/porta-calda.jpg"]);
  assert.equal(tutti(v, (x) => x.tag === "blockquote").length, 0);
  assert.equal(tutti(v, (x) => x.tag === "button").length, 0);
});

// ---- file e stile ----
const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");
const regole = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(^|\\n)${esc} \\{([^}]*)\\}`, "g"))].map((m) => m[2]).join(";");
};

test("immagini della porta nell'app, leggere (meno di 150 KB), copiate dal ramo design/app-v4", () => {
  for (const f of ["porta-uomo-rosa.jpg", "porta-donna-rosa.jpg", "porta-calda.jpg"]) {
    const u = new URL(`../landing/app/img/${f}`, import.meta.url);
    assert.ok(existsSync(u), f);
    assert.ok(statSync(u).size < 150 * 1024, f);
  }
});

test("stile: ante che scorrono una volta sola (6 s, morbide), luce che respira, ferme con «riduci movimento»", () => {
  assert.match(regole(".app .porta-v4-anta.sx"), /animation: porta-v4-sx 6s cubic-bezier\(0\.22, 0\.61, 0\.36, 1\) 0\.5s both/);
  assert.match(regole(".app .porta-v4-anta.dx"), /animation: porta-v4-dx 6s cubic-bezier\(0\.22, 0\.61, 0\.36, 1\) 0\.5s both/);
  assert.match(css, /@keyframes porta-v4-sx \{ from \{ transform: translateX\(0\); \} to \{ transform: translateX\(-96%\); \} \}/);
  assert.match(regole(".app .porta-v4-foto"), /object-fit: cover/);
  assert.match(regole(".app .porta-v4-foto"), /filter: blur\(4px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.app \.porta-v4-anta\.sx \{ animation: none; transform: translateX\(-96%\); \} \.app \.porta-v4-anta\.dx \{ animation: none; transform: translateX\(96%\); \} \.app \.porta-v4-luce \{ animation: none; \} \}/);
  assert.match(regole(".app .porta-v4 .frase"), /border-left: 2px solid #E8432B/);
});

// D149 e risposta del CPO del 23/11: «Nome, età · provincia» come nel disegno (Marco, 35 · Milano), gli stessi dati
// della stanza. Senza età o provincia valide si mostra solo quello che c'è.
test("porta v4: «Marco, 35 · Milano»; dati mancanti o strani non si mostrano", async () => {
  const c = await sera([{ id: PORTA, con: LEI, nome: "Marco", frase_per_te: null, sagoma: "uomo", eta: 35, provincia: "Milano" }]);
  const v = vistaSera(h, c, { svelamento: () => {} });
  const chi = conClasse(v, "porta-v4-chi")[0];
  assert.equal(testo(chi), "Marco, 35 · Milano");
  assert.equal(testo(tutti(chi, (x) => x.tag === "strong")[0]), "Marco, 35");
  assert.equal(testo(conClasse(chi, "nota")[0]), " · Milano");
  for (const [eta, provincia, atteso] of [[null, null, "Marco"], [17, "Milano", "Marco · Milano"], ["35", " ", "Marco"],
    [35.5, "x".repeat(61), "Marco"], [120, "Dall'estero", "Marco, 120 · Dall'estero"]]) {
    const d = await sera([{ id: PORTA, con: LEI, nome: "Marco", sagoma: "uomo", eta, provincia }]);
    assert.equal(testo(conClasse(vistaSera(h, d, { svelamento: () => {} }), "porta-v4-chi")[0]), atteso, `${eta} ${provincia}`);
  }
});

test("service worker: versione nuova per età e provincia dietro la porta", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(!sw.includes('"presente-app-45"'));
});
