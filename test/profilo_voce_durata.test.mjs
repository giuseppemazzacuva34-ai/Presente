// Parità grafica della schermata 23 (D149, richiesta del coordinatore del 26/11, linea «sviluppatore-b»):
// il riquadro con l'onda e «La tua voce · 18 s». La durata, se non è già nota (voce riletta dal server),
// si prende dai metadati dell'audio; nella prova il profilo finto ha una voce finta di 18 secondi. Nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { statoProfilo, vistaProfilo } from "../landing/app/moduli/profilo.js";
import { creaProva } from "../landing/app/moduli/prova.js";
import { FILE_VOCE } from "../landing/app/moduli/salvataggio.js";

// h con nodi che ascoltano eventi (come il DOM): serve per simulare «loadedmetadata».
const h = (tag, a = {}, ...figli) => {
  const n = { tag, a: { ...(a || {}) }, f: figli.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false), ascolti: {} };
  n.addEventListener = (ev, cb) => { (n.ascolti[ev] ||= []).push(cb); };
  n.lancia = (ev) => (n.ascolti[ev] || []).forEach((cb) => cb());
  n.setAttribute = (k, v) => { n.a[k] = v; };
  Object.defineProperty(n, "textContent", { get: () => n.f.map((x) => (typeof x === "string" ? x : x.textContent)).join(""), set: (t) => { n.f = [t]; } });
  return n;
};
const tutti = (n, pred, out = []) => { if (typeof n === "object") { if (pred(n)) out.push(n); n.f.forEach((x) => tutti(x, pred, out)); } return out; };
const fn = () => {};
const BASE = { nome: "Giulia", eta: 33, citta: "Milano", saldo: 145, regali: 17, inStanza: true };
const AZIONI = { risposte: fn, regali: fn, foto: fn, preferenze: fn, elimina: fn, torna: fn };
const parti = (voce) => {
  const v = vistaProfilo(h, statoProfilo({ ...BASE, voce }), AZIONI);
  return { audio: tutti(v, (x) => x.tag === "audio")[0], b: tutti(v, (x) => x.tag === "button")[0] };
};

test("voce senza secondi: alla lettura dei metadati il pulsante diventa «▶ La tua voce · 18 s»", () => {
  const { audio, b } = parti({ url: "blob:v", secondi: 0 });
  assert.equal(b.textContent, "▶ La tua voce");
  audio.duration = 18.4;
  audio.lancia("loadedmetadata");
  assert.equal(b.textContent, "▶ La tua voce · 18 s");
  // finita la riproduzione torna l'etichetta con i secondi
  audio.lancia("play");
  audio.lancia("ended");
  assert.equal(b.textContent, "▶ La tua voce · 18 s");
});

test("durata non valida (Infinity, NaN, 0): l'etichetta resta «▶ La tua voce», mai numeri inventati", () => {
  for (const d of [Infinity, NaN, 0]) {
    const { audio, b } = parti({ url: "blob:v" });
    audio.duration = d;
    audio.lancia("loadedmetadata");
    assert.equal(b.textContent, "▶ La tua voce");
  }
});

test("secondi già noti: i metadati non cambiano l'etichetta", () => {
  const { audio, b } = parti({ url: "blob:v", secondi: 18 });
  audio.duration = 25;
  audio.lancia("loadedmetadata");
  assert.equal(b.textContent, "▶ La tua voce · 18 s");
});

test("prova: il profilo finto ha una voce finta (silenzio WAV di 18 secondi) tra le voci salvate", async () => {
  const p = creaProva({ attesaMs: 0 });
  p.regista.profiloPronto();
  const r = await p.archivio.leggi();
  assert.ok(r.voci.includes(FILE_VOCE));
  const blob = await p.archivio.scaricaFile("voci", FILE_VOCE);
  assert.equal(blob.type, "audio/wav");
  const buf = new DataView(await blob.arrayBuffer());
  const byteAlSecondo = buf.getUint32(28, true);
  const dati = buf.getUint32(40, true);
  assert.equal(dati / byteAlSecondo, 18);
  assert.ok(blob.size < 200000); // leggera: 8 kHz, 8 bit, mono
});
