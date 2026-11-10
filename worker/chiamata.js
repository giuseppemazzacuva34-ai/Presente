// Durable Object `Chiamata` (issue #4, passo 3b-2a): uno per chiamata, con archivio SQLite (piano gratuito).
// Solo il «guscio» Cloudflare: tutta la logica è in api/chiamata_do.js (provata con node --test).
// Lo usa il Worker per le richieste /app/api/chiamata/… (passo 3b-2b) con metodi RPC; il telefono non lo vede mai.
// Le chiavi (REALTIME_APP_ID / REALTIME_APP_SECRET, SUPABASE_SERVICE_ROLE_KEY) restano secret del Worker: this.env.

import { DurableObject } from "cloudflare:workers";
import { GestoreChiamata } from "../api/chiamata_do.js";
import { chiudiVoce } from "../api/realtime.js";
import { registraChiamata } from "../api/registro_chiamate.js";

export class Chiamata extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.gestore = new GestoreChiamata({
      storage: ctx.storage,
      chiudiSessione: (sessione, mids) => chiudiVoce(this.env, sessione, mids),
      registra: (riga) => registraChiamata(this.env, riga),
    });
  }

  apri(dati) { return this.gestore.apri(dati); }
  rispondi(dati) { return this.gestore.rispondi(dati); }
  rifiuta(dati) { return this.gestore.rifiuta(dati); }
  chiudi(dati) { return this.gestore.chiudi(dati); }
  caduta(dati) { return this.gestore.caduta(dati); }
  rientro(dati) { return this.gestore.rientro(dati); }
  pesca(dati) { return this.gestore.pesca(dati); }
  vista(per, carte) { return this.gestore.vista(per, carte); }

  async alarm() {
    await this.gestore.allarme();
  }
}
