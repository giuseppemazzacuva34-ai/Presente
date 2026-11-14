// Chiamate solo voce (issue #4, passo 3b-2b-2a): letture dal database per aprire una chiamata.
// Finto fetch: si controlla quali indirizzi si chiedono (solo chiave del server, solo le colonne che servono)
// e cosa succede se Supabase non risponde. Nessuna rete, solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stanzaDi, datiPerChiamare } from "../api/dati_chiamata.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const S = "99999999-9999-4999-8999-999999999999";
const ENV = { SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "chiave-server" };
const ADESSO = new Date("2026-11-10T19:00:00Z");
const STANZA = { id: S, apre: new Date("2026-11-09T08:00:00Z"), chiude: new Date("2026-11-15T20:00:00Z") };

function finto(risposte) {
  const chieste = [];
  const f = async (url, init) => {
    chieste.push({ url: decodeURIComponent(url), init });
    for (const [pezzo, r] of risposte) {
      if (decodeURIComponent(url).includes(pezzo)) {
        if (r instanceof Error) throw r;
        return new Response(JSON.stringify(r.corpo ?? r), { status: r.stato ?? 200 });
      }
    }
    return new Response("[]", { status: 200 });
  };
  return { f, chieste };
}

test("stanzaDi: la stanza aperta adesso, con le date", async () => {
  const { f, chieste } = finto([["membri_stanza", [{ stanze: { id: S, apre_il: "2026-11-09T08:00:00+00:00", chiude_il: "2026-11-15T20:00:00+00:00" } }]]]);
  const s = await stanzaDi(ENV, A, ADESSO, f);
  assert.deepEqual(s, STANZA);
  const u = chieste[0].url;
  assert.ok(u.startsWith(ENV.SUPABASE_URL + "/rest/v1/membri_stanza?"));
  assert.ok(u.includes(`utente_id=eq.${A}`));
  assert.ok(u.includes("stanze.apre_il=lte.2026-11-10T19:00:00.000Z") && u.includes("stanze.chiude_il=gt.2026-11-10T19:00:00.000Z"));
  assert.equal(chieste[0].init.headers.apikey, "chiave-server");
});

test("stanzaDi: nessuna stanza, risposta strana, errore o chiavi mancanti → null", async () => {
  for (const r of [[], [{ stanze: null }], [{ stanze: { id: "x", apre_il: "a", chiude_il: "b" } }], { stato: 500, corpo: {} }, new Error("rete")]) {
    const { f } = finto([["membri_stanza", r]]);
    assert.equal(await stanzaDi(ENV, A, ADESSO, f), null);
  }
  const { f, chieste } = finto([]);
  assert.equal(await stanzaDi({}, A, ADESSO, f), null);
  assert.equal(await stanzaDi(ENV, "' or 1=1", ADESSO, f), null);
  assert.equal(chieste.length, 0);
});

test("datiPerChiamare: membri, chiamate della settimana, blocchi, fascia e permesso di chi riceve", async () => {
  const { f, chieste } = finto([
    ["membri_stanza", [{ utente_id: A }, { utente_id: B }]],
    ["/chiamate?", [{ chi: A, con: B, inizio: "2026-11-09T10:00:00+00:00", durata: 120 }]],
    ["blocchi", []],
    ["profili", [{ fascia_da: "19:00", fascia_a: "24:00", pausa_il: "2026-11-10", solo_con_permesso: true }]],
    ["permessi_chiamata", [{ permesso_a: A }]],
  ]);
  const r = await datiPerChiamare(ENV, { stanza: STANZA, chi: A, verso: B }, f);
  assert.deepEqual(r, {
    ok: true, membri: [A, B],
    chiamate: [{ chi: A, con: B, inizio: "2026-11-09T10:00:00+00:00", durata: 120 }],
    blocchi: [], fascia: { da: "19:00", a: "24:00" }, pausa: "2026-11-10", soloConPermesso: true, permessi: new Set([A]),
  });
  const tutte = chieste.map((c) => c.url).join("\n");
  assert.ok(tutte.includes(`membri_stanza?stanza_id=eq.${S}&select=utente_id`));
  // Chiamate dal giorno prima dell'apertura (per il conto «5 al giorno»), solo di A o B, solo 4 colonne.
  assert.ok(tutte.includes("chiamate?select=chi,con,inizio,durata&inizio=gte.2026-11-08T08:00:00.000Z"));
  assert.ok(tutte.includes(`or=(chi.in.(${A},${B}),con.in.(${A},${B}))`));
  assert.ok(tutte.includes(`or=(and(chi.eq.${A},bloccato.eq.${B}),and(chi.eq.${B},bloccato.eq.${A}))`));
  assert.ok(tutte.includes(`profili?id=eq.${B}&select=fascia_da,fascia_a,pausa_il,solo_con_permesso`));
  assert.ok(tutte.includes(`permessi_chiamata?utente_id=eq.${B}&permesso_a=eq.${A}`));
  // Mai colonne del profilo diverse da fascia, pausa e permesso (niente nomi, foto, questionario).
  assert.equal(/select=\*/.test(tutte), false);
});

test("datiPerChiamare: senza fascia e senza permessi", async () => {
  const { f } = finto([["membri_stanza", [{ utente_id: A }, { utente_id: B }]], ["profili", [{ fascia_da: null, fascia_a: null, solo_con_permesso: false }]]]);
  const r = await datiPerChiamare(ENV, { stanza: STANZA, chi: A, verso: B }, f);
  assert.equal(r.ok, true);
  assert.equal(r.fascia, null);
  assert.equal(r.pausa, null);
  assert.equal(r.soloConPermesso, false);
  assert.deepEqual(r.permessi, new Set());
});

test("datiPerChiamare: una sola lettura che non va → ok false (mai regole su dati a metà)", async () => {
  for (const pezzo of ["membri_stanza", "/chiamate?", "blocchi", "profili", "permessi_chiamata"]) {
    for (const guasto of [{ stato: 503, corpo: {} }, new Error("rete"), { corpo: { non: "lista" } }]) {
      const { f } = finto([[pezzo, guasto], ["membri_stanza", [{ utente_id: A }]]]);
      assert.deepEqual(await datiPerChiamare(ENV, { stanza: STANZA, chi: A, verso: B }, f), { ok: false, motivo: "riprova" }, pezzo);
    }
  }
});
