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
import { soloAudio, soloVoceSessione, midAudio } from "./realtime.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const no = (motivo) => ({ ok: false, motivo });
const offertaValida = (o) => !!o && typeof o === "object" && o.type === "offer" && soloAudio(o.sdp) && !!midAudio(o.sdp);

// d: { stanzaDi(chi, adesso) → { id, apre, chiude } | null,
//      datiPerChiamare({ stanza, chi, verso }) → { ok, membri, chiamate, blocchi, fascia, pausa, soloConPermesso, permessi },
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
    chiamate: dati.chiamate, blocchi: dati.blocchi, inChiamata, fascia: dati.fascia, pausa: dati.pausa,
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
    const a = await d.chiamata(id).apri({ chi, con: verso, chiusuraStanza, sessioneChi: sessione, midChi: mid,
      stanza: stanza.id, chiamata: id });
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
  // Carte attive (passo 3b-2b-2c-2b-2): ne serve il numero per il pulsante e il testo della carta aperta.
  // Se non si leggono il pulsante sparisce per questo giro, la chiamata si vede lo stesso.
  const carte = d.carte ? await d.carte() : null;
  const r = await d.chiamata(linea.chiamata).vista(per, carte ? carte.length : 0);
  return r && r.ok ? { ok: true, vista: conTesto(r.vista, carte) } : { ok: true, vista: null };
}

// --- Passo 3b-2b-2c-1: rispondere, rifiutare, chiudere -------------------------------------------------------------
// La chiamata di una persona la trova il Centralino della sua stanza (mai un id mandato dal telefono).
// Le regole di «chi può fare cosa» (solo chi riceve risponde o rifiuta, vale il primo tocco, squillo di 30 s)
// le decide il Durable Object `Chiamata` (api/stato_chiamata.js): qui si passa solo il suo «no».

async function lineaDi(per, adesso, d) {
  if (!UUID.test(per || "")) return no("dati");
  const stanza = await d.stanzaDi(per, adesso);
  if (!stanza) return no("nessuna");
  const linea = await d.centralino(stanza.id).linea(per);
  return linea ? { ok: true, linea, stanza } : no("nessuna");
}

const esitoDo = (r) => (r && r.ok ? null : no(String((r && r.motivo) || "riprova")));

// Chi riceve risponde: la sua voce (solo voce) va su una sessione nuova, poi il Durable Object passa a «in corso».
export async function rispondiChiamata({ per, offerta, adesso }, d) {
  if (!UUID.test(per || "")) return no("dati");
  if (!offertaValida(offerta)) return no("solo_voce");
  const l = await lineaDi(per, adesso, d);
  if (!l.ok) return l;
  if (l.linea.ruolo !== "con") return no("non_tocca_a_te");

  const mid = midAudio(offerta.sdp);
  let sessione = null, pubblicata = false;
  try {
    const s = await d.nuovaSessione();
    if (!s.ok) return no(s.motivo);
    sessione = s.sessione;
    const p = await d.pubblicaVoce(sessione, offerta);
    if (!p.ok) return no(p.motivo);
    pubblicata = true;
    const r = await d.chiamata(l.linea.chiamata).rispondi({ da: per, sessione, mid });
    const errore = esitoDo(r);
    if (errore) return await chiudiTraccia(errore);
    return { ok: true, descrizione: p.descrizione, vista: r.vista };
  } catch (e) {
    console.error("rispondi chiamata: errore", e && e.name);
    return await chiudiTraccia(no("riprova"));
  }

  async function chiudiTraccia(risultato) {
    if (pubblicata) {
      try { await d.chiudiSessione(sessione, [mid]); } catch { /* la traccia senza traffico la chiude comunque Realtime */ }
    }
    return risultato;
  }
}

export async function rifiutaChiamata({ per, adesso }, d) {
  const l = await lineaDi(per, adesso, d);
  if (!l.ok) return l;
  if (l.linea.ruolo !== "con") return no("non_tocca_a_te");
  const r = await d.chiamata(l.linea.chiamata).rifiuta({ da: per });
  return esitoDo(r) || { ok: true, vista: r.vista };
}

// «Chiudi» (o «Annulla» durante lo squillo) e «Chiudi e segnala»: per tutti e due.
export async function chiudiChiamata({ per, segnala, adesso }, d) {
  const l = await lineaDi(per, adesso, d);
  if (!l.ok) return l;
  const r = await d.chiamata(l.linea.chiamata).chiudi({ da: per, esito: segnala === true ? "chiudi_e_segnala" : "chiusa" });
  const errore = esitoDo(r);
  if (errore) return errore;
  return r.segnala ? { ok: true, vista: r.vista, segnala: true } : { ok: true, vista: r.vista };
}

// --- Passo 3b-2b-2c-2a: ricevere la voce dell'altra persona -------------------------------------------------------
// «ascolta»: il server chiede a Realtime la traccia «voce» dell'altra persona sulla mia sessione e passa al telefono
// l'offerta di Cloudflare; «conferma»: il telefono manda la sua risposta (solo voce). Le sessioni le sa solo il
// Durable Object: il telefono non manda e non riceve mai id. d in più: riceviVoce(mia, altra), confermaRisposta(mia, r).
const rispostaValida = (r) => !!r && typeof r === "object" && r.type === "answer" && soloVoceSessione(r.sdp);

export async function ascoltaChiamata({ per, adesso }, d) {
  const l = await lineaDi(per, adesso, d);
  if (!l.ok) return l;
  const chiamata = d.chiamata(l.linea.chiamata);
  const s = await chiamata.sessioni(per);
  if (!s || !s.ok) return no(String((s && s.motivo) || "riprova"));
  let ricevuta = null;
  try {
    const v = await d.riceviVoce(s.mia, s.altra);
    if (!v.ok) return no(v.motivo);
    ricevuta = v.mid;
    const r = await chiamata.ascolto({ da: per, mid: v.mid, di: s.altra });
    const errore = esitoDo(r);
    if (errore) return await chiudiRicevuta(errore);
    return { ok: true, descrizione: v.descrizione, vista: r.vista };
  } catch (e) {
    console.error("ascolta chiamata: errore", e && e.name);
    return await chiudiRicevuta(no("riprova"));
  }

  async function chiudiRicevuta(risultato) {
    if (ricevuta) {
      try { await d.chiudiSessione(s.mia, [ricevuta]); } catch { /* a fine chiamata si chiude comunque tutta la sessione */ }
    }
    return risultato;
  }
}

export async function confermaAscolto({ per, risposta, adesso }, d) {
  if (!UUID.test(per || "")) return no("dati");
  if (!rispostaValida(risposta)) return no("solo_voce");
  const l = await lineaDi(per, adesso, d);
  if (!l.ok) return l;
  const chiamata = d.chiamata(l.linea.chiamata);
  const s = await chiamata.sessioni(per);
  if (!s || !s.ok) return no(String((s && s.motivo) || "riprova"));
  const c = await d.confermaRisposta(s.mia, risposta);
  if (!c || !c.ok) return no(String((c && c.motivo) || "riprova"));
  const v = await chiamata.vista(per);
  return { ok: true, vista: v && v.ok ? v.vista : null };
}

// --- Passo 3b-2b-2c-2b-1: connessione persa e «Riconnetti» --------------------------------------------------------
// Spec v1.2: 30 secondi per rientrare, il timer continua; se non si rientra la chiamata finisce (lo decide l'allarme
// del Durable Object). «caduta»: il telefono che ha perso la voce lo dice. «rientro»: al tocco su «Riconnetti» il
// telefono manda una nuova offerta solo voce, pubblicata su una sessione nuova; la vecchia la chiude il Durable Object.
// Se la caduta non era arrivata (rete del tutto assente) il rientro la segna prima: così vale sempre la stessa regola.
export async function cadutaChiamata({ per, adesso }, d) {
  const l = await lineaDi(per, adesso, d);
  if (!l.ok) return l;
  const r = await d.chiamata(l.linea.chiamata).caduta({ da: per });
  return esitoDo(r) || { ok: true, vista: r.vista };
}

export async function rientroChiamata({ per, offerta, adesso }, d) {
  if (!UUID.test(per || "")) return no("dati");
  if (!offertaValida(offerta)) return no("solo_voce");
  const l = await lineaDi(per, adesso, d);
  if (!l.ok) return l;
  const chiamata = d.chiamata(l.linea.chiamata);
  const errore = esitoDo(await chiamata.caduta({ da: per }));
  if (errore) return errore;

  const mid = midAudio(offerta.sdp);
  let sessione = null, pubblicata = false;
  try {
    const s = await d.nuovaSessione();
    if (!s.ok) return no(s.motivo);
    sessione = s.sessione;
    const p = await d.pubblicaVoce(sessione, offerta);
    if (!p.ok) return no(p.motivo);
    pubblicata = true;
    const r = await chiamata.rientro({ da: per, sessione, mid });
    const no2 = esitoDo(r);
    if (no2) return await chiudiTraccia(no2);
    return { ok: true, descrizione: p.descrizione, vista: r.vista };
  } catch (e) {
    console.error("rientro chiamata: errore", e && e.name);
    return await chiudiTraccia(no("riprova"));
  }

  async function chiudiTraccia(risultato) {
    if (pubblicata) {
      try { await d.chiudiSessione(sessione, [mid]); } catch { /* la traccia senza traffico la chiude comunque Realtime */ }
    }
    return risultato;
  }
}

// --- Passo 3b-2b-2c-2b-2: pescata della carta (spec v1.2) -----------------------------------------------------------
// Un tocco su «Carte» → la stessa carta sui due telefoni (la vede anche l'altra persona al suo prossimo GET).
// Le regole (da 0:10 a 14:00, 20 s tra due pescate, vale il primo tocco) le decide il Durable Object; il mazzo e le
// carte già viste dalla coppia le legge qui il server. Al Durable Object vanno solo id di carta, mai i testi; al
// telefono la vista con { id, testo, daMe }: niente nomi (il nome dell'altra persona l'app lo sa già), niente id
// della chiamata. d in più: carte(), carteViste({ stanza, a, b }), segnaVista({ stanza, a, b, carta, ricomincia }),
// casuale() → numero in [0, 1) (sul server crypto.getRandomValues).

// Aggiunge il testo alla carta aperta; una carta non più attiva non si mostra.
function conTesto(vista, carte) {
  if (!vista || !vista.carta) return vista;
  const c = (carte || []).find((x) => x.id === vista.carta.id);
  return { ...vista, carta: c ? { id: c.id, testo: c.testo, daMe: vista.carta.daMe === true } : null };
}

export async function pescaCartaChiamata({ per, adesso }, d) {
  const l = await lineaDi(per, adesso, d);
  if (!l.ok) return l;
  if (!UUID.test(l.linea.altra || "")) return no("riprova");
  const [a, b] = [per, l.linea.altra].sort();
  const coppia = { stanza: l.stanza.id, a, b };
  const [carte, viste] = await Promise.all([d.carte(), d.carteViste(coppia)]);
  if (!carte || !viste) return no("riprova");
  if (!carte.length) return no("nessuna_carta");

  const r = await d.chiamata(l.linea.chiamata).pesca({
    da: per, carte: carte.map((c) => ({ id: c.id })), viste, numero: d.casuale(),
  });
  const errore = esitoDo(r);
  if (errore) return errore;
  // Se non si salva, la carta compare lo stesso: al più potrà ripetersi in questa settimana.
  const segnata = await d.segnaVista({ ...coppia, carta: r.carta, ricomincia: r.ricomincia === true });
  if (!segnata) console.error("pesca carta: carta vista non salvata");
  return { ok: true, vista: conTesto(r.vista, carte) };
}
