// Stanza viva (issue #380 spec v1 punto 2, passo 6a): «chiamate N di 3» sulla riga di ogni persona della stanza.
// Il numero lo calcola il server con la stessa regola del limite di 3 (api/chiamate.js: solo chiamate che contano,
// solo dentro la settimana della stanza) e arriva con i testi dei pulsanti (GET /app/api/chiamata/pulsanti).
// Sospesi e blocchi non danno mai una riga: non si deve scoprire una sospensione o un blocco (#7 spec v1.1).
// Tutto finto: nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chiamateTra, CHIAMATA } from "../api/chiamate.js";
import { pulsantiStanza } from "../api/pulsanti.js";
import { chiamataApi, PERCORSO_CHIAMATA } from "../worker/chiamata_api.js";
import { creaChiamata } from "../landing/app/moduli/chiamata.js";
import { creaTelefono } from "../landing/app/moduli/telefono.js";
import { testoChiamate } from "../landing/app/moduli/stanza_viva.js";
import { oraDiRoma } from "../api/stanze.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const E = "55555555-5555-4555-8555-555555555555";
const S = "99999999-9999-4999-8999-999999999999";
const APRE = oraDiRoma(2026, 11, 9, 9);
const CHIUDE = oraDiRoma(2026, 11, 15, 21);
const ADESSO = oraDiRoma(2026, 11, 12, 20);
const STANZA = { apre: APRE, chiude: CHIUDE, membri: [A, B, C, D, E] };
const riga = (chi, con, giorno, ora, durata = 120) => ({ chi, con, inizio: oraDiRoma(2026, 11, giorno, ora).toISOString(), durata });

test("chiamateTra: conta nei due versi, solo chiamate che contano e solo nella settimana della stanza", () => {
  const chiamate = [
    riga(A, B, 9, 10), riga(B, A, 10, 11), // una per verso: 2
    riga(A, B, 10, 12, CHIAMATA.minimoPerContare - 1), // troppo corta: non conta
    riga(A, B, 10, 13, null), // in corso: non conta ancora
    { chi: A, con: B, inizio: oraDiRoma(2026, 11, 8, 20).toISOString(), durata: 300 }, // settimana prima
    riga(A, C, 9, 15), riga(C, D, 9, 16),
  ];
  assert.equal(chiamateTra({ chi: A, verso: B, stanza: STANZA, chiamate }), 2);
  assert.equal(chiamateTra({ chi: B, verso: A, stanza: STANZA, chiamate }), 2);
  assert.equal(chiamateTra({ chi: A, verso: C, stanza: STANZA, chiamate }), 1);
  assert.equal(chiamateTra({ chi: A, verso: D, stanza: STANZA, chiamate }), 0);
  assert.equal(chiamateTra({ chi: A, verso: B, stanza: STANZA }), 0);
});

function finti(dati = {}) {
  return {
    stanzaDi: async () => ({ id: S, apre: APRE, chiude: CHIUDE }),
    datiPerPulsanti: async () => ({ ok: true, membri: [A, B, C, D, E], chiamate: [], blocchi: [], profili: new Map(),
      permessi: new Set(), sospesi: new Set(), ...dati }),
    centralino: () => ({ linea: async () => null }),
  };
}

test("pulsantiStanza: «chiamate» = [{ id, n }] solo per chi ha almeno una chiamata con me, mai oltre 3, mai per me", async () => {
  const chiamate = [riga(A, B, 9, 10), riga(B, A, 10, 11), riga(A, B, 11, 12), riga(B, A, 12, 10), riga(C, A, 10, 18), riga(D, E, 10, 19)];
  const r = await pulsantiStanza({ per: A, adesso: ADESSO }, finti({ chiamate }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.chiamate, [{ id: B, n: 3 }, { id: C, n: 1 }]);
});

test("pulsantiStanza: sospesi e bloccati (nei due versi) non danno una riga; io sospeso o senza stanza: nessuna", async () => {
  const chiamate = [riga(A, B, 9, 10), riga(A, C, 9, 11), riga(D, A, 9, 12), riga(A, E, 9, 13)];
  const r = await pulsantiStanza({ per: A, adesso: ADESSO },
    finti({ chiamate, sospesi: new Set([B]), blocchi: [{ chi: C, bloccato: A }, { chi: A, bloccato: D }] }));
  assert.deepEqual(r.chiamate, [{ id: E, n: 1 }]);
  assert.deepEqual((await pulsantiStanza({ per: A, adesso: ADESSO }, finti({ chiamate, sospesi: new Set([A]) }))).chiamate, []);
  const senza = finti();
  senza.stanzaDi = async () => null;
  assert.deepEqual(await pulsantiStanza({ per: A, adesso: ADESSO }, senza), { ok: true, pulsanti: [], chiamate: [] });
});

// --- Worker ---------------------------------------------------------------------------------------------------------
const ID = "11111111-2222-4333-8444-555555555555";
const ENV_W = { ACCESSO_APP: "si", SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const auth = async (url) => (new URL(url).pathname === "/auth/v1/user" ? Response.json({ id: ID }) : new Response("{}", { status: 404 }));
const get = () => new Request("https://presenteincontri.app" + PERCORSO_CHIAMATA + "/pulsanti", { headers: { authorization: "Bearer eyJ.prova.firma12345" } });

test("GET /pulsanti: passano solo { id, n } con id valido e n intero da 1 a 3", async () => {
  const op = { pulsantiStanza: async () => ({ ok: true, pulsanti: [], chiamate: [
    { id: B, n: 3 }, { id: C, n: 1, extra: "x" }, { id: D, n: 4 }, { id: E, n: 0 }, { id: "rotto", n: 2 }, { id: D, n: 1.5 }, { id: E, n: "2" },
  ] }) };
  const r = await chiamataApi(get(), ENV_W, auth, op);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, pulsanti: [], chiamate: [{ id: B, n: 3 }, { id: C, n: 1 }] });
  const vecchio = await chiamataApi(get(), ENV_W, auth, { pulsantiStanza: async () => ({ ok: true, pulsanti: [] }) });
  assert.deepEqual(await vecchio.json(), { ok: true, pulsanti: [], chiamate: [] });
});

// --- Web app --------------------------------------------------------------------------------------------------------
const ID1 = "aaaaaaaa-1111-4111-8111-111111111111";
const ID2 = "bbbbbbbb-2222-4222-8222-222222222222";
const risposta = (dati) => async () => new Response(JSON.stringify(dati), { status: 200, headers: { "content-type": "application/json" } });

test("creaChiamata().pulsanti(): «chiamate» pulite (id valido, n da 1 a 3, una riga per persona)", async () => {
  const r = await creaChiamata({ token: async () => "tok", fetch: risposta({ ok: true, pulsanti: [], chiamate: [
    { id: ID1, n: 2 }, { id: ID1, n: 3 }, { id: "x", n: 1 }, { id: ID2, n: 9 },
  ] }) }).pulsanti();
  assert.deepEqual(r, { ok: true, pulsanti: [], chiamate: [{ id: ID1, n: 2 }] });
  const vecchio = await creaChiamata({ token: async () => "tok", fetch: risposta({ ok: true, pulsanti: [] }) }).pulsanti();
  assert.deepEqual(vecchio, { ok: true, pulsanti: [], chiamate: [] });
});

test("telefono: ogni persona della stanza ha «chiamate» (0 se il server non dice niente); dopo una chiamata si rilegge", async () => {
  let volta = 0;
  const t = creaTelefono({
    compagni: { leggi: async () => ({ ok: true, persone: [{ id: ID1, nome: "Giulia", eta: 34, citta: "Torino" }, { id: ID2, nome: "Marco", eta: 38, citta: "Asti" }] }) },
    linea: { chiama: async () => ({ ok: true, vista: null }) },
    chiamata: { pulsanti: async () => ({ ok: true, pulsanti: [], chiamate: ++volta === 1 ? [{ id: ID2, n: 2 }] : [{ id: ID2, n: 3 }] }) },
    voce: { muto: () => {}, chiudi: () => {} },
  });
  await t.caricaPersone();
  assert.deepEqual(t.modello().stanza.persone.map((p) => p.chiamate), [0, 2]);
  t.torna();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(t.modello().stanza.persone.map((p) => p.chiamate), [0, 3]);
});

test("testoChiamate: «chiamate N di 3», con N fuori misura riportato tra 0 e 3", () => {
  assert.equal(testoChiamate(0), "chiamate 0 di 3");
  assert.equal(testoChiamate(2), "chiamate 2 di 3");
  assert.equal(testoChiamate(3), "chiamate 3 di 3");
  assert.equal(testoChiamate(7), "chiamate 3 di 3");
  assert.equal(testoChiamate(undefined), "chiamate 0 di 3");
  assert.equal(testoChiamate(-1), "chiamate 0 di 3");
});
