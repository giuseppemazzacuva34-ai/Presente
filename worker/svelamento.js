// Durable Object `Svelamento` (issue #65, passo 7b): uno per porta, con archivio SQLite (piano gratuito).
// Solo il «guscio» Cloudflare: tutta la logica è in api/svelamento_do.js (provata con node --test).
// Il Worker lo usa per le richieste video dello svelamento (passo 7c) con metodi RPC; il telefono non lo vede mai.
// Le chiavi Realtime (REALTIME_APP_ID / REALTIME_APP_SECRET) restano secret del Worker: this.env.

import { DurableObject } from "cloudflare:workers";
import { GestoreSvelamento } from "../api/svelamento_do.js";
import { chiudiVoce } from "../api/realtime.js";
import { segnaFineSvelamento } from "./svelamento_api.js";

export class Svelamento extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.gestore = new GestoreSvelamento({
      storage: ctx.storage,
      chiudiSessione: (sessione, mids) => chiudiVoce(this.env, sessione, mids),
      // Passo 8b-2b: la fine del video va al database (fine_svelamento / torna_a_quando) con la chiave del server.
      segna: (x) => segnaFineSvelamento(this.env, x),
    });
  }

  pubblica(dati) { return this.gestore.pubblica(dati); }
  altra(da) { return this.gestore.altra(da); }
  sessioni(da) { return this.gestore.sessioni(da); }
  inArrivo(dati) { return this.gestore.inArrivo(dati); }
  ricevuto(dati) { return this.gestore.ricevuto(dati); }
  vista(da) { return this.gestore.vista(da); }
  chiudi(dati) { return this.gestore.chiudi(dati); }
  segna() { return this.gestore.segna(); }

  async alarm() {
    await this.gestore.allarme();
  }
}
