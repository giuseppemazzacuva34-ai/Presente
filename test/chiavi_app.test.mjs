// Chiavi e sera delle porte nella web app (issue #5, spec v1.1, passi 4-8; passo 5c della linea «sviluppatore-c»).
// Testi della spec, conto alla rovescia, schermata della sera e richieste al Worker. Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  contatoreChiavi, schedaChiave, finestraDai, confermaRiprendi, contoAllaRovescia, schermataSera, testoErroreChiavi, creaChiavi,
} from "../landing/app/moduli/chiavi.js";
import { TESTI_CHIAVI } from "../api/chiavi.js";

const LEI = "11111111-2222-4333-8444-555555555555";
const LUI = "66666666-7777-4888-9999-000000000000";
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CHIUDE = "2026-11-15T20:00:00Z"; // domenica 21:00 di Roma
const stato = (date = [], extra = {}) => ({ stanza: true, chiude_il: CHIUDE, chiuse: false, restanti: 2 - date.length, date, ...extra });

test("contatore: «Le tue chiavi: N» con due icone, piene quelle ancora da dare", () => {
  assert.deepEqual(contatoreChiavi(stato()), { testo: "Le tue chiavi: 2", icone: [true, true] });
  assert.deepEqual(contatoreChiavi(stato([{ a: LEI, frase: null }])), { testo: "Le tue chiavi: 1", icone: [true, false] });
  assert.equal(contatoreChiavi({ stanza: false }), null);
});

test("scheda: «Dai una chiave» a chi non l'hai data, «Hai dato una chiave» con riprendi e modifica", () => {
  assert.deepEqual(schedaChiave(stato(), LEI), { dai: "Dai una chiave" });
  assert.deepEqual(schedaChiave(stato([{ a: LEI, frase: "Il treno" }]), LEI),
    { segno: "Hai dato una chiave", frase: "Il treno", riprendi: "Riprendi la chiave", modifica: "Modifica la frase" });
  // Finite le chiavi, sulle altre schede il pulsante non c'è.
  assert.deepEqual(schedaChiave(stato([{ a: LUI, frase: null }, { a: PORTA, frase: null }]), LEI), {});
});

test("scheda dalle 20:59: niente pulsanti, solo «Le chiavi sono chiuse»", () => {
  assert.deepEqual(schedaChiave(stato([{ a: LEI, frase: null }], { chiuse: true }), LEI), { segno: "Hai dato una chiave", chiuse: TESTI_CHIAVI.chiuse });
  assert.deepEqual(schedaChiave(stato([], { chiuse: true }), LEI), { chiuse: TESTI_CHIAVI.chiuse });
  assert.equal(schedaChiave({ stanza: false }, LEI), null);
});

test("finestre: testi della spec con il nome, frase di 140 caratteri al massimo", () => {
  assert.deepEqual(finestraDai("Giulia"), {
    titolo: "Dai una chiave a Giulia?", etichetta: "Una frase per Giulia",
    nota: "La leggerà solo se anche Giulia ti dà una chiave.", bottone: "Dai la chiave", massimo: 140,
  });
  assert.equal(confermaRiprendi("Giulia"), "Riprendi la chiave a Giulia? Non lo saprà.");
  assert.equal(finestraDai("").titolo, "Dai una chiave a questa persona?");
});

test("conto alla rovescia: dalle 20:00 di Roma, poi chiavi chiuse; prima nessun testo", () => {
  const ora = (iso) => new Date(iso);
  assert.equal(contoAllaRovescia(CHIUDE, ora("2026-11-15T18:59:00Z")), null);
  assert.equal(contoAllaRovescia(CHIUDE, ora("2026-11-15T19:00:30Z")), "Le porte si aprono tra 59 minuti");
  assert.equal(contoAllaRovescia(CHIUDE, ora("2026-11-15T19:58:30Z")), "Le porte si aprono tra 1 minuto");
  assert.equal(contoAllaRovescia(CHIUDE, ora("2026-11-15T19:59:00Z")), TESTI_CHIAVI.chiuse);
  assert.equal(contoAllaRovescia(CHIUDE, ora("2026-11-15T20:00:00Z")), null);
  assert.equal(contoAllaRovescia("non è una data", ora("2026-11-15T19:30:00Z")), null);
});

test("sera con porte: «Una porta si è aperta: <nome>.», la frase dell'altra persona e «Vai allo svelamento»", () => {
  const s = schermataSera({ ok: true, stato: "pronta", porte: [
    { id: PORTA, con: LEI, nome: "Giulia", frase_per_te: "Il treno, ancora." },
    { id: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee", con: LUI, nome: "Marco", frase_per_te: null },
  ] });
  assert.deepEqual(s, { tipo: "porte", schede: [
    { porta: PORTA, testo: "Una porta si è aperta: Giulia.", scritto: "Giulia ti ha scritto:", frase: "Il treno, ancora.", bottone: "Vai allo svelamento" },
    { porta: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee", testo: "Una porta si è aperta: Marco.", scritto: null, frase: null, bottone: "Vai allo svelamento" },
  ] });
});

test("sera senza porte: lo stesso testo per tutti; in attesa e senza sera niente da mostrare", () => {
  assert.deepEqual(schermataSera({ ok: true, stato: "pronta", porte: [], testo: TESTI_CHIAVI.nessunaPorta }),
    { tipo: "nessuna_porta", testo: "Stasera nessuna porta si è aperta. Lunedì alle 9 apre una nuova stanza." });
  assert.deepEqual(schermataSera({ ok: true, stato: "attesa" }), { tipo: "attesa" });
  assert.equal(schermataSera({ ok: true, stato: "nessuna" }), null);
  // Righe senza id valido non diventano schede.
  assert.deepEqual(schermataSera({ ok: true, stato: "pronta", porte: [{ id: "x", con: LEI, nome: "Giulia" }] }).tipo, "nessuna_porta");
});

test("errori: testi brevi, mai il motivo tecnico", () => {
  assert.equal(testoErroreChiavi("rete"), "Sei senza connessione. Riprova tra poco.");
  assert.equal(testoErroreChiavi("troppe"), "Troppi tentativi. Aspetta un minuto.");
  assert.equal(testoErroreChiavi("boh"), "Non è andata. Riprova tra poco.");
});

// Rete finta: risponde come worker/chiavi_api.js.
function reteFinta(risposte) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    viste.push({ url, metodo: opzioni.method || "GET", headers: opzioni.headers, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    const r = risposte[`${opzioni.method || "GET"} ${url}`];
    if (r instanceof Error) throw r;
    return r instanceof Response ? r : Response.json(r);
  };
  return { f, viste };
}

test("richieste: GET dello stato e della sera, POST dai/riprendi/frase senza «da», con il token", async () => {
  const st = stato([{ a: LEI, frase: null }]);
  const rete = reteFinta({
    "GET /app/api/chiavi": { ok: true, ...st },
    "POST /app/api/chiavi": { ok: true, stato: st },
    "GET /app/api/chiavi/sera": { ok: true, stato: "attesa" },
  });
  const c = creaChiavi({ token: () => "tok", fetch: rete.f });
  assert.deepEqual(await c.leggi(), { ok: true, stato: st });
  assert.deepEqual(await c.dai(LEI, "Il treno"), { ok: true, stato: st });
  await c.riprendi(LEI);
  await c.cambiaFrase(LEI, "");
  assert.deepEqual(await c.sera(), { ok: true, stato: "attesa" });
  assert.deepEqual(rete.viste.filter((v) => v.metodo === "POST").map((v) => v.corpo),
    [{ azione: "dai", a: LEI, frase: "Il treno" }, { azione: "riprendi", a: LEI }, { azione: "frase", a: LEI, frase: "" }]);
  assert.ok(rete.viste.every((v) => v.headers.authorization === "Bearer tok"));
});

test("richieste: rifiuto con il testo del server, rete giù, senza accesso nessuna richiesta", async () => {
  const no = reteFinta({ "POST /app/api/chiavi": { ok: false, motivo: "finite", testo: TESTI_CHIAVI.finite } });
  assert.deepEqual(await creaChiavi({ token: () => "tok", fetch: no.f }).dai(LEI, ""), { ok: false, motivo: "finite", testo: TESTI_CHIAVI.finite });
  const giu = reteFinta({ "GET /app/api/chiavi": new Error("rete") });
  assert.deepEqual(await creaChiavi({ token: () => "tok", fetch: giu.f }).leggi(), { ok: false, motivo: "rete", testo: testoErroreChiavi("rete") });
  const vuota = reteFinta({});
  assert.deepEqual(await creaChiavi({ token: () => null, fetch: vuota.f }).leggi(), { ok: false, motivo: "accesso", testo: testoErroreChiavi("accesso") });
  assert.equal(vuota.viste.length, 0);
  const persona = reteFinta({});
  assert.deepEqual(await creaChiavi({ token: () => "tok", fetch: persona.f }).dai("non-un-id", ""), { ok: false, motivo: "dati", testo: testoErroreChiavi("dati") });
  assert.equal(persona.viste.length, 0);
});

test("il modulo non salva nulla in locale e non parla del diario", () => {
  const sorgente = readFileSync(new URL("../landing/app/moduli/chiavi.js", import.meta.url), "utf8");
  assert.doesNotMatch(sorgente, /localStorage|sessionStorage|indexedDB|document\./);
  assert.doesNotMatch(sorgente, /diario/i);
});
