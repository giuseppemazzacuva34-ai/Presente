// Chiamate solo voce (issue #4, passo 3b-1): stato di UNA chiamata, deciso dal server. Solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nuovaChiamata, rispondi, rifiuta, chiudi, caduta, rientro, scadenze, prossimoAllarme, pesca, vistaPer,
} from "../api/stato_chiamata.js";
import { oraDiRoma } from "../api/stanze.js";

const T0 = oraDiRoma(2026, 11, 10, 20);
const CHIUDE = oraDiRoma(2026, 11, 15, 21);
const s = (n) => new Date(T0.getTime() + n * 1000);
const CARTE = Array.from({ length: 30 }, (_, i) => ({ id: i + 1 }));
const zero = () => 0;

function squilla() {
  return nuovaChiamata({ chi: "a", con: "b", adesso: T0, chiusuraStanza: CHIUDE, sessioneChi: "sessioneA123", midChi: "0" });
}
function inCorso() {
  return rispondi(squilla(), { da: "b", adesso: s(5), sessione: "sessioneB123", mid: "0" }).stato;
}

test("nuova chiamata: squilla 30 secondi, nessuna riga del registro", () => {
  const c = squilla();
  assert.equal(c.fase, "squilla");
  assert.equal(c.scadeSquillo, s(30).getTime());
  assert.equal(prossimoAllarme(c), s(30).getTime());
});

test("risponde solo chi è chiamato, e solo durante lo squillo", () => {
  assert.equal(rispondi(squilla(), { da: "a", adesso: s(5), sessione: "sessioneA999", mid: "0" }).motivo, "non_tocca_a_te");
  assert.equal(rispondi(squilla(), { da: "c", adesso: s(5), sessione: "sessioneC999", mid: "0" }).motivo, "non_tocca_a_te");
  assert.equal(rispondi(squilla(), { da: "b", adesso: s(30), sessione: "sessioneB123", mid: "0" }).motivo, "squillo_finito");
  const r = rispondi(squilla(), { da: "b", adesso: s(5), sessione: "sessioneB123", mid: "0" });
  assert.equal(r.ok, true);
  assert.equal(r.stato.fase, "in_corso");
  assert.equal(r.stato.inizio, s(5).getTime());
  assert.equal(r.stato.fine, s(5 + 900).getTime());
  assert.equal(prossimoAllarme(r.stato), s(905).getTime());
});

test("la chiamata finisce alla chiusura della stanza se arriva prima dei 15 minuti", () => {
  const c = nuovaChiamata({ chi: "a", con: "b", adesso: new Date(CHIUDE.getTime() - 300000), chiusuraStanza: CHIUDE,
    sessioneChi: "sessioneA123", midChi: "0" });
  const r = rispondi(c, { da: "b", adesso: new Date(CHIUDE.getTime() - 290000), sessione: "sessioneB123", mid: "0" });
  assert.equal(r.stato.fine, CHIUDE.getTime());
});

test("rifiuto o squillo scaduto: finita senza riga del registro", () => {
  const r = rifiuta(squilla(), { da: "b", adesso: s(3) });
  assert.equal(r.stato.fase, "finita");
  assert.equal(r.riga, null);
  assert.equal(rifiuta(squilla(), { da: "c", adesso: s(3) }).motivo, "non_tocca_a_te");
  const x = scadenze(squilla(), s(30));
  assert.equal(x.stato.fase, "finita");
  assert.equal(x.riga, null);
  assert.equal(scadenze(squilla(), s(29)).stato.fase, "squilla");
});

test("chi chiama può annullare durante lo squillo", () => {
  const r = chiudi(squilla(), { da: "a", adesso: s(4), esito: "chiusa" });
  assert.equal(r.stato.fase, "finita");
  assert.equal(r.riga, null);
});

test("chiusura: riga con solo chi / con / inizio / durata / esito", () => {
  const r = chiudi(inCorso(), { da: "b", adesso: s(5 + 125), esito: "chiusa" });
  assert.deepEqual(r.riga, { chi: "a", con: "b", inizio: new Date(s(5)).toISOString(), durata: 125, esito: "chiusa" });
  assert.deepEqual(Object.keys(r.riga), ["chi", "con", "inizio", "durata", "esito"]);
  assert.equal(r.stato.fase, "finita");
  assert.deepEqual(r.daChiudere.sort(), ["sessioneA123", "sessioneB123"]);
});

test("chiudere: solo i due, solo esiti ammessi, mai due volte", () => {
  assert.equal(chiudi(inCorso(), { da: "c", adesso: s(60), esito: "chiusa" }).motivo, "non_tocca_a_te");
  assert.equal(chiudi(inCorso(), { da: "a", adesso: s(60), esito: "tempo_scaduto" }).motivo, "esito");
  const una = chiudi(inCorso(), { da: "a", adesso: s(60), esito: "chiudi_e_segnala" });
  assert.equal(una.riga.esito, "chiudi_e_segnala");
  assert.equal(una.segnala, true);
  assert.equal(chiudi(una.stato, { da: "b", adesso: s(61), esito: "chiusa" }).motivo, "gia_finita");
});

test("15 minuti: il server chiude per tutti e due, durata mai oltre 900", () => {
  const x = scadenze(inCorso(), s(5 + 900 + 7));
  assert.equal(x.riga.esito, "tempo_scaduto");
  assert.equal(x.riga.durata, 900);
  assert.equal(x.stato.fase, "finita");
  assert.equal(scadenze(inCorso(), s(5 + 899)).riga, null);
});

test("connessione caduta: 30 secondi per rientrare, il timer continua", () => {
  let c = caduta(inCorso(), { da: "a", adesso: s(100) }).stato;
  assert.equal(prossimoAllarme(c), s(130).getTime());
  assert.equal(vistaPer(c, "b", s(110)).altraPersona, "riconnessione");
  const dentro = rientro(c, { da: "a", adesso: s(120), sessione: "sessioneA456", mid: "1" });
  assert.equal(dentro.ok, true);
  assert.deepEqual(dentro.daChiudere, ["sessioneA123"]);
  assert.equal(dentro.stato.fine, s(905).getTime());
  assert.equal(prossimoAllarme(dentro.stato), s(905).getTime());
  const fuori = scadenze(c, s(130));
  assert.equal(fuori.riga.esito, "caduta");
  assert.equal(fuori.riga.durata, 95); // fino al momento della caduta, non fino alla scadenza dei 30 s
  assert.equal(rientro(c, { da: "a", adesso: s(131), sessione: "sessioneA456", mid: "1" }).motivo, "troppo_tardi");
});

test("carte: prima a 0:10, poi ogni 20 secondi, mai nell'ultimo minuto; vale il primo tocco", () => {
  const c = inCorso();
  assert.equal(pesca(c, { da: "a", adesso: s(5 + 9), carte: CARTE, viste: new Set(), casuale: zero }).motivo, "fuori_tempo");
  const p = pesca(c, { da: "a", adesso: s(5 + 10), carte: CARTE, viste: new Set(), casuale: zero });
  assert.equal(p.ok, true);
  assert.equal(p.carta, 1);
  assert.equal(p.stato.carta.da, "a");
  // il tocco dell'altra persona subito dopo: ignorato
  assert.equal(pesca(p.stato, { da: "b", adesso: s(5 + 11), carte: CARTE, viste: new Set([1]), casuale: zero }).motivo, "troppo_presto");
  const q = pesca(p.stato, { da: "b", adesso: s(5 + 30), carte: CARTE, viste: new Set([1]), casuale: zero });
  assert.equal(q.carta, 2);
  assert.equal(pesca(c, { da: "c", adesso: s(5 + 30), carte: CARTE, viste: new Set(), casuale: zero }).motivo, "non_tocca_a_te");
  assert.equal(pesca(c, { da: "a", adesso: s(5 + 840), carte: CARTE, viste: new Set(), casuale: zero }).motivo, "fuori_tempo");
  assert.equal(pesca(c, { da: "a", adesso: s(5 + 30), carte: [], viste: new Set(), casuale: zero }).motivo, "nessuna_carta");
});

test("vista del telefono: timer, carte e suggerimento, mai le sessioni", () => {
  const c = inCorso();
  const v = vistaPer(c, "a", s(5 + 31), 30);
  assert.equal(v.fase, "in_corso");
  assert.equal(v.restanti, 869);
  assert.equal(v.suggerimento, true);
  assert.equal(v.carte.visibile, true);
  assert.equal(JSON.stringify(v).includes("sessione"), false);
  assert.equal(vistaPer(c, "a", s(5 + 40)).suggerimento, false);
  assert.equal(vistaPer(c, "a", s(5 + 841)).ultimoMinuto, true);
  assert.equal(vistaPer(c, "a", s(5 + 31), 0).carte.visibile, false); // tabella carte vuota: niente pulsante
  assert.equal(vistaPer(c, "c", s(10)), null);
  const conCarta = pesca(c, { da: "b", adesso: s(5 + 12), carte: CARTE, viste: new Set(), casuale: zero }).stato;
  assert.equal(vistaPer(conCarta, "a", s(5 + 31)).suggerimento, false);
  assert.deepEqual(vistaPer(conCarta, "a", s(5 + 13)).carta, { id: 1, daMe: false });
});

test("vista: dice con chi è la chiamata (id della persona della stanza), mai le sessioni", () => {
  const c = squilla();
  assert.equal(vistaPer(c, "b", s(1)).altra, "a");
  assert.equal(vistaPer(c, "a", s(1)).altra, "b");
  const v = vistaPer(inCorso(), "a", s(20));
  assert.equal(v.altra, "b");
  assert.ok(!JSON.stringify(v).includes("sessione"));
  const fine = chiudi(inCorso(), { da: "a", adesso: s(60), esito: "chiusa" }).stato;
  assert.equal(vistaPer(fine, "b", s(61)).altra, "a");
});
