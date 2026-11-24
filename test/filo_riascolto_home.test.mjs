// Il Filo della stanza (issue #360, spec v1 parte 2 punto 8, D151 A): la voce «Il vocale del Filo» nella home, passo
// 10d della linea «sviluppatore-c». In «La tua stanza» aperta, tutta la settimana; stanza chiusa, vuota o in errore:
// niente voce. Controlli sul testo di flusso.js, avvio.js e app.css (aggiunte minime in fondo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("flusso: import, modulo dalle opzioni e voce solo nella stanza aperta", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /import \{ vistaFiloRiascolto \} from "\.\/filo_riascolto\.js";/);
  assert.match(flusso, /filoRiascolto = \(telefono && opzioni\.filoRiascolto\) \|\| null;/);
  assert.match(flusso, /st\.stato === "pronta" && !st\.chiusa && filoRiascolto \? vistaFiloRiascolto\(h, filoRiascolto\) : null,/);
  // La voce sta dopo le chiavi e prima delle schede delle persone.
  const sezione = flusso.slice(flusso.indexOf('h("section", { classe: "tua-stanza"'));
  const chiavi = sezione.indexOf("vistaChiavi(h, chiaviStanza)");
  const voce = sezione.indexOf("vistaFiloRiascolto(h, filoRiascolto)");
  const persone = sezione.indexOf("    contenuto,");
  assert.ok(chiavi > 0 && voce > chiavi && persone > voce, `${chiavi} ${voce} ${persone}`);
  // Quando il modulo cambia, la home si ridisegna (filoCambiato vale anche per la voce).
  assert.match(flusso, /export function filoCambiato\(\) \{\n  if \(!radice \|\| \(!filoLunedi && !filoRiascolto\)/);
});

test("avvio: il modulo nasce col token e ridisegna la home", () => {
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /import \{ creaFiloRiascolto \} from "\/app\/moduli\/filo_riascolto\.js";/);
  assert.match(avvio, /const filoRiascolto = creaFiloRiascolto\(\{ token: \(\) => accesso\.token\(\), fetch: window\.fetch\.bind\(window\), aggiorna: \(\) => filoCambiato\(\) \}\);/);
  assert.match(avvio, /filoDomenica, filoLunedi, filoRiascolto \};/);
});

test("stile: voce con pallino rosso del brand e area di tocco di almeno 44px", () => {
  const css = leggi("../landing/app/app.css");
  assert.match(css, /\.app \.filo-voce \{[^}]*min-height: 44px;/);
  assert.match(css, /\.app \.filo-pallino \{[^}]*background: var\(--rosso\);/);
});
