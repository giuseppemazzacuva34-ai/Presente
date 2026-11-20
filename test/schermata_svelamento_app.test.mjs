// Svelamento (issue #65, passo 7d-2; D48 A, spec v1 del CPO, passo 6 e casi limite): la schermata del video.
// Si prova con un video finto (collegaVideo finto), un orologio finto e un giro manuale: «Aspettiamo <nome>…»,
// timer dei 10 secondi solo dall'inizio dato dal server, filigrana con il nome di chi guarda, microfono, «Chiudi e
// segnala» che chiude subito, caduta con «Riprova» (2 minuti, massimo 3), «Ecco <nome>.» alla fine.
// Nessuna rete vera, nessun Cloudflare, solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creaSchermataSvelamento, vistaSchermata, TESTI_SCHERMATA, RIPROVA_MS, MAX_RIPROVE } from "../landing/app/moduli/schermata_svelamento.js";
import { collegaVideo } from "../landing/app/moduli/video_svelamento.js";

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testi = (n) => (typeof n === "string" ? [n] : n && n.f ? n.f.flatMap(testi) : []);
const trova = (n, pred) => (!n || typeof n !== "object" ? [] : [...(pred(n) ? [n] : []), ...(n.f || []).flatMap((x) => trova(x, pred))]);
const bottone = (n, testo) => trova(n, (x) => x.tag === "button" && testi(x).join("") === testo)[0];

const INIZIO = 1_000_000;
const VISTA_ATTESA = { fase: "attesa", ora: INIZIO };
const inCorso = (inizio, ora = inizio) => ({ fase: "in_corso", ora, inizio, nitidoDal: inizio + 3000, fine: inizio + 10_000 });

// collegaVideo finto: ogni azione risponde con la prossima risposta in coda (o con quella fissa).
function finto() {
  const chiamate = [];
  const code = { pubblica: [], ricevi: [], vista: [], riprova: [] };
  const fissa = {
    pubblica: { ok: true, vista: VISTA_ATTESA },
    ricevi: { ok: false, motivo: "in_attesa" },
    vista: { ok: true, vista: VISTA_ATTESA },
    riprova: { ok: true, vista: VISTA_ATTESA },
  };
  const r = (nome) => async () => {
    chiamate.push(nome);
    const x = code[nome].length ? code[nome].shift() : fissa[nome];
    return typeof x === "function" ? x() : x;
  };
  const collega = {
    pubblica: r("pubblica"), ricevi: r("ricevi"), vista: r("vista"), riprova: r("riprova"),
    chiudi() { chiamate.push("chiudi"); },
    muto(spento) { chiamate.push(spento ? "muto" : "voce"); },
  };
  return { collega, chiamate, code, fissa };
}

function schermata(extra = {}) {
  const f = finto();
  let ora = INIZIO;
  let giro = null;
  const eventi = [];
  const s = creaSchermataSvelamento({
    collega: f.collega, nome: "Marta", nomeMio: "Luca", schermo: { tag: "video", a: {}, f: [] },
    adesso: () => ora, ogni: (fn) => { giro = fn; return 1; }, ferma: () => { giro = null; },
    leggiOgni: 0,
    quandoFinito: () => eventi.push("finito"), quandoSegnala: () => eventi.push("segnala"), quandoEsci: (m) => eventi.push(`esci:${m}`),
    ...extra,
  });
  const passa = async (ms) => { ora += ms; if (giro) await giro(); await new Promise((x) => setImmediate(x)); };
  return { s, f, eventi, passa, ora: () => ora, giro: () => giro, avanti: (ms) => { ora += ms; } };
}

test("apre: pubblica voce e video, poi «Aspettiamo <nome>…» finché l'altra persona non arriva", async () => {
  const t = schermata();
  await t.s.apri();
  assert.deepEqual(t.f.chiamate, ["pubblica"]);
  assert.equal(t.s.modello().stato, "aspetta");
  const v = vistaSchermata(h, t.s);
  assert.ok(testi(v).includes("Aspettiamo Marta…"));
  await t.passa(1000);
  assert.ok(t.f.chiamate.includes("ricevi"), "si prova a ricevere l'altra persona");
  assert.equal(t.s.modello().stato, "aspetta");
});

test("il timer parte solo quando il server dà l'inizio (entrambi i video ricevuti)", async () => {
  const t = schermata();
  await t.s.apri();
  t.f.code.ricevi.push({ ok: true, vista: VISTA_ATTESA });
  await t.passa(1000);
  assert.equal(t.s.modello().stato, "aspetta", "ricevuto, ma l'altra persona non ha ancora confermato");
  assert.equal(t.s.modello().secondi, 10);
  const inizio = t.ora() + 500;
  t.f.fissa.vista = { ok: true, vista: inCorso(inizio, inizio) };
  await t.passa(1000);
  assert.equal(t.s.modello().stato, "in_corso");
  assert.equal(t.s.modello().secondi, 10);
  assert.equal(t.s.modello().sfocato, true, "i primi 3 secondi sfocati");
  const v = vistaSchermata(h, t.s);
  assert.ok(trova(v, (x) => x.a.role === "timer").length === 1);
  assert.ok(testi(v).includes("10 secondi"));
});

test("timer sull'ora del server anche se il telefono è avanti di 2 minuti", async () => {
  const t = schermata();
  await t.s.apri();
  t.f.code.ricevi.push({ ok: true, vista: VISTA_ATTESA });
  await t.passa(1000);
  // Il server è 2 minuti indietro rispetto al telefono.
  const server = t.ora() - 120_000;
  t.f.fissa.vista = () => ({ ok: true, vista: inCorso(server, t.ora() - 120_000) });
  await t.passa(0);
  assert.equal(t.s.modello().secondi, 10);
  await t.passa(4500);
  assert.equal(t.s.modello().secondi, 6);
  assert.equal(t.s.modello().sfocato, false);
});

test("a 10 secondi la chiamata si chiude da sola: «Ecco <nome>.», niente più richieste", async () => {
  const t = schermata();
  await t.s.apri();
  t.f.code.ricevi.push({ ok: true, vista: VISTA_ATTESA });
  await t.passa(1000);
  const inizio = t.ora();
  t.f.fissa.vista = { ok: true, vista: inCorso(inizio, inizio) };
  await t.passa(0);
  // Anche se il server non risponde più, il telefono chiude a 10 secondi.
  t.f.fissa.vista = { ok: false, motivo: "riprova" };
  await t.passa(10_000);
  assert.equal(t.s.modello().stato, "finito");
  assert.ok(t.f.chiamate.includes("chiudi"), "fotocamera, microfono e connessione chiusi");
  assert.deepEqual(t.eventi, ["finito"]);
  assert.equal(t.giro(), null, "il giro si ferma");
  const v = vistaSchermata(h, t.s);
  assert.ok(testi(v).includes("Ecco Marta."));
  assert.equal(bottone(v, TESTI_SCHERMATA.chiudiSegnala), undefined);
});

test("il server dice «finito»: si chiude anche se il telefono conta ancora", async () => {
  const t = schermata();
  await t.s.apri();
  t.f.code.ricevi.push({ ok: true, vista: VISTA_ATTESA });
  await t.passa(1000);
  t.f.fissa.vista = { ok: true, vista: { fase: "finito", ora: t.ora() } };
  await t.passa(1000);
  assert.equal(t.s.modello().stato, "finito");
  assert.deepEqual(t.eventi, ["finito"]);
});

// Passo 7d-3a: l'altra persona ha toccato «Chiudi e segnala». Il server dice «interrotto»: mai «Ecco <nome>.».
test("il server dice «interrotto» a metà video: si esce, mai «Ecco <nome>.»", async () => {
  const t = schermata();
  await t.s.apri();
  t.f.code.ricevi.push({ ok: true, vista: inCorso(t.ora()) });
  await t.passa(1000);
  assert.equal(t.s.modello().stato, "in_corso");
  t.f.fissa.vista = { ok: true, vista: { fase: "interrotto", ora: t.ora() } };
  await t.passa(1000);
  assert.equal(t.s.modello().stato, "uscita");
  assert.deepEqual(t.eventi, ["esci:interrotto"]);
  assert.ok(t.f.chiamate.includes("chiudi"));
  assert.equal(testi(vistaSchermata(h, t.s)).some((x) => x.startsWith("Ecco")), false);
});

test("filigrana: nome di chi guarda (non dell'altra persona) + data, su tutto il video", async () => {
  const t = schermata();
  await t.s.apri();
  const v = vistaSchermata(h, t.s);
  const fil = trova(v, (x) => String(x.a.classe || "").includes("filigrana"));
  assert.equal(fil.length, 1);
  assert.match(testi(fil[0]).join(""), /^Luca · \d\d\/\d\d\/\d{4}$/);
  assert.equal(fil[0].a["aria-hidden"], "true");
  const schermo = trova(v, (x) => x.tag === "video");
  assert.equal(schermo.length, 1, "lo schermo arriva da fuori, sempre lo stesso elemento");
});

test("solo microfono e «Chiudi e segnala»: niente cambio fotocamera, niente pulsante per allungare", async () => {
  const t = schermata();
  await t.s.apri();
  const v = vistaSchermata(h, t.s);
  const nomi = trova(v, (x) => x.tag === "button").map((b) => testi(b).join(""));
  assert.deepEqual(nomi.sort(), [TESTI_SCHERMATA.chiudiSegnala, TESTI_SCHERMATA.microfonoAcceso].sort());
});

test("microfono on/off", async () => {
  const t = schermata();
  await t.s.apri();
  t.s.microfono();
  assert.equal(t.s.modello().muto, true);
  assert.ok(t.f.chiamate.includes("muto"));
  assert.ok(bottone(vistaSchermata(h, t.s), TESTI_SCHERMATA.microfonoSpento), "il pulsante dice cosa fa");
  t.s.microfono();
  assert.equal(t.s.modello().muto, false);
  assert.ok(t.f.chiamate.includes("voce"));
});

test("«Chiudi e segnala» chiude subito (prima di qualunque attesa) e apre la segnalazione", async () => {
  const t = schermata();
  await t.s.apri();
  t.f.code.ricevi.push({ ok: true, vista: VISTA_ATTESA });
  await t.passa(1000);
  const inizio = t.ora();
  t.f.fissa.vista = { ok: true, vista: inCorso(inizio, inizio) };
  await t.passa(2000);
  const prima = t.f.chiamate.length;
  t.s.chiudiESegnala();
  // Senza aspettare nulla: chiusura già fatta.
  assert.equal(t.f.chiamate[prima], "chiudi");
  assert.equal(t.s.modello().stato, "segnalata");
  assert.equal(t.giro(), null);
  assert.deepEqual(t.eventi, ["segnala"]);
  const b = vistaSchermata(h, t.s);
  assert.equal(trova(b, (x) => x.tag === "video").length, 0, "il video sparisce");
  // Un giro tardivo non riapre nulla.
  await t.passa(20_000);
  assert.equal(t.s.modello().stato, "segnalata");
});

test("pulsante rosso «Chiudi e segnala» collegato all'azione", async () => {
  const t = schermata();
  await t.s.apri();
  const b = bottone(vistaSchermata(h, t.s), TESTI_SCHERMATA.chiudiSegnala);
  assert.match(b.a.classe, /rosso/);
  b.a.onclick();
  assert.equal(t.s.modello().stato, "segnalata");
});

test("caduta a 4 s → «La connessione è caduta.» + «Riprova» → il timer riparte da 10, sfocato", async () => {
  const t = schermata();
  await t.s.apri();
  t.f.code.ricevi.push({ ok: true, vista: VISTA_ATTESA });
  await t.passa(1000);
  const inizio = t.ora();
  t.f.fissa.vista = { ok: true, vista: inCorso(inizio, inizio) };
  await t.passa(4000);
  t.s.cade();
  assert.equal(t.s.modello().stato, "caduta");
  let v = vistaSchermata(h, t.s);
  assert.ok(testi(v).includes(TESTI_SCHERMATA.caduta));
  assert.ok(bottone(v, TESTI_SCHERMATA.riprova));
  // Il server ha azzerato l'inizio (nuova pubblicazione).
  t.f.fissa.vista = { ok: true, vista: VISTA_ATTESA };
  await t.s.riprova();
  assert.ok(t.f.chiamate.includes("riprova"));
  assert.equal(t.s.modello().stato, "aspetta");
  assert.equal(t.s.modello().secondi, 10);
  assert.equal(t.s.modello().sfocato, true);
  assert.equal(t.s.modello().riprove, 1);
  // Si riceve di nuovo l'altra persona sulla connessione nuova.
  const prima = t.f.chiamate.filter((c) => c === "ricevi").length;
  await t.passa(1000);
  assert.equal(t.f.chiamate.filter((c) => c === "ricevi").length, prima + 1);
});

test("caduta dopo i 10 secondi: lo svelamento è valido, si chiude come finito", async () => {
  const t = schermata();
  await t.s.apri();
  t.f.code.ricevi.push({ ok: true, vista: VISTA_ATTESA });
  await t.passa(1000);
  const inizio = t.ora();
  t.f.fissa.vista = { ok: true, vista: inCorso(inizio, inizio) };
  await t.passa(0);
  t.avanti(10_200);
  t.s.cade();
  assert.equal(t.s.modello().stato, "finito");
  assert.deepEqual(t.eventi, ["finito"]);
});

test("«Riprova» vale per 2 minuti: poi si torna a scegliere quando", async () => {
  const t = schermata();
  await t.s.apri();
  t.s.cade();
  await t.passa(RIPROVA_MS + 1000);
  assert.equal(t.s.modello().stato, "uscita");
  assert.ok(t.f.chiamate.includes("chiudi"));
  assert.deepEqual(t.eventi, ["esci:tempo"]);
  await t.s.riprova();
  assert.equal(t.f.chiamate.includes("riprova"), false);
});

test("massimo 3 «Riprova»: alla quarta caduta si torna a scegliere quando", async () => {
  assert.equal(MAX_RIPROVE, 3);
  const t = schermata();
  await t.s.apri();
  for (let i = 0; i < 3; i++) {
    t.s.cade();
    await t.s.riprova();
    assert.equal(t.s.modello().stato, "aspetta");
  }
  t.s.cade();
  assert.equal(t.s.modello().stato, "uscita");
  assert.deepEqual(t.eventi, ["esci:tentativi"]);
});

test("la pubblicazione non riesce: stessa schermata della caduta, con «Riprova»", async () => {
  const t = schermata();
  t.f.code.pubblica.push({ ok: false, motivo: "riprova" });
  await t.s.apri();
  assert.equal(t.s.modello().stato, "caduta");
  await t.s.riprova();
  assert.equal(t.s.modello().stato, "aspetta");
});

test("fotocamera negata all'ingresso: si esce con il motivo (la sala d'attesa offre «Passa alle foto»)", async () => {
  const t = schermata();
  t.f.code.pubblica.push({ ok: false, motivo: "fotocamera_negata" });
  await t.s.apri();
  assert.equal(t.s.modello().stato, "uscita");
  assert.deepEqual(t.eventi, ["esci:fotocamera"]);
});

test("il server chiude la porta durante il video: si chiude tutto con il testo del server", async () => {
  const t = schermata();
  await t.s.apri();
  t.f.code.ricevi.push({ ok: false, motivo: "porta_chiusa", testo: "Questa porta si è chiusa." });
  await t.passa(1000);
  assert.equal(t.s.modello().stato, "uscita");
  assert.equal(t.s.modello().testo, "Questa porta si è chiusa.");
  assert.ok(t.f.chiamate.includes("chiudi"));
});

test("dopo una «Riprova» dell'altra persona (inizio azzerato) si riceve di nuovo", async () => {
  const t = schermata();
  await t.s.apri();
  t.f.code.ricevi.push({ ok: true, vista: VISTA_ATTESA });
  await t.passa(1000);
  const inizio = t.ora();
  t.f.fissa.vista = { ok: true, vista: inCorso(inizio, inizio) };
  await t.passa(1000);
  assert.equal(t.s.modello().stato, "in_corso");
  t.f.fissa.vista = { ok: true, vista: { fase: "attesa", ora: t.ora() } };
  await t.passa(1000);
  assert.equal(t.s.modello().stato, "aspetta");
  assert.equal(t.s.modello().secondi, 10);
  const prima = t.f.chiamate.filter((c) => c === "ricevi").length;
  await t.passa(1000);
  assert.equal(t.f.chiamate.filter((c) => c === "ricevi").length, prima + 1);
});

test("una richiesta alla volta: un giro mentre la precedente è in corso non ne parte un'altra", async () => {
  const t = schermata();
  await t.s.apri();
  let libera;
  t.f.collega.ricevi = () => { t.f.chiamate.push("ricevi"); return new Promise((ok) => { libera = ok; }); };
  t.avanti(1000);
  const g = t.giro();
  const p1 = g();
  t.avanti(1000);
  await g();
  assert.equal(t.f.chiamate.filter((c) => c === "ricevi").length, 1);
  libera({ ok: false, motivo: "in_attesa" });
  await p1;
});

test("letture al server al massimo una al secondo, anche se il giro è più fitto", async () => {
  const t = schermata({ leggiOgni: 1000 });
  await t.s.apri();
  await t.passa(250);
  await t.passa(250);
  await t.passa(250);
  assert.equal(t.f.chiamate.filter((c) => c === "ricevi").length, 0);
  await t.passa(250);
  assert.equal(t.f.chiamate.filter((c) => c === "ricevi").length, 1);
});

test("chiudi(): uscendo dalla pagina si spegne tutto, senza eventi", async () => {
  const t = schermata();
  await t.s.apri();
  t.s.chiudi();
  assert.ok(t.f.chiamate.includes("chiudi"));
  assert.equal(t.giro(), null);
  assert.deepEqual(t.eventi, []);
  assert.equal(vistaSchermata(h, t.s), null);
});

test("collegaVideo espone il microfono del video", () => {
  const visti = [];
  const c = collegaVideo({ svelamento: {}, video: { muto: (s) => visti.push(s), nitido() {}, chiudi() {} }, porta: "x" });
  c.muto(true);
  c.muto(false);
  assert.deepEqual(visti, [true, false]);
});

test("testi: quelli della spec", () => {
  assert.equal(TESTI_SCHERMATA.aspetta, "Aspettiamo <nome>…");
  assert.equal(TESTI_SCHERMATA.ecco, "Ecco <nome>.");
  assert.equal(TESTI_SCHERMATA.caduta, "La connessione è caduta.");
  assert.equal(TESTI_SCHERMATA.chiudiSegnala, "Chiudi e segnala");
  assert.equal(RIPROVA_MS, 120_000);
});
