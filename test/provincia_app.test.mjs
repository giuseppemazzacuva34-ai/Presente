// Passo 5 dell'app con la provincia (#2, spec v1.3 del CPO). Nessuna rete, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { opzioniMenu } from "../worker/province.js";
import { MENU_PROVINCE, cercaProvincia, suggerimenti, nomeVisibile, ESTERO } from "../landing/app/moduli/province.js";
import { creaSalvataggio, profiloDaStato, statoDaSalvato, PAESE_ESTERO } from "../landing/app/moduli/salvataggio.js";

test("il menu dell'app ha gli stessi 107 + «Vivo all'estero» del sito, nello stesso ordine", () => {
  const sito = opzioniMenu().map((o) => {
    const [, sigla, nome] = o.match(/^<option value="([A-Z]{2})">(.*)<\/option>$/);
    return [sigla, nome.replace(/&#39;/g, "'")];
  });
  assert.equal(MENU_PROVINCE.length, 108);
  assert.deepEqual(MENU_PROVINCE, sito);
  assert.deepEqual(MENU_PROVINCE.at(-1), [ESTERO, "Vivo all'estero"]);
});

test("ricerca: nome esatto senza badare a maiuscole e accenti; «Mil» suggerisce Milano", () => {
  assert.equal(cercaProvincia("Roma"), "RM");
  assert.equal(cercaProvincia("  monza e brianza "), "MB");
  assert.equal(cercaProvincia("forli-cesena"), "FC");
  assert.equal(cercaProvincia("l'aquila"), "AQ");
  assert.equal(cercaProvincia("vivo all'estero"), "EE");
  for (const v of ["Mil", "", "RM", "Sanremo", null]) assert.equal(cercaProvincia(v), null, String(v));
  assert.deepEqual(suggerimenti("Mil").map((p) => p[0]), ["MI"]);
  assert.ok(suggerimenti("Reggio").length === 2);
  assert.deepEqual(suggerimenti("Sanremo"), []);
});

test("gli altri vedono il nome della provincia o «Dall'estero», mai la sigla", () => {
  assert.equal(nomeVisibile("MB"), "Monza e Brianza");
  assert.equal(nomeVisibile("EE"), "Dall'estero");
  assert.equal(nomeVisibile("XX"), "");
});

test("al passo 5 si salva la sigla (mai città né regione); origine «lista» solo se confermata senza cambi", () => {
  const base = { nome: " Giulia ", provincia: "RM", provinciaLista: "", miPresento: "donna", miDescrivo: "x", regione: "Sicilia" };
  const p = profiloDaStato(base);
  assert.deepEqual(p, { nome: "Giulia", provincia: "RM", provincia_origine: "scelta", paese: "IT", mi_presento_come: "donna", mi_descrivo: null });
  assert.equal(profiloDaStato({ ...base, provinciaLista: "RM" }).provincia_origine, "lista");
  assert.equal(profiloDaStato({ ...base, provinciaLista: "LT" }).provincia_origine, "scelta");
  assert.equal(profiloDaStato({ ...base, provincia: "EE" }).paese, PAESE_ESTERO);
});

test("al rientro: provincia ripresa; profilo vecchio senza provincia torna al passo «Chi sei»", () => {
  const st = { questionario: { risposte: {}, importanza: {} } };
  assert.equal(statoDaSalvato(st, { profilo: { passo: 8, provincia: "MB", nome: "A" } }), 8);
  assert.equal(st.provincia, "MB");
  assert.equal(st.provinciaTesto, "Monza e Brianza");
  const vecchio = { questionario: { risposte: {}, importanza: {} } };
  assert.equal(statoDaSalvato(vecchio, { profilo: { passo: 10, paese: "ZZ", citta: null } }), 4);
  assert.equal(vecchio.provincia, "");
  const inizio = { questionario: { risposte: {}, importanza: {} } };
  assert.equal(statoDaSalvato(inizio, { profilo: { passo: 3 } }), 3);
});

test("il server rifiuta un secondo cambio entro 7 giorni: il messaggio arriva com'è all'app", async () => {
  const f = async () => new Response(JSON.stringify({ code: "23514", message: "Puoi cambiarla di nuovo dal 12/11." }), { status: 400 });
  const a = creaSalvataggio({ supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co", supabaseAnonKey: "anon",
    token: async () => "t", utenteId: () => "11111111-2222-4333-8444-555555555555", fetch: f });
  assert.deepEqual(await a.salvaProfilo({ provincia: "MI" }), { ok: false, motivo: "regola", messaggio: "Puoi cambiarla di nuovo dal 12/11." });
  const altro = async () => new Response(JSON.stringify({ message: "duplicate key value violates unique constraint \"x\"" }), { status: 409 });
  const b = creaSalvataggio({ supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co", supabaseAnonKey: "anon",
    token: async () => "t", utenteId: () => "11111111-2222-4333-8444-555555555555", fetch: altro });
  assert.deepEqual(await b.salvaProfilo({ provincia: "MI" }), { ok: false, motivo: "salvataggio" });
});
