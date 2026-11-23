// Test interno (#8, richiesta di Giuseppe del 23/11): con ACCESSO_APP = «tester» i lavori programmati devono girare,
// altrimenti il 30/11 la stanza non si compone e la domenica le porte non si aprono. Con «tester» possono esistere
// solo gli account delle persone in elenco (iscrizioni libere chiuse in Supabase, #377). Con «no» restano spenti.
// Nessun dato reale: fetch e database finti.
import { test } from "node:test";
import assert from "node:assert/strict";
import { apriPorteDellaSera } from "../worker/sera_porte.js";
import { chiudiIncontriFiniti } from "../worker/incontri_finiti.js";
import { pulisciBozzeSupporto } from "../worker/bozze_supporto.js";
import { spedisciAvvisiSicurezza } from "../worker/avvisi_sicurezza.js";
import { eseguiLunedi } from "../scripts/lavoro_lunedi.mjs";

const env = (accesso) => ({
  ACCESSO_APP: accesso, SUPABASE_URL: "https://prova.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "chiave-finta",
  BREVO_API_KEY: "brevo-finta", EMAIL_SICUREZZA: "casella@example.org",
});
const contaRichieste = () => {
  const stato = { n: 0 };
  stato.f = async () => { stato.n++; return new Response("[]", { status: 200 }); };
  return stato;
};
const lavori = { apriPorteDellaSera, chiudiIncontriFiniti, pulisciBozzeSupporto, spedisciAvvisiSicurezza };

for (const [nome, lavoro] of Object.entries(lavori)) {
  test(`${nome}: con «tester» gira`, async () => {
    const r = contaRichieste();
    const esito = await lavoro(env("tester"), r.f);
    assert.notEqual(esito?.esito, "spento");
    assert.ok(r.n > 0, "nessuna richiesta");
  });
  test(`${nome}: con «no» o un valore sbagliato resta spento`, async () => {
    for (const accesso of ["no", "TESTER", "tester-x", ""]) {
      const r = contaRichieste();
      assert.deepEqual(await lavoro(env(accesso), r.f), { esito: "spento" }, accesso);
      assert.equal(r.n, 0, accesso);
    }
  });
}

test("lavoro del lunedì: con «tester» parte (prima lettura al database), con «no» resta spento", async () => {
  const lette = [];
  const rpc = async (nome) => { lette.push(nome); throw new Error("fermo qui"); };
  const lunedi = new Date("2026-11-29T23:35:00Z"); // lunedì 30/11 alle 0:35 di Roma
  await assert.rejects(eseguiLunedi({ rpc, adesso: lunedi, accessoApp: "tester" }));
  assert.ok(lette.length > 0);
  assert.equal((await eseguiLunedi({ rpc, adesso: lunedi, accessoApp: "no" })).esito, "spento");
});
