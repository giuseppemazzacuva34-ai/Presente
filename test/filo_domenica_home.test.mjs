// Il Filo della stanza (issue #360, spec v1.1 parte 3, D151 A): la schermata 36 nella home, passo 7b della linea
// «sviluppatore-c». Prima della sera delle porte (#5) compare la schermata 36; «Scopri la tua sera» porta alla sera
// invariata, con le sue porte che si aprono. Il lettore resta lo stesso tra un ridisegno e l'altro e, se il link
// firmato è scaduto, se ne chiede uno nuovo. h finto, rete finta, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaFiloDomenica, vistaFiloDomenica, vistaSeraFilo } from "../landing/app/moduli/filo_domenica.js";
import { creaChiaviStanza, vistaSera } from "../landing/app/moduli/chiavi_stanza.js";

const leggi = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const STANZA = "11111111-2222-4333-8444-555555555555";
const VOCALE = { url: "https://esempio.supabase.co/primo", durata: 48, testo: "Ciao a tutti.", filo: "Valentina", scade_tra: 300 };
const PORTE = "/app/api/filo/porte";
const ASCOLTA = "/app/api/filo/ascolta?tipo=domenica";
const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };
const bottone = (n, t) => tutti(n, (x) => x.tag === "button" && testo(x) === t)[0];

function rete(risposte) {
  const chiamate = [];
  const f = async (url) => {
    chiamate.push(url);
    const coda = risposte[url];
    const r = (Array.isArray(coda) ? (coda.length > 1 ? coda.shift() : coda[0]) : coda) ?? { status: 500, body: {} };
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  return { f, chiamate };
}
const conNumero = (n, vocale = VOCALE) => ({ [PORTE]: { status: 200, body: { ok: true, porte: { stanza: STANZA, numero: n } } },
  [ASCOLTA]: [{ status: 200, body: { ok: true, vocale } }] });

const senzaPorte = { ok: true, stato: "pronta", porte: [], testo: "Stasera nessuna porta si è aperta. Lunedì alle 9 apre una nuova stanza." };
function chiavi(sera) {
  return { async leggi() { return { ok: true, stato: { stanza: false } }; }, async sera() { return sera; } };
}
function orologio() {
  const coda = [];
  return { coda, dopo: (fn, ms) => { coda.push({ fn, ms }); } };
}

test("modello: «letto» diventa vero quando la lettura è finita, con o senza schermata", async () => {
  const { f } = rete({ [PORTE]: { status: 200, body: { ok: true, porte: null } } });
  const fd = creaFiloDomenica({ token: () => "tok", fetch: f });
  assert.equal(fd.modello().letto, false);
  await fd.prepara();
  assert.equal(fd.modello().letto, true);
  const vuoto = creaFiloDomenica({ token: () => null, fetch: f });
  await vuoto.prepara();
  assert.equal(vuoto.modello().letto, true);
});

test("il lettore è lo stesso tra due ridisegni (la voce non si interrompe)", async () => {
  const fd = creaFiloDomenica({ token: () => "tok", fetch: rete(conNumero(2)).f });
  await fd.prepara();
  const a1 = tutti(vistaFiloDomenica(h, fd), (x) => x.tag === "audio")[0];
  const a2 = tutti(vistaFiloDomenica(h, fd), (x) => x.tag === "audio")[0];
  assert.ok(a1);
  assert.equal(a1, a2);
});

test("link scaduto: all'errore del lettore si chiede un link nuovo, al massimo due volte", async () => {
  const r = rete({ [PORTE]: { status: 200, body: { ok: true, porte: { stanza: STANZA, numero: 2 } } },
    [ASCOLTA]: [{ status: 200, body: { ok: true, vocale: VOCALE } },
      { status: 200, body: { ok: true, vocale: { ...VOCALE, url: "https://esempio.supabase.co/secondo" } } }] });
  const fd = creaFiloDomenica({ token: () => "tok", fetch: r.f });
  await fd.prepara();
  const audio = tutti(vistaFiloDomenica(h, fd), (x) => x.tag === "audio")[0];
  await audio.a.onerror();
  assert.equal(audio.src, "https://esempio.supabase.co/secondo");
  await audio.a.onerror();
  await audio.a.onerror();
  assert.equal(r.chiamate.filter((u) => u === ASCOLTA).length, 3, "una lettura iniziale e due rinnovi, non di più");
});

test("prima della sera (o con la sera in attesa) vale la vista di sempre e non si legge niente", async () => {
  const r = rete(conNumero(3));
  const fd = creaFiloDomenica({ token: () => "tok", fetch: r.f });
  const ks = creaChiaviStanza({ chiavi: chiavi({ ok: true, stato: "nessuna" }) });
  await ks.prepara();
  assert.equal(vistaSeraFilo(h, fd, ks, () => "sera"), "sera");
  const ksAttesa = creaChiaviStanza({ chiavi: chiavi({ ok: true, stato: "attesa" }), dopo: () => {} });
  await ksAttesa.prepara();
  assert.equal(vistaSeraFilo(h, fd, ksAttesa, () => "sera"), "sera");
  assert.equal(r.chiamate.length, 0);
  // Senza il modulo del Filo, come oggi.
  assert.equal(vistaSeraFilo(h, null, ks, () => "sera"), "sera");
});

test("di sera: «Un attimo…» mentre legge, poi la schermata 36; senza Filo la sera di sempre", async () => {
  const fd = creaFiloDomenica({ token: () => "tok", fetch: rete(conNumero(1)).f });
  const ks = creaChiaviStanza({ chiavi: chiavi(senzaPorte) });
  await ks.prepara();
  const attesa = vistaSeraFilo(h, fd, ks, () => "sera");
  assert.equal(testo(attesa), "Un attimo…");
  assert.equal(attesa.a.role, "status");
  await fd.prepara();
  const v = vistaSeraFilo(h, fd, ks, () => "sera");
  assert.match(testo(v), /1 porta si è aperta\./);

  const senzaFilo = creaFiloDomenica({ token: () => "tok", fetch: rete({ [PORTE]: { status: 200, body: { ok: true, porte: null } } }).f });
  await senzaFilo.prepara();
  assert.equal(vistaSeraFilo(h, senzaFilo, ks, () => "sera"), "sera");
});

test("«Scopri la tua sera»: la schermata si chiude e la sera parte con le porte che si aprono", async () => {
  const fd = creaFiloDomenica({ token: () => "tok", fetch: rete(conNumero(0, null)).f });
  const o = orologio();
  const ks = creaChiaviStanza({ chiavi: chiavi(senzaPorte), dopo: o.dopo, animazioneMs: 3000 });
  await ks.prepara();
  await fd.prepara();
  // Mentre si guardava la schermata 36 l'animazione della sera è finita da sola.
  await o.coda.find((x) => x.ms === 3000).fn();
  assert.equal(ks.modello().animazione, false);
  bottone(vistaSeraFilo(h, fd, ks, () => vistaSera(h, ks)), "Scopri la tua sera").a.onclick();
  assert.equal(fd.modello().schermata, null);
  assert.equal(ks.modello().animazione, true);
  assert.match(testo(vistaSeraFilo(h, fd, ks, () => vistaSera(h, ks))), /Salta/);
});

test("riavviaAnimazione: con «riduci movimento» (0 ms) l'esito si vede subito; altrimenti 3 secondi", async () => {
  const o = orologio();
  const ks = creaChiaviStanza({ chiavi: chiavi(senzaPorte), dopo: o.dopo, animazioneMs: 0 });
  await ks.prepara();
  ks.riavviaAnimazione();
  assert.equal(ks.modello().animazione, false);
  const o2 = orologio();
  const ks2 = creaChiaviStanza({ chiavi: chiavi(senzaPorte), dopo: o2.dopo, animazioneMs: 3000 });
  await ks2.prepara();
  ks2.saltaAnimazione();
  ks2.riavviaAnimazione();
  assert.equal(ks2.modello().animazione, true);
  const ultimo = o2.coda.filter((x) => x.ms === 3000).at(-1);
  await ultimo.fn();
  assert.equal(ks2.modello().animazione, false);
});

test("flusso e avvio: la schermata 36 prima della sera, aggiunte minime", () => {
  const flusso = leggi("../landing/app/moduli/flusso.js");
  assert.match(flusso, /import \{ vistaSeraFilo \} from "\.\/filo_domenica\.js";/);
  assert.match(flusso, /filoDomenica = \(telefono && opzioni\.filoDomenica\) \|\| null;/);
  assert.match(flusso, /vistaSeraFilo\(h, filoDomenica, chiaviStanza, \(\) => vistaSera\(h, chiaviStanza, \{ svelamento \}\)\)/);
  const avvio = leggi("../landing/app/avvio.js");
  assert.match(avvio, /import \{ creaFiloDomenica \} from "\/app\/moduli\/filo_domenica\.js";/);
  assert.match(avvio, /creaFiloDomenica\(\{ token: \(\) => accesso\.token\(\), fetch: window\.fetch\.bind\(window\), aggiorna: \(\) => chiaviCambiate\(\) \}\)/);
  assert.match(avvio, /regaloRicevuto, filoDomenica[,}\s]/);
});

test("service worker: il modulo del Filo è tra i file dell'app e la versione è cambiata", () => {
  const sw = leggi("../landing/app/sw.js");
  assert.match(sw, /"\/app\/moduli\/filo_domenica\.js"/);
  assert.doesNotMatch(sw, /const VERSIONE = "presente-app-51";/);
});
