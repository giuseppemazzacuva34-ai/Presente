// Chiamate solo voce (issue #4, passo 3b-2b-2a): apertura di una chiamata e «a che punto è la mia chiamata».
// Mette insieme i pezzi già fatti, nell'ordine del passo 2-3 del flusso (docs/architettura.md):
//   1. l'offerta del telefono deve essere solo voce (prima di toccare qualunque cosa);
//   2. la stanza aperta di chi chiama e i dati per le regole (dal database, solo server);
//   3. le regole di api/chiamate.js (stanza, blocchi, 3 volte, 5 al giorno, fascia, permesso);
//   4. il Centralino della stanza occupa le due linee (una chiamata alla volta, deciso in un solo punto);
//   5. sessione Realtime + voce pubblicata (api/realtime.js), poi il Durable Object `Chiamata` fa squillare.
// Se un passo dopo il 4 non riesce si torna indietro: linee liberate e, se serve, traccia chiusa.
// Al telefono tornano solo la «vista» e la risposta SDP: mai l'id della chiamata, mai le sessioni Realtime.
// Nulla di Cloudflare né di rete qui: tutto arriva da `d` (il Worker passa quelli veri, i test quelli finti).

import { puoChiamare } from "./chiamate.js";
import { soloAudio, midAudio } from "./realtime.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const no = (motivo) => ({ ok: false, motivo });
const offertaValida = (o) => !!o && typeof o === "object" && o.type === "offer" && soloAudio(o.sdp) && !!midAudio(o.sdp);

// d: { stanzaDi(chi, adesso) → { id, apre, chiude } | null,
//      datiPerChiamare({ stanza, chi, verso }) → { ok, membri, chiamate, blocchi, fascia, soloConPermesso, permessi },
//      centralino(idStanza) → { linea, occupa, libera }, chiamata(idChiamata) → { apri, vista },
//      nuovaSessione(), pubblicaVoce(sessione, offerta), chiudiSessione(sessione, mids), nuovoId() }
export async function apriChiamata({ chi, verso, offerta, adesso }, d) {
  if (!UUID.test(chi || "") || !UUID.test(verso || "") || chi === verso) return no("dati");
  if (!offertaValida(offerta)) return no("solo_voce");

  const stanza = await d.stanzaDi(chi, adesso);
  if (!stanza) return no("non_in_stanza");
  const dati = await d.datiPerChiamare({ stanza, chi, verso });
  if (!dati || !dati.ok) return no("riprova");

  const centralino = d.centralino(stanza.id);
  const inChiamata = new Set();
  for (const id of [chi, verso]) if (await centralino.linea(id)) inChiamata.add(id);
  const regole = puoChiamare({
    chi, verso, adesso,
    stanza: { apre: stanza.apre, chiude: stanza.chiude, membri: dati.membri },
    chiamate: dati.chiamate, blocchi: dati.blocchi, inChiamata, fascia: dati.fascia,
    soloConPermesso: dati.soloConPermesso, permessi: dati.permessi,
  });
  if (!regole.ok) return regole;

  const id = d.nuovoId();
  const chiusuraStanza = stanza.chiude.getTime();
  const linee = await centralino.occupa({ chi, con: verso, chiamata: id, chiusuraStanza });
  if (!linee.ok) return linee;

  const mid = midAudio(offerta.sdp);
  let sessione = null, pubblicata = false;
  try {
    const s = await d.nuovaSessione();
    if (!s.ok) return await indietro(s.motivo);
    sessione = s.sessione;
    const p = await d.pubblicaVoce(sessione, offerta);
    if (!p.ok) return await indietro(p.motivo);
    pubblicata = true;
    const a = await d.chiamata(id).apri({ chi, con: verso, chiusuraStanza, sessioneChi: sessione, midChi: mid });
    if (!a || !a.ok) return await indietro("riprova");
    return { ok: true, descrizione: p.descrizione, vista: a.vista };
  } catch (e) {
    console.error("apri chiamata: errore", e && e.name);
    return await indietro("riprova");
  }

  async function indietro(motivo) {
    if (pubblicata) {
      try { await d.chiudiSessione(sessione, [mid]); } catch { /* la traccia senza traffico la chiude comunque Realtime */ }
    }
    try { await centralino.libera({ chiamata: id }); } catch { /* la linea si libera da sola dopo DURATA_MASSIMA_LINEA */ }
    return no(motivo);
  }
}

// Vista della propria chiamata (in arrivo, in corso o appena finita), oppure null se non ce n'è una.
export async function statoChiamata({ per, adesso }, d) {
  if (!UUID.test(per || "")) return no("dati");
  const stanza = await d.stanzaDi(per, adesso);
  if (!stanza) return { ok: true, vista: null };
  const linea = await d.centralino(stanza.id).linea(per);
  if (!linea) return { ok: true, vista: null };
  const r = await d.chiamata(linea.chiamata).vista(per);
  return r && r.ok ? { ok: true, vista: r.vista } : { ok: true, vista: null };
}
