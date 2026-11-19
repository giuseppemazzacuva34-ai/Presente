// Durable Object `Svelamento` (issue #65, passo 7b): uno per porta, con archivio SQLite (piano gratuito).
// Solo il «guscio» Cloudflare: tutta la logica è in api/svelamento_do.js (provata con node --test).
// Lo userà il Worker per le richieste video dello svelamento (passo 7c) con metodi RPC; il telefono non lo vede mai.
// Le chiavi Realtime (REALTIME_APP_ID / REALTIME_APP_SECRET) restano secret del Worker: this.env.

import { DurableObject } from "cloudflare:workers";
import { GestoreSvelamento } from "../api/svelamento_do.js";
import { chiudiVoce } from "../api/realtime.js";

export class Svelamento extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.gestore = new GestoreSvelamento({
      storage: ctx.storage,
      chiudiSessione: (sessione, mids) => chiudiVoce(this.env, sessione, mids),
    });
  }

  pubblica(dati) { return this.gestore.pubblica(dati); }
  altra(da) { return this.gestore.altra(da); }
  ricevuto(dati) { return this.gestore.ricevuto(dati); }
  vista(da) { return this.gestore.vista(da); }

  async alarm() {
    await this.gestore.allarme();
  }
}
