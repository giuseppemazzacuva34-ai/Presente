// «Elimina il mio account» (issue #2, specifica v1 del CPO): cancella subito voce, foto e account.
// Le righe di profilo, filtri, questionario e consensi spariscono da sole con l'account (on delete cascade nella
// migrazione 20261029140000_profilo.sql). I file di voce e foto invece Supabase non li cancella in SQL: li cancella
// questo endpoint con la chiave service_role, che vive SOLO come secret del Worker (mai nel repository, mai nel browser).
//
// POST /app/api/elimina-account con «Authorization: Bearer <token dell'utente>».
// Spento finché ACCESSO_APP non vale «si» (come l'accesso con email). Ordine: prima i file, poi l'account:
// se i file non si cancellano l'account resta e l'utente può riprovare; mai un account cancellato con file rimasti.

export const PERCORSO_ELIMINA = "/app/api/elimina-account";
const CARTELLE = ["voci", "foto"];
const PAGINA = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;

function risposta(stato, corpo) {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function eliminaAccount(request, env, f = fetch) {
  if (request.method !== "POST") return new Response("Metodo non ammesso.", { status: 405, headers: { allow: "POST" } });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });

  // Solo dalla nostra web app: un altro sito non può far partire la cancellazione.
  const origine = request.headers.get("origin");
  if (!origine || origine !== new URL(request.url).origin) return risposta(403, { ok: false, motivo: "origine" });

  const token = (request.headers.get("authorization") || "").match(/^Bearer ([A-Za-z0-9._-]{20,4096})$/);
  if (!token) return risposta(401, { ok: false, motivo: "accesso" });

  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const servizio = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!URL_SUPABASE.test(base) || !servizio) return risposta(503, { ok: false, motivo: "configurazione" });
  const admin = { apikey: servizio, authorization: `Bearer ${servizio}` };

  try {
    // 1. Chi è? Lo dice Supabase leggendo il token dell'utente (non ci fidiamo di un id mandato dal telefono).
    const chi = await f(`${base}/auth/v1/user`, { headers: { apikey: servizio, authorization: `Bearer ${token[1]}` } });
    if (chi.status === 401 || chi.status === 403) return risposta(401, { ok: false, motivo: "accesso" });
    if (!chi.ok) return risposta(502, { ok: false, motivo: "riprova" });
    const id = String((await chi.json()).id || "");
    if (!UUID.test(id)) return risposta(401, { ok: false, motivo: "accesso" });

    // 2. Tutti i file nelle cartelle voci/<id>/ e foto/<id>/.
    for (const cartella of CARTELLE) {
      const nomi = await elencaFile(f, base, admin, cartella, id);
      if (nomi === null) return risposta(502, { ok: false, motivo: "riprova" });
      for (let i = 0; i < nomi.length; i += PAGINA) {
        const via = await f(`${base}/storage/v1/object/${cartella}`, {
          method: "DELETE",
          headers: { ...admin, "content-type": "application/json" },
          body: JSON.stringify({ prefixes: nomi.slice(i, i + PAGINA) }),
        });
        if (!via.ok) return risposta(502, { ok: false, motivo: "riprova" });
      }
      // Controllo finale: la cartella deve risultare vuota.
      const rimasti = await elencaFile(f, base, admin, cartella, id);
      if (rimasti === null || rimasti.length) return risposta(502, { ok: false, motivo: "riprova" });
    }

    // 3. L'account: con lui spariscono email, profilo, filtri, questionario e consensi.
    const via = await f(`${base}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin });
    if (!via.ok && via.status !== 404) return risposta(502, { ok: false, motivo: "riprova" });
    return risposta(200, { ok: true });
  } catch {
    // Mai dettagli del server verso il telefono.
    return risposta(502, { ok: false, motivo: "riprova" });
  }
}

// Elenca i file di una persona in una cartella. null = Supabase non ha risposto bene.
async function elencaFile(f, base, admin, cartella, id) {
  const nomi = [];
  for (let offset = 0; offset < 10000; offset += PAGINA) {
    const r = await f(`${base}/storage/v1/object/list/${cartella}`, {
      method: "POST",
      headers: { ...admin, "content-type": "application/json" },
      // Come fa la libreria ufficiale di Supabase: il nome della cartella, senza «/» finale.
      body: JSON.stringify({ prefix: id, limit: PAGINA, offset }),
    });
    if (!r.ok) return null;
    const pagina = await r.json();
    if (!Array.isArray(pagina)) return null;
    for (const voce of pagina) {
      const nome = String((voce && voce.name) || "");
      // Le voci senza id sono sottocartelle: non ne creiamo, ma per sicurezza le scendiamo una volta.
      if (!nome || nome.includes("..")) continue;
      if (voce.id === null || voce.id === undefined) {
        const dentro = await elencaFile(f, base, admin, cartella, `${id}/${nome}`);
        if (dentro === null) return null;
        nomi.push(...dentro);
      } else {
        nomi.push(`${id}/${nome}`);
      }
    }
    if (pagina.length < PAGINA) return nomi;
  }
  return nomi;
}

// Requisito 5 del CISO: limite di frequenza (binding LIMITE_ELIMINA in wrangler.jsonc, 3 richieste al minuto dalla
// stessa connessione). Ogni richiesta fa lavorare Supabase con la chiave amministratore: così nessuno la può usare
// per tempestarlo. L'indirizzo IP serve solo a contare in memoria: non si salva e non va nei log.
// Se il limite non risponde si lascia passare: la cancellazione resta comunque protetta dal token dell'utente.
async function troppeRichieste(request, env) {
  if (!env.LIMITE_ELIMINA) return false;
  try {
    const { success } = await env.LIMITE_ELIMINA.limit({ key: "elimina:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}
