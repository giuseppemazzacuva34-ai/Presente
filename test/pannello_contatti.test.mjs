// Pannello di chi decide: seconda volta in 6 mesi per contatti chiesti prima della porta (issue #7, «Regole» ›
// Contatti chiesti prima della porta; linea «sviluppatore-b», passo 14b). Il database rifiuta l'avviso con il codice
// fisso «seconda_volta_contatti» (migrazione 20261117094059): il Worker lo passa al pannello, che spiega cosa fare.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pannelloApi, PERCORSO_PANNELLO } from "../worker/pannello_api.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const SEG = "66666666-7777-4888-9999-000000000000";
const ENV = { ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta" };

function richiesta(corpo) {
  return new Request("https://presenteincontri.app" + PERCORSO_PANNELLO + "/decidi", {
    method: "POST", headers: { authorization: "Bearer eyJhbGciOi.utente-di-prova.firma12345", "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}
function supabase(rispostaDecidi) {
  return async (url) => {
    const u = new URL(url);
    if (u.pathname === "/auth/v1/user") return Response.json({ id: ID });
    if (u.pathname === "/rest/v1/rpc/e_moderatore") return Response.json(true);
    if (u.pathname === "/rest/v1/rpc/decidi_segnalazione") return rispostaDecidi();
    return new Response("{}", { status: 404 });
  };
}

test("seconda volta in 6 mesi: il Worker risponde «seconda_volta_contatti»", async () => {
  const f = supabase(() => Response.json({ code: "23514", message: "seconda_volta_contatti", hint: "Serve la sospensione di 7 giorni." }, { status: 400 }));
  const r = await pannelloApi(richiesta({ id: SEG, azione: "avviso", regola: "Niente contatti prima della porta", testo: "numero" }), ENV, f);
  assert.deepEqual(await r.json(), { ok: false, motivo: "seconda_volta_contatti" });
});

test("altri rifiuti del database restano «rifiutata» (nessun testo del database passa al pannello)", async () => {
  const f = supabase(() => Response.json({ message: "Segnalazione già decisa." }, { status: 400 }));
  const r = await pannelloApi(richiesta({ id: SEG, azione: "archivia", testo: "niente" }), ENV, f);
  assert.deepEqual(await r.json(), { ok: false, motivo: "rifiutata" });
  const g = supabase(() => new Response("non json", { status: 400 }));
  const s = await pannelloApi(richiesta({ id: SEG, azione: "archivia", testo: "niente" }), ENV, g);
  assert.deepEqual(await s.json(), { ok: false, motivo: "rifiutata" });
});

test("la pagina del pannello spiega cosa fare alla seconda volta", () => {
  const pagina = readFileSync(new URL("../landing/app/pannello_avvio.js", import.meta.url), "utf8");
  assert.match(pagina, /seconda_volta_contatti: "[^"]*seconda volta in 6 mesi[^"]*Sospensione 7 giorni[^"]*"/);
});
