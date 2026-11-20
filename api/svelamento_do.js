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
// da lì, e il timer riparte da 10 con lo sfocato iniziale. Il conto dei 3 tentativi resta al database.
// Nessuna registrazione: Realtime inoltra e basta, qui niente SDP, niente immagini. A svelamento finito e chiusure
// fatte, dopo ATTESA_DOPO_FINE il Durable Object cancella tutto. Al telefono va solo la «vista»: mai id di sessione.
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
const no = (motivo) => ({ ok: false, motivo });
const persona = (x) => typeof x === "string" && x.length > 0 && x.length <= 64;
const dueMids = (m) => Array.isArray(m) && m.length === 2 && m.every((x) => typeof x === "string" && MID.test(x)) && m[0] !== m[1];

function fase(stato) {
  if (stato.finitoIl) return "finito";
  return stato.inizio ? "in_corso" : "attesa";
}

// «ora» è l'ora del server (passo 7d-1): il telefono calcola timer e sfocatura senza fidarsi del proprio orologio.
function vistaPer(stato, da, ora) {
  if (!stato.persone[da] && Object.keys(stato.persone).length >= 2) return null;
  const f = fase(stato);
  const v = { fase: f, ora };
  if (stato.inizio) Object.assign(v, { inizio: stato.inizio, nitidoDal: stato.inizio + SFOCATO_MS, fine: stato.inizio + DURATA_MS });
  return v;
}

const altraDi = (stato, da) => Object.keys(stato.persone).find((p) => p !== da);
// Tutte le tracce di una sessione: le mie due (voce, video) più le due che ricevo o sto per ricevere (passo 7c).
// «ricevo» e «arrivo» non sono mai pieni insieme: così una sessione non supera mai 4 tracce (limite di chiudiVoce).
const tracce = (p) => [...p.mids, ...(p.ricevo || []), ...(p.arrivo || [])];

export class GestoreSvelamento {
  constructor({ storage, adesso = () => new Date(), chiudiSessione }) {
    this.storage = storage;
    this.adesso = adesso;
    this.chiudiSessione = chiudiSessione;
  }

  // Il telefono ha pubblicato voce + video (api/realtime.js pubblicaSvelamento): il Worker salva qui la sessione.
  async pubblica({ da, sessione, mids }) {
    if (!persona(da) || typeof sessione !== "string" || !SESSIONE.test(sessione) || !dueMids(mids)) return no("dati");
    const adesso = this.adesso().getTime();
    const stato = (await this.storage.get("stato")) || { persone: {}, inizio: null, finitoIl: null, creato: adesso };
    if (stato.finitoIl) return no("finito");
    const prima = stato.persone[da];
    if (!prima && Object.keys(stato.persone).length >= 2) return no("non_tocca_a_te");
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
    if (stato.finitoIl) return no("finito");
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
    if (stato.finitoIl) return no("finito");
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
    if (stato.finitoIl) return no("finito");
    if (!altraDi(stato, da)) return no("in_attesa");
    const p = stato.persone[da];
    const nuovi = mids === undefined ? p.arrivo : mids;
    if (!dueMids(nuovi)) return no("dati");
    const chiusure = p.ricevo && p.ricevo.join() !== nuovi.join() ? [{ sessione: p.sessione, mids: p.ricevo }] : [];
    p.ricevo = [...nuovi];
    p.arrivo = null;
    if (!stato.inizio && Object.values(stato.persone).every((x) => x.ricevo)) stato.inizio = this.adesso().getTime();
    await this.#salva(stato, chiusure);
    if (chiusure.length) await this.#esegui();
    await this.#allarme();
    return { ok: true, vista: vistaPer(stato, da, this.adesso().getTime()) };
  }

  async vista(da) {
    const stato = await this.storage.get("stato");
    if (!stato) return no("nessuna");
    const vista = vistaPer(stato, da, this.adesso().getTime());
    return vista ? { ok: true, vista } : no("non_tocca_a_te");
  }

  // Allarme: fine dei 10 secondi (o scadenza senza inizio), poi le chiusure rimaste, poi la pulizia.
  async allarme() {
    const stato = await this.storage.get("stato");
    if (!stato) return { ok: true };
    const adesso = this.adesso().getTime();
    const scade = stato.inizio ? stato.inizio + DURATA_MS : stato.creato + SCADENZA_MS;
    if (!stato.finitoIl && adesso >= scade) {
      stato.finitoIl = adesso;
      await this.#salva(stato, Object.values(stato.persone).map((p) => ({ sessione: p.sessione, mids: tracce(p) })));
    }
    await this.#esegui();
    const dopo = await this.storage.get("stato");
    const attesa = (await this.storage.get("attesa")) || VUOTA;
    if (dopo.finitoIl && !attesa.chiusure.length && adesso >= dopo.finitoIl + ATTESA_DOPO_FINE) {
      await this.storage.deleteAlarm();
      await this.storage.deleteAll();
      return { ok: true };
    }
    await this.#allarme();
    return { ok: true };
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
    if (stato.finitoIl) quando = attesa.chiusure.length ? adesso + RIPROVA_MS : stato.finitoIl + ATTESA_DOPO_FINE;
    else {
      quando = stato.inizio ? stato.inizio + DURATA_MS : stato.creato + SCADENZA_MS;
      if (attesa.chiusure.length) quando = Math.min(quando, adesso + RIPROVA_MS);
    }
    await this.storage.setAlarm(quando);
  }
}
