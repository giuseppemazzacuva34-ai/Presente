// Durable Object `Centralino` (issue #4, passo 3b-2b-1): uno per stanza (nome = id della stanza), archivio SQLite
// del piano gratuito. Solo il «guscio» Cloudflare: la logica è in api/centralino.js (provata con node --test).
// Sa solo chi ha la linea occupata e da quale chiamata; lo usa il Worker per le richieste /app/api/chiamata/… (3b-2b-2)
// con metodi RPC. Il telefono non lo vede mai.

import { DurableObject } from "cloudflare:workers";
import { GestoreCentralino } from "../api/centralino.js";

export class Centralino extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.gestore = new GestoreCentralino({ storage: ctx.storage });
  }

  linea(per) { return this.gestore.linea(per); }
  occupa(dati) { return this.gestore.occupa(dati); }
  libera(dati) { return this.gestore.libera(dati); }

  async alarm() {
    await this.gestore.allarme();
  }
}
