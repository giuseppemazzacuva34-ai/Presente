// Locali consigliati nello stato letto dal Worker (issue #6 spec v1.1 punto 1, decisione D143 B; passo 2u della linea
// «sviluppatore-b»). GET /app/api/incontro aggiunge a «incontro»:
//   locali: [{ id, nome, indirizzo, tipo, fascia, da_verificare }]  ← quelli che chi legge può proporre
//   locale_scelto: { nome, indirizzo, da_verificare } | null         ← il locale della proposta o dell'appuntamento
// da public.locali_incontro(porta, persona). Se quella lettura non va, l'incontro si legge lo stesso (senza locali).
// Supabase finto, dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { incontroApi, PERCORSO_INCONTRO } from "../worker/incontro_api.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const ALTRO = "66666666-7777-4888-9999-000000000000";
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const L1 = "b1b1b1b1-0000-4000-8000-000000000001";
const TOKEN = "eyJhbGciOi.utente-di-prova.firma12345";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };
const STATO = { stato: "da_fissare", scadenza: "2026-11-28T18:00:00+00:00", orario: null, locale: null, luogo: null,
  proposta_mia: false, proposta_scade: null, controproposte_rimaste: 3, azioni: ["proponi"], ritardo_minuti: null, esito: null,
  checkin_mio: false, checkin_altro: false, checkin_da: null, checkin_fino: null, segnale: null, disdetta: null };
const LOCALE = { id: L1, nome: "Cru Isola", indirizzo: "Via Ugo Bassi 24", tipo: "wine bar", fascia: "Sera", da_verificare: true };

function supabaseFinto(rpc = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    viste.push({ percorso: u.pathname, corpo: opzioni.body ? JSON.parse(opzioni.body) : null });
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID, email: "prova@example.com" });
    const nome = u.pathname.replace("/rest/v1/rpc/", "");
    if (nome in rpc) return rpc[nome] instanceof Response ? rpc[nome] : Response.json(rpc[nome]);
    return new Response("{}", { status: 404 });
  };
  return { f, rpc: (nome) => viste.filter((v) => v.percorso === `/rest/v1/rpc/${nome}`) };
}
const leggi = () => new Request(`https://presenteincontri.app${PERCORSO_INCONTRO}?porta=${PORTA}&persona=${ALTRO}`,
  { method: "GET", headers: { authorization: `Bearer ${TOKEN}` } });
const incontro = async (rpc) => (await (await incontroApi(leggi(), ENV, supabaseFinto(rpc).f)).json()).incontro;

test("locali: chiesti per la persona del token e per la porta", async () => {
  const s = supabaseFinto({ stato_incontro: STATO, locali_incontro: { locali: [LOCALE], scelto: null } });
  const r = await incontroApi(leggi(), ENV, s.f);
  assert.equal(r.status, 200);
  assert.deepEqual(s.rpc("locali_incontro")[0].corpo, { p_porta: PORTA, p_persona: ID });
  const i = (await r.json()).incontro;
  assert.deepEqual(i.locali, [LOCALE]);
  assert.equal(i.locale_scelto, null);
});

test("locali: il locale scelto passa con nome, indirizzo e «da verificare»", async () => {
  const i = await incontro({ stato_incontro: { ...STATO, stato: "proposto", locale: L1 },
    locali_incontro: { locali: [], scelto: { nome: "Cru Isola", indirizzo: "Via Ugo Bassi 24", da_verificare: true, stato: "x" } } });
  assert.deepEqual(i.locale_scelto, { nome: "Cru Isola", indirizzo: "Via Ugo Bassi 24", da_verificare: true });
});

test("locali: passano solo i campi previsti e solo voci di forma giusta", async () => {
  const strani = [{ ...LOCALE, provincia: "MI", stato: "da_visitare" }, { ...LOCALE, id: "non-un-id" },
    { ...LOCALE, nome: 7 }, { ...LOCALE, tipo: "discoteca" }, { ...LOCALE, da_verificare: "si" }, { ...LOCALE, fascia: null }, "x"];
  const i = await incontro({ stato_incontro: STATO, locali_incontro: { locali: strani, scelto: { nome: 3 } } });
  assert.deepEqual(i.locali, [LOCALE, { ...LOCALE, fascia: null }]);
  assert.equal(i.locale_scelto, null);
});

test("locali: al massimo 40 voci", async () => {
  const tanti = Array.from({ length: 45 }, () => LOCALE);
  assert.equal((await incontro({ stato_incontro: STATO, locali_incontro: { locali: tanti, scelto: null } })).locali.length, 40);
});

test("locali: se la lettura dei locali non va, l'incontro si legge lo stesso", async () => {
  for (const guasto of [new Response("{}", { status: 500 }), "boh", null]) {
    const i = await incontro({ stato_incontro: STATO, locali_incontro: guasto });
    assert.equal(i.stato, "da_fissare");
    assert.deepEqual(i.locali, []);
    assert.equal(i.locale_scelto, null);
  }
});
