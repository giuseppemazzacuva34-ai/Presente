// «Stanza viva» e «Fissa una chiamata» nella web app (issue #380, spec v1 del CPO del 23/11, schermate 19-20), passo
// 5c della linea CTO: regole della pagina e richieste al Worker. Il telefono non decide niente di definitivo: orari,
// messaggio, limiti e stati li ricontrolla il server. Qui solo cosa mostrare. Orologio finto, fetch finto, nessuna rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TESTI_FISSA, azioneRiga, giorniEOre, quandoTesto, avvisiAppuntamenti, rigaStato, creaStanzaViva,
} from "../landing/app/moduli/appuntamenti_stanza.js";
import { TESTI_APPUNTAMENTI, APPUNTAMENTI } from "../api/appuntamenti.js";

const A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const B = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const APP = "aaaaaaaa-0000-4ccc-8ddd-eeeeeeeeeeee";
// Martedì 24/11/2026 alle 11:00 di Roma.
const MARTEDI = new Date("2026-11-24T10:00:00Z");
// Domenica 29/11/2026: 20:29 e 20:30 di Roma.
const DOM_2029 = new Date("2026-11-29T19:29:00Z");
const DOM_2030 = new Date("2026-11-29T19:30:00Z");

test("i testi della pagina sono quelli del server (la pagina non può importare api/appuntamenti.js)", () => {
  assert.equal(TESTI_FISSA.contatti, TESTI_APPUNTAMENTI.contatti);
  assert.equal(TESTI_FISSA.treAperti, TESTI_APPUNTAMENTI.treAperti);
  assert.equal(TESTI_FISSA.massimo, APPUNTAMENTI.messaggioMassimo);
  assert.equal(TESTI_FISSA.segnaleOgni, APPUNTAMENTI.segnaleOgni * 1000);
  assert.equal(TESTI_FISSA.segnaposto, "Ti va di sentirci stasera?");
  assert.equal(TESTI_FISSA.spiega("Luca"), "Luca riceve la proposta e la conferma, o te ne propone un'altra. Vi avvisiamo 10 minuti prima.");
});

test("riga: online e chiamabile → CHIAMA", () => {
  assert.deepEqual(azioneRiga({ etichetta: "Chiama", stato: "online", adesso: MARTEDI }), { tipo: "chiama", testo: "Chiama" });
});

test("riga: FISSA al posto di CHIAMA se in chiamata, non in linea, fuori fascia o in pausa (testo del server)", () => {
  assert.equal(azioneRiga({ etichetta: "Chiama", stato: "non_in_linea", adesso: MARTEDI }).tipo, "fissa");
  assert.equal(azioneRiga({ etichetta: "Chiama", stato: "in_chiamata", adesso: MARTEDI }).tipo, "fissa");
  assert.equal(azioneRiga({ etichetta: "È in un'altra chiamata", stato: "online", adesso: MARTEDI }).tipo, "fissa");
  // Fuori fascia e pausa hanno lo stesso testo: la pausa non si scopre.
  const f = azioneRiga({ etichetta: "Disponibile da 20:00", stato: "online", adesso: MARTEDI });
  assert.deepEqual(f, { tipo: "fissa", testo: "Fissa", motivo: "Disponibile da 20:00" });
});

test("riga: niente FISSA dopo 3 chiamate, con il limite di oggi o «chiedi di parlare»: resta il testo del server", () => {
  for (const etichetta of ["Avete già parlato 3 volte. Ora tocca alle chiavi", "Per oggi hai fatto 5 chiamate. A domani",
    "Per oggi non può ricevere altre chiamate. Riprova domani.", "Chiedi di parlare"]) {
    assert.deepEqual(azioneRiga({ etichetta, stato: "non_in_linea", adesso: MARTEDI }), { tipo: "testo", testo: etichetta });
  }
});

test("riga: domenica da 20:30 FISSA sparisce", () => {
  assert.equal(azioneRiga({ etichetta: "Chiama", stato: "non_in_linea", adesso: DOM_2029 }).tipo, "fissa");
  assert.notEqual(azioneRiga({ etichetta: "Chiama", stato: "non_in_linea", adesso: DOM_2030 }).tipo, "fissa");
  assert.deepEqual(azioneRiga({ etichetta: "Disponibile da 20:00", stato: "online", adesso: DOM_2030 }),
    { tipo: "testo", testo: "Disponibile da 20:00" });
});

test("riga: con un appuntamento aperto con quella persona niente FISSA; all'ora fissata CHIAMA per 15 minuti", () => {
  assert.equal(azioneRiga({ etichetta: "Chiama", stato: "non_in_linea", adesso: MARTEDI, appuntamento: { fase: "fissato" } }).tipo, "testo");
  assert.equal(azioneRiga({ etichetta: "Disponibile da 20:00", stato: "online", adesso: MARTEDI, appuntamento: { fase: "in_attesa" } }).tipo, "testo");
  assert.deepEqual(azioneRiga({ etichetta: "Disponibile da 20:00", stato: "online", adesso: MARTEDI, appuntamento: { fase: "chiama" } }),
    { tipo: "chiama", testo: "Chiama" });
  // Appuntamento finito o annullato: come se non ci fosse.
  assert.equal(azioneRiga({ etichetta: "Chiama", stato: "non_in_linea", adesso: MARTEDI, appuntamento: { fase: "annullato" } }).tipo, "fissa");
});

test("riga: stato sempre scritto, «in chiamata con <nome>» solo se si vede l'altra persona", () => {
  const nomi = new Map([[B, "Sara"]]);
  assert.equal(rigaStato({ stato: "online", testo: "online" }, nomi), "online");
  assert.equal(rigaStato({ stato: "in_chiamata", testo: "in chiamata", con: B }, nomi), "in chiamata con Sara");
  assert.equal(rigaStato({ stato: "in_chiamata", testo: "in chiamata", con: A }, nomi), "in chiamata");
  assert.equal(rigaStato({ stato: "non_in_linea", testo: "non in linea · da 2 h" }, nomi), "non in linea · da 2 h");
  assert.equal(rigaStato(undefined, nomi), "");
  assert.equal(rigaStato({ stato: "online", testo: "alle 21:13" }, nomi), "", "un testo inatteso non si mostra");
});

test("giorni e ore: Oggi, Domani, poi il nome del giorno; ore di Roma", () => {
  const ore = ["2026-11-24T19:00:00.000Z", "2026-11-24T19:30:00.000Z", "2026-11-25T19:00:00.000Z", "2026-11-26T20:30:00.000Z"];
  assert.deepEqual(giorniEOre(ore, MARTEDI), [
    { id: "2026-11-24", nome: "Oggi", ore: [{ iso: ore[0], testo: "20:00" }, { iso: ore[1], testo: "20:30" }] },
    { id: "2026-11-25", nome: "Domani", ore: [{ iso: ore[2], testo: "20:00" }] },
    { id: "2026-11-26", nome: "Giovedì", ore: [{ iso: ore[3], testo: "21:30" }] },
  ]);
  assert.deepEqual(giorniEOre([], MARTEDI), []);
  assert.deepEqual(giorniEOre(["ieri", null], MARTEDI), []);
});

test("quando: «oggi alle 21:00», «domani alle …», «giovedì alle …»", () => {
  assert.equal(quandoTesto("2026-11-24T20:00:00.000Z", MARTEDI), "oggi alle 21:00");
  assert.equal(quandoTesto("2026-11-25T20:00:00.000Z", MARTEDI), "domani alle 21:00");
  assert.equal(quandoTesto("2026-11-26T08:30:00.000Z", MARTEDI), "giovedì alle 9:30");
});

const app = (extra = {}) => ({
  id: APP, altra: B, propostoDaMe: false, stato: "proposto", quando: "2026-11-24T20:00:00.000Z",
  messaggio: "Ti va di sentirci stasera?", fase: "in_attesa", puoControproporre: true, annullatoDallAltra: false, ...extra,
});
const nomi = new Map([[B, "Sara"]]);

test("avvisi: proposta ricevuta con CONFERMA, UN ALTRO ORARIO, NO GRAZIE e il messaggio", () => {
  const [a] = avvisiAppuntamenti([app()], nomi, MARTEDI);
  assert.equal(a.testo, "Sara ti propone una chiamata · oggi alle 21:00");
  assert.equal(a.messaggio, "Ti va di sentirci stasera?");
  assert.deepEqual(a.azioni.map((x) => x.azione), ["conferma", "altro", "no"]);
  assert.deepEqual(a.azioni.map((x) => x.testo), ["Conferma", "Un altro orario", "No, grazie"]);
  const [b] = avvisiAppuntamenti([app({ puoControproporre: false })], nomi, MARTEDI);
  assert.deepEqual(b.azioni.map((x) => x.azione), ["conferma", "no"], "dopo 2 controproposte niente «un altro orario»");
});

test("avvisi: proposta mandata, fissata, promemoria, ora della chiamata", () => {
  const [m] = avvisiAppuntamenti([app({ propostoDaMe: true })], nomi, MARTEDI);
  assert.equal(m.testo, "Proposta mandata a Sara · oggi alle 21:00");
  assert.deepEqual(m.azioni.map((x) => x.azione), ["annulla"]);
  assert.equal(m.messaggio, null, "il proprio messaggio non si ripete");
  const [f] = avvisiAppuntamenti([app({ stato: "confermato", fase: "fissato" })], nomi, MARTEDI);
  assert.equal(f.testo, "◷ Chiamata fissata con Sara oggi alle 21:00");
  assert.deepEqual(f.azioni.map((x) => [x.azione, x.testo]), [["annulla", "Annulla l'appuntamento"]]);
  const [p] = avvisiAppuntamenti([app({ stato: "confermato", fase: "promemoria" })], nomi, MARTEDI);
  assert.equal(p.testo, "Tra 10 minuti: chiamata con Sara.");
  assert.equal(p.urgente, true);
  const [c] = avvisiAppuntamenti([app({ stato: "confermato", fase: "chiama" })], nomi, MARTEDI);
  assert.equal(c.testo, "◷ Chiamata fissata con Sara · adesso");
  assert.deepEqual(c.azioni.map((x) => x.azione), ["chiama"]);
});

test("avvisi: esiti per chi ha proposto, mai il motivo dell'altra persona", () => {
  const testi = (a) => avvisiAppuntamenti([app(a)], nomi, MARTEDI).map((x) => x.testo);
  assert.deepEqual(testi({ propostoDaMe: true, stato: "rifiutato", fase: "rifiutato" }), ["Sara non può a quell'ora."]);
  assert.deepEqual(testi({ propostoDaMe: true, stato: "scaduto", fase: "scaduto", testo: TESTI_APPUNTAMENTI.scaduta }), [TESTI_APPUNTAMENTI.scaduta]);
  assert.deepEqual(testi({ stato: "annullato", fase: "annullato", annullatoDallAltra: true, testo: TESTI_APPUNTAMENTI.annullato }),
    ["Sara ha annullato l'appuntamento."]);
  assert.deepEqual(testi({ stato: "annullato", fase: "annullato", testo: TESTI_APPUNTAMENTI.annullato }), [TESTI_APPUNTAMENTI.annullato]);
  assert.deepEqual(testi({ stato: "tre_chiamate", fase: "tre_chiamate", testo: TESTI_APPUNTAMENTI.treChiamate }), [TESTI_APPUNTAMENTI.treChiamate]);
  // Appuntamento finito (15 minuti passati) o persona che non si vede più: niente.
  assert.deepEqual(testi({ stato: "confermato", fase: "finito" }), []);
  assert.deepEqual(avvisiAppuntamenti([app()], new Map(), MARTEDI), []);
});

// ── Richieste al Worker ──
function fetchFinto(risposte = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url, "https://presenteincontri.app");
    viste.push({ percorso: u.pathname + u.search, metodo: opzioni.method || "GET", headers: opzioni.headers || {},
      corpo: opzioni.body ? JSON.parse(opzioni.body) : undefined });
    const chiave = `${opzioni.method || "GET"} ${u.pathname}${u.search}`;
    const r = risposte[chiave];
    if (r instanceof Error) throw r;
    return r ? Response.json(r.corpo, { status: r.stato || 200 }) : Response.json({ ok: false }, { status: 404 });
  };
  return { f, viste };
}

test("client: senza token nessuna richiesta", async () => {
  const s = fetchFinto();
  const v = creaStanzaViva({ token: () => null, fetch: s.f });
  assert.equal((await v.stati()).ok, false);
  assert.equal((await v.segnale()).ok, false);
  assert.equal(s.viste.length, 0);
});

test("client: segnale POST, stati e appuntamenti GET con il token; ore per una persona", async () => {
  const s = fetchFinto({
    "POST /app/api/stanza/presenza": { corpo: { ok: true, inStanza: true } },
    "GET /app/api/stanza/presenza": { corpo: { ok: true, persone: [{ id: A, stato: "online", testo: "online", con: null, gruppo: "donne" }] } },
    "GET /app/api/stanza/appuntamenti": { corpo: { ok: true, appuntamenti: [app()] } },
    [`GET /app/api/stanza/appuntamenti?con=${B}`]: { corpo: { ok: true, ore: ["2026-11-24T19:00:00.000Z"] } },
  });
  const v = creaStanzaViva({ token: () => "tok", fetch: s.f });
  assert.deepEqual(await v.segnale(), { ok: true, inStanza: true });
  const st = await v.stati();
  assert.equal(st.persone[0].gruppo, "donne");
  assert.equal((await v.appuntamenti()).appuntamenti.length, 1);
  assert.deepEqual((await v.ore(B)).ore, ["2026-11-24T19:00:00.000Z"]);
  assert.ok(s.viste.every((x) => x.headers.authorization === "Bearer tok"));
  assert.equal((await v.ore("non-un-id")).ok, false, "id non valido: nessuna richiesta");
  assert.equal(s.viste.length, 4);
});

test("client: proponi e risposte mandano solo i campi previsti; i rifiuti arrivano con il testo del server", async () => {
  const s = fetchFinto({ "POST /app/api/stanza/appuntamenti": { corpo: { ok: false, motivo: "contatti", testo: TESTI_APPUNTAMENTI.contatti } } });
  const v = creaStanzaViva({ token: () => "tok", fetch: s.f });
  const r = await v.proponi({ con: B, quando: "2026-11-24T19:00:00.000Z", messaggio: "  scrivimi su insta  ", extra: 1 });
  assert.deepEqual(r, { ok: false, motivo: "contatti", testo: TESTI_APPUNTAMENTI.contatti });
  assert.deepEqual(s.viste[0].corpo, { azione: "proponi", con: B, quando: "2026-11-24T19:00:00.000Z", messaggio: "scrivimi su insta" });
  await v.rispondi(APP, "conferma");
  await v.rispondi(APP, "altro", { quando: "2026-11-24T19:30:00.000Z", messaggio: "" });
  await v.rispondi(APP, "annulla");
  assert.deepEqual(s.viste.slice(1).map((x) => x.corpo), [
    { azione: "conferma", id: APP },
    { azione: "altro", id: APP, quando: "2026-11-24T19:30:00.000Z", messaggio: null },
    { azione: "annulla", id: APP },
  ]);
  assert.equal((await v.rispondi(APP, "cancella-tutto")).ok, false);
  assert.equal(s.viste.length, 4, "azione sconosciuta: nessuna richiesta");
});

test("client: rete giù o 503 → testo generico, mai un esito inventato", async () => {
  const s = fetchFinto({ "POST /app/api/stanza/appuntamenti": new Error("rete"), "GET /app/api/stanza/presenza": { stato: 503, corpo: { ok: false, motivo: "riprova" } } });
  const v = creaStanzaViva({ token: () => "tok", fetch: s.f });
  const r = await v.proponi({ con: B, quando: "2026-11-24T19:00:00.000Z" });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "rete");
  const st = await v.stati();
  assert.equal(st.ok, false);
});

test("il modulo non usa salvataggi locali, timer globali o librerie esterne", () => {
  const sorgente = readFileSync(new URL("../landing/app/moduli/appuntamenti_stanza.js", import.meta.url), "utf8");
  assert.doesNotMatch(sorgente, /localStorage|sessionStorage|indexedDB|document\.cookie|https?:\/\//);
  assert.doesNotMatch(sorgente, /console\.log/);
});
