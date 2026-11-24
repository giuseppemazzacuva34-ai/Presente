// Sezione «Perché si lascia la stanza» del pannello di chi decide (issue #381, spec v1 del CPO del 23/11, «Dati»;
// linea «sviluppatore-b», passo 6c). Il modulo landing/app/moduli/pannello.js trasforma la risposta di
// GET /app/api/pannello/uscite in settimane leggibili: totale, motivi con i testi della schermata 22, testi liberi.
// Mai nomi: il Worker e il database non li danno.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaPannello, vociUscite } from "../landing/app/moduli/pannello.js";
import { MOTIVI_APP } from "../landing/app/moduli/lascia_stanza.js";

test("vociUscite: una voce per settimana, la più recente prima, motivi con il testo della schermata 22", () => {
  const voci = vociUscite([
    { settimana: "2026-11-16", motivo: "tempo", quante: 1, testi: [] },
    { settimana: "2026-11-23", motivo: "tempo", quante: 3, testi: [] },
    { settimana: "2026-11-23", motivo: "altro", quante: 2, testi: ["Orari scomodi"] },
  ]);
  assert.equal(voci.length, 2);
  assert.equal(voci[0].titolo, "Settimana del 23 novembre · 5 uscite");
  assert.deepEqual(voci[0].motivi, ["Questa settimana non ho tempo: 3", "Altro, lo scrivo io: 2"]);
  assert.deepEqual(voci[0].testi, ["Orari scomodi"]);
  assert.equal(voci[1].titolo, "Settimana del 16 novembre · 1 uscita");
});

test("vociUscite: le etichette sono quelle della schermata 22 (stessa fonte, nessuna copia)", () => {
  const voci = vociUscite(MOTIVI_APP.map((m) => ({ settimana: "2026-11-23", motivo: m.id, quante: 1, testi: [] })));
  assert.deepEqual(voci[0].motivi, MOTIVI_APP.map((m) => `${m.testo}: 1`));
});

test("vociUscite: righe non valide si scartano, mai numeri inventati", () => {
  assert.deepEqual(vociUscite(null), []);
  assert.deepEqual(vociUscite([{ settimana: "ieri", motivo: "tempo", quante: 1, testi: [] },
    { settimana: "2026-11-23", motivo: "boh", quante: 1, testi: [] },
    { settimana: "2026-11-23", motivo: "tempo", quante: -2, testi: [] }]), []);
});

test("creaPannello.uscite: GET /app/api/pannello/uscite con il token, errori come le altre sezioni", async () => {
  const chiamate = [];
  const f = async (url, init) => {
    chiamate.push([url, init.method, init.headers.authorization]);
    return Response.json({ ok: true, uscite: [{ settimana: "2026-11-23", motivo: "app", quante: 1, testi: [] }] });
  };
  const p = creaPannello({ token: () => "tok", fetch: f });
  const r = await p.uscite();
  assert.equal(r.ok, true);
  assert.deepEqual(r.uscite, [{ settimana: "2026-11-23", motivo: "app", quante: 1, testi: [] }]);
  assert.deepEqual(chiamate, [["/app/api/pannello/uscite", "GET", "Bearer tok"]]);

  const no = creaPannello({ token: () => "tok", fetch: async () => new Response("{}", { status: 403 }) });
  assert.deepEqual(await no.uscite(), { ok: false, motivo: "non_moderatore" });
});

test("pagina del pannello: pulsante e sezione «Perché si lascia la stanza», testi solo con textContent", () => {
  const avvio = readFileSync(new URL("../landing/app/pannello_avvio.js", import.meta.url), "utf8");
  assert.match(avvio, /async function mostraUscite\(p\)/);
  assert.match(avvio, /testo: "Perché si lascia la stanza"/);
  assert.match(avvio, /onclick: \(\) => mostraUscite\(p\)/);
  assert.doesNotMatch(avvio, /innerHTML/);
});
