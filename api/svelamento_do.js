// Svelamento dopo la porta (issue #65, passo 7b; D48 A): il «gestore» delle sessioni Realtime di UNA porta, cuore del
// Durable Object `Svelamento` (worker/svelamento.js). Un Durable Object per porta (SQLite, piano gratuito): risponde a
// una richiesta alla volta e l'allarme chiude il video a 10 secondi anche se nessun telefono scrive.
//
// Chi può entrare e quando lo decide il database (entra_svelamento → «iniziato_video»); il Worker chiama questo gestore
// solo dopo quel sì, con la persona letta dal token. Qui si tiene solo:
// - la sessione Realtime di ciascuno dei due (al massimo due persone: una terza non entra mai) e i mids delle tracce;
// - il timer: i 10 secondi partono SOLO quando tutti e due hanno ricevuto voce e video dell'altra persona
//   (spec, criterio «Il timer dei 10 secondi parte solo quando entrambi i video sono ricevuti»);
// - la fine: allo scadere il server chiude tutte le tracce delle due sessioni, senza aspettare i telefoni.
// «Riprova» (nuova pubblicazione prima della fine) chiude la sessione vecchia e le tracce che l'altra persona riceveva
// da lì, e il timer riparte da 10 con lo sfocato iniziale. Gli avvii dei 10 secondi li conta qui (passo 8b-2b).
// Nessuna registrazione: Realtime inoltra e basta, qui niente SDP, niente immagini. A svelamento finito e chiusure
// fatte, dopo ATTESA_DOPO_FINE il Durable Object cancella tutto. Al telefono va solo la «vista»: mai id di sessione.
// Passo 8b-2b: il Durable Object dice al database come è finito il video, con «segna» (da fuori: il Worker chiama
// fine_svelamento o torna_a_quando, worker/svelamento_api.js segnaFineSvelamento):
// - 10 secondi pieni → «finito» (da lì le 48 ore del sì/no);
// - nessun inizio entro SCADENZA_MS, o caduta al terzo avvio dei 10 secondi (SVELAMENTO.tentativi) → «quando» (passo 4,
//   caparre e scelte restano); al telefono motivo «quando», mai «Ecco <nome>.»;
// - «Chiudi e segnala» → niente: il database ha già chiuso la porta.
// Se il database non risponde si riprova a ogni allarme (al massimo TENTATIVI volte); la pulizia aspetta.
// Niente Cloudflare qui dentro: archivio, orologio e chiusura delle sessioni arrivano da fuori (test con node --test).

import { SVELAMENTO } from "./svelamento.js";

export const ATTESA_DOPO_FINE = 60_000;
export const SCADENZA_MS = 15 * 60_000; // nessuno svelamento iniziato entro 15 minuti dalla prima pubblicazione: si chiude
export const RIPROVA_MS = 30_000;
export const TENTATIVI = 5;
const DURATA_MS = SVELAMENTO.durata * 1000;
const SFOCATO_MS = SVELAMENTO.sfocato * 1000;

const SESSIONE = /^[A-Za-z0-9_-]{8,128}$/;
const MID = /^[A-Za-z0-9_-]{1,32}$/;
const VUOTA = Object.freeze({ chiusure: [], tentativi: 0 });
const PORTA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const no = (motivo) => ({ ok: false, motivo });
const persona = (x) => typeof x === "string" && x.length > 0 && x.length <= 64;
const dueMids = (m) => Array.isArray(m) && m.length === 2 && m.every((x) => typeof x === "string" && MID.test(x)) && m[0] !== m[1];

function fase(stato) {
  if (stato.interrotto) return "interrotto";
  if (stato.quando) return "quando";
  if (stato.finitoIl) return "finito";
  return stato.inizio ? "in_corso" : "attesa";
}

// «ora» è l'ora del server (passo 7d-1): il telefono calcola timer e sfocatura senza fidarsi del proprio orologio.
function vistaPer(stato, da, ora) {
  if (!stato.persone[da] && Object.keys(stato.persone).length >= 2) return null;
  const f = fase(stato);
  const v = { fase: f, ora };
  if (stato.inizio && f !== "interrotto") Object.assign(v, { inizio: stato.inizio, nitidoDal: stato.inizio + SFOCATO_MS, fine: stato.inizio + DURATA_MS });
  return v;
}

// Svelamento finito: «interrotto» se chiuso con «Chiudi e segnala» (passo 7d-3a), sennò «finito».
const finito = (stato) => no(stato.interrotto ? "interrotto" : stato.quando ? "quando" : "finito");
const altraDi = (stato, da) => Object.keys(stato.persone).find((p) => p !== da);
// Tutte le tracce di una sessione: le mie due (voce, video) più le due che ricevo o sto per ricevere (passo 7c).
// «ricevo» e «arrivo» non sono mai pieni insieme: così una sessione non supera mai 4 tracce (limite di chiudiVoce).
const tracce = (p) => [...p.mids, ...(p.ricevo || []), ...(p.arrivo || [])];

export class GestoreSvelamento {
  constructor({ storage, adesso = () => new Date(), chiudiSessione, segna = null }) {
    this.storage = storage;
    this.adesso = adesso;
    this.chiudiSessione = chiudiSessione;
    this.segnaFine = segna;
  }

  // Il telefono ha pubblicato voce + video (api/realtime.js pubblicaSvelamento): il Worker salva qui la sessione.
  async pubblica({ da, sessione, mids, porta }) {
    if (!persona(da) || typeof sessione !== "string" || !SESSIONE.test(sessione) || !dueMids(mids)) return no("dati");
    const adesso = this.adesso().getTime();
    const stato = (await this.storage.get("stato")) || { persone: {}, inizio: null, finitoIl: null, creato: adesso };
    if (stato.finitoIl) return finito(stato);
    const prima = stato.persone[da];
    if (!prima && Object.keys(stato.persone).length >= 2) return no("non_tocca_a_te");
    if (!stato.porta && typeof porta === "string" && PORTA.test(porta)) stato.porta = porta;
    // Passo 8b-2b: «Riprova» dopo che i 10 secondi erano partiti = una caduta. Al terzo avvio caduto si torna al passo 4.
    if (prima && stato.inizio && (stato.avvii || 0) >= SVELAMENTO.tentativi) {
      Object.assign(stato, { finitoIl: adesso, quando: true, daSegnare: "quando" });
      await this.#salva(stato, Object.values(stato.persone).map((p) => ({ sessione: p.sessione, mids: tracce(p) })));
      await this.#esegui();
      await this.#segna();
      await this.#allarme();
      return no("quando");
    }
    const chiusure = [];
    if (prima) {
      // «Riprova»: la sessione vecchia si chiude tutta; l'altra persona chiude ciò che riceveva da lì e richiede.
      chiusure.push({ sessione: prima.sessione, mids: tracce(prima) });
      const altra = stato.persone[altraDi(stato, da)];
      for (const campo of ["ricevo", "arrivo"]) {
        if (altra && altra[campo]) {
          chiusure.push({ sessione: altra.sessione, mids: altra[campo] });
          altra[campo] = null;
        }
      }
      stato.inizio = null;
    }
    stato.persone[da] = { sessione, mids: [...mids], ricevo: null, arrivo: null };
    await this.#salva(stato, chiusure);
    await this.#esegui();
    await this.#allarme();
    return { ok: true, vista: vistaPer(stato, da, this.adesso().getTime()) };
  }

  // Solo per il Worker (mai per il telefono): la sessione dell'altra persona, da cui ricevere voce e video.
  async altra(da) {
    const stato = await this.storage.get("stato");
    if (!stato) return no("nessuna");
    if (!stato.persone[da]) return Object.keys(stato.persone).length >= 2 ? no("non_tocca_a_te") : no("nessuna");
    if (stato.finitoIl) return finito(stato);
    const altra = stato.persone[altraDi(stato, da)];
    return altra ? { ok: true, sessione: altra.sessione } : no("in_attesa");
  }

  // Passo 7c, solo per il Worker (mai per il telefono): la mia sessione e quella dell'altra persona.
  async sessioni(da) {
    const a = await this.altra(da);
    if (!a.ok) return a;
    const stato = await this.storage.get("stato");
    return { ok: true, mia: stato.persone[da].sessione, altra: a.sessione };
  }

  // Passo 7c: il Worker ha chiesto a Realtime voce e video dell'altra persona; il telefono deve ancora rispondere.
  // Ricevere di nuovo chiude subito le tracce vecchie (in arrivo o già ricevute): mai più di 4 tracce per sessione.
  async inArrivo({ da, mids }) {
    const stato = await this.storage.get("stato");
    if (!stato || !stato.persone[da]) return no("nessuna");
    if (stato.finitoIl) return finito(stato);
    if (!altraDi(stato, da)) return no("in_attesa");
    if (!dueMids(mids)) return no("dati");
    const p = stato.persone[da];
    const chiusure = [p.arrivo, p.ricevo].filter(Boolean).map((m) => ({ sessione: p.sessione, mids: m }));
    p.ricevo = null;
    p.arrivo = [...mids];
    await this.#salva(stato, chiusure);
    await this.#esegui();
    await this.#allarme();
    return { ok: true, vista: vistaPer(stato, da, this.adesso().getTime()) };
  }

  // Il telefono ha confermato la ricezione di voce e video dell'altra persona: con tutti e due partono i 10 secondi.
  // Senza mids (passo 7c) valgono le tracce «in arrivo» segnate da inArrivo.
  async ricevuto({ da, mids }) {
    const stato = await this.storage.get("stato");
    if (!stato || !stato.persone[da]) return no("nessuna");
    if (stato.finitoIl) return finito(stato);
    if (!altraDi(stato, da)) return no("in_attesa");
    const p = stato.persone[da];
    const nuovi = mids === undefined ? p.arrivo : mids;
    if (!dueMids(nuovi)) return no("dati");
    const chiusure = p.ricevo && p.ricevo.join() !== nuovi.join() ? [{ sessione: p.sessione, mids: p.ricevo }] : [];
    p.ricevo = [...nuovi];
    p.arrivo = null;
    if (!stato.inizio && Object.values(stato.persone).every((x) => x.ricevo)) {
      stato.inizio = this.adesso().getTime();
      stato.avvii = (stato.avvii || 0) + 1;
    }
    await this.#salva(stato, chiusure);
    if (chiusure.length) await this.#esegui();
    await this.#allarme();
    return { ok: true, vista: vistaPer(stato, da, this.adesso().getTime()) };
  }

  // Passo 7d-3a, solo per il Worker dopo il sì del database (chiudi_e_segnala_svelamento): «Chiudi e segnala».
  // Chiude SUBITO tutte le tracce delle due sessioni, senza aspettare i 10 secondi; poi la vista dice «interrotto» a
  // entrambi (mai «Ecco <nome>.») e non si riapre nulla. Se lo svelamento era già finito non cambia niente.
  async chiudi({ da }) {
    if (!persona(da)) return no("dati");
    const stato = await this.storage.get("stato");
    if (!stato) return { ok: true };
    if (!stato.persone[da] && Object.keys(stato.persone).length >= 2) return no("non_tocca_a_te");
    if (stato.finitoIl) return { ok: true };
    stato.finitoIl = this.adesso().getTime();
    stato.interrotto = true;
    await this.#salva(stato, Object.values(stato.persone).map((p) => ({ sessione: p.sessione, mids: tracce(p) })));
    await this.#esegui();
    await this.#allarme();
    return { ok: true };
  }

  async vista(da) {
    const stato = await this.storage.get("stato");
    if (!stato) return no("nessuna");
    if (stato.quando) return no("quando");
    const vista = vistaPer(stato, da, this.adesso().getTime());
    return vista ? { ok: true, vista } : no("non_tocca_a_te");
  }

  // Allarme: fine dei 10 secondi (o scadenza senza inizio), poi le chiusure rimaste, poi la pulizia.
  async allarme() {
    const stato = await this.storage.get("stato");
    if (!stato) return { ok: true };
    const adesso = this.adesso().getTime();
    await this.#scadi(stato, adesso);
    await this.#esegui();
    await this.#segna();
    const dopo = await this.storage.get("stato");
    const attesa = (await this.storage.get("attesa")) || VUOTA;
    if (dopo.finitoIl && !attesa.chiusure.length && !dopo.daSegnare && adesso >= dopo.finitoIl + ATTESA_DOPO_FINE) {
      await this.storage.deleteAlarm();
      await this.storage.deleteAll();
      return { ok: true };
    }
    await this.#allarme();
    return { ok: true };
  }

  // Passo 8b-2b, solo per il Worker (mai per il telefono): segna subito la fine nel database se manca ancora. Ripetuta
  // non cambia nulla.
  async segna() {
    const stato = await this.storage.get("stato");
    if (!stato) return { ok: true };
    if (await this.#scadi(stato, this.adesso().getTime())) {
      await this.#esegui();
      await this.#allarme();
    }
    await this.#segna();
    return { ok: true };
  }

  // Tempo scaduto e non ancora finito: si chiude adesso. 10 secondi pieni → «finito»; nessun inizio entro SCADENZA_MS →
  // di nuovo «Quando?» (passo 8b-2b). true se ha chiuso.
  async #scadi(stato, adesso) {
    const scade = stato.inizio ? stato.inizio + DURATA_MS : stato.creato + SCADENZA_MS;
    if (stato.finitoIl || adesso < scade) return false;
    stato.finitoIl = adesso;
    if (stato.inizio) stato.daSegnare = "finito";
    else Object.assign(stato, { quando: true, daSegnare: "quando" });
    await this.#salva(stato, Object.values(stato.persone).map((p) => ({ sessione: p.sessione, mids: tracce(p) })));
    return true;
  }

  // La fine va al database una volta sola. Ogni risposta del database chiude la questione (anche «porta_chiusa» o
  // «non_iniziato»: lì non c'è più niente da segnare), tranne nessuna risposta o «non_ancora»: si riprova all'allarme.
  async #segna() {
    const stato = await this.storage.get("stato");
    if (!stato || !stato.daSegnare) return;
    const chi = Object.keys(stato.persone)[0];
    if (!stato.porta || !chi || !this.segnaFine) {
      delete stato.daSegnare;
      return this.storage.put("stato", stato);
    }
    let r;
    try {
      r = await this.segnaFine({ porta: stato.porta, persona: chi, fine: stato.daSegnare });
    } catch (e) {
      console.error("svelamento: segna", e && e.name);
    }
    const ora = (await this.storage.get("stato")) || stato;
    if (typeof r === "string" && r !== "non_ancora") delete ora.daSegnare;
    else {
      ora.segnaTentativi = (ora.segnaTentativi || 0) + 1;
      if (ora.segnaTentativi >= TENTATIVI) {
        console.error("svelamento: fine non segnata");
        delete ora.daSegnare;
      }
    }
    return this.storage.put("stato", ora);
  }

  // Stato nuovo + chiusure da fare, in UNA scrittura (nessuna attesa di rete in mezzo).
  async #salva(stato, nuove) {
    const attesa = (await this.storage.get("attesa")) || VUOTA;
    await this.storage.put({ stato, attesa: { chiusure: [...attesa.chiusure, ...nuove], tentativi: attesa.tentativi } });
  }

  // Prova le chiusure rimaste; toglie solo quelle riuscite. Dopo TENTATIVI giri a vuoto lascia perdere
  // (Realtime chiude comunque le sessioni rimaste senza traffico).
  async #esegui() {
    const attesa = (await this.storage.get("attesa")) || VUOTA;
    if (!attesa.chiusure.length) return;
    const fatte = new Set();
    for (const c of attesa.chiusure) {
      try {
        const r = await this.chiudiSessione(c.sessione, c.mids);
        if (r && r.ok) fatte.add(c);
      } catch (e) {
        console.error("svelamento: chiusura", e && e.name);
      }
    }
    // Rilegge prima di scrivere: nel frattempo può essere arrivata un'altra richiesta con chiusure nuove.
    const chiave = (c) => c.sessione + ":" + c.mids.join(",");
    const fatteChiavi = new Set([...fatte].map(chiave));
    const ora = (await this.storage.get("attesa")) || VUOTA;
    const resta = ora.chiusure.filter((c) => !fatteChiavi.has(chiave(c)));
    const tentativi = resta.length ? attesa.tentativi + 1 : 0;
    if (resta.length && tentativi >= TENTATIVI) {
      console.error("svelamento: lasciate perdere", resta.length, "chiusure");
      return this.storage.put("attesa", VUOTA);
    }
    return this.storage.put("attesa", { chiusure: resta, tentativi });
  }

  async #allarme() {
    const stato = await this.storage.get("stato");
    const attesa = (await this.storage.get("attesa")) || VUOTA;
    const adesso = this.adesso().getTime();
    let quando;
    if (stato.finitoIl) {
      quando = attesa.chiusure.length || stato.daSegnare ? adesso + RIPROVA_MS : stato.finitoIl + ATTESA_DOPO_FINE;
    }
    else {
      quando = stato.inizio ? stato.inizio + DURATA_MS : stato.creato + SCADENZA_MS;
      if (attesa.chiusure.length) quando = Math.min(quando, adesso + RIPROVA_MS);
    }
    await this.storage.setAlarm(quando);
  }
}
