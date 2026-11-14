// «Quando posso ricevere chiamate» nel profilo (issue #4, spec v1.3 del CPO, 13/11, § 1), passo 3c-5b-1.
// Solo dati inventati, nessuna rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ORARI_DALLE, ORARI_ALLE, FASCIA_DEFAULT, controlla, testoSalvato, oggiDiRoma, daProfilo, campiDaSalvare, TESTI }
  from "../landing/app/moduli/disponibilita.js";
import { controllaFascia, FASCIA_DEFAULT as FASCIA_SERVER, ERRORE_FASCIA, giornoDiRoma } from "../api/chiamate.js";
import { oraDiRoma } from "../api/stanze.js";
import { creaSalvataggio, statoDaSalvato } from "../landing/app/moduli/salvataggio.js";

const MARTEDI = (h, m = 0) => oraDiRoma(2026, 11, 10, h, m);

test("selettori con passo di 30 minuti: «Dalle» 00:00–23:30, «Alle» 00:30–24:00", () => {
  assert.equal(ORARI_DALLE.length, 48);
  assert.equal(ORARI_DALLE[0], "00:00");
  assert.equal(ORARI_DALLE.at(-1), "23:30");
  assert.equal(ORARI_ALLE.length, 48);
  assert.equal(ORARI_ALLE[0], "00:30");
  assert.equal(ORARI_ALLE.at(-1), "24:00");
  assert.ok([...ORARI_DALLE, ...ORARI_ALLE].every((o) => /^\d{2}:(00|30)$/.test(o)));
});

test("default 9:00–23:00, uguale a quello del server", () => {
  assert.deepEqual(FASCIA_DEFAULT, FASCIA_SERVER);
});

test("stesso controllo del server per ogni coppia dei selettori (nessuna fascia che il server rifiuterebbe)", () => {
  for (const da of ORARI_DALLE) for (const a of ORARI_ALLE) {
    assert.equal(controlla(da, a).ok, controllaFascia(da, a).ok, `${da}-${a}`);
  }
  assert.deepEqual(controlla("19:00", "19:30"), { ok: false, errore: ERRORE_FASCIA });
  assert.deepEqual(controlla("22:00", "01:00"), { ok: false, errore: ERRORE_FASCIA });
  assert.equal(TESTI.errore, "La fascia deve durare almeno un'ora e finire dopo l'inizio.");
});

test("testo dopo il salvataggio, come nella spec", () => {
  assert.equal(testoSalvato({ da: "19:00", a: "23:00" }), "Salvato. Da adesso ti chiamano dalle 19:00 alle 23:00.");
  assert.equal(testoSalvato({ da: "09:00", a: "24:00" }), "Salvato. Da adesso ti chiamano dalle 9:00 alle 24:00.");
});

test("giorno di Roma per la pausa: lo stesso del server, anche a cavallo della mezzanotte", () => {
  for (const t of [MARTEDI(0, 10), MARTEDI(12), MARTEDI(23, 59), new Date("2026-11-10T23:30:00Z")]) {
    assert.equal(oggiDiRoma(t), giornoDiRoma(t));
  }
});

test("dal profilo: fascia salvata se valida, altrimenti il default; pausa accesa solo se è di oggi", () => {
  assert.deepEqual(daProfilo({ fascia_da: "19:00", fascia_a: "23:00", pausa_il: "2026-11-10" }, MARTEDI(20)),
    { da: "19:00", a: "23:00", pausa: true });
  assert.deepEqual(daProfilo({ fascia_da: "19:00", fascia_a: "23:00", pausa_il: "2026-11-09" }, MARTEDI(20)),
    { da: "19:00", a: "23:00", pausa: false });
  assert.deepEqual(daProfilo({ fascia_da: null, fascia_a: null }, MARTEDI(20)), { da: "09:00", a: "23:00", pausa: false });
  assert.deepEqual(daProfilo({ fascia_da: "19:15", fascia_a: "20:00" }, MARTEDI(20)), { da: "09:00", a: "23:00", pausa: false });
  assert.deepEqual(daProfilo(null, MARTEDI(20)), { da: "09:00", a: "23:00", pausa: false });
});

test("campi da salvare: fascia e pausa solo per oggi (spenta = null)", () => {
  assert.deepEqual(campiDaSalvare({ da: "19:00", a: "23:00", pausa: true }, MARTEDI(20)),
    { ok: true, campi: { fascia_da: "19:00", fascia_a: "23:00", pausa_il: "2026-11-10" } });
  assert.deepEqual(campiDaSalvare({ da: "19:00", a: "23:00", pausa: false }, MARTEDI(20)),
    { ok: true, campi: { fascia_da: "19:00", fascia_a: "23:00", pausa_il: null } });
  assert.deepEqual(campiDaSalvare({ da: "20:00", a: "20:30", pausa: false }, MARTEDI(20)),
    { ok: false, errore: ERRORE_FASCIA });
});

// --- Salvataggio su Supabase (finto) -------------------------------------------------------------------------
const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
function finto(rispondi) {
  const chiamate = [];
  const f = async (url, o = {}) => {
    const u = new URL(url);
    chiamate.push({ percorso: u.pathname, query: u.searchParams, metodo: o.method, headers: o.headers, corpo: o.body && JSON.parse(o.body) });
    const [stato, dati] = rispondi();
    return new Response(stato === 204 ? null : JSON.stringify(dati), { status: stato });
  };
  return { f, chiamate };
}
const crea = (f) => creaSalvataggio({ supabaseUrl: BASE, supabaseAnonKey: "anon", token: async () => "tok", utenteId: () => ID, fetch: f });

test("salvaDisponibilita: PATCH sulla propria riga, solo fascia_da, fascia_a e pausa_il", async () => {
  const s = finto(() => [204, null]);
  const r = await crea(s.f).salvaDisponibilita({ fascia_da: "19:00", fascia_a: "23:00", pausa_il: null, nome: "no", passo: 99 });
  assert.deepEqual(r, { ok: true });
  const c = s.chiamate[0];
  assert.equal(c.metodo, "PATCH");
  assert.equal(c.percorso, "/rest/v1/profili");
  assert.equal(c.query.get("id"), `eq.${ID}`);
  assert.equal(c.headers.authorization, "Bearer tok");
  assert.deepEqual(c.corpo, { fascia_da: "19:00", fascia_a: "23:00", pausa_il: null });
});

test("salvaDisponibilita: il messaggio della regola sulla pausa passa così com'è, il resto no", async () => {
  const regola = "«Oggi non ricevo chiamate» vale solo per oggi.";
  assert.deepEqual(await crea(finto(() => [400, { message: regola }]).f).salvaDisponibilita({ pausa_il: "2026-11-09" }),
    { ok: false, motivo: "regola", messaggio: regola });
  assert.deepEqual(await crea(finto(() => [400, { message: "violates check constraint fascia_v13" }]).f).salvaDisponibilita({ fascia_da: "19:00" }),
    { ok: false, motivo: "salvataggio" });
});

test("al rientro lo stato porta fascia e pausa lette dal profilo", () => {
  const s = { questionario: { risposte: {}, importanza: {} } };
  statoDaSalvato(s, { profilo: { nome: "Giulia", fascia_da: "19:00", fascia_a: "23:00", pausa_il: "2026-11-10", passo: 10 } });
  assert.equal(s.fasciaDa, "19:00");
  assert.equal(s.fasciaA, "23:00");
  assert.equal(s.pausaIl, "2026-11-10");
});

test("il service worker conosce il modulo nuovo e ha cambiato versione", () => {
  const sw = readFileSync(new URL("../landing/app/sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"/app/moduli/disponibilita.js"'));
  assert.ok(!sw.includes('"presente-app-16"'));
});

test("la schermata del profilo usa etichette visibili, il testo della spec e il link «Torna al profilo»", () => {
  const flusso = readFileSync(new URL("../landing/app/moduli/flusso.js", import.meta.url), "utf8");
  assert.deepEqual([TESTI.titolo, TESTI.dalle, TESTI.alle, TESTI.pausa], ["Quando posso ricevere chiamate", "Dalle", "Alle", "Oggi non ricevo chiamate"]);
  for (const t of ["TESTI_FASCIA.titolo", "TESTI_FASCIA.dalle", "TESTI_FASCIA.alle", "TESTI_FASCIA.pausa", "Torna al profilo"]) assert.ok(flusso.includes(t), t);
  assert.match(flusso, /role: "switch"/);
  assert.match(flusso, /h\("label", \{ for: id \}, etichetta\)/);
  assert.match(flusso, /selettore\("fascia-da", TESTI_FASCIA\.dalle/);
  assert.match(flusso, /selettore\("fascia-a", TESTI_FASCIA\.alle/);
});
