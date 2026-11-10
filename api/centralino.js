// Chiamate solo voce (issue #4, passo 3b-2b-1): il «centralino» di UNA stanza, cuore del Durable Object `Centralino`
// (worker/centralino.js). Un Durable Object per stanza (nome = id della stanza, SQLite del piano gratuito): risponde a una
// richiesta alla volta, quindi due persone che chiamano la stessa persona nello stesso istante non passano entrambe.
//
// Sa SOLO chi ha la linea occupata e da quale chiamata (id del Durable Object `Chiamata`): serve per
// - «una chiamata alla volta per persona» (spec v1: «È in un'altra chiamata»);
// - far trovare a chi riceve la chiamata in arrivo (la «vista» la dà poi il Durable Object della chiamata).
// Niente sessioni Realtime, niente nomi, niente audio: solo id, ruolo e scadenza.
//
// Il Worker libera le linee quando la chiamata finisce; se per un guasto non succede, una linea si libera da sola dopo
// DURATA_MASSIMA_LINEA (nessuna chiamata può durare di più). Dopo la chiusura della stanza si cancella tutto.
// Nulla di Cloudflare qui: archivio e orologio arrivano da fuori, così si prova con `node --test` (test/centralino.test.mjs).

import { CHIAMATA } from "./chiamate.js";

export const DURATA_MASSIMA_LINEA = (CHIAMATA.squillo + CHIAMATA.durataMassima + CHIAMATA.riconnessione + 60) * 1000;
export const DOPO_CHIUSURA = 60 * 60 * 1000; // un'ora dopo la chiusura della stanza non resta nulla

const OCCUPATO = "È in un'altra chiamata";
const no = (motivo, testo) => (testo ? { ok: false, motivo, testo } : { ok: false, motivo });
const chiave = (id) => "linea:" + id;
const testo = (x) => typeof x === "string" && x.length > 0 && x.length <= 128;

export class GestoreCentralino {
  constructor({ storage, adesso = () => new Date() }) {
    this.storage = storage;
    this.adesso = adesso;
  }

  // Linea di una persona: { chiamata, ruolo: "chi" | "con", altra } oppure null (libera o scaduta).
  async linea(per) {
    const l = await this.#leggi(per);
    return l ? { chiamata: l.chiamata, ruolo: l.ruolo, altra: l.altra } : null;
  }

  // Occupa le linee di chi chiama e di chi riceve, solo se sono libere tutte e due.
  async occupa({ chi, con, chiamata, chiusuraStanza }) {
    if (!testo(chi) || !testo(con) || chi === con || !testo(chiamata) || !Number.isFinite(chiusuraStanza)) return no("dati");
    const adesso = this.adesso().getTime();
    if (adesso >= chiusuraStanza) return no("stanza_chiusa");
    if (await this.#leggi(chi)) return no("gia_in_chiamata");
    if (await this.#leggi(con)) return no("occupato", OCCUPATO);
    const scade = adesso + DURATA_MASSIMA_LINEA;
    await this.storage.put({
      [chiave(chi)]: { chiamata, ruolo: "chi", altra: con, scade },
      [chiave(con)]: { chiamata, ruolo: "con", altra: chi, scade },
      chiusura: chiusuraStanza,
    });
    await this.storage.setAlarm(chiusuraStanza + DOPO_CHIUSURA);
    return { ok: true };
  }

  // Libera le linee di UNA chiamata (le due persone). Se una persona è già in una chiamata nuova, quella resta.
  async libera({ chiamata }) {
    if (!testo(chiamata)) return no("dati");
    const da = [];
    for (const [k, v] of await this.storage.list({ prefix: "linea:" })) if (v.chiamata === chiamata) da.push(k);
    if (da.length) await this.storage.delete(da);
    return { ok: true };
  }

  // Allarme: a stanza chiusa (più un'ora) cancella tutto; prima no (un allarme può arrivare in anticipo dopo un riavvio).
  async allarme() {
    const chiusura = await this.storage.get("chiusura");
    if (!Number.isFinite(chiusura) || this.adesso().getTime() >= chiusura + DOPO_CHIUSURA) {
      await this.storage.deleteAlarm();
      await this.storage.deleteAll();
      return { ok: true };
    }
    await this.storage.setAlarm(chiusura + DOPO_CHIUSURA);
    return { ok: true };
  }

  async #leggi(per) {
    if (!testo(per)) return null;
    const l = await this.storage.get(chiave(per));
    if (!l) return null;
    if (this.adesso().getTime() >= l.scade) {
      await this.storage.delete(chiave(per));
      return null;
    }
    return l;
  }
}
