// «Sono in difficoltà» nella web app (issue #7, spec v1.1 punto 6 e casi limite; passo 7a della linea «sviluppatore-b»).
// Schermata con il 112 in alto, «Avvisa Presente» (segnalazione da 1 ora, persona facoltativa), testo fisso e consigli.
// Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schermataDifficolta, corpoDifficolta, inEvidenza, confermaDifficolta } from "../landing/app/moduli/difficolta.js";
import { segnala } from "../api/segnala.js";

const LEI = "11111111-2222-4333-8444-555555555555";
const IO = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test("schermata: 112 in alto, «Avvisa Presente», testo fisso e consigli della spec", () => {
  const s = schermataDifficolta([]);
  assert.equal(s.titolo, "Se sei in pericolo, chiama il 112");
  assert.equal(s.chiama, "Chiama il 112");
  assert.equal(s.telefono, "tel:112");
  assert.equal(s.avvisa, "Avvisa Presente");
  assert.equal(s.fisso, "Presente non è un servizio di emergenza e non vede dove sei.");
  assert.deepEqual(s.consigli, ["Vai dove ci sono altre persone.", "Parla con il personale del locale."]);
  assert.equal(s.persone, null); // nessuna persona da proporre: niente domanda
});

test("schermata: «Riguarda una persona di Presente?» solo con le persone passate, mai un id come nome", () => {
  const s = schermataDifficolta([{ id: LEI, nome: "Giulia" }, { id: "non-un-id", nome: "X" }, { id: IO, nome: "" }]);
  assert.equal(s.domanda, "Riguarda una persona di Presente?");
  assert.deepEqual(s.persone, [["", "No, nessuna in particolare"], [LEI, "Giulia"], [IO, "Una persona della stanza"]]);
});

test("corpo: motivo e origine «sono_in_difficolta», persona facoltativa, niente «da»", () => {
  assert.deepEqual(corpoDifficolta({}), { ok: true, corpo: { contro: null, motivo: "sono_in_difficolta", origine: "sono_in_difficolta", testo: "", blocca: false } });
  const c = corpoDifficolta({ contro: LEI });
  assert.equal(c.corpo.contro, LEI);
  assert.equal(c.corpo.blocca, false); // il blocco resta una scelta dal modulo «Segnala», non da qui
  assert.equal("da" in c.corpo, false);
  assert.equal(corpoDifficolta({ contro: "boh" }).ok, false);
});

test("il corpo è accettato dal server (api/segnala.js) con e senza persona", async () => {
  const salvati = [];
  const d = { conosce: async () => true, salva: async (q) => { salvati.push(q); return "99999999-9999-4999-8999-999999999999"; } };
  for (const scelte of [{}, { contro: LEI }]) {
    const r = await segnala({ da: IO, corpo: corpoDifficolta(scelte).corpo }, d);
    assert.deepEqual(r, { ok: true, ore: 1, pericolo: true });
  }
  assert.equal(salvati[0].contro, null);
  assert.equal(salvati[1].contro, LEI);
});

test("conferma: priorità 1 ora e sempre il rimando al 112", () => {
  const c = confermaDifficolta();
  assert.equal(c.testo, "Abbiamo avvisato Presente. Una persona la leggerà entro 1 ora.");
  assert.equal(c.pericolo, "Se sei in pericolo ora, chiama il 112.");
  assert.equal(c.telefono, "tel:112");
});

test("in evidenza: dal check-in «Sono qui» fino a 6 ore dopo l'orario fissato", () => {
  const app = { orario: "2026-12-05T19:00:00Z", checkinIl: "2026-12-05T18:55:00Z" };
  assert.equal(inEvidenza(app, new Date("2026-12-05T18:54:00Z")), false);
  assert.equal(inEvidenza(app, new Date("2026-12-05T18:55:00Z")), true);
  assert.equal(inEvidenza(app, new Date("2026-12-06T01:00:00Z")), true);
  assert.equal(inEvidenza(app, new Date("2026-12-06T01:00:01Z")), false);
  assert.equal(inEvidenza({ orario: "2026-12-05T19:00:00Z", checkinIl: null }, new Date("2026-12-05T19:30:00Z")), false);
  assert.equal(inEvidenza(null, new Date()), false);
  assert.equal(inEvidenza({ orario: "boh", checkinIl: "boh" }, new Date()), false);
});

test("il modulo non salva nulla sul telefono e non scrive nei log", () => {
  const codice = readFileSync(new URL("../landing/app/moduli/difficolta.js", import.meta.url), "utf8");
  assert.ok(!/console\.|localStorage|sessionStorage|indexedDB|geolocation/i.test(codice.replace(/\/\/.*$/gm, "")));
});
