// Chiamate solo voce (issue #4, passo 3b-2a): il «gestore» di UNA chiamata, cuore del Durable Object `Chiamata`
// (worker/chiamata.js). Un Durable Object per chiamata (SQLite, piano gratuito): risponde a una richiesta alla volta,
// quindi «vale il primo tocco» viene da sé; l'allarme fa scadere squillo, 15:00 e rientro anche se nessun telefono scrive.
//
// Qui non c'è nulla di Cloudflare: archivio, orologio, chiusura delle sessioni Realtime e scrittura del registro
// arrivano da fuori, così tutto si prova con `node --test` (test/chiamata_do.test.mjs).
//
// Regole che questo file aggiunge a api/stato_chiamata.js:
// - Prima si salva, poi si fa il resto: lo stato nuovo e le cose «da fare» (sessioni da chiudere, riga del registro)
//   si scrivono insieme; solo dopo si chiama Realtime e Supabase. Se uno dei due non risponde si riprova all'allarme
//   (ogni RIPROVA_MS, al massimo TENTATIVI volte: Realtime chiude comunque le sessioni rimaste senza traffico).
// - A chiamata finita e tutto scritto, dopo ATTESA_DOPO_FINE (il tempo per far vedere «finita» ai telefoni)
//   il Durable Object cancella tutto: non resta nemmeno chi ha chiamato chi. L'unica traccia è la riga del registro.
// - Al telefono va solo la «vista» (vistaPer): mai gli id delle sessioni Realtime.

import {
  nuovaChiamata, rispondi, rifiuta, chiudi, caduta, rientro, scadenze, prossimoAllarme, pesca, vistaPer, ascolto, sessioniPer,
} from "./stato_chiamata.js";

export const ATTESA_DOPO_FINE = 60_000;
export const RIPROVA_MS = 30_000;
export const TENTATIVI = 5;

const no = (motivo) => ({ ok: false, motivo });
const VUOTA = Object.freeze({ chiusure: [], riga: null, tentativi: 0 });
const vuota = (a) => !a || (!a.chiusure.length && !a.riga && !a.linee);
const testo = (x) => typeof x === "string" && x.length > 0 && x.length <= 128;
const stessaRiga = (x, y) => !!x && !!y && x.chi === y.chi && x.inizio === y.inizio;

export class GestoreChiamata {
  // liberaLinee(stanza, chiamata) → { ok }: libera le due linee nel Centralino della stanza (passo 3b-2b-2c).
  constructor({ storage, adesso = () => new Date(), chiudiSessione, registra, liberaLinee = null }) {
    this.storage = storage;
    this.adesso = adesso;
    this.chiudiSessione = chiudiSessione;
    this.registra = registra;
    this.liberaLinee = liberaLinee;
  }

  // stanza e chiamata (id) servono solo per liberare le linee del Centralino quando la chiamata finisce.
  async apri({ chi, con, chiusuraStanza, sessioneChi, midChi, stanza, chiamata }) {
    if (await this.storage.get("stato")) return no("gia_aperta");
    const adesso = this.adesso();
    const stato = nuovaChiamata({ chi, con, adesso, chiusuraStanza: new Date(chiusuraStanza), sessioneChi, midChi });
    const linee = testo(stanza) && testo(chiamata) ? { stanza, chiamata } : null;
    await this.storage.put({ stato, attesa: VUOTA, ...(linee ? { linee } : {}) });
    await this.#allarme(stato, VUOTA);
    return { ok: true, vista: vistaPer(stato, chi, adesso) };
  }

  rispondi({ da, sessione, mid }) { return this.#passo((c, adesso) => rispondi(c, { da, adesso, sessione, mid }), da); }
  rifiuta({ da }) { return this.#passo((c, adesso) => rifiuta(c, { da, adesso }), da); }
  chiudi({ da, esito }) { return this.#passo((c, adesso) => chiudi(c, { da, adesso, esito }), da); }
  caduta({ da }) { return this.#passo((c, adesso) => caduta(c, { da, adesso }), da); }
  rientro({ da, sessione, mid }) { return this.#passo((c, adesso) => rientro(c, { da, adesso, sessione, mid }), da); }

  // carte: righe attive · viste: Set degli id già visti dalla coppia · li legge e li aggiorna chi chiama (il Worker).
  pesca({ da, carte, viste, casuale }) {
    return this.#passo((c, adesso) => pesca(c, { da, adesso, carte, viste, casuale }), da, carte?.length || 0);
  }

  // Passo 3b-2b-2c-2a. Le due sessioni Realtime per ascoltare: solo per il Worker, mai per il telefono.
  async sessioni(per) {
    const stato = await this.storage.get("stato");
    return stato ? sessioniPer(stato, per) : no("nessuna");
  }
  ascolto({ da, mid, di }) { return this.#passo((c) => ascolto(c, { da, mid, di }), da); }

  async vista(per, carte = 0) {
    const stato = await this.storage.get("stato");
    if (!stato) return no("nessuna");
    const vista = vistaPer(stato, per, this.adesso(), carte);
    return vista ? { ok: true, vista } : no("non_tocca_a_te");
  }

  // Allarme del Durable Object: scadenze, poi le cose rimaste da fare, poi (se tutto è finito) la pulizia.
  async allarme() {
    const stato = await this.storage.get("stato");
    if (!stato) return { ok: true };
    const adesso = this.adesso();
    const r = scadenze(stato, adesso);
    if (r.stato.fase === "finita" && stato.fase !== "finita") await this.#salva(stato, r, adesso);
    await this.#esegui();
    const dopo = await this.storage.get("stato");
    const attesa = (await this.storage.get("attesa")) || VUOTA;
    if (dopo.fase === "finita" && vuota(attesa) && adesso.getTime() >= dopo.finitaIl + ATTESA_DOPO_FINE) {
      await this.storage.deleteAlarm();
      await this.storage.deleteAll();
      return { ok: true };
    }
    await this.#allarme(dopo, attesa);
    return { ok: true };
  }

  // Un passo chiesto da un telefono: calcolo, salvataggio insieme alle cose da fare, poi Realtime e registro.
  async #passo(calcolo, da, carte = 0) {
    const stato = await this.storage.get("stato");
    if (!stato) return no("nessuna");
    const adesso = this.adesso();
    const r = calcolo(stato, adesso);
    if (!r.ok) return r;
    await this.#salva(stato, r, adesso);
    await this.#esegui();
    const dopo = await this.storage.get("stato");
    await this.#allarme(dopo, (await this.storage.get("attesa")) || VUOTA);
    const fine = { ok: true, vista: vistaPer(dopo, da, adesso, carte) };
    if (r.segnala) fine.segnala = true;
    if (r.carta !== undefined) Object.assign(fine, { carta: r.carta, ricomincia: r.ricomincia });
    return fine;
  }

  // Stato nuovo + cose da fare, in UNA scrittura (nessuna attesa di rete in mezzo).
  async #salva(prima, r, adesso) {
    const attesa = (await this.storage.get("attesa")) || VUOTA;
    const mids = (sessione) => {
      const s = Object.values(prima.sessioni).find((x) => x.sessione === sessione);
      return s ? [s.mid, s.ascolto && s.ascolto.mid].filter(Boolean) : []; // la mia voce e quella che ricevo
    };
    const nuove = [...(r.daChiudere || []).map((sessione) => ({ sessione, mids: mids(sessione) })), ...(r.chiudiTracce || [])];
    const appenaFinita = r.stato.fase === "finita" && prima.fase !== "finita";
    const stato = appenaFinita ? { ...r.stato, finitaIl: adesso.getTime() } : r.stato;
    const linee = appenaFinita ? await this.storage.get("linee") : attesa.linee;
    await this.storage.put({
      stato,
      attesa: { chiusure: [...attesa.chiusure, ...nuove], riga: r.riga || attesa.riga, tentativi: attesa.tentativi,
        ...(linee ? { linee } : {}) },
    });
  }

  // Prova a fare le cose rimaste; toglie solo quelle riuscite (rilegge prima di scrivere: nel frattempo può
  // essere arrivata un'altra richiesta). Dopo TENTATIVI giri a vuoto lascia perdere.
  async #esegui() {
    const attesa = (await this.storage.get("attesa")) || VUOTA;
    if (vuota(attesa)) return;
    const fatte = [];
    for (const c of attesa.chiusure) {
      const r = await this.chiudiSessione(c.sessione, c.mids);
      if (r && r.ok) fatte.push(c.sessione);
    }
    const rigaScritta = attesa.riga ? await this.registra(attesa.riga) : false;
    let lineeLibere = !this.liberaLinee; // senza Centralino collegato non c'è nulla da liberare
    if (attesa.linee && this.liberaLinee) {
      try {
        const r = await this.liberaLinee(attesa.linee.stanza, attesa.linee.chiamata);
        lineeLibere = !!(r && r.ok);
      } catch (e) {
        console.error("chiamata: centralino", e && e.name);
      }
    }
    const ora = (await this.storage.get("attesa")) || VUOTA;
    const resta = {
      chiusure: ora.chiusure.filter((c) => !fatte.includes(c.sessione)),
      riga: rigaScritta && stessaRiga(ora.riga, attesa.riga) ? null : ora.riga,
      tentativi: ora.tentativi + 1,
      ...(ora.linee && !lineeLibere ? { linee: ora.linee } : {}),
    };
    if (vuota(resta)) return this.storage.put("attesa", VUOTA);
    if (resta.tentativi >= TENTATIVI) {
      // Le linee rimaste si liberano comunque da sole dopo DURATA_MASSIMA_LINEA (api/centralino.js).
      console.error("chiamata: lasciate perdere", resta.chiusure.length, "chiusure,", resta.riga ? 1 : 0, "righe,", resta.linee ? 1 : 0, "linee");
      return this.storage.put("attesa", VUOTA);
    }
    return this.storage.put("attesa", resta);
  }

  async #allarme(stato, attesa) {
    const adesso = this.adesso().getTime();
    const quando = [];
    const p = prossimoAllarme(stato);
    if (p !== null) quando.push(p);
    if (!vuota(attesa)) quando.push(adesso + RIPROVA_MS);
    else if (stato.fase === "finita") quando.push(stato.finitaIl + ATTESA_DOPO_FINE);
    if (quando.length) await this.storage.setAlarm(Math.min(...quando));
    else await this.storage.deleteAlarm();
  }
}
