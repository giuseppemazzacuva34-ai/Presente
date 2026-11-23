// Richieste del Worker per il sì/no segreto (issue #65, passo 8b-2a, linea «sviluppatore»; regola del CPO del 21/11).
// La risposta la salva SOLO la persona del token; «risposto» è identico per un sì e per un no e non dice mai se
// l'altra persona ha risposto. Nello stato escono «svelate» ed «esiti» con i soli campi previsti. Supabase finto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { svelamentoApi, PERCORSO_SVELAMENTO } from "../worker/svelamento_api.js";
import { TESTI_SVELAMENTO, quandoRoma } from "../api/svelamento.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const LEI = "66666666-7777-4888-9999-000000000000";
const ALTRO = "99999999-8888-4777-8666-555555555555";
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const SITO = "https://presenteincontri.app";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const SVELATA = {
  porta: PORTA, con: LEI, nome: "Giulia", eta: 31, tipo: "video",
  finito_il: "2026-11-21T20:00:00+00:00", risposta_scade_il: "2026-11-23T20:00:00+00:00", ho_risposto: false,
};
const ESITO = { porta: PORTA, con: LEI, nome: "Giulia", eta: 31, esito: "doppio_si", esito_il: "2026-11-22T10:00:00+00:00" };
const STATO = { saldo: 25, porte: [], svelate: [SVELATA], esiti: [] };

function supabaseFinto({ rpc = {} } = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID, email: "prova@example.com" });
    const nome = u.pathname.replace("/rest/v1/rpc/", "");
    if (nome in rpc) return rpc[nome] instanceof Response ? rpc[nome] : Response.json(rpc[nome]);
    return new Response("{}", { status: 404 });
  };
  return { f, rpc: (nome) => viste.filter((v) => v.percorso === `/rest/v1/rpc/${nome}`) };
}
function richiesta(corpo) {
  const headers = { authorization: `Bearer ${TOKEN}` };
  if (corpo !== undefined) headers["content-type"] = "application/json";
  return new Request(SITO + PERCORSO_SVELAMENTO, { method: corpo === undefined ? "GET" : "POST", headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
}
const rispondi = (risposta, extra = {}) => richiesta({ azione: "rispondi", porta: PORTA, risposta, ...extra });

test("quandoRoma: giorno e ora di Roma, in italiano", () => {
  assert.equal(quandoRoma("2026-11-23T20:00:00Z"), "lunedì 23 novembre alle 21:00");
  assert.equal(quandoRoma("2026-07-01T07:05:00Z"), "mercoledì 1 luglio alle 09:05");
  assert.equal(quandoRoma("non è una data"), null);
});

test("POST rispondi: la persona è quella del token, anche se il corpo dice altro; poi lo stato", async () => {
  const s = supabaseFinto({ rpc: { rispondi_svelamento: "risposto", svelamento_di: STATO } });
  const r = await svelamentoApi(rispondi("si", { persona: ALTRO, p_persona: ALTRO }), ENV, s.f);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.esito, "risposto");
  assert.ok(j.stato && Array.isArray(j.stato.svelate));
  assert.deepEqual(s.rpc("rispondi_svelamento")[0].corpo, { p_porta: PORTA, p_persona: ID, p_risposta: "si" });
});

test("POST rispondi: un sì e un no danno esattamente la stessa risposta", async () => {
  const si = supabaseFinto({ rpc: { rispondi_svelamento: "risposto", svelamento_di: STATO } });
  const no = supabaseFinto({ rpc: { rispondi_svelamento: "risposto", svelamento_di: STATO } });
  const a = await (await svelamentoApi(rispondi("si"), ENV, si.f)).json();
  const b = await (await svelamentoApi(rispondi("no"), ENV, no.f)).json();
  assert.deepEqual(a, b);
  assert.equal(no.rpc("rispondi_svelamento")[0].corpo.p_risposta, "no");
});

test("POST rispondi con doppio sì: esito subito con il testo della spec", async () => {
  const s = supabaseFinto({ rpc: { rispondi_svelamento: "doppio_si", svelamento_di: { ...STATO, svelate: [], esiti: [ESITO] } } });
  const j = await (await svelamentoApi(rispondi("si"), ENV, s.f)).json();
  assert.equal(j.ok, true);
  assert.equal(j.esito, "doppio_si");
  assert.equal(j.testo, "Vi siete detti sì. Ora fissate l'incontro.");
  assert.equal(j.stato.esiti[0].esito, "doppio_si");
});

test("POST rispondi con risposta non valida o mancante: 400 senza chiamare il database", async () => {
  for (const x of ["forse", "SI", "", null, 1, undefined]) {
    const s = supabaseFinto({ rpc: { rispondi_svelamento: "risposto" } });
    const r = await svelamentoApi(rispondi(x), ENV, s.f);
    assert.equal(r.status, 400, String(x));
    assert.equal(s.rpc("rispondi_svelamento").length, 0);
  }
});

test("POST rispondi: già risposto o non ancora svelata → ok false col motivo", async () => {
  for (const esito of ["gia_risposto", "non_svelata"]) {
    const s = supabaseFinto({ rpc: { rispondi_svelamento: esito } });
    const r = await svelamentoApi(rispondi("no"), ENV, s.f);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: false, motivo: esito });
  }
});

test("POST rispondi dopo le 48 ore: «tempo_scaduto» con il testo dell'esito chiuso", async () => {
  const s = supabaseFinto({ rpc: { rispondi_svelamento: "tempo_scaduto" } });
  assert.deepEqual(await (await svelamentoApi(rispondi("si"), ENV, s.f)).json(), { ok: false, motivo: "tempo_scaduto", testo: TESTI_SVELAMENTO.chiusa });
});

test("POST rispondi su porta chiusa: nessun motivo; porta non sua: 404; risposta strana: 503", async () => {
  const chiusa = supabaseFinto({ rpc: { rispondi_svelamento: "porta_chiusa" } });
  assert.deepEqual(await (await svelamentoApi(rispondi("si"), ENV, chiusa.f)).json(), { ok: false, motivo: "porta_chiusa", testo: TESTI_SVELAMENTO.portaChiusa });
  const altrui = supabaseFinto({ rpc: { rispondi_svelamento: "non_nella_porta" } });
  assert.equal((await svelamentoApi(rispondi("si"), ENV, altrui.f)).status, 404);
  const strana = supabaseFinto({ rpc: { rispondi_svelamento: "boh" } });
  assert.equal((await svelamentoApi(rispondi("si"), ENV, strana.f)).status, 503);
});

test("GET: «svelate» con i soli campi previsti, la domanda e mai le risposte", async () => {
  const s = supabaseFinto({ rpc: { svelamento_di: { ...STATO, svelate: [{ ...SVELATA, risposta_a: "si", risposta_b: "no", sua_risposta: "no", ha_risposto: true }] } } });
  const j = await (await svelamentoApi(richiesta(), ENV, s.f)).json();
  assert.deepEqual(j.svelate, [{
    porta: PORTA, con: LEI, nome: "Giulia", eta: 31, tipo: "video",
    finito_il: "2026-11-21T20:00:00.000Z", risposta_scade_il: "2026-11-23T20:00:00.000Z",
    ho_risposto: false, domanda: "Vuoi incontrare Giulia?", in_attesa: null,
  }]);
  assert.equal(j.testi.risposta.confermaSi, "Rispondi sì? Non potrai cambiarla.");
  assert.equal(j.testi.risposta.confermaNo, "Rispondi no? Non potrai cambiarla.");
});

test("GET: dopo la mia risposta «Hai risposto. Saprai com'è andata entro <giorno e ora>.»", async () => {
  const s = supabaseFinto({ rpc: { svelamento_di: { ...STATO, svelate: [{ ...SVELATA, ho_risposto: true }] } } });
  const j = await (await svelamentoApi(richiesta(), ENV, s.f)).json();
  assert.equal(j.svelate[0].ho_risposto, true);
  assert.equal(j.svelate[0].in_attesa, "Hai risposto. Saprai com'è andata entro lunedì 23 novembre alle 21:00.");
});

test("GET: «ho_risposto» vale solo se è proprio true", async () => {
  const s = supabaseFinto({ rpc: { svelamento_di: { ...STATO, svelate: [{ ...SVELATA, ho_risposto: "si" }] } } });
  const j = await (await svelamentoApi(richiesta(), ENV, s.f)).json();
  assert.equal(j.svelate[0].ho_risposto, false);
  assert.equal(j.svelate[0].in_attesa, null);
});

test("GET: «esiti» solo doppio sì o chiusa, con il loro testo; valori sconosciuti scartati", async () => {
  const chiusa = { ...ESITO, porta: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee", esito: "chiusa", motivo: "sospensione" };
  const strano = { ...ESITO, porta: "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee", esito: "sospensione" };
  const s = supabaseFinto({ rpc: { svelamento_di: { ...STATO, svelate: [], esiti: [ESITO, chiusa, strano] } } });
  const j = await (await svelamentoApi(richiesta(), ENV, s.f)).json();
  assert.equal(j.esiti.length, 2);
  assert.deepEqual(j.esiti[0], { porta: PORTA, con: LEI, nome: "Giulia", eta: 31, esito: "doppio_si", esito_il: "2026-11-22T10:00:00.000Z", testo: TESTI_SVELAMENTO.doppioSi });
  assert.equal(j.esiti[1].esito, "chiusa");
  assert.equal(j.esiti[1].testo, "Questa volta non vi incontrerete. I tuoi 100 crediti sono tornati nel tuo saldo.");
  assert.equal("motivo" in j.esiti[1], false);
});

test("GET: senza «svelate» ed «esiti» dal database → liste vuote", async () => {
  const s = supabaseFinto({ rpc: { svelamento_di: { saldo: 25, porte: [] } } });
  const j = await (await svelamentoApi(richiesta(), ENV, s.f)).json();
  assert.deepEqual(j.svelate, []);
  assert.deepEqual(j.esiti, []);
});
