// Chiamate solo voce (issue #4, passo 3b-2b-2a): apertura di una chiamata e «a che punto è la mia chiamata».
// Tutto con finti centralino, finte sessioni Realtime e finto Durable Object: nessuna rete, solo dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { apriChiamata, statoChiamata, rispondiChiamata, rifiutaChiamata, chiudiChiamata } from "../api/apri_chiamata.js";
import { oraDiRoma } from "../api/stanze.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const STANZA = "99999999-9999-4999-8999-999999999999";
const ADESSO = oraDiRoma(2026, 11, 10, 20);
const APRE = oraDiRoma(2026, 11, 9, 9);
const CHIUDE = oraDiRoma(2026, 11, 15, 21);
const OFFERTA = { type: "offer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\n" };
const CON_VIDEO = { type: "offer", sdp: OFFERTA.sdp + "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:1\r\n" };

function finti({ linee = {}, dati = {}, sessione = { ok: true, sessione: "sessione-aaaa" }, pubblica, apri, rispondi, chiudi } = {}) {
  const registro = { occupa: [], libera: [], chiuse: [], aperte: [], risposte: [], rifiuti: [], chiusure: [], sessioni: 0 };
  const occupate = { ...linee };
  const d = {
    stanzaDi: async (chi) => (chi === C ? null : { id: STANZA, apre: APRE, chiude: CHIUDE }),
    datiPerChiamare: async () => ({ ok: true, membri: [A, B], chiamate: [], blocchi: [], fascia: null,
      soloConPermesso: false, permessi: new Set(), ...dati }),
    centralino: (id) => {
      assert.equal(id, STANZA);
      return {
        linea: async (per) => occupate[per] || null,
        occupa: async (x) => {
          registro.occupa.push(x);
          if (occupate[x.chi]) return { ok: false, motivo: "gia_in_chiamata" };
          if (occupate[x.con]) return { ok: false, motivo: "occupato", testo: "È in un'altra chiamata" };
          occupate[x.chi] = { chiamata: x.chiamata, ruolo: "chi", altra: x.con };
          occupate[x.con] = { chiamata: x.chiamata, ruolo: "con", altra: x.chi };
          return { ok: true };
        },
        libera: async (x) => { registro.libera.push(x); for (const k of Object.keys(occupate)) if (occupate[k].chiamata === x.chiamata) delete occupate[k]; return { ok: true }; },
      };
    },
    nuovaSessione: async () => { registro.sessioni++; return sessione; },
    pubblicaVoce: async (s, offerta) => (pubblica ? pubblica(s, offerta) : { ok: true, descrizione: { type: "answer", sdp: "risposta" } }),
    chiudiSessione: async (s, mids) => { registro.chiuse.push({ s, mids }); return { ok: true }; },
    chiamata: (id) => ({
      apri: async (x) => { registro.aperte.push({ id, ...x }); return apri ? apri(x) : { ok: true, vista: { fase: "squilla", io: "chiama", squillo: 30 } }; },
      vista: async (per) => ({ ok: true, vista: { fase: "squilla", io: per === A ? "chiama" : "riceve", squillo: 12 } }),
      rispondi: async (x) => { registro.risposte.push({ id, ...x }); return rispondi ? rispondi(x) : { ok: true, vista: { fase: "in_corso", io: "riceve" } }; },
      rifiuta: async (x) => { registro.rifiuti.push({ id, ...x }); return { ok: true, vista: { fase: "finita", io: "riceve" } }; },
      chiudi: async (x) => { registro.chiusure.push({ id, ...x }); return chiudi ? chiudi(x)
        : { ok: true, vista: { fase: "finita", io: x.da === A ? "chiama" : "riceve" }, ...(x.esito === "chiudi_e_segnala" ? { segnala: true } : {}) }; },
    }),
    nuovoId: () => "chiamata-1",
  };
  return { d, registro, occupate };
}

test("apertura riuscita: linee occupate, una sessione, Durable Object aperto con la chiusura della stanza", async () => {
  const { d, registro, occupate } = finti();
  const r = await apriChiamata({ chi: A, verso: B, offerta: OFFERTA, adesso: ADESSO }, d);
  assert.equal(r.ok, true);
  assert.deepEqual(r.descrizione, { type: "answer", sdp: "risposta" });
  assert.equal(r.vista.fase, "squilla");
  assert.equal(registro.sessioni, 1);
  assert.deepEqual(registro.aperte, [{ id: "chiamata-1", chi: A, con: B, chiusuraStanza: CHIUDE.getTime(), sessioneChi: "sessione-aaaa", midChi: "0",
    stanza: STANZA, chiamata: "chiamata-1" }]);
  assert.equal(occupate[B].chiamata, "chiamata-1");
  // Al telefono non arrivano mai l'id della chiamata né le sessioni Realtime.
  assert.equal(JSON.stringify(r).includes("chiamata-1"), false);
  assert.equal(JSON.stringify(r).includes("sessione-aaaa"), false);
});

test("offerta con video o non valida: rifiutata prima di toccare linee e Realtime", async () => {
  for (const offerta of [CON_VIDEO, null, { type: "answer", sdp: OFFERTA.sdp }, { type: "offer", sdp: "v=0\r\nm=audio 9 X 111\r\n" }]) {
    const { d, registro } = finti();
    const r = await apriChiamata({ chi: A, verso: B, offerta, adesso: ADESSO }, d);
    assert.deepEqual(r, { ok: false, motivo: "solo_voce" });
    assert.equal(registro.occupa.length + registro.sessioni, 0);
  }
});

test("id non validi o uguali: «dati»", async () => {
  const { d } = finti();
  for (const [chi, verso] of [["x", B], [A, "' or 1=1"], [A, A]]) {
    assert.deepEqual(await apriChiamata({ chi, verso, offerta: OFFERTA, adesso: ADESSO }, d), { ok: false, motivo: "dati" });
  }
});

test("chi non è in una stanza aperta: «non_in_stanza», niente linee", async () => {
  const { d, registro } = finti();
  assert.deepEqual(await apriChiamata({ chi: C, verso: B, offerta: OFFERTA, adesso: ADESSO }, d), { ok: false, motivo: "non_in_stanza" });
  assert.equal(registro.occupa.length, 0);
});

test("dati non leggibili dal database: «riprova», niente linee", async () => {
  const { d, registro } = finti();
  d.datiPerChiamare = async () => ({ ok: false, motivo: "riprova" });
  assert.deepEqual(await apriChiamata({ chi: A, verso: B, offerta: OFFERTA, adesso: ADESSO }, d), { ok: false, motivo: "riprova" });
  assert.equal(registro.occupa.length, 0);
});

test("le regole di api/chiamate.js valgono: blocco, 3 volte, fascia, permesso", async () => {
  const casi = [
    [{ blocchi: [{ chi: B, bloccato: A }] }, "bloccati"],
    [{ chiamate: [1, 2, 3].map((g) => ({ chi: A, con: B, inizio: oraDiRoma(2026, 11, 9, 10 + g).toISOString(), durata: 120 })) }, "tre_con_lei"],
    [{ fascia: { da: "21:00", a: "23:00" } }, "fuori_fascia"],
    [{ soloConPermesso: true }, "serve_permesso"],
    [{ membri: [A, C] }, "non_in_stanza"],
  ];
  for (const [dati, motivo] of casi) {
    const { d, registro } = finti({ dati });
    const r = await apriChiamata({ chi: A, verso: B, offerta: OFFERTA, adesso: ADESSO }, d);
    assert.equal(r.ok, false);
    assert.equal(r.motivo, motivo);
    assert.equal(registro.occupa.length + registro.sessioni, 0);
  }
});

test("chi riceve è già in chiamata: «È in un'altra chiamata»; chi chiama già in chiamata: «gia_in_chiamata»", async () => {
  let { d } = finti({ linee: { [B]: { chiamata: "altra", ruolo: "con", altra: C } } });
  assert.deepEqual(await apriChiamata({ chi: A, verso: B, offerta: OFFERTA, adesso: ADESSO }, d),
    { ok: false, motivo: "occupato", testo: "È in un'altra chiamata" });
  ({ d } = finti({ linee: { [A]: { chiamata: "altra", ruolo: "chi", altra: C } } }));
  assert.deepEqual(await apriChiamata({ chi: A, verso: B, offerta: OFFERTA, adesso: ADESSO }, d), { ok: false, motivo: "gia_in_chiamata" });
});

test("due chiamate nello stesso istante: il centralino decide, la seconda non crea sessioni", async () => {
  const { d, registro } = finti();
  d.centralino = ((orig) => (id) => { const c = orig(id); return { ...c, linea: async () => null }; })(d.centralino);
  await apriChiamata({ chi: A, verso: B, offerta: OFFERTA, adesso: ADESSO }, d);
  d.nuovoId = () => "chiamata-2";
  const r = await apriChiamata({ chi: C, verso: B, offerta: OFFERTA, adesso: ADESSO }, { ...d, stanzaDi: async () => ({ id: STANZA, apre: APRE, chiude: CHIUDE }),
    datiPerChiamare: async () => ({ ok: true, membri: [A, B, C], chiamate: [], blocchi: [], fascia: null, soloConPermesso: false, permessi: new Set() }) });
  assert.equal(r.motivo, "occupato");
  assert.equal(registro.sessioni, 1);
});

test("Realtime non risponde: linee liberate, «realtime»", async () => {
  const { d, registro, occupate } = finti({ sessione: { ok: false, motivo: "realtime" } });
  assert.deepEqual(await apriChiamata({ chi: A, verso: B, offerta: OFFERTA, adesso: ADESSO }, d), { ok: false, motivo: "realtime" });
  assert.deepEqual(registro.libera, [{ chiamata: "chiamata-1" }]);
  assert.deepEqual(occupate, {});
});

test("pubblicazione della voce rifiutata: linee liberate, nessuna traccia da chiudere", async () => {
  const { d, registro, occupate } = finti({ pubblica: () => ({ ok: false, motivo: "realtime" }) });
  assert.deepEqual(await apriChiamata({ chi: A, verso: B, offerta: OFFERTA, adesso: ADESSO }, d), { ok: false, motivo: "realtime" });
  assert.equal(registro.libera.length, 1);
  assert.equal(registro.chiuse.length, 0);
  assert.deepEqual(occupate, {});
});

test("Durable Object che non apre (o lancia un errore): traccia chiusa e linee liberate", async () => {
  for (const apri of [() => ({ ok: false, motivo: "gia_aperta" }), () => { throw new Error("guasto"); }]) {
    const { d, registro, occupate } = finti({ apri });
    const r = await apriChiamata({ chi: A, verso: B, offerta: OFFERTA, adesso: ADESSO }, d);
    assert.equal(r.ok, false);
    assert.equal(r.motivo, "riprova");
    assert.deepEqual(registro.chiuse, [{ s: "sessione-aaaa", mids: ["0"] }]);
    assert.deepEqual(occupate, {});
  }
});

test("stato: nessuna chiamata → vista null; chiamata in arrivo → vista di chi riceve", async () => {
  let { d } = finti();
  assert.deepEqual(await statoChiamata({ per: A, adesso: ADESSO }, d), { ok: true, vista: null });
  ({ d } = finti({ linee: { [B]: { chiamata: "chiamata-1", ruolo: "con", altra: A } } }));
  assert.deepEqual(await statoChiamata({ per: B, adesso: ADESSO }, d), { ok: true, vista: { fase: "squilla", io: "riceve", squillo: 12 } });
});

test("stato: fuori da una stanza o id non valido", async () => {
  const { d } = finti();
  assert.deepEqual(await statoChiamata({ per: C, adesso: ADESSO }, d), { ok: true, vista: null });
  assert.deepEqual(await statoChiamata({ per: "x", adesso: ADESSO }, d), { ok: false, motivo: "dati" });
});

// Passo 3b-2b-2c-1: rispondere, rifiutare, chiudere. Chi è lo dice il Worker (token); la chiamata la trova il centralino.
const IN_ARRIVO = { [A]: { chiamata: "chiamata-1", ruolo: "chi", altra: B }, [B]: { chiamata: "chiamata-1", ruolo: "con", altra: A } };

test("rispondi: sessione e voce di chi riceve, poi il Durable Object; al telefono solo risposta SDP e vista", async () => {
  const { d, registro } = finti({ linee: IN_ARRIVO, sessione: { ok: true, sessione: "sessione-bbbb" } });
  const r = await rispondiChiamata({ per: B, offerta: OFFERTA, adesso: ADESSO }, d);
  assert.equal(r.ok, true);
  assert.deepEqual(r.descrizione, { type: "answer", sdp: "risposta" });
  assert.equal(r.vista.fase, "in_corso");
  assert.deepEqual(registro.risposte, [{ id: "chiamata-1", da: B, sessione: "sessione-bbbb", mid: "0" }]);
  assert.equal(JSON.stringify(r).includes("sessione-bbbb"), false);
  assert.equal(JSON.stringify(r).includes("chiamata-1"), false);
});

test("rispondi: offerta con video rifiutata prima di creare sessioni", async () => {
  const { d, registro } = finti({ linee: IN_ARRIVO });
  assert.deepEqual(await rispondiChiamata({ per: B, offerta: CON_VIDEO, adesso: ADESSO }, d), { ok: false, motivo: "solo_voce" });
  assert.equal(registro.sessioni, 0);
});

test("rispondi: chi ha chiamato non può «rispondere» alla propria chiamata; senza chiamata «nessuna»", async () => {
  const { d, registro } = finti({ linee: IN_ARRIVO });
  assert.deepEqual(await rispondiChiamata({ per: A, offerta: OFFERTA, adesso: ADESSO }, d), { ok: false, motivo: "non_tocca_a_te" });
  const vuoto = finti();
  assert.deepEqual(await rispondiChiamata({ per: B, offerta: OFFERTA, adesso: ADESSO }, vuoto.d), { ok: false, motivo: "nessuna" });
  assert.equal(registro.sessioni + vuoto.registro.sessioni, 0);
});

test("rispondi troppo tardi (o già risposto): la traccia appena pubblicata si chiude, motivo dal Durable Object", async () => {
  const { d, registro } = finti({ linee: IN_ARRIVO, sessione: { ok: true, sessione: "sessione-bbbb" },
    rispondi: async () => ({ ok: false, motivo: "squillo_finito" }) });
  assert.deepEqual(await rispondiChiamata({ per: B, offerta: OFFERTA, adesso: ADESSO }, d), { ok: false, motivo: "squillo_finito" });
  assert.deepEqual(registro.chiuse, [{ s: "sessione-bbbb", mids: ["0"] }]);
});

test("rispondi: Realtime giù → «realtime», nessun passo sul Durable Object", async () => {
  const { d, registro } = finti({ linee: IN_ARRIVO, sessione: { ok: false, motivo: "realtime" } });
  assert.deepEqual(await rispondiChiamata({ per: B, offerta: OFFERTA, adesso: ADESSO }, d), { ok: false, motivo: "realtime" });
  assert.equal(registro.risposte.length, 0);
});

test("rifiuta: solo chi riceve, passa al Durable Object", async () => {
  const { d, registro } = finti({ linee: IN_ARRIVO });
  const r = await rifiutaChiamata({ per: B, adesso: ADESSO }, d);
  assert.deepEqual(r, { ok: true, vista: { fase: "finita", io: "riceve" } });
  assert.deepEqual(registro.rifiuti, [{ id: "chiamata-1", da: B }]);
  assert.deepEqual(await rifiutaChiamata({ per: A, adesso: ADESSO }, d), { ok: false, motivo: "non_tocca_a_te" });
});

test("chiudi e «Chiudi e segnala»: esito giusto al Durable Object, «segnala» torna al telefono", async () => {
  const { d, registro } = finti({ linee: IN_ARRIVO });
  assert.deepEqual(await chiudiChiamata({ per: A, segnala: false, adesso: ADESSO }, d), { ok: true, vista: { fase: "finita", io: "chiama" } });
  const r = await chiudiChiamata({ per: B, segnala: true, adesso: ADESSO }, d);
  assert.equal(r.segnala, true);
  assert.deepEqual(registro.chiusure.map((x) => x.esito), ["chiusa", "chiudi_e_segnala"]);
});

test("chiudi: senza chiamata «nessuna», id non valido «dati»", async () => {
  const { d } = finti();
  assert.deepEqual(await chiudiChiamata({ per: A, segnala: false, adesso: ADESSO }, d), { ok: false, motivo: "nessuna" });
  assert.deepEqual(await chiudiChiamata({ per: "x", segnala: false, adesso: ADESSO }, d), { ok: false, motivo: "dati" });
  assert.deepEqual(await rifiutaChiamata({ per: C, adesso: ADESSO }, d), { ok: false, motivo: "nessuna" });
});
