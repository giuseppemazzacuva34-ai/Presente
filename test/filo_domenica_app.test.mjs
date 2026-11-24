// Il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A): schermata 36 «Il Filo · le porte aperte»
// nella web app, passo 7a della linea «sviluppatore-c». Modulo, letture dal Worker e vista; rete finta, nessun dato reale.
// Testi della spec (parte 3): «Domenica · ore 21», numero con singolare/plurale/zero, riga rossa solo con 1 o più,
// «Il Filo dice solo quante, mai chi.», «Scopri la tua sera». Il vocale non parte mai da solo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TESTI_FILO_DOMENICA, durataTesto, schermataFiloDomenica, creaFiloDomenica, vistaFiloDomenica,
} from "../landing/app/moduli/filo_domenica.js";

const STANZA = "11111111-2222-4333-8444-555555555555";
const VOCALE = { url: "https://esempio.supabase.co/firmato", durata: 48, testo: "Ciao a tutti, tra poco sapete quante porte.", filo: "Valentina", scade_tra: 300 };

const h = (tag, a = {}, ...figli) => ({ tag, a: a || {}, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) });
const testo = (n) => (n === null || n === undefined ? "" : typeof n === "object" ? n.f.map(testo).join("") : String(n));
const tutti = (n, ok, out = []) => { if (n && typeof n === "object") { if (ok(n)) out.push(n); n.f.forEach((x) => tutti(x, ok, out)); } return out; };

function rete(risposte) {
  const chiamate = [];
  const f = async (url, init = {}) => {
    chiamate.push({ url, ...init });
    const r = risposte[url] ?? { status: 500, body: {} };
    if (r.errore) throw new Error("rete");
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body };
  };
  return { f, chiamate };
}
const PORTE = "/app/api/filo/porte";
const ASCOLTA = "/app/api/filo/ascolta?tipo=domenica";

test("testi della spec, parte 3", () => {
  assert.equal(TESTI_FILO_DOMENICA.occhiello, "Domenica · ore 21");
  assert.equal(TESTI_FILO_DOMENICA.attacco, "Questa settimana, nella nostra stanza…");
  assert.equal(TESTI_FILO_DOMENICA.rigaRossa, "Ora scopri se una è la tua.");
  assert.equal(TESTI_FILO_DOMENICA.nota, "Il Filo dice solo quante, mai chi.");
  assert.equal(TESTI_FILO_DOMENICA.bottone, "Scopri la tua sera");
  assert.equal(TESTI_FILO_DOMENICA.ascolta, "Ascolta il vocale del Filo");
  assert.equal(TESTI_FILO_DOMENICA.leggi, "Leggi il testo");
  assert.ok(Object.isFrozen(TESTI_FILO_DOMENICA));
});

test("durata del vocale come «0:48» e «1:00»; niente se non è un intero valido", () => {
  assert.equal(durataTesto(48), "0:48");
  assert.equal(durataTesto(60), "1:00");
  assert.equal(durataTesto(9), "0:09");
  assert.equal(durataTesto(-1), null);
  assert.equal(durataTesto("48"), null);
});

test("numero: plurale, singolare e zero come nella spec; riga rossa solo con 1 o più", () => {
  const tre = schermataFiloDomenica({ porte: { stanza: STANZA, numero: 3 }, vocale: null });
  assert.deepEqual([tre.numero, tre.frase, tre.rigaRossa], ["3", "porte si sono aperte.", "Ora scopri se una è la tua."]);
  const una = schermataFiloDomenica({ porte: { stanza: STANZA, numero: 1 }, vocale: null });
  assert.deepEqual([una.numero, una.frase, una.rigaRossa], ["1", "porta si è aperta.", "Ora scopri se una è la tua."]);
  const zero = schermataFiloDomenica({ porte: { stanza: STANZA, numero: 0 }, vocale: null });
  assert.deepEqual([zero.numero, zero.frase, zero.rigaRossa], [null, "Questa settimana nessuna porta si è aperta.", null]);
});

test("stanza senza Filo o numero non valido: la schermata non c'è (mai un numero inventato)", () => {
  assert.equal(schermataFiloDomenica({ porte: null, vocale: VOCALE }), null);
  assert.equal(schermataFiloDomenica({ porte: { stanza: STANZA, numero: -2 }, vocale: null }), null);
  assert.equal(schermataFiloDomenica({ porte: { stanza: STANZA, numero: "3" }, vocale: null }), null);
});

test("con il vocale: scheda «<Nome> · il Filo» e «Il vocale della domenica · 0:48»; senza, niente scheda", () => {
  const s = schermataFiloDomenica({ porte: { stanza: STANZA, numero: 2 }, vocale: VOCALE });
  assert.deepEqual(s.scheda, { titolo: "Valentina · il Filo", sotto: "Il vocale della domenica · 0:48", url: VOCALE.url, testo: VOCALE.testo });
  assert.equal(schermataFiloDomenica({ porte: { stanza: STANZA, numero: 2 }, vocale: null }).scheda, null);
  // Vocale senza link o senza testo: meglio nessun lettore che un lettore rotto.
  assert.equal(schermataFiloDomenica({ porte: { stanza: STANZA, numero: 2 }, vocale: { ...VOCALE, url: "" } }).scheda, null);
});

test("lettura: numero e vocale dal Worker col token; senza numero non chiede il vocale", async () => {
  const { f, chiamate } = rete({
    [PORTE]: { status: 200, body: { ok: true, porte: { stanza: STANZA, numero: 3 } } },
    [ASCOLTA]: { status: 200, body: { ok: true, vocale: VOCALE } },
  });
  const fd = creaFiloDomenica({ token: () => "tok", fetch: f });
  await fd.prepara();
  const m = fd.modello();
  assert.equal(m.schermata.numero, "3");
  assert.equal(m.schermata.scheda.titolo, "Valentina · il Filo");
  assert.deepEqual(chiamate.map((c) => [c.url, c.method, c.headers.authorization]), [
    [PORTE, "GET", "Bearer tok"], [ASCOLTA, "GET", "Bearer tok"],
  ]);

  const r2 = rete({ [PORTE]: { status: 200, body: { ok: true, porte: null } } });
  const fd2 = creaFiloDomenica({ token: () => "tok", fetch: r2.f });
  await fd2.prepara();
  assert.equal(fd2.modello().schermata, null);
  assert.equal(r2.chiamate.length, 1);
});

test("vocale che non arriva (errore o null): resta il numero, senza scheda", async () => {
  for (const ascolta of [{ status: 503, body: { ok: false } }, { errore: true }, { status: 200, body: { ok: true, vocale: null } }]) {
    const { f } = rete({ [PORTE]: { status: 200, body: { ok: true, porte: { stanza: STANZA, numero: 1 } } }, [ASCOLTA]: ascolta });
    const fd = creaFiloDomenica({ token: () => "tok", fetch: f });
    await fd.prepara();
    assert.equal(fd.modello().schermata.numero, "1");
    assert.equal(fd.modello().schermata.scheda, null);
  }
});

test("numero che non arriva (senza token, 401, 503, rete): nessuna schermata, si va diretti alla sera", async () => {
  const casi = [
    [() => null, {}],
    [() => "tok", { [PORTE]: { status: 401, body: { ok: false } } }],
    [() => "tok", { [PORTE]: { status: 503, body: { ok: false } } }],
    [() => "tok", { [PORTE]: { errore: true } }],
  ];
  for (const [token, risposte] of casi) {
    const { f } = rete(risposte);
    const fd = creaFiloDomenica({ token, fetch: f });
    await fd.prepara();
    assert.equal(fd.modello().schermata, null);
  }
});

test("prepara() legge una volta sola; «Scopri la tua sera» chiude la schermata e avvisa la vista", async () => {
  const { f, chiamate } = rete({ [PORTE]: { status: 200, body: { ok: true, porte: { stanza: STANZA, numero: 0 } } },
    [ASCOLTA]: { status: 200, body: { ok: true, vocale: null } } });
  let avvisi = 0;
  const fd = creaFiloDomenica({ token: () => "tok", fetch: f, aggiorna: () => { avvisi++; } });
  await Promise.all([fd.prepara(), fd.prepara()]);
  assert.equal(chiamate.length, 2);
  assert.ok(fd.modello().schermata);
  const prima = avvisi;
  fd.chiudi();
  assert.equal(fd.modello().schermata, null);
  assert.ok(avvisi > prima);
});

test("vista: occhiello, numero grande, frase, riga rossa, nota e pulsante; vocale mai automatico, con nome accessibile e testo", async () => {
  const { f } = rete({ [PORTE]: { status: 200, body: { ok: true, porte: { stanza: STANZA, numero: 3 } } },
    [ASCOLTA]: { status: 200, body: { ok: true, vocale: VOCALE } } });
  const fd = creaFiloDomenica({ token: () => "tok", fetch: f });
  await fd.prepara();
  let aperta = 0;
  const v = vistaFiloDomenica(h, fd, { scopri: () => { aperta++; } });
  const t = testo(v);
  for (const parte of ["Domenica · ore 21", "Valentina · il Filo", "Il vocale della domenica · 0:48",
    "Questa settimana, nella nostra stanza…", "3", "porte si sono aperte.", "Ora scopri se una è la tua.",
    "Il Filo dice solo quante, mai chi.", "Scopri la tua sera", "Leggi il testo", VOCALE.testo]) {
    assert.ok(t.includes(parte), `manca «${parte}»`);
  }
  const audio = tutti(v, (x) => x.tag === "audio");
  assert.equal(audio.length, 1);
  assert.equal(audio[0].a.src, VOCALE.url);
  assert.equal(audio[0].a.autoplay, undefined);
  assert.equal(audio[0].a.preload, "none");
  assert.equal(audio[0].a.controls, true); // lettore nativo: usabile da tastiera
  assert.equal(audio[0].a["aria-label"], "Ascolta il vocale del Filo");
  const dettagli = tutti(v, (x) => x.tag === "details");
  assert.equal(dettagli.length, 1);
  assert.equal(testo(tutti(dettagli[0], (x) => x.tag === "summary")[0]), "Leggi il testo");
  const b = tutti(v, (x) => x.tag === "button" && testo(x) === "Scopri la tua sera")[0];
  b.a.onclick();
  assert.equal(aperta, 1);
  assert.equal(fd.modello().schermata, null);
});

test("vista con zero porte e senza vocale: niente numero grande, niente riga rossa, niente lettore", async () => {
  const { f } = rete({ [PORTE]: { status: 200, body: { ok: true, porte: { stanza: STANZA, numero: 0 } } },
    [ASCOLTA]: { status: 200, body: { ok: true, vocale: null } } });
  const fd = creaFiloDomenica({ token: () => "tok", fetch: f });
  await fd.prepara();
  const v = vistaFiloDomenica(h, fd, { scopri: () => {} });
  const t = testo(v);
  assert.ok(t.includes("Questa settimana nessuna porta si è aperta."));
  assert.ok(!t.includes("Ora scopri se una è la tua."));
  assert.equal(tutti(v, (x) => x.tag === "audio").length, 0);
  assert.equal(tutti(v, (x) => (x.a.classe || "").includes("filo-numero")).length, 0);
});

test("nessuna schermata → la vista non disegna nulla", async () => {
  const { f } = rete({ [PORTE]: { status: 200, body: { ok: true, porte: null } } });
  const fd = creaFiloDomenica({ token: () => "tok", fetch: f });
  await fd.prepara();
  assert.equal(vistaFiloDomenica(h, fd, { scopri: () => {} }), null);
});

test("il modulo non salva nulla nel telefono e non scrive nei log", () => {
  const sorgente = readFileSync(new URL("../landing/app/moduli/filo_domenica.js", import.meta.url), "utf8");
  assert.ok(!/localStorage|sessionStorage|indexedDB|console\./.test(sorgente));
  assert.ok(!/autoplay/.test(sorgente.replace(/\/\/.*$/gm, "")));
});
