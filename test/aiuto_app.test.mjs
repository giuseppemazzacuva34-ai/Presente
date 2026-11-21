// Pagina Aiuto nella web app (issue #10, spec v1 del CPO, parte A; passo 3a della linea «sviluppatore-c»):
// testi della spec, «Scrivici» (categoria + testo con contatore), «I miei messaggi» e filtro «Cerca» locale.
// Il corpo non dice mai chi scrive: lo dice il token (worker/supporto_api.js). Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TESTI_AIUTO, CATEGORIE_SCRIVICI, moduloScrivici, corpoScrivici, confermaScrivici, contatore, filtraDomande,
  testoErroreAiuto, statoMessaggio, creaAiuto,
} from "../landing/app/moduli/aiuto.js";
import { CATEGORIE } from "../api/supporto.js";

const ID = "11111111-2222-4333-8444-555555555555";

test("testi della spec: «Sono in difficoltà» in alto, «Scrivici» in fondo, conferma dopo l'invio", () => {
  assert.equal(TESTI_AIUTO.titolo, "Aiuto");
  assert.equal(TESTI_AIUTO.sicurezza, "Hai bisogno di aiuto subito per la tua sicurezza?");
  assert.equal(TESTI_AIUTO.difficolta, "Sono in difficoltà");
  assert.equal(TESTI_AIUTO.domande, "Domande frequenti");
  assert.equal(TESTI_AIUTO.cerca, "Cerca");
  assert.equal(TESTI_AIUTO.nonTrovato, "Non hai trovato la risposta?");
  assert.equal(TESTI_AIUTO.scrivici, "Scrivici");
  assert.equal(TESTI_AIUTO.miei, "I miei messaggi");
  assert.equal(confermaScrivici({ sicurezza: false }).testo, "Ricevuto. Ti rispondiamo per email entro 48 ore (di solito prima)");
});

test("le 7 categorie della spec, nello stesso ordine e con gli stessi codici del server", () => {
  assert.deepEqual(CATEGORIE_SCRIVICI.map(([, t]) => t), ["Account e accesso", "Stanza e chiamate", "Chiavi e porte", "Coin", "Incontro", "Test", "Altro"]);
  assert.deepEqual(CATEGORIE_SCRIVICI.map(([v]) => v), Object.keys(CATEGORIE));
});

test("modulo: email dell'account mostrata e non modificabile, massimo 1.000, nessun allegato", () => {
  const m = moduloScrivici("prova@example.invalid");
  assert.equal(m.email, "prova@example.invalid");
  assert.equal(m.emailModificabile, false);
  assert.equal(m.massimo, 1000);
  assert.equal(m.invia, "Invia");
  assert.equal("allegati" in m, false);
});

test("contatore visibile: conta le lettere vere (una emoji = 1)", () => {
  assert.equal(contatore(""), "0/1000");
  assert.equal(contatore("ciao 😀"), "6/1000");
});

test("corpo: solo categoria e testo, mai chi scrive; vuoto e troppo lungo fermati prima dell'invio", () => {
  assert.deepEqual(corpoScrivici({ categoria: "account", testo: "Non entro" }), { ok: true, corpo: { categoria: "account", testo: "Non entro" } });
  assert.deepEqual(corpoScrivici({ categoria: "account", testo: "   " }), { ok: false, errore: "Scrivi cosa è successo, anche in due parole" });
  assert.equal(corpoScrivici({ categoria: "boh", testo: "x" }).ok, false);
  assert.equal(corpoScrivici({ categoria: "altro", testo: "a".repeat(1001) }).ok, false);
});

test("messaggio con bandiera «sicurezza»: la conferma mostra subito «Sono in difficoltà»", () => {
  assert.equal(confermaScrivici({ sicurezza: true }).difficolta, "Sono in difficoltà");
  assert.equal(confermaScrivici({ sicurezza: false }).difficolta, null);
});

test("errori: «troppi» e «vuoto» con i testi della spec", () => {
  assert.equal(testoErroreAiuto("troppi"), "Hai già scritto 5 volte oggi. Ti rispondiamo su quelle");
  assert.equal(testoErroreAiuto("vuoto"), "Scrivi cosa è successo, anche in due parole");
  assert.equal(testoErroreAiuto("rete"), "Sei senza connessione. Riprova tra poco.");
  assert.equal(testoErroreAiuto("qualcosa"), "Non è andata. Riprova tra poco.");
});

test("stato dei messaggi: Inviato / Risposto", () => {
  assert.equal(statoMessaggio({ stato: "inviato" }), "Inviato");
  assert.equal(statoMessaggio({ stato: "risposto" }), "Risposto");
});

test("«Cerca» filtra sul telefono, senza lettere maiuscole né accenti che contano", () => {
  const domande = [{ domanda: "Come funzionano le chiavi", risposta: "Due a settimana." }, { domanda: "Le mie foto chi le vede", risposta: "Solo dopo il sì." }];
  assert.equal(filtraDomande(domande, "").length, 2);
  assert.deepEqual(filtraDomande(domande, "CHIAVI").map((d) => d.domanda), ["Come funzionano le chiavi"]);
  assert.deepEqual(filtraDomande(domande, "si").map((d) => d.domanda), ["Le mie foto chi le vede"]);
  assert.equal(filtraDomande(domande, "zzz").length, 0);
});

function rete(risposte) {
  const viste = [];
  const f = async (url, o = {}) => {
    viste.push({ url, metodo: o.method || "GET", headers: o.headers || {}, corpo: o.body ? JSON.parse(o.body) : null });
    const r = risposte.shift();
    if (r instanceof Error) throw r;
    return typeof r === "number" ? new Response("{}", { status: r }) : Response.json(r);
  };
  return { f, viste };
}

test("invio: POST /app/api/supporto con il token, il corpo non contiene chi scrive", async () => {
  const { f, viste } = rete([{ ok: true, id: ID, sicurezza: true }]);
  const a = creaAiuto({ token: async () => "token-di-prova-abcdefghij", fetch: f });
  assert.deepEqual(await a.invia({ categoria: "incontro", testo: "mi segue" }), { ok: true, id: ID, sicurezza: true });
  assert.equal(viste[0].url, "/app/api/supporto");
  assert.equal(viste[0].metodo, "POST");
  assert.equal(viste[0].headers.authorization, "Bearer token-di-prova-abcdefghij");
  assert.deepEqual(viste[0].corpo, { categoria: "incontro", testo: "mi segue" });
});

test("invio: senza accesso, rete giù, 429, 404 e motivi del server", async () => {
  assert.deepEqual(await creaAiuto({ token: async () => null, fetch: rete([]).f }).invia({}), { ok: false, motivo: "accesso" });
  const conRisposta = (r) => creaAiuto({ token: async () => "t".repeat(30), fetch: rete([r]).f });
  assert.deepEqual(await conRisposta(new Error("giù")).invia({}), { ok: false, motivo: "rete" });
  assert.deepEqual(await conRisposta(429).invia({}), { ok: false, motivo: "troppe" });
  assert.deepEqual(await conRisposta(404).invia({}), { ok: false, motivo: "spento" });
  assert.deepEqual(await conRisposta({ ok: false, motivo: "troppi" }).invia({}), { ok: false, motivo: "troppi" });
  assert.deepEqual(await conRisposta({ ok: false, motivo: "strano" }).invia({}), { ok: false, motivo: "riprova" });
});

test("«I miei messaggi»: GET con il token, solo i campi attesi", async () => {
  const m = { id: ID, categoria: "altro", testo: "ciao", creatoIl: "2026-11-16T10:00:00Z", stato: "risposto", risposta: "Eccoci", rispostoIl: "2026-11-16T12:00:00Z" };
  const { f, viste } = rete([{ ok: true, email: "prova@example.invalid", messaggi: [m] }]);
  const a = creaAiuto({ token: async () => "t".repeat(30), fetch: f });
  assert.deepEqual(await a.miei(), { ok: true, email: "prova@example.invalid", messaggi: [m] });
  assert.equal(viste[0].metodo, "GET");
  assert.equal(viste[0].url, "/app/api/supporto");
  assert.deepEqual(await creaAiuto({ token: async () => "t".repeat(30), fetch: rete([503]).f }).miei(), { ok: false, motivo: "riprova" });
});
