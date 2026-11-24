// Pannello dell'amministratore per il Filo della stanza (issue #360, spec v1 + v1.1, D151 A), passo 12c della linea
// «sviluppatore-c»: il modulo della pagina. Parla solo con /app/api/filo-amministratore/* col token di chi guarda:
// se è amministratore lo decide il database. Rete finta, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { vociStanzeFilo, testoErroreFilo, creaFiloAmministratore, durataVocale }
  from "../landing/app/moduli/filo_amministratore.js";
import { PERCORSO_FILO_AMMINISTRATORE } from "../worker/filo_amministratore_api.js";

const ADESSO = new Date("2026-11-30T08:50:00Z");
const S1 = "11111111-2222-4333-8444-555555555555";
const S2 = "66666666-7777-4888-9999-000000000000";
const S3 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FILE = `${S1}/lunedi-1.webm`;
const riga = (stanza, extra = {}) => ({ stanza, nome: "Stanza di prova", citta: "Torino", apre_il: "2026-11-30T08:00:00Z",
  chiude_il: "2026-12-07T08:00:00Z", filo_nome: "Anna", membri: 12, vocale_lunedi: true, vocale_domenica: false, avviso: null, ...extra });

test("voci: titolo, periodo in ora di Roma, Filo, membri e vocali leggibili", () => {
  const [v] = vociStanzeFilo([riga(S1)], ADESSO);
  assert.equal(v.stanza, S1);
  assert.equal(v.titolo, "Stanza di prova · Torino");
  assert.equal(v.periodo, "dal 30 nov alle 09:00 al 7 dic alle 09:00");
  assert.equal(v.filo, "Filo: Anna");
  assert.equal(v.conFilo, true);
  assert.equal(v.membri, "12 persone");
  assert.equal(v.vocali, "Vocale del lunedì: c'è · vocale della domenica: non ancora");
  assert.equal(v.lunedi, true);
  assert.equal(v.domenica, false);
  assert.equal(v.avviso, "");
  assert.equal(v.rossa, false);
});

test("voci: stanza senza Filo e senza città", () => {
  const [v] = vociStanzeFilo([riga(S1, { filo_nome: null, citta: null, membri: 1, vocale_lunedi: false })], ADESSO);
  assert.equal(v.titolo, "Stanza di prova");
  assert.equal(v.filo, "Senza Filo");
  assert.equal(v.conFilo, false);
  assert.equal(v.membri, "1 persona");
  assert.equal(v.avviso, "");
});

test("voci: Filo senza nome nel profilo", () => {
  const [v] = vociStanzeFilo([riga(S1, { filo_nome: "" })], ADESSO);
  assert.equal(v.filo, "Filo: (nome non inserito)");
  assert.equal(v.conFilo, true);
});

test("voci: avvisi delle 8:45 e delle 13:00 in rosso e in cima", () => {
  const voci = vociStanzeFilo([
    riga(S1),
    riga(S2, { vocale_lunedi: false, avviso: "manca_lunedi" }),
    riga(S3, { vocale_lunedi: false, avviso: "senza_lunedi" }),
  ], ADESSO);
  assert.deepEqual(voci.map((v) => v.stanza), [S2, S3, S1]);
  assert.equal(voci[0].avviso, "Alle 8:45 manca il vocale del lunedì: il Filo può ancora caricarlo fino alle 13:00.");
  assert.equal(voci[0].rossa, true);
  assert.equal(voci[1].avviso, "Dopo le 13:00: questa settimana la stanza è senza vocale del lunedì.");
  assert.equal(voci[1].rossa, true);
  assert.equal(voci[2].rossa, false);
});

test("voci: righe senza id valido scartate, valori strani resi innocui", () => {
  const voci = vociStanzeFilo([null, "x", { stanza: "non-un-id" }, riga(S1, { nome: 5, membri: "tanti", avviso: "<b>" })], ADESSO);
  assert.equal(voci.length, 1);
  assert.equal(voci[0].titolo, "Stanza · Torino");
  assert.equal(voci[0].membri, "0 persone");
  assert.equal(voci[0].avviso, "");
  assert.deepEqual(vociStanzeFilo("non un elenco", ADESSO), []);
});

test("durata del vocale in minuti e secondi", () => {
  assert.equal(durataVocale(24), "0:24");
  assert.equal(durataVocale(70), "1:10");
  assert.equal(durataVocale(-1), "");
  assert.equal(durataVocale("x"), "");
});

test("errori: testi per ogni motivo, uno generico per il resto", () => {
  assert.match(testoErroreFilo("accesso"), /Entra prima nell'app/);
  assert.equal(testoErroreFilo("non_amministratore"), "Questo account non può usare il pannello del Filo.");
  assert.equal(testoErroreFilo("spento"), "La pagina non è ancora attiva.");
  assert.equal(testoErroreFilo("persona"), "Nessun account con questa email: controlla l'indirizzo.");
  assert.equal(testoErroreFilo("stanza"), "Questa stanza è già chiusa.");
  assert.equal(testoErroreFilo("filo_membro"), "Questa persona è nella stanza: il Filo non può esserne membro.");
  assert.equal(testoErroreFilo("email"), "Scrivi un'email valida.");
  assert.equal(testoErroreFilo("qualcosa"), "Qualcosa non ha funzionato. Riprova tra poco.");
  assert.equal(testoErroreFilo("constructor"), "Qualcosa non ha funzionato. Riprova tra poco.");
});

function reteFinta(risposte) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    viste.push({ url, metodo: opzioni.method, auth: opzioni.headers?.authorization, corpo: opzioni.body ? JSON.parse(opzioni.body) : undefined });
    const r = risposte[url.split("?")[0]];
    if (r instanceof Error) throw r;
    if (typeof r === "number") return new Response("{}", { status: r });
    return Response.json(r);
  };
  return { f, viste };
}
const P = PERCORSO_FILO_AMMINISTRATORE;

test("stanze: GET col token, elenco restituito", async () => {
  const { f, viste } = reteFinta({ [`${P}/stanze`]: { ok: true, stanze: [riga(S1)] } });
  const p = creaFiloAmministratore({ token: () => "tok", fetch: f });
  const r = await p.stanze();
  assert.equal(r.ok, true);
  assert.equal(r.stanze.length, 1);
  assert.deepEqual(viste[0], { url: `${P}/stanze`, metodo: "GET", auth: "Bearer tok", corpo: undefined });
});

test("stanze: senza token niente rete; 401, 403, 404, 429 e rete assente diventano motivi", async () => {
  const vuoto = reteFinta({});
  assert.deepEqual(await creaFiloAmministratore({ token: () => null, fetch: vuoto.f }).stanze(), { ok: false, motivo: "accesso" });
  assert.equal(vuoto.viste.length, 0);
  for (const [stato, motivo] of [[401, "accesso"], [403, "non_amministratore"], [404, "spento"], [429, "troppe"], [503, "riprova"]]) {
    const { f } = reteFinta({ [`${P}/stanze`]: stato });
    assert.deepEqual(await creaFiloAmministratore({ token: () => "tok", fetch: f }).stanze(), { ok: false, motivo });
  }
  const { f } = reteFinta({ [`${P}/stanze`]: new Error("giù") });
  assert.deepEqual(await creaFiloAmministratore({ token: () => "tok", fetch: f }).stanze(), { ok: false, motivo: "rete" });
});

test("assegna: email ripulita e controllata prima della rete; motivi del server passati", async () => {
  const { f, viste } = reteFinta({ [`${P}/assegna`]: { ok: true } });
  const p = creaFiloAmministratore({ token: () => "tok", fetch: f });
  assert.deepEqual(await p.assegna(S1, "  filo@example.invalid "), { ok: true });
  assert.deepEqual(viste[0].corpo, { stanza: S1, email: "filo@example.invalid" });
  assert.equal(viste[0].metodo, "POST");
  assert.deepEqual(await p.assegna(S1, "non-una-email"), { ok: false, motivo: "email" });
  assert.deepEqual(await p.assegna("x", "filo@example.invalid"), { ok: false, motivo: "dati" });
  assert.equal(viste.length, 1);
  const no = reteFinta({ [`${P}/assegna`]: { ok: false, motivo: "persona" } });
  assert.deepEqual(await creaFiloAmministratore({ token: () => "tok", fetch: no.f }).assegna(S1, "a@b.it"), { ok: false, motivo: "persona" });
  const strano = reteFinta({ [`${P}/assegna`]: { ok: false, motivo: "__proto__" } });
  assert.deepEqual(await creaFiloAmministratore({ token: () => "tok", fetch: strano.f }).assegna(S1, "a@b.it"), { ok: false, motivo: "riprova" });
});

test("togli il Filo: POST con la stanza", async () => {
  const { f, viste } = reteFinta({ [`${P}/togli-filo`]: { ok: true, tolto: true } });
  assert.deepEqual(await creaFiloAmministratore({ token: () => "tok", fetch: f }).togliFilo(S1), { ok: true, tolto: true });
  assert.deepEqual(viste[0].corpo, { stanza: S1 });
});

test("ascolta: GET con stanza e tipo; vocale assente o presente", async () => {
  const vocale = { url: "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/sign/vocali_filo/x", durata: 70, testo: "Ciao", file: FILE };
  const { f, viste } = reteFinta({ [`${P}/ascolta`]: { ok: true, vocale } });
  const p = creaFiloAmministratore({ token: () => "tok", fetch: f });
  assert.deepEqual(await p.ascolta(S1, "lunedi"), { ok: true, vocale });
  assert.equal(viste[0].url, `${P}/ascolta?stanza=${S1}&tipo=lunedi`);
  assert.equal(viste[0].metodo, "GET");
  assert.deepEqual(await p.ascolta(S1, "martedi"), { ok: false, motivo: "dati" });
  const vuoto = reteFinta({ [`${P}/ascolta`]: { ok: true, vocale: null } });
  assert.deepEqual(await creaFiloAmministratore({ token: () => "tok", fetch: vuoto.f }).ascolta(S1, "domenica"), { ok: true, vocale: null });
  const strano = reteFinta({ [`${P}/ascolta`]: { ok: true, vocale: { url: "javascript:alert(1)", durata: 3, testo: "", file: FILE } } });
  assert.deepEqual(await creaFiloAmministratore({ token: () => "tok", fetch: strano.f }).ascolta(S1, "lunedi"), { ok: false, motivo: "riprova" });
});

test("togli il vocale: POST con stanza, tipo e file", async () => {
  const { f, viste } = reteFinta({ [`${P}/togli-vocale`]: { ok: true, tolto: true } });
  const p = creaFiloAmministratore({ token: () => "tok", fetch: f });
  assert.deepEqual(await p.togliVocale(S1, "lunedi", FILE), { ok: true, tolto: true });
  assert.deepEqual(viste[0].corpo, { stanza: S1, tipo: "lunedi", file: FILE });
  assert.deepEqual(await p.togliVocale(S1, "lunedi", "../x"), { ok: false, motivo: "dati" });
  assert.equal(viste.length, 1);
});

test("il modulo non salva nulla sul telefono e non scrive log", async () => {
  const { readFileSync } = await import("node:fs");
  const sorgente = readFileSync(new URL("../landing/app/moduli/filo_amministratore.js", import.meta.url), "utf8");
  assert.doesNotMatch(sorgente, /localStorage|sessionStorage|indexedDB|console\./);
});
