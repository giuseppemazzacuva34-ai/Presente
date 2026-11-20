// Pagina del pannello di chi decide (issue #7, «Cosa vede chi decide»; D51 A) · linea «sviluppatore-b», passo 13c.
// Il modulo parla solo con /app/api/pannello/* (Worker) col token di chi decide. Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ETICHETTE_MOTIVI, AZIONI_PANNELLO, REGOLE_PANNELLO, tempoCheResta, vociCoda, schedaLeggibile, creaPannello }
  from "../landing/app/moduli/pannello.js";
import { MOTIVI } from "../api/segnalazioni.js";
import { REGOLE_COMMUNITY, ID_REGOLE } from "../landing/app/moduli/regole_community.js";
import { AZIONI } from "../worker/pannello_api.js";

const SEG = "66666666-7777-4888-9999-000000000000";
const ADESSO = new Date("2026-11-16T15:00:00Z");

test("etichette per tutti i motivi e tutte le azioni del server", () => {
  assert.deepEqual(Object.keys(ETICHETTE_MOTIVI).sort(), Object.keys(MOTIVI).sort());
  assert.deepEqual(AZIONI_PANNELLO.map(([a]) => a), [...AZIONI]);
  assert.equal(AZIONI_PANNELLO[0][1], "Archivia (nessuna violazione)");
  // Spec v1.2: le 10 Regole della community ufficiali, niente «Altre regole».
  assert.equal(REGOLE_PANNELLO, REGOLE_COMMUNITY);
  for (const [id] of REGOLE_PANNELLO) assert.ok(ID_REGOLE.includes(id));
});

test("tempo che resta: minuti, ore, giorni e scadute", () => {
  assert.equal(tempoCheResta("2026-11-16T15:45:00Z", ADESSO), "Restano 45 min");
  assert.equal(tempoCheResta("2026-11-16T17:10:00Z", ADESSO), "Restano 2 h 10 min");
  assert.equal(tempoCheResta("2026-11-18T16:00:00Z", ADESSO), "Restano 2 g 1 h");
  assert.equal(tempoCheResta("2026-11-16T14:00:00Z", ADESSO), "Scaduta da 1 h");
  assert.equal(tempoCheResta("niente", ADESSO), "");
});

test("coda: voci leggibili, in rosso le scadute e le priorità da 1 ora non aperte", () => {
  const [v] = vociCoda([{ id: SEG, motivo: "minacce_pericolo", origine: "dopo_chiamata", ore: 1, creata_il: "2026-11-16T14:50:00Z",
    scade_il: "2026-11-16T15:50:00Z", aperta: false, nome_da: "Carla", nome_contro: "Bruno", in_sospensione: true, archiviate_di_chi_segnala: 2 }], ADESSO);
  assert.equal(v.id, SEG);
  assert.equal(v.motivo, "Minacce, o mi sono sentita/o in pericolo");
  assert.equal(v.priorita, "Priorità 1 ora");
  assert.equal(v.chi, "Carla segnala Bruno");
  assert.equal(v.resta, "Restano 50 min");
  assert.equal(v.rossa, true);
  assert.deepEqual(v.note, ["Nuova", "Sospensione in corso", "Chi segnala ha 2 segnalazioni archiviate"]);
  const [w] = vociCoda([{ id: SEG, motivo: "sono_in_difficolta", ore: 1, scade_il: "2026-11-16T15:50:00Z", aperta: true,
    nome_da: null, nome_contro: null, in_sospensione: false, archiviate_di_chi_segnala: 0 }], ADESSO);
  assert.equal(w.chi, "Senza nome · nessuna persona collegata");
  assert.equal(w.rossa, false);
  assert.deepEqual(w.note, ["Aperta"]);
  assert.deepEqual(vociCoda([{ id: "x" }, null], ADESSO), []);
});

test("scheda: regola proposta dal motivo (solo un suggerimento)", () => {
  const base = { id: SEG, origine: "scheda", testo: "", creata_il: "2026-11-16T14:00:00Z", contro: SEG };
  assert.equal(schedaLeggibile({ segnalazione: { ...base, motivo: "contatti_prima_porta" } }).regolaProposta, "al_buio");
  assert.equal(schedaLeggibile({ segnalazione: { ...base, motivo: "minacce_pericolo" } }).regolaProposta, "sicurezza");
});

test("scheda: racconto, chiamate, porte e storico in frasi; mai campi non previsti", () => {
  const s = schedaLeggibile({
    segnalazione: { id: SEG, motivo: "altro", origine: "scheda", testo: "racconto", creata_il: "2026-11-16T14:00:00Z", nome_da: "Anna", nome_contro: "Bruno", contro: SEG },
    chiamate: [{ inizio: "2026-11-16T13:00:00Z", chiamava: "da", durata: 300, esito: "chiudi_e_segnala" }],
    porte: [{ aperta_il: "2026-11-15T20:00:00Z", esito: null }],
    storico: { segnalazioni: [{ motivo: "insulti", creata_il: "2026-11-01T10:00:00Z", esito: "archiviata" }], sanzioni: [{ livello: "avviso", regola: "rispetto", decisa_il: "2026-10-01T10:00:00Z" }] },
    diario: "non deve uscire",
  });
  assert.equal(s.titolo, "Altro");
  assert.equal(s.chi, "Anna segnala Bruno");
  assert.equal(s.testo, "racconto");
  assert.equal(s.chiamate[0], "16 nov, 14:00 · chiamava Anna · 5 min 0 s · chiusa con «Chiudi e segnala»");
  assert.equal(s.porte[0], "Porta aperta il 15 nov, 21:00 · in corso");
  assert.equal(s.storico[0], "Segnalazione «Insulti o mancanza di rispetto» del 1 nov, 11:00 · archiviata");
  assert.equal(s.storico[1], "Sanzione «Avviso» (Rispetto, sempre) del 1 ott, 12:00");
  assert.equal(s.sanzionabile, true);
  // Spec v1.2: per «Altro» nessuna regola proposta, si sceglie a mano.
  assert.equal(s.regolaProposta, "");
  assert.ok(!JSON.stringify(s).includes("non deve uscire"));
  assert.equal(schedaLeggibile(null), null);
});

function reteFinta(risposte) {
  const viste = [];
  const f = async (url, init = {}) => {
    viste.push([new URL(url, "https://presenteincontri.app").pathname, init.method || "GET", init.headers?.authorization, init.body ? JSON.parse(init.body) : null]);
    const r = risposte[new URL(url, "https://presenteincontri.app").pathname];
    return r ? Response.json(r.corpo, { status: r.stato || 200 }) : new Response("{}", { status: 404 });
  };
  return { f, viste };
}

test("client: coda, scheda e decisione al Worker col token; 403 → non_moderatore", async () => {
  const { f, viste } = reteFinta({
    "/app/api/pannello/coda": { corpo: { ok: true, coda: [] } },
    "/app/api/pannello/scheda": { corpo: { ok: true, scheda: { segnalazione: { id: SEG } } } },
    "/app/api/pannello/decidi": { corpo: { ok: true, sanzione: null } },
  });
  const p = creaPannello({ token: async () => "tok", fetch: f });
  assert.deepEqual(await p.coda(), { ok: true, coda: [] });
  assert.deepEqual(await p.scheda(SEG), { ok: true, scheda: { segnalazione: { id: SEG } } });
  assert.deepEqual(await p.decidi({ id: SEG, azione: "archivia", testo: " ok " }), { ok: true });
  assert.deepEqual(viste.map((v) => v.slice(0, 3)), [
    ["/app/api/pannello/coda", "GET", "Bearer tok"], ["/app/api/pannello/scheda", "POST", "Bearer tok"], ["/app/api/pannello/decidi", "POST", "Bearer tok"]]);
  assert.deepEqual(viste[2][3], { id: SEG, azione: "archivia", regola: "", testo: "ok" });
  const no = creaPannello({ token: async () => "tok", fetch: reteFinta({ "/app/api/pannello/coda": { stato: 403, corpo: { ok: false } } }).f });
  assert.deepEqual(await no.coda(), { ok: false, motivo: "non_moderatore" });
  const senza = creaPannello({ token: async () => null, fetch: f });
  assert.deepEqual(await senza.coda(), { ok: false, motivo: "accesso" });
});

test("client: decisione controllata prima di partire (motivo e regola)", async () => {
  const { f, viste } = reteFinta({});
  const p = creaPannello({ token: async () => "tok", fetch: f });
  assert.deepEqual(await p.decidi({ id: SEG, azione: "avviso", regola: "", testo: "x" }), { ok: false, motivo: "regola" });
  assert.deepEqual(await p.decidi({ id: SEG, azione: "avviso", regola: "rispetto", testo: "  " }), { ok: false, motivo: "testo" });
  assert.deepEqual(await p.decidi({ id: SEG, azione: "avviso", regola: "rispetto", testo: "a".repeat(101) }), { ok: false, motivo: "testo" });
  assert.deepEqual(await p.decidi({ id: SEG, azione: "avviso", regola: "Rispetto", testo: "x" }), { ok: false, motivo: "regola" });
  assert.deepEqual(await p.decidi({ id: SEG, azione: "banna", regola: "rispetto", testo: "x" }), { ok: false, motivo: "azione" });
  assert.equal(viste.length, 0);
});
