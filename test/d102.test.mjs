// D102 A (Giuseppe, 3/11): prima schermata più pulita e ringraziamento con solo provincia + WhatsApp. Solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { conNumeri } from "../worker/numeri.js";
import { conPasso2, htmlInvito } from "../worker/grazie.js";

const leggi = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const home = leggi("landing/index.html");
const grazie = leggi("landing/grazie.html");
const eroe = home.slice(home.indexOf('<section class="eroe"'), home.indexOf("</section>", home.indexOf('<section class="eroe"')));

test("titolo nuovo e sottotitolo in corsivo", () => {
  assert.match(home, /<h1 id="titolo">Le app di incontri ti hanno stancata\? <em>Qui ci si sceglie a voce\.<\/em><\/h1>/);
  assert.match(eroe, /<p class="sottotitolo"><em>Prima la voce\. Poi il resto\.<\/em><\/p>/);
});

test("in testata un link di testo, nella prima schermata un solo pulsante", () => {
  const testata = home.slice(home.indexOf('<header class="testata">'), home.indexOf("</header>"));
  assert.doesNotMatch(testata, /class="bottone/);
  assert.match(testata, /<a class="link-testata" href="#iscriviti">Iscriviti<\/a>/);
  assert.equal((eroe.match(/class="bottone"/g) || []).length, 1);
});

test("prima schermata: niente crediti né regalo; soglia 36 e tre rassicurazioni vicino al pulsante", () => {
  assert.doesNotMatch(eroe, /crediti|In regalo subito|30 domande/);
  const dopo = eroe.slice(eroe.indexOf('<button class="bottone"'));
  assert.match(dopo, /La tua città si accende a 36 iscritti\./);
  assert.equal((dopo.match(/<li>/g) || []).length, 3);
  assert.match(dopo, /foto/);
  assert.match(dopo, /locale consigliato/);
  assert.doesNotMatch(home, /niente foto|app gratis/i);
});

test("numeri: in alto solo «N persone già in lista», i 9 crediti nella domanda «Quanto costa?»", () => {
  const numeri = { totale: 59, citta: {} };
  const html = conNumeri(home, numeri, { MOSTRA_POSTI: "si" });
  const alto = html.slice(html.indexOf('<section class="eroe"'), html.indexOf("<form"));
  assert.match(alto, /<strong>59<\/strong> persone già in lista\./);
  assert.doesNotMatch(alto, /crediti|Restano/);
  const costa = html.slice(html.indexOf("<summary>Quanto costa?</summary>"), html.indexOf("</details>", html.indexOf("<summary>Quanto costa?</summary>")));
  assert.match(costa, /I primi 150 iscritti hanno 9 crediti in regalo, una stanza in più, al primo acquisto\. Restano <strong>91<\/strong> posti\./);
  assert.match(costa, /Crediti non convertibili in denaro\./);
  // con i posti spenti resta la prova sociale, niente crediti
  const spento = conNumeri(home, numeri, { MOSTRA_POSTI: "no" });
  assert.match(spento, /<strong>59<\/strong> persone già in lista\./);
  assert.doesNotMatch(spento, /9 crediti/);
});

test("/grazie: solo provincia (e chi ti ha invitato), niente domande facoltative né altri link", () => {
  assert.doesNotMatch(grazie, /name="presento"|name="cerchi"|name="fascia"|consenso-cerchi/);
  assert.doesNotMatch(grazie, /t\.me\/|href="\/segui"|social-link|instagram\.com|tiktok\.com|facebook\.com/);
  assert.match(grazie, /<select id="zona" name="zona" required/);
  const pulsanti = grazie.match(/class="bottone[^"]*"/g) || [];
  // «Fatto» del passo 2 + l'unico invito WhatsApp
  assert.equal(pulsanti.length, 2, pulsanti.join(" "));
  assert.match(grazie, />Invita un'amica su WhatsApp<\/a>/);
  assert.match(grazie, /In regalo subito: 30 domande per non annoiarsi mai al primo appuntamento/);
});

test("link personale: un solo pulsante WhatsApp", () => {
  const h = htmlInvito("https://presenteincontri.app/da/amico?invito=ABCDEF", "Roma");
  assert.equal((h.match(/class="bottone/g) || []).length, 1);
  assert.match(h, />Invita un'amica su WhatsApp<\/a>/);
  assert.doesNotMatch(h, /t\.me/);
  assert.match(decodeURIComponent(h.match(/wa\.me\/\?text=([^"]+)/)[1]), /invito=ABCDEF/);
});

test("passo 2 ancora valido senza le domande facoltative", () => {
  const con = conPasso2(grazie, "0123456789abcdef0123456789abcdef", "", "");
  assert.match(con, /name="t" value="0123456789abcdef0123456789abcdef"/);
});
