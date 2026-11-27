// Pannello di chi decide (issue #7, spec v1.1 definitiva, «Cosa vede chi decide»; D51 A) · linea «sviluppatore-b», passo 13b.
//
//   GET  /app/api/pannello/coda                                 → { ok: true, coda: [...] }
//   POST /app/api/pannello/scheda { id }                        → { ok: true, scheda: {...} }   (l'apertura va nel registro)
//   POST /app/api/pannello/decidi { id, azione, regola?, testo } → { ok: true, sanzione } | { ok: false, motivo }
//   GET  /app/api/pannello/ricorsi                              → { ok: true, ricorsi: [...] }          (passo 13e)
//   POST /app/api/pannello/ricorso { id, esito, testo }         → { ok: true } | { ok: false, motivo } (passo 13e)
//   POST /app/api/pannello/email { id: sanzione }               → { ok: true, email: { a, livello, regola, fine_il } }
//        (passo 15b, D144 A: testo pronto e indirizzo per l'email che Giuseppe manda a mano; nessun invio da qui)
//        + mandata_il: data e ora di «Ho mandato l'email» se già segnata, altrimenti null (passo 15e, spec v1.3)
//   POST /app/api/pannello/mandata { id: sanzione }             → { ok: true, mandata_il }   («Ho mandato l'email», passo 15e)
//   GET  /app/api/pannello/uscite                               → { ok: true, uscite: [{ settimana, motivo, quante, testi }] }
//        (#381 passo 6b: motivi di «Lascia la stanza» per settimana, ultime 8; testi liberi senza nome)
//   GET  /app/api/pannello/contestazioni                        → { ok: true, contestazioni: [{ id, nome, domanda, testo,
//        quanti_no, inviata_il, tua }] }   (#6 v1.3 punto 2, passo 4b: «Contesta» un «No»; mai chi ha risposto)
//   POST /app/api/pannello/contestazione { id, esito }          → { ok: true, esito } | { ok: false, motivo }
//        (esito «accolta» o «respinta»; motivi: gia_decisa, non_trovata, propria, non_moderatore)
//   GET  /app/api/pannello/buche                                → { ok: true, buche: [{ id, nome, fase, testo, inviata_il,
//        orario, decidibile, tua }] }   (#6 v1.4: «Ero lì» / «Non riesco»; mai l'altra persona né la porta)
//   POST /app/api/pannello/buca { id, esito }                   → { ok: true, esito } | { ok: false, motivo }
//        (esito «accolta» o «respinta»; motivi in più: non_ancora = finestra del check-in non finita, in_attesa_d156;
//        crediti mossi dal database: decidi_contestazione_buca, D156 A)
//
// Chi decide lo dicono SOLO il token di Supabase e la tabella «moderatori» (in beta Giuseppe): un campo nel corpo
// non conta. Le regole stanno nel database (migrazioni 20261116094039 e 20261116144014): qui solo accesso, forma
// della richiesta e codici di risposta. Nei log solo nomi di errore e codici, mai token, nomi o racconti.
// Spento finché ACCESSO_APP non vale «si».

import { ID_REGOLE } from "../landing/app/moduli/regole_community.js";

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

// Codici fissi che il database usa per rifiutare una decisione e che il pannello sa spiegare.
const CODICI_DATABASE = Object.freeze(["seconda_volta_contatti"]);

// Chiamata a una funzione del database con la chiave del server: { stato, dati } oppure null se la rete non va.
async function rpc(s, nome, parametri, f) {
  try {
    const r = await entro(ATTESA_MS, f(`${s.base}/rest/v1/rpc/${nome}`, { method: "POST", headers: s.headers, body: JSON.stringify(parametri) }));
    if (!r.ok) {
      console.error("pannello: risposta", nome, r.status);
      // Solo i codici fissi scritti da noi nel database passano oltre (mai altro testo, mai nei log).
      const errore = await r.json().catch(() => null);
      return { stato: r.status, dati: null, codice: CODICI_DATABASE.includes(errore?.message) ? errore.message : null };
    }
    // Le funzioni «void» (decidi_ricorso) possono rispondere 204 senza corpo.
    return { stato: r.status, dati: r.status === 204 ? null : await r.json() };
  } catch (e) {
    console.error("pannello: errore", nome, e && e.name);
    return null;
  }
}

// Forma dell'email della sanzione: solo questi quattro campi. Forma diversa → guasto (undefined), mai nei log.
const LIVELLI = ["avviso", "sospensione_7", "sospensione_30", "esclusione"];
function soloEmail(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const { a, livello, regola, fine_il: fine = null } = d;
  if (typeof a !== "string" || a.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) return null;
  if (!LIVELLI.includes(livello) || typeof regola !== "string" || !regola || regola.length > 100) return null;
  if (fine !== null && (typeof fine !== "string" || fine.length > 40 || Number.isNaN(Date.parse(fine)))) return null;
  return { a, livello, regola, fine_il: fine };
}

// Data e ora salvate dal database (timestamptz in testo): forma diversa → null.
function soloData(d) {
  return typeof d === "string" && d.length <= 40 && !Number.isNaN(Date.parse(d)) ? d : null;
}

// #381: motivi di «Lascia la stanza». Passa solo questa forma (mai persona, stanza o nome); altro → null (guasto).
const MOTIVI_USCITA = ["tempo", "persone", "conosciuto", "app", "altro"];
function soloUscite(d) {
  if (!Array.isArray(d) || d.length > 200) return null;
  const fuori = [];
  for (const riga of d) {
    if (!riga || typeof riga !== "object") return null;
    const { settimana, motivo, quante, testi } = riga;
    if (typeof settimana !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(settimana)) return null;
    if (!MOTIVI_USCITA.includes(motivo) || !Number.isInteger(quante) || quante < 0) return null;
    if (!Array.isArray(testi) || !testi.every((t) => typeof t === "string" && t.length <= 300)) return null;
    fuori.push({ settimana, motivo, quante, testi: [...testi] });
  }
  return fuori;
}

// #6 v1.3: contestazioni dei «No». Passa solo questa forma (mai chi ha risposto né l'incontro); altro → null (guasto).
const DOMANDE_CONTESTABILI = ["presentato", "foto_sue", "come_in_chiamata"];
const ESITI_CONTESTAZIONE = Object.freeze({ accolta: true, respinta: false });
const RISPOSTE_CONTESTAZIONE = new Set(["accolta", "respinta", "gia_decisa", "non_trovata", "propria", "non_moderatore"]);
function soloContestazioni(d) {
  if (!Array.isArray(d) || d.length > 200) return null;
  const fuori = [];
  for (const riga of d) {
    if (!riga || typeof riga !== "object") return null;
    const { id, nome, domanda, testo, quanti_no, inviata_il, tua } = riga;
    if (typeof id !== "string" || !UUID.test(id) || !DOMANDE_CONTESTABILI.includes(domanda)) return null;
    if (!(nome === null || (typeof nome === "string" && nome.length <= 40))) return null;
    if (typeof testo !== "string" || testo.length > 500 || !Number.isInteger(quanti_no) || quanti_no < 0) return null;
    if (!soloData(inviata_il) || typeof tua !== "boolean") return null;
    fuori.push({ id, nome, domanda, testo, quanti_no, inviata_il, tua });
  }
  return fuori;
}

// #6 v1.4: «Ero lì» / «Non riesco». Passa solo questa forma (mai l'altra persona, la porta o saldi); altro → null.
const FASI_BUCA = ["prima_della_buca", "dopo_buca"];
const RISPOSTE_BUCA = new Set([...RISPOSTE_CONTESTAZIONE, "non_ancora", "in_attesa_d156"]);
function soloBuche(d) {
  if (!Array.isArray(d) || d.length > 200) return null;
  const fuori = [];
  for (const riga of d) {
    if (!riga || typeof riga !== "object") return null;
    const { id, nome, fase, testo, inviata_il, orario, decidibile, tua } = riga;
    if (typeof id !== "string" || !UUID.test(id) || !FASI_BUCA.includes(fase)) return null;
    if (!(nome === null || (typeof nome === "string" && nome.length <= 40))) return null;
    if (typeof testo !== "string" || testo.length > 500 || !soloData(inviata_il) || !soloData(orario)) return null;
    if (typeof decidibile !== "boolean" || typeof tua !== "boolean") return null;
    fuori.push({ id, nome, fase, testo, inviata_il, orario, decidibile, tua });
  }
  return fuori;
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
      // Seconda volta in 6 mesi per contatti prima della porta (passo 14a): serve la sospensione di 7 giorni.
      if (r.stato >= 400 && r.stato < 500) return { ok: false, motivo: r.codice || "rifiutata" };
      return null;
    },
    ricorsi: async (id) => {
      const r = s && (await rpc(s, "ricorsi_da_decidere", { p_moderatore: id }, f));
      return r && r.stato === 200 && Array.isArray(r.dati) ? r.dati : null;
    },
    // Persona diversa da chi ha sanzionato, una sola volta: lo controlla decidi_ricorso() nel database.
    // D144 A: indirizzo, livello, regola e fine di una sanzione decisa da chi chiede (lo controlla il database).
    emailSanzione: async ({ moderatore, sanzione }) => {
      const r = s && (await rpc(s, "email_sanzione", { p_moderatore: moderatore, p_sanzione: sanzione }, f));
      if (!r || r.stato !== 200) return undefined;
      if (r.dati === null) return null;
      return soloEmail(r.dati) || undefined;
    },
    // Spec #7 v1.3: «Ho mandato l'email». Il database salva la data una volta sola e solo per chi ha deciso.
    segnaMandata: async ({ moderatore, sanzione }) => {
      const r = s && (await rpc(s, "segna_email_mandata", { p_moderatore: moderatore, p_sanzione: sanzione }, f));
      if (!r || r.stato !== 200) return undefined;
      if (r.dati === null) return null;
      return soloData(r.dati) || undefined;
    },
    // Lettura per il pannello: se non riesce, null (il testo pronto si mostra lo stesso).
    emailMandata: async ({ moderatore, sanzione }) => {
      const r = s && (await rpc(s, "email_mandata", { p_moderatore: moderatore, p_sanzione: sanzione }, f));
      return r && r.stato === 200 ? soloData(r.dati) : null;
    },
    uscite: async (id) => {
      const r = s && (await rpc(s, "motivi_uscite", { p_moderatore: id }, f));
      return r && r.stato === 200 ? soloUscite(r.dati) : null;
    },
    decidiRicorso: async ({ moderatore, ricorso, esito, testo }) => {
      const r = s && (await rpc(s, "decidi_ricorso", { p_moderatore: moderatore, p_ricorso: ricorso, p_esito: esito, p_testo: testo }, f));
      if (!r) return null;
      if (r.stato >= 200 && r.stato < 300) return { ok: true };
      if (r.stato >= 400 && r.stato < 500) return { ok: false, motivo: "rifiutata" };
      return null;
    },
    contestazioni: async (id) => {
      const r = s && (await rpc(s, "contestazioni_no_da_decidere", { p_moderatore: id }, f));
      return r && r.stato === 200 ? soloContestazioni(r.dati) : null;
    },
    // Solo moderatori, mai la propria, una volta sola: lo controlla decidi_contestazione_no() nel database.
    decidiContestazione: async ({ moderatore, contestazione, accolta }) => {
      const r = s && (await rpc(s, "decidi_contestazione_no", { p_id: contestazione, p_decisore: moderatore, p_accolta: accolta }, f));
      return r && r.stato === 200 && RISPOSTE_CONTESTAZIONE.has(r.dati) ? r.dati : null;
    },
    buche: async (id) => {
      const r = s && (await rpc(s, "contestazioni_buca_da_decidere", { p_moderatore: id }, f));
      return r && r.stato === 200 ? soloBuche(r.dati) : null;
    },
    // Solo moderatori, mai la propria, dopo la finestra, una volta sola: lo controlla decidi_contestazione_buca().
    decidiBuca: async ({ moderatore, contestazione, accolta }) => {
      const r = s && (await rpc(s, "decidi_contestazione_buca", { p_id: contestazione, p_decisore: moderatore, p_accolta: accolta }, f));
      return r && r.stato === 200 && RISPOSTE_BUCA.has(r.dati) ? r.dati : null;
    },
  };
}

export async function pannelloApi(request, env, f = fetch, operazioni = null) {
  const percorso = new URL(request.url).pathname.slice(PERCORSO_PANNELLO.length);
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  const metodi = { "/coda": "GET", "/scheda": "POST", "/decidi": "POST", "/ricorsi": "GET", "/ricorso": "POST", "/email": "POST", "/mandata": "POST", "/uscite": "GET",
    "/contestazioni": "GET", "/contestazione": "POST",
    "/buche": "GET", "/buca": "POST" };
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
    if (percorso === "/uscite") {
      const uscite = op.uscite ? await op.uscite(chi.id) : null;
      return Array.isArray(uscite) ? risposta(200, { ok: true, uscite }) : risposta(503, { ok: false, motivo: "riprova" });
    }
    if (percorso === "/contestazioni") {
      const contestazioni = op.contestazioni ? await op.contestazioni(chi.id) : null;
      return Array.isArray(contestazioni) ? risposta(200, { ok: true, contestazioni }) : risposta(503, { ok: false, motivo: "riprova" });
    }
    if (percorso === "/buche") {
      const buche = op.buche ? await op.buche(chi.id) : null;
      return Array.isArray(buche) ? risposta(200, { ok: true, buche }) : risposta(503, { ok: false, motivo: "riprova" });
    }
    const corpo = await leggiCorpo(request);
    if (corpo.errore) return corpo.errore;
    const id = corpo.dati.id;
    if (typeof id !== "string" || !UUID.test(id)) return risposta(400, { ok: false, motivo: "dati" });

    if (percorso === "/contestazione") {
      const { esito } = corpo.dati;
      if (typeof esito !== "string" || !Object.hasOwn(ESITI_CONTESTAZIONE, esito)) return risposta(400, { ok: false, motivo: "dati" });
      const r = op.decidiContestazione
        ? await op.decidiContestazione({ moderatore: chi.id, contestazione: id, accolta: ESITI_CONTESTAZIONE[esito] }) : null;
      if (!r) return risposta(503, { ok: false, motivo: "riprova" });
      return risposta(200, r === esito ? { ok: true, esito } : { ok: false, motivo: r });
    }

    if (percorso === "/buca") {
      const { esito } = corpo.dati;
      if (typeof esito !== "string" || !Object.hasOwn(ESITI_CONTESTAZIONE, esito)) return risposta(400, { ok: false, motivo: "dati" });
      const r = op.decidiBuca ? await op.decidiBuca({ moderatore: chi.id, contestazione: id, accolta: ESITI_CONTESTAZIONE[esito] }) : null;
      if (!r) return risposta(503, { ok: false, motivo: "riprova" });
      return risposta(200, r === esito ? { ok: true, esito } : { ok: false, motivo: r });
    }

    if (percorso === "/ricorso") {
      const { esito } = corpo.dati;
      const motivo = typeof corpo.dati.testo === "string" ? corpo.dati.testo.trim() : "";
      if (!ESITI_RICORSO.includes(esito) || !motivo || motivo.length > 2000) return risposta(400, { ok: false, motivo: "dati" });
      const fatto = await op.decidiRicorso({ moderatore: chi.id, ricorso: id, esito, testo: motivo });
      if (!fatto) return risposta(503, { ok: false, motivo: "riprova" });
      return risposta(200, fatto.ok ? { ok: true } : { ok: false, motivo: String(fatto.motivo || "rifiutata") });
    }
    if (percorso === "/email") {
      const email = await op.emailSanzione({ moderatore: chi.id, sanzione: id });
      if (email === null) return risposta(404, { ok: false, motivo: "non_trovato" });
      if (!email) return risposta(503, { ok: false, motivo: "riprova" });
      const mandata = op.emailMandata ? await op.emailMandata({ moderatore: chi.id, sanzione: id }) : null;
      return risposta(200, { ok: true, email, mandata_il: mandata || null });
    }
    if (percorso === "/mandata") {
      const quando = await op.segnaMandata({ moderatore: chi.id, sanzione: id });
      if (quando === null) return risposta(404, { ok: false, motivo: "non_trovato" });
      return quando ? risposta(200, { ok: true, mandata_il: quando }) : risposta(503, { ok: false, motivo: "riprova" });
    }
    if (percorso === "/scheda") {
      const scheda = await op.scheda({ moderatore: chi.id, segnalazione: id });
      return scheda ? risposta(200, { ok: true, scheda }) : risposta(503, { ok: false, motivo: "riprova" });
    }
    const { azione } = corpo.dati;
    const testo = typeof corpo.dati.testo === "string" ? corpo.dati.testo.trim() : "";
    const regola = typeof corpo.dati.regola === "string" ? corpo.dati.regola.trim() : "";
    // Spec #7 v1.2: motivo libero di 100 caratteri al massimo; la regola è uno dei 10 id ufficiali (vuota solo per
    // «Archivia» e «Togli sospensione cautelare»).
    if (!AZIONI.includes(azione) || !testo || testo.length > 100) return risposta(400, { ok: false, motivo: "dati" });
    if (regola ? !ID_REGOLE.includes(regola) : !SENZA_REGOLA.has(azione)) return risposta(400, { ok: false, motivo: "dati" });
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
