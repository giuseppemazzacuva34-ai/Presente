// Dopo la chiamata (issue #4 spec v1.3 § 3, passo 3c-4b-1): le richieste del Worker
//   POST /app/api/chiamata/dopo          { appena }                 → { ok, dopo }
//   POST /app/api/chiamata/richiameresti { chi, inizio, risposta }  → { ok, salvata }
// e le letture/scritture dal database (solo server). Supabase finto: nessuna rete, solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dopoChiamata, rispondiRichiameresti, APPENA_FINITA_MS } from "../api/dopo_chiamata.js";
import { riproponiDb, ultimaChiamataDb, salvaRichiamerestiDb } from "../api/dati_chiamata.js";
import { chiamataApi, PERCORSO_CHIAMATA } from "../worker/chiamata_api.js";

const IO = "11111111-2222-4333-8444-555555555555";
const LEI = "66666666-7777-4888-9999-000000000000";
const ADESSO = new Date("2026-11-13T19:20:00Z");
const INIZIO = "2026-11-13T19:00:00.000Z"; // 15 minuti: finita alle 19:15
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "chiave-server" };

// Un campo passato come undefined vuol dire «il database non risponde» (per questo niente valori di default).
function dati(o = {}) {
  const proposta = "proposta" in o ? o.proposta : null;
  const ultima = "ultima" in o ? o.ultima : null;
  const salva = "salva" in o ? o.salva : true;
  const chieste = [];
  return {
    chieste,
    riproponi: async (per) => { chieste.push(["riproponi", per]); return proposta; },
    ultima: async (per) => { chieste.push(["ultima", per]); return ultima; },
    salva: async (x) => { chieste.push(["salva", x]); return salva; },
  };
}

// --- Logica ------------------------------------------------------------------------------------------------------
test("dopo: una chiamata che conta senza risposta → «La richiameresti?» con l'altra persona e la chiave della chiamata", async () => {
  for (const [chi, con] of [[IO, LEI], [LEI, IO]]) {
    const d = dati({ proposta: { chi, con, inizio: "2026-11-13T19:00:00+00:00" } });
    const r = await dopoChiamata({ per: IO, appena: true, adesso: ADESSO }, d);
    assert.deepEqual(r, { ok: true, dopo: {
      tipo: "richiameresti", passi: ["richiameresti", "diario", "fine"], testo: null, altra: LEI, chiamata: { chi, inizio: INIZIO },
    } });
  }
});

test("dopo: al rientro (appena false) senza domanda da riproporre → niente schermata, nemmeno per chiamate brevi", async () => {
  const d = dati({ ultima: { chi: IO, con: LEI, inizio: "2026-11-13T19:18:00Z", durata: 20, esito: "chiusa" } });
  assert.deepEqual(await dopoChiamata({ per: IO, appena: false, adesso: ADESSO }, d), { ok: true, dopo: null });
  assert.ok(!d.chieste.some(([x]) => x === "ultima"));
});

test("dopo: chiamata appena finita sotto i 60 s → testo «durata poco», Segnala e Torna; mai la domanda", async () => {
  const d = dati({ ultima: { chi: LEI, con: IO, inizio: "2026-11-13T19:18:30Z", durata: 40, esito: "chiusa" } });
  const r = await dopoChiamata({ per: IO, appena: true, adesso: ADESSO }, d);
  assert.deepEqual(r, { ok: true, dopo: {
    tipo: "breve", passi: ["fine"], testo: "La chiamata è durata poco e non conta nei limiti.", altra: LEI, chiamata: null,
  } });
});

test("dopo: caduta lunga senza rientro → solo Segnala e Torna, senza il testo «durata poco»", async () => {
  const d = dati({ ultima: { chi: IO, con: LEI, inizio: "2026-11-13T19:10:00Z", durata: 500, esito: "caduta" } });
  const r = await dopoChiamata({ per: IO, appena: true, adesso: ADESSO }, d);
  assert.equal(r.dopo.tipo, "breve");
  assert.equal(r.dopo.testo, null);
});

test("dopo: chi NON ha premuto «Chiudi e segnala» non lo scopre (mai il modulo #7 aperto da solo, mai la domanda)", async () => {
  const lunga = await dopoChiamata({ per: IO, appena: true, adesso: ADESSO },
    dati({ ultima: { chi: IO, con: LEI, inizio: "2026-11-13T19:10:00Z", durata: 500, esito: "chiudi_e_segnala" } }));
  const caduta = await dopoChiamata({ per: IO, appena: true, adesso: ADESSO },
    dati({ ultima: { chi: IO, con: LEI, inizio: "2026-11-13T19:10:00Z", durata: 500, esito: "caduta" } }));
  assert.deepEqual(lunga, caduta);
  const breve = await dopoChiamata({ per: IO, appena: true, adesso: ADESSO },
    dati({ ultima: { chi: IO, con: LEI, inizio: "2026-11-13T19:18:30Z", durata: 30, esito: "chiudi_e_segnala" } }));
  const breveChiusa = await dopoChiamata({ per: IO, appena: true, adesso: ADESSO },
    dati({ ultima: { chi: IO, con: LEI, inizio: "2026-11-13T19:18:30Z", durata: 30, esito: "chiusa" } }));
  assert.deepEqual(breve, breveChiusa);
});

test("dopo: chiamata che conta già proposta prima, o finita da più di 2 minuti, o nessuna → niente schermata", async () => {
  assert.equal(APPENA_FINITA_MS, 2 * 60 * 1000);
  for (const ultima of [
    null,
    { chi: IO, con: LEI, inizio: "2026-11-13T19:05:00Z", durata: 600, esito: "tempo_scaduto" }, // già proposta (riproponi vuoto)
    { chi: IO, con: LEI, inizio: "2026-11-13T19:00:00Z", durata: 30, esito: "chiusa" }, // finita alle 19:00:30
  ]) {
    assert.deepEqual(await dopoChiamata({ per: IO, appena: true, adesso: ADESSO }, dati({ ultima })), { ok: true, dopo: null });
  }
});

test("dopo: database che non risponde → «riprova» (mai una schermata inventata)", async () => {
  assert.deepEqual(await dopoChiamata({ per: IO, appena: true, adesso: ADESSO }, dati({ proposta: undefined })), { ok: false, motivo: "riprova" });
  assert.deepEqual(await dopoChiamata({ per: IO, appena: true, adesso: ADESSO }, dati({ ultima: undefined })), { ok: false, motivo: "riprova" });
});

test("dopo: righe strane dal database non diventano una schermata", async () => {
  for (const proposta of [{ chi: "x", con: LEI, inizio: INIZIO }, { chi: IO, con: LEI, inizio: "ieri" }, { chi: LEI, con: LEI, inizio: INIZIO }]) {
    assert.deepEqual(await dopoChiamata({ per: IO, appena: false, adesso: ADESSO }, dati({ proposta })), { ok: true, dopo: null });
  }
});

test("richiameresti: salva per la persona del token; risposta già data o chiamata che non conta → salvata false", async () => {
  const d = dati();
  const r = await rispondiRichiameresti({ per: IO, corpo: { chi: LEI, inizio: "2026-11-13T19:00:00Z", risposta: "si" } }, d);
  assert.deepEqual(r, { ok: true, salvata: true });
  assert.deepEqual(d.chieste, [["salva", { per: IO, chi: LEI, inizio: INIZIO, risposta: "si" }]]);
  assert.deepEqual(await rispondiRichiameresti({ per: IO, corpo: { chi: LEI, inizio: INIZIO, risposta: "no" } }, dati({ salva: false })),
    { ok: true, salvata: false });
  assert.deepEqual(await rispondiRichiameresti({ per: IO, corpo: { chi: LEI, inizio: INIZIO, risposta: "no" } }, dati({ salva: undefined })),
    { ok: false, motivo: "riprova" });
});

test("richiameresti: corpo sbagliato (risposta strana, nome, testo libero) → «dati», nessuna scrittura", async () => {
  for (const corpo of [{}, { chi: LEI, inizio: INIZIO, risposta: "forse" }, { chi: LEI, inizio: INIZIO, risposta: "si", nome: "Leo" }]) {
    const d = dati();
    assert.deepEqual(await rispondiRichiameresti({ per: IO, corpo }, d), { ok: false, motivo: "dati" });
    assert.equal(d.chieste.length, 0);
  }
});

// --- Database (solo server) ----------------------------------------------------------------------------------------
function supabase(risposte) {
  const chieste = [];
  const f = async (url, init = {}) => {
    const u = decodeURIComponent(url);
    chieste.push({ url: u, init });
    for (const [pezzo, r] of risposte) {
      if (u.includes(pezzo)) {
        if (r instanceof Error) throw r;
        return new Response(JSON.stringify(r.corpo ?? r), { status: r.stato ?? 200 });
      }
    }
    return new Response("[]", { status: 200 });
  };
  return { f, chieste };
}

test("riproponiDb: funzione del server con la persona del token; nessuna riga → null; errore → undefined", async () => {
  const { f, chieste } = supabase([["rpc/richiameresti_da_riproporre", [{ chi: IO, con: LEI, inizio: "2026-11-13T19:00:00+00:00" }]]]);
  assert.deepEqual(await riproponiDb(ENV, IO, f), { chi: IO, con: LEI, inizio: "2026-11-13T19:00:00+00:00" });
  assert.equal(chieste[0].url, ENV.SUPABASE_URL + "/rest/v1/rpc/richiameresti_da_riproporre");
  assert.equal(chieste[0].init.method, "POST");
  assert.deepEqual(JSON.parse(chieste[0].init.body), { p_utente: IO });
  assert.equal(chieste[0].init.headers.apikey, "chiave-server");
  assert.equal(await riproponiDb(ENV, IO, supabase([["rpc/", []]]).f), null);
  assert.equal(await riproponiDb(ENV, IO, supabase([["rpc/", { stato: 500, corpo: {} }]]).f), undefined);
  assert.equal(await riproponiDb(ENV, IO, supabase([["rpc/", new Error("rete")]]).f), undefined);
  assert.equal(await riproponiDb({}, IO, supabase([]).f), undefined);
  assert.equal(await riproponiDb(ENV, "non-un-id", supabase([]).f), undefined);
});

test("ultimaChiamataDb: l'ultima chiamata finita della persona, solo le colonne che servono", async () => {
  const riga = { chi: LEI, con: IO, inizio: "2026-11-13T19:18:30+00:00", durata: 40, esito: "chiusa" };
  const { f, chieste } = supabase([["chiamate?", [riga]]]);
  assert.deepEqual(await ultimaChiamataDb(ENV, IO, f), riga);
  const u = chieste[0].url;
  assert.ok(u.startsWith(ENV.SUPABASE_URL + "/rest/v1/chiamate?select=chi,con,inizio,durata,esito&"));
  assert.ok(u.includes(`or=(chi.eq.${IO},con.eq.${IO})`) && u.includes("durata=not.is.null") && u.includes("order=inizio.desc") && u.includes("limit=1"));
  assert.equal(await ultimaChiamataDb(ENV, IO, supabase([["chiamate?", []]]).f), null);
  assert.equal(await ultimaChiamataDb(ENV, IO, supabase([["chiamate?", { stato: 503, corpo: {} }]]).f), undefined);
});

test("salvaRichiamerestiDb: funzione del server; true/false come risponde, errore → undefined", async () => {
  const { f, chieste } = supabase([["rpc/salva_richiameresti", true]]);
  assert.equal(await salvaRichiamerestiDb(ENV, { per: IO, chi: LEI, inizio: INIZIO, risposta: "no" }, f), true);
  assert.deepEqual(JSON.parse(chieste[0].init.body), { p_utente: IO, p_chi: LEI, p_inizio: INIZIO, p_risposta: "no" });
  assert.equal(await salvaRichiamerestiDb(ENV, { per: IO, chi: LEI, inizio: INIZIO, risposta: "no" }, supabase([["rpc/", false]]).f), false);
  assert.equal(await salvaRichiamerestiDb(ENV, { per: IO, chi: LEI, inizio: INIZIO, risposta: "no" }, supabase([["rpc/", { stato: 400, corpo: {} }]]).f), undefined);
  assert.equal(await salvaRichiamerestiDb(ENV, { per: IO, chi: LEI, inizio: INIZIO, risposta: "boh" }, supabase([]).f), undefined);
});

// --- Worker ---------------------------------------------------------------------------------------------------------
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
function supabaseAccesso() {
  return async (url) => {
    if (new URL(url).pathname === "/auth/v1/user") return Response.json({ id: IO });
    return new Response("{}", { status: 404 });
  };
}
function richiesta(passo, corpo, metodo = "POST") {
  return new Request(`https://presenteincontri.app${PERCORSO_CHIAMATA}/${passo}`, {
    method: metodo, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: metodo === "POST" ? JSON.stringify(corpo) : undefined,
  });
}
function operazioni({ dopo = { ok: true, dopo: null }, salva = { ok: true, salvata: true } } = {}) {
  const ricevute = [];
  return {
    ricevute,
    dopoChiamata: async (x) => { ricevute.push(["dopo", x]); return dopo; },
    rispondiRichiameresti: async (x) => { ricevute.push(["richiameresti", x]); return salva; },
  };
}

test("Worker /dopo: persona del token, «appena» solo se true; al telefono solo ok e dopo", async () => {
  const op = operazioni({ dopo: { ok: true, dopo: { tipo: "breve", passi: ["fine"], testo: null, altra: LEI, chiamata: null } } });
  const r = await chiamataApi(richiesta("dopo", { appena: true, per: LEI }), ENV, supabaseAccesso(), op);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, dopo: { tipo: "breve", passi: ["fine"], testo: null, altra: LEI, chiamata: null } });
  assert.equal(op.ricevute[0][1].per, IO);
  assert.equal(op.ricevute[0][1].appena, true);
  await chiamataApi(richiesta("dopo", { appena: "si" }), ENV, supabaseAccesso(), op);
  assert.equal(op.ricevute[1][1].appena, false);
});

test("Worker /richiameresti: persona del token; «dati» 400, «riprova» 503, GET 405, spento 404", async () => {
  const op = operazioni();
  const corpo = { chi: LEI, inizio: INIZIO, risposta: "si" };
  const r = await chiamataApi(richiesta("richiameresti", corpo), ENV, supabaseAccesso(), op);
  assert.deepEqual(await r.json(), { ok: true, salvata: true });
  assert.deepEqual(op.ricevute[0], ["richiameresti", { per: IO, corpo }]);
  assert.equal((await chiamataApi(richiesta("richiameresti", corpo), ENV, supabaseAccesso(), operazioni({ salva: { ok: false, motivo: "dati" } }))).status, 400);
  assert.equal((await chiamataApi(richiesta("richiameresti", corpo), ENV, supabaseAccesso(), operazioni({ salva: { ok: false, motivo: "riprova" } }))).status, 503);
  assert.equal((await chiamataApi(richiesta("dopo", {}, "GET"), ENV, supabaseAccesso(), op)).status, 405);
  assert.equal((await chiamataApi(richiesta("dopo", {}), { ...ENV, ACCESSO_APP: "no" }, supabaseAccesso(), op)).status, 404);
});
