// Schermate della chiamata nella web app (issue #4, passo 3c-1): il modulo che parla con /app/api/chiamata e decide
// cosa mostrare (squillo, timer 15:00, banner dei primi 10 secondi, Carte, ultimo minuto, riconnessione).
// Il server è finto: nessuna rete, nessun dato reale, nessun audio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaChiamata, testoTimer, testoMotivo, schermata, BANNER } from "../landing/app/moduli/chiamata.js";

const UUID = "11111111-2222-4333-8444-555555555555";

function finto(rispondi = () => [200, { ok: true, vista: null }]) {
  const chiamate = [];
  const f = async (url, o = {}) => {
    const c = { url, metodo: o.method || "GET", headers: o.headers || {}, corpo: o.body ? JSON.parse(o.body) : undefined };
    chiamate.push(c);
    const [stato, dati] = rispondi(c);
    if (stato === "rete") throw new TypeError("rete assente");
    return new Response(typeof dati === "string" ? dati : JSON.stringify(dati), { status: stato });
  };
  return { f, chiamate };
}
const crea = (f, token = "tok-utente") => creaChiamata({ token: async () => token, fetch: f });

test("stato: GET /app/api/chiamata con il token dell'utente; vista null = nessuna chiamata", async () => {
  const s = finto(() => [200, { ok: true, vista: null }]);
  assert.deepEqual(await crea(s.f).stato(), { ok: true, vista: null });
  assert.equal(s.chiamate[0].url, "/app/api/chiamata");
  assert.equal(s.chiamate[0].metodo, "GET");
  assert.equal(s.chiamate[0].headers.authorization, "Bearer tok-utente");
  assert.equal(s.chiamate[0].corpo, undefined);
});

test("apri: POST /apri con verso e offerta; al telefono tornano solo descrizione e vista", async () => {
  const vista = { fase: "squilla", io: "chiama", squillo: 30 };
  const s = finto(() => [200, { ok: true, descrizione: "v=0 risposta", vista }]);
  assert.deepEqual(await crea(s.f).apri(UUID, "v=0 offerta"), { ok: true, descrizione: "v=0 risposta", vista });
  const c = s.chiamate[0];
  assert.equal(c.url, "/app/api/chiamata/apri");
  assert.equal(c.metodo, "POST");
  assert.equal(c.headers["content-type"], "application/json");
  assert.deepEqual(c.corpo, { verso: UUID, offerta: "v=0 offerta" });
});

test("il corpo non porta mai chi chiama: lo dice solo il token", async () => {
  const s = finto(() => [200, { ok: true, vista: null }]);
  const ch = crea(s.f);
  await ch.apri(UUID, "o");
  await ch.rispondi("o");
  await ch.rifiuta();
  await ch.chiudi();
  await ch.ascolta();
  await ch.conferma("r");
  await ch.caduta();
  await ch.rientro("o");
  await ch.carta();
  for (const c of s.chiamate) {
    assert.equal(c.metodo, "POST");
    assert.ok(!("chi" in c.corpo) && !("per" in c.corpo), c.url);
  }
  assert.deepEqual(s.chiamate.map((c) => c.url.replace("/app/api/chiamata/", "")),
    ["apri", "rispondi", "rifiuta", "chiudi", "ascolta", "conferma", "caduta", "rientro", "carta"]);
  assert.deepEqual(s.chiamate[1].corpo, { offerta: "o" });
  assert.deepEqual(s.chiamate[3].corpo, { segnala: false });
  assert.deepEqual(s.chiamate[5].corpo, { risposta: "r" });
  assert.deepEqual(s.chiamate[7].corpo, { offerta: "o" });
  assert.deepEqual(s.chiamate[8].corpo, {});
});

test("chiudi e segnala: manda segnala true e riporta segnala dalla risposta", async () => {
  const s = finto(() => [200, { ok: true, vista: { fase: "finita", io: "chiama" }, segnala: true }]);
  assert.deepEqual(await crea(s.f).chiudi(true), { ok: true, vista: { fase: "finita", io: "chiama" }, segnala: true });
  assert.deepEqual(s.chiamate[0].corpo, { segnala: true });
});

test("i «no» delle regole tornano col loro motivo; errori di rete e server con motivi fissi", async () => {
  assert.deepEqual(await crea(finto(() => [200, { ok: false, motivo: "tre_con_lei" }]).f).apri(UUID, "o"), { ok: false, motivo: "tre_con_lei" });
  assert.deepEqual(await crea(finto(() => [401, { ok: false, motivo: "accesso" }]).f).stato(), { ok: false, motivo: "accesso" });
  assert.deepEqual(await crea(finto(() => [429, { ok: false, motivo: "troppe" }]).f).stato(), { ok: false, motivo: "troppe" });
  assert.deepEqual(await crea(finto(() => [503, { ok: false, motivo: "riprova" }]).f).stato(), { ok: false, motivo: "riprova" });
  assert.deepEqual(await crea(finto(() => [404, { ok: false, motivo: "spento" }]).f).stato(), { ok: false, motivo: "spento" });
  assert.deepEqual(await crea(finto(() => ["rete"]).f).stato(), { ok: false, motivo: "rete" });
  assert.deepEqual(await crea(finto(() => [200, "non json"]).f).stato(), { ok: false, motivo: "riprova" });
  // Un motivo strano dal server non arriva mai sullo schermo così com'è.
  assert.deepEqual(await crea(finto(() => [200, { ok: false, motivo: "<b>x</b>" }]).f).stato(), { ok: false, motivo: "riprova" });
});

test("senza token non parte nessuna richiesta", async () => {
  const s = finto();
  assert.deepEqual(await crea(s.f, null).stato(), { ok: false, motivo: "accesso" });
  assert.deepEqual(await creaChiamata({ token: async () => { throw new Error("x"); }, fetch: s.f }).carta(), { ok: false, motivo: "accesso" });
  assert.equal(s.chiamate.length, 0);
});

test("apri controlla la persona prima di chiamare il server", async () => {
  const s = finto();
  assert.deepEqual(await crea(s.f).apri("non-un-id", "o"), { ok: false, motivo: "dati" });
  assert.equal(s.chiamate.length, 0);
});

test("timer: minuti e secondi, mai negativo", () => {
  assert.equal(testoTimer(900), "15:00");
  assert.equal(testoTimer(845), "14:05");
  assert.equal(testoTimer(59), "0:59");
  assert.equal(testoTimer(0), "0:00");
  assert.equal(testoTimer(-3), "0:00");
  assert.equal(testoTimer(undefined), "0:00");
});

test("testi dei motivi: quelli della specifica, e un testo generico per tutto il resto", () => {
  assert.equal(testoMotivo("occupato"), "È in un'altra chiamata");
  assert.equal(testoMotivo("tre_con_lei"), "Avete già parlato 3 volte. Ora tocca alle chiavi");
  assert.equal(testoMotivo("cinque_oggi"), "Per oggi hai fatto 5 chiamate. A domani");
  assert.equal(testoMotivo("serve_permesso"), "Chiedi di parlare");
  assert.equal(testoMotivo("microfono"), "Per chiamare serve il microfono. Consentilo nelle impostazioni del telefono e riprova");
  assert.equal(testoMotivo("rete"), "Sei senza connessione. Riprova tra poco");
  assert.equal(testoMotivo("qualcosa"), "Non è andata. Riprova tra poco");
  for (const m of ["occupato", "tre_con_lei", "cinque_oggi", "cinque_oggi_lei", "fuori_fascia", "serve_permesso", "non_in_stanza",
    "stanza_chiusa", "stanza_chiude", "bloccati", "gia_in_chiamata", "troppo_presto", "fuori_tempo", "nessuna_carta", "nessuna",
    "accesso", "troppe", "spento", "riprova", "rete", "microfono", "dati", "solo_voce", "non_tocca_a_te"]) {
    const t = testoMotivo(m);
    assert.equal(typeof t, "string", m);
    assert.ok(t.length > 0 && !/gratis|niente foto/i.test(t), m);
  }
});

test("schermata: nessuna chiamata", () => {
  assert.deepEqual(schermata(null), { tipo: "nessuna" });
  assert.deepEqual(schermata(undefined), { tipo: "nessuna" });
});

test("schermata: squillo per chi chiama (solo «Chiudi») e per chi riceve («Rispondi» e «Rifiuta»)", () => {
  assert.deepEqual(schermata({ fase: "squilla", io: "chiama", squillo: 25 }, { nomeAltra: "Giulia" }),
    { tipo: "squillo_in_uscita", titolo: "Stai chiamando Giulia", testo: "Squilla… 25 s", pulsanti: ["chiudi"] });
  assert.deepEqual(schermata({ fase: "squilla", io: "riceve", squillo: 30 }, { nomeAltra: "Marco" }),
    { tipo: "squillo_in_arrivo", titolo: "Marco ti sta chiamando", testo: "Solo voce · 15 minuti", pulsanti: ["rispondi", "rifiuta"] });
  // Senza nome: mai «undefined» sullo schermo.
  assert.equal(schermata({ fase: "squilla", io: "riceve", squillo: 30 }).titolo, "Ti stanno chiamando");
});

const inCorso = (x = {}) => ({
  fase: "in_corso", io: "chiama", restanti: 880, ultimoMinuto: false, altraPersona: "collegata",
  carte: { visibile: true, attesa: 0 }, suggerimento: false, carta: null, ascolto: "fatto", ...x,
});

test("in chiamata: timer, Microfono, Carte, Chiudi, Chiudi e segnala; banner solo nei primi 10 secondi visti", () => {
  const s = schermata(inCorso(), { secondiVisti: 3 });
  assert.equal(s.tipo, "in_corso");
  assert.equal(s.timer, "14:40");
  assert.equal(s.banner, BANNER);
  assert.equal(BANNER, "Niente numeri, cognomi o social prima della porta");
  assert.deepEqual(s.pulsanti, ["microfono", "carte", "chiudi", "chiudi_e_segnala"]);
  assert.deepEqual(s.carte, { etichetta: "Carte", attiva: true });
  assert.equal(schermata(inCorso(), { secondiVisti: 10 }).banner, null);
  assert.equal(schermata(inCorso(), {}).banner, BANNER, "senza conteggio il banner resta: meglio un promemoria in più");
});

test("Carte: nascosto quando il server dice di no; con l'attesa il pulsante mostra il conto e non si tocca", () => {
  const nascoste = schermata(inCorso({ carte: { visibile: false, attesa: 0 } }), { secondiVisti: 20 });
  assert.equal(nascoste.carte, null);
  assert.deepEqual(nascoste.pulsanti, ["microfono", "chiudi", "chiudi_e_segnala"]);
  assert.deepEqual(schermata(inCorso({ carte: { visibile: true, attesa: 12 } }), { secondiVisti: 20 }).carte, { etichetta: "Carte · 12 s", attiva: false });
});

test("suggerimento discreto e ultimo minuto", () => {
  assert.equal(schermata(inCorso({ suggerimento: true }), { secondiVisti: 30 }).suggerimento, "Serve un'idea? Pesca una carta");
  assert.equal(schermata(inCorso(), { secondiVisti: 30 }).suggerimento, null);
  const fine = schermata(inCorso({ restanti: 42, ultimoMinuto: true, carte: { visibile: false, attesa: 0 } }), { secondiVisti: 900 });
  assert.equal(fine.avviso, "Ancora un minuto");
  assert.equal(fine.carte, null);
  assert.equal(schermata(inCorso(), { secondiVisti: 30 }).avviso, null);
});

test("carta aperta: testo e «Pescata da te» / «Pescata da <nome>»", () => {
  const mia = schermata(inCorso({ carta: { id: 4, testo: "Il viaggio più strano?", daMe: true } }), { secondiVisti: 40, nomeAltra: "Luca" });
  assert.deepEqual(mia.carta, { testo: "Il viaggio più strano?", da: "Pescata da te" });
  const sua = schermata(inCorso({ carta: { id: 4, testo: "Il viaggio più strano?", daMe: false } }), { secondiVisti: 40, nomeAltra: "Luca" });
  assert.deepEqual(sua.carta, { testo: "Il viaggio più strano?", da: "Pescata da Luca" });
  assert.equal(schermata(inCorso({ carta: { id: 4, testo: "X", daMe: false } }), { secondiVisti: 40 }).carta.da, "Pescata dall'altra persona");
  // Carta senza testo (non più attiva): non si mostra.
  assert.equal(schermata(inCorso({ carta: { id: 4, daMe: false } }), { secondiVisti: 40 }).carta, null);
});

test("l'altra persona ha perso la connessione: il timer continua e si dice che sta rientrando", () => {
  const s = schermata(inCorso({ altraPersona: "riconnessione" }), { secondiVisti: 60, nomeAltra: "Sara" });
  assert.equal(s.riconnessione, "Sara ha perso la connessione: ha 30 secondi per rientrare");
  assert.equal(s.timer, "14:40");
  assert.equal(schermata(inCorso(), { secondiVisti: 60 }).riconnessione, null);
});

test("ascolto da fare: l'app sa che deve ancora collegare la voce dell'altra persona", () => {
  assert.equal(schermata(inCorso({ ascolto: "da_fare" }), { secondiVisti: 1 }).ascolta, true);
  assert.equal(schermata(inCorso(), { secondiVisti: 1 }).ascolta, false);
});

test("chiamata finita: nessun pulsante della chiamata, solo il testo e «Segnala un problema»", () => {
  assert.deepEqual(schermata({ fase: "finita", io: "riceve" }),
    { tipo: "finita", titolo: "Chiamata finita", pulsanti: ["segnala_problema"] });
});

test("una vista con una fase sconosciuta non rompe lo schermo", () => {
  assert.deepEqual(schermata({ fase: "boh" }), { tipo: "nessuna" });
});

test("il service worker tiene anche chiamata.js e la versione cambia", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"/app/moduli/chiamata.js"'));
  assert.ok(!sw.includes('"presente-app-11"'));
});

test("il modulo non registra nulla e non usa il video", () => {
  const codice = readFileSync(new URL("../landing/app/moduli/chiamata.js", import.meta.url), "utf8");
  assert.ok(!/MediaRecorder|console\.|localStorage|video/i.test(codice.replace(/\/\/.*$/gm, "")));
});
