// Pannello di chi decide (issue #7, spec v1.1 definitiva, «Cosa vede chi decide»; D51 A) · linea «sviluppatore-b», passo 13b.
//
//   GET  /app/api/pannello/coda                                 → { ok: true, coda: [...] }
//   POST /app/api/pannello/scheda { id }                        → { ok: true, scheda: {...} }   (l'apertura va nel registro)
//   POST /app/api/pannello/decidi { id, azione, regola?, testo } → { ok: true, sanzione } | { ok: false, motivo }
//   GET  /app/api/pannello/ricorsi                              → { ok: true, ricorsi: [...] }          (passo 13e)
//   POST /app/api/pannello/ricorso { id, esito, testo }         → { ok: true } | { ok: false, motivo } (passo 13e)
//
// Chi decide lo dicono SOLO il token di Supabase e la tabella «moderatori» (in beta Giuseppe): un campo nel corpo
// non conta. Le regole stanno nel database (migrazioni 20261116094039 e 20261116144014): qui solo accesso, forma
// della richiesta e codici di risposta. Nei log solo nomi di errore e codici, mai token, nomi o racconti.
// Spento finché ACCESSO_APP non vale «si».

export const PERCORSO_PANNELLO = "/app/api/pannello";
export const AZIONI = Object.freeze(["archivia", "avviso", "sospensione_7", "sospensione_30", "esclusione", "togli_cautelare"]);
export const ESITI_RICORSO = Object.freeze(["accolto", "respinto"]);
const SENZA_REGOLA = new Set(["archivia", "togli_cautelare"]);
const CORPO_MASSIMO = 16 * 1024; // motivo di 2000 caratteri al massimo, anche con caratteri di 4 byte
const ATTESA_MS = 2500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;

function risposta(stato, corpo, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

function entro(ms, promessa) {
  let timer;
  return Promise.race([promessa, new Promise((_, no) => { timer = setTimeout(() => no(new Error("tempo scaduto")), ms); })])
    .finally(() => clearTimeout(timer));
}

function server(env) {
  const base = String(env?.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const chiave = String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return URL_SUPABASE.test(base) && chiave
    ? { base, chiave, headers: { apikey: chiave, authorization: `Bearer ${chiave}`, "content-type": "application/json" } } : null;
}

// Chiamata a una funzione del database con la chiave del server: { stato, dati } oppure null se la rete non va.
async function rpc(s, nome, parametri, f) {
  try {
    const r = await entro(ATTESA_MS, f(`${s.base}/rest/v1/rpc/${nome}`, { method: "POST", headers: s.headers, body: JSON.stringify(parametri) }));
    if (!r.ok) {
      console.error("pannello: risposta", nome, r.status);
      return { stato: r.status, dati: null };
    }
    // Le funzioni «void» (decidi_ricorso) possono rispondere 204 senza corpo.
    return { stato: r.status, dati: r.status === 204 ? null : await r.json() };
  } catch (e) {
    console.error("pannello: errore", nome, e && e.name);
    return null;
  }
}

function operazioniVere(env, f) {
  const s = server(env);
  return {
    eModeratore: async (id) => {
      const r = s && (await rpc(s, "e_moderatore", { p_persona: id }, f));
      return r && r.stato === 200 ? r.dati === true : null;
    },
    coda: async (id) => {
      const r = s && (await rpc(s, "coda_moderazione", { p_moderatore: id }, f));
      if (!(r && r.stato === 200 && Array.isArray(r.dati))) return null;
      // «sospeso» → «in_sospensione»: il codice del browser non deve contenere «peso» (controllo di scripts/test_worker.mjs).
      return r.dati.map(({ sospeso, ...resto }) => ({ ...resto, in_sospensione: sospeso === true }));
    },
    scheda: async ({ moderatore, segnalazione }) => {
      const r = s && (await rpc(s, "scheda_segnalazione", { p_moderatore: moderatore, p_segnalazione: segnalazione }, f));
      return r && r.stato === 200 && r.dati && typeof r.dati === "object" ? r.dati : null;
    },
    decidi: async ({ moderatore, segnalazione, azione, regola, testo }) => {
      const r = s && (await rpc(s, "decidi_segnalazione",
        { p_moderatore: moderatore, p_segnalazione: segnalazione, p_azione: azione, p_regola: regola, p_testo: testo }, f));
      if (!r) return null;
      if (r.stato >= 200 && r.stato < 300) return { ok: true, sanzione: typeof r.dati === "string" ? r.dati : null };
      // Segnalazione già decisa o inesistente, persona mancante: lo dice il database, si mostra «non riuscita».
      if (r.stato >= 400 && r.stato < 500) return { ok: false, motivo: "rifiutata" };
      return null;
    },
    ricorsi: async (id) => {
      const r = s && (await rpc(s, "ricorsi_da_decidere", { p_moderatore: id }, f));
      return r && r.stato === 200 && Array.isArray(r.dati) ? r.dati : null;
    },
    // Persona diversa da chi ha sanzionato, una sola volta: lo controlla decidi_ricorso() nel database.
    decidiRicorso: async ({ moderatore, ricorso, esito, testo }) => {
      const r = s && (await rpc(s, "decidi_ricorso", { p_moderatore: moderatore, p_ricorso: ricorso, p_esito: esito, p_testo: testo }, f));
      if (!r) return null;
      if (r.stato >= 200 && r.stato < 300) return { ok: true };
      if (r.stato >= 400 && r.stato < 500) return { ok: false, motivo: "rifiutata" };
      return null;
    },
  };
}

export async function pannelloApi(request, env, f = fetch, operazioni = null) {
  const percorso = new URL(request.url).pathname.slice(PERCORSO_PANNELLO.length);
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  const metodi = { "/coda": "GET", "/scheda": "POST", "/decidi": "POST", "/ricorsi": "GET", "/ricorso": "POST" };
  if (!Object.hasOwn(metodi, percorso)) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (request.method !== metodi[percorso]) return risposta(405, { ok: false, motivo: "metodo" }, { allow: metodi[percorso] });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });

  const chi = await chiEDavvero(request, env, f);
  if (chi.errore) return chi.errore;
  const op = operazioni || operazioniVere(env, f);
  try {
    const moderatore = await op.eModeratore(chi.id);
    if (moderatore === null || moderatore === undefined) return risposta(503, { ok: false, motivo: "riprova" });
    if (moderatore !== true) return risposta(403, { ok: false, motivo: "non_moderatore" });

    if (percorso === "/coda") {
      const coda = await op.coda(chi.id);
      return Array.isArray(coda) ? risposta(200, { ok: true, coda }) : risposta(503, { ok: false, motivo: "riprova" });
    }
    if (percorso === "/ricorsi") {
      const ricorsi = await op.ricorsi(chi.id);
      return Array.isArray(ricorsi) ? risposta(200, { ok: true, ricorsi }) : risposta(503, { ok: false, motivo: "riprova" });
    }
    const corpo = await leggiCorpo(request);
    if (corpo.errore) return corpo.errore;
    const id = corpo.dati.id;
    if (typeof id !== "string" || !UUID.test(id)) return risposta(400, { ok: false, motivo: "dati" });

    if (percorso === "/ricorso") {
      const { esito } = corpo.dati;
      const motivo = typeof corpo.dati.testo === "string" ? corpo.dati.testo.trim() : "";
      if (!ESITI_RICORSO.includes(esito) || !motivo || motivo.length > 2000) return risposta(400, { ok: false, motivo: "dati" });
      const fatto = await op.decidiRicorso({ moderatore: chi.id, ricorso: id, esito, testo: motivo });
      if (!fatto) return risposta(503, { ok: false, motivo: "riprova" });
      return risposta(200, fatto.ok ? { ok: true } : { ok: false, motivo: String(fatto.motivo || "rifiutata") });
    }
    if (percorso === "/scheda") {
      const scheda = await op.scheda({ moderatore: chi.id, segnalazione: id });
      return scheda ? risposta(200, { ok: true, scheda }) : risposta(503, { ok: false, motivo: "riprova" });
    }
    const { azione } = corpo.dati;
    const testo = typeof corpo.dati.testo === "string" ? corpo.dati.testo.trim() : "";
    const regola = typeof corpo.dati.regola === "string" ? corpo.dati.regola.trim() : "";
    if (!AZIONI.includes(azione) || !testo || testo.length > 2000 || regola.length > 100) return risposta(400, { ok: false, motivo: "dati" });
    if (!SENZA_REGOLA.has(azione) && !regola) return risposta(400, { ok: false, motivo: "dati" });
    const esito = await op.decidi({ moderatore: chi.id, segnalazione: id, azione, regola: regola || null, testo });
    if (!esito) return risposta(503, { ok: false, motivo: "riprova" });
    return risposta(200, esito.ok ? { ok: true, sanzione: esito.sanzione ?? null } : { ok: false, motivo: String(esito.motivo || "rifiutata") });
  } catch (e) {
    console.error("pannello: errore", e && e.name);
    return risposta(503, { ok: false, motivo: "riprova" });
  }
}

// Chi è lo dice Supabase leggendo il token (come in worker/segnala_api.js): { id } oppure { errore: Response }.
async function chiEDavvero(request, env, f) {
  const token = (request.headers.get("authorization") || "").match(/^Bearer ([A-Za-z0-9._-]{20,4096})$/);
  if (!token) return { errore: risposta(401, { ok: false, motivo: "accesso" }) };
  const s = server(env);
  if (!s) return { errore: risposta(503, { ok: false, motivo: "riprova" }) };
  try {
    const r = await entro(ATTESA_MS, f(`${s.base}/auth/v1/user`, { headers: { apikey: s.chiave, authorization: `Bearer ${token[1]}` } }));
    if (r.status === 401 || r.status === 403) return { errore: risposta(401, { ok: false, motivo: "accesso" }) };
    if (!r.ok) return { errore: risposta(503, { ok: false, motivo: "riprova" }) };
    const id = String(((await r.json()) || {}).id || "");
    return UUID.test(id) ? { id } : { errore: risposta(401, { ok: false, motivo: "accesso" }) };
  } catch (e) {
    console.error("pannello: accesso", e && e.name);
    return { errore: risposta(503, { ok: false, motivo: "riprova" }) };
  }
}

// Limite di frequenza: stesso binding gratuito delle altre richieste (LIMITE_PROVINCIA), chiave a parte. Qui serve
// soprattutto contro una coda di richieste senza token valido, che altrimenti costerebbe una chiamata a Supabase
// per ognuna, senza nessun limite (le altre rotte nuove di Fase 2 lo hanno già). L'IP serve solo a contare in
// memoria, mai salvato.
async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "pannello:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}

async function leggiCorpo(request) {
  const troppo = { errore: risposta(413, { ok: false, motivo: "troppo_grande" }) };
  const sbagliato = { errore: risposta(400, { ok: false, motivo: "dati" }) };
  const dichiarato = Number(request.headers.get("content-length"));
  if (Number.isFinite(dichiarato) && dichiarato > CORPO_MASSIMO) return troppo;
  if (!request.body) return sbagliato;
  const lettore = request.body.getReader();
  const pezzi = [];
  let totale = 0;
  for (;;) {
    const { done, value } = await lettore.read();
    if (done) break;
    totale += value.byteLength;
    if (totale > CORPO_MASSIMO) {
      try { await lettore.cancel(); } catch { /* niente da fare */ }
      return troppo;
    }
    pezzi.push(value);
  }
  const tutto = new Uint8Array(totale);
  let i = 0;
  for (const p of pezzi) { tutto.set(p, i); i += p.byteLength; }
  try {
    const dati = JSON.parse(new TextDecoder().decode(tutto));
    return dati && typeof dati === "object" && !Array.isArray(dati) ? { dati } : sbagliato;
  } catch {
    return sbagliato;
  }
}
