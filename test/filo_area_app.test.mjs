// Pannello dell'amministratore: il Filo per area (issue #360, spec v1.2 del CPO del 25/11), linea «sviluppatore-c».
// Modulo landing/app/moduli/filo_amministratore.js (aree, assegnaArea, togliArea, vociAreeFilo) e pagina di avvio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creaFiloAmministratore, vociAreeFilo, testoErroreFilo } from "../landing/app/moduli/filo_amministratore.js";

const avvio = readFileSync(new URL("../landing/app/filo_amministratore_avvio.js", import.meta.url), "utf8");
const EMAIL = "filo.prova@example.com";

function finto(risposte = {}) {
  const viste = [];
  const f = async (url, opzioni = {}) => {
    viste.push({ url, metodo: opzioni.method, corpo: opzioni.body ? JSON.parse(opzioni.body) : undefined, headers: opzioni.headers });
    const percorso = url.replace("/app/api/filo-amministratore", "");
    const r = risposte[percorso] ?? { stato: 200, corpo: { ok: true } };
    return new Response(JSON.stringify(r.corpo), { status: r.stato, headers: { "content-type": "application/json" } });
  };
  return { f, viste };
}
const pannello = (f) => creaFiloAmministratore({ token: () => "token-di-prova", fetch: f });

test("aree: legge l'elenco col token di chi guarda", async () => {
  const aree = [{ tipo: "citta", citta: "Milano", filo_nome: "Silvia", assegnato_il: "2026-03-28T10:00:00Z" }];
  const s = finto({ "/aree": { stato: 200, corpo: { ok: true, aree } } });
  assert.deepEqual(await pannello(s.f).aree(), { ok: true, aree });
  assert.equal(s.viste[0].metodo, "GET");
  assert.equal(s.viste[0].headers.authorization, "Bearer token-di-prova");
});

test("aree: 403 → non amministratore", async () => {
  const s = finto({ "/aree": { stato: 403, corpo: { ok: false } } });
  assert.deepEqual(await pannello(s.f).aree(), { ok: false, motivo: "non_amministratore" });
});

test("assegnaArea: città o Italia, email pulita; controlli prima della rete", async () => {
  const s = finto();
  assert.deepEqual(await pannello(s.f).assegnaArea("citta", " Milano ", ` ${EMAIL} `), { ok: true });
  assert.deepEqual(s.viste[0].corpo, { tipo: "citta", citta: "Milano", email: EMAIL });
  assert.deepEqual(await pannello(s.f).assegnaArea("italia", "", EMAIL), { ok: true });
  assert.deepEqual(s.viste[1].corpo, { tipo: "italia", email: EMAIL });
  assert.deepEqual(await pannello(s.f).assegnaArea("citta", "  ", EMAIL), { ok: false, motivo: "area" });
  assert.deepEqual(await pannello(s.f).assegnaArea("regione", "Lombardia", EMAIL), { ok: false, motivo: "area" });
  assert.deepEqual(await pannello(s.f).assegnaArea("citta", "Milano", "no"), { ok: false, motivo: "email" });
  assert.equal(s.viste.length, 2);
});

test("assegnaArea: persona sconosciuta torna come motivo con il suo testo", async () => {
  const s = finto({ "/assegna-area": { stato: 200, corpo: { ok: false, motivo: "persona" } } });
  const esito = await pannello(s.f).assegnaArea("citta", "Milano", EMAIL);
  assert.deepEqual(esito, { ok: false, motivo: "persona" });
  assert.match(testoErroreFilo("persona"), /email/);
  assert.match(testoErroreFilo("area"), /città/);
});

test("togliArea: dice se c'era", async () => {
  const s = finto({ "/togli-area": { stato: 200, corpo: { ok: true, tolto: true } } });
  assert.deepEqual(await pannello(s.f).togliArea("citta", "Milano"), { ok: true, tolto: true });
  assert.deepEqual(s.viste[0].corpo, { tipo: "citta", citta: "Milano" });
  assert.deepEqual(await pannello(s.f).togliArea("citta", ""), { ok: false, motivo: "area" });
});

test("vociAreeFilo: nomi leggibili, Stanza Italia per prima, voci strane scartate", () => {
  const voci = vociAreeFilo([
    { tipo: "citta", citta: "Milano", filo_nome: "Silvia", assegnato_il: "2026-03-28T10:00:00Z" },
    { tipo: "italia", citta: null, filo_nome: "", assegnato_il: "2026-03-28T10:00:00Z" },
    { tipo: "regione", citta: "X", filo_nome: "Y" },
    null,
  ]);
  assert.deepEqual(voci.map((v) => [v.titolo, v.filo]), [["Stanza Italia", "Filo: (nome non inserito)"], ["Milano", "Filo: Silvia"]]);
  assert.deepEqual(voci[1].area, { tipo: "citta", citta: "Milano" });
  assert.deepEqual(vociAreeFilo("no"), []);
});

test("pagina: sezione delle aree con assegna e togli (con conferma)", () => {
  for (const azione of ["aree", "assegnaArea", "togliArea"]) assert.match(avvio, new RegExp(`\\.${azione}\\(`));
  assert.match(avvio, /vociAreeFilo\(/);
  assert.match(avvio, /Il Filo per area/);
  assert.match(avvio, /Togliere il Filo dall'area/);
});
