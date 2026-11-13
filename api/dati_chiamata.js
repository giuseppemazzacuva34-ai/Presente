// Chiamate solo voce (issue #4, passo 3b-2b-2a): le letture dal database che servono per aprire una chiamata.
// Solo il server, con la chiave service_role (secret del Worker, mai nel telefono). Si leggono SOLO le colonne
// che servono alle regole di api/chiamate.js: niente nomi, foto, questionario o diario.
// Se una lettura non va, la risposta è «riprova»: le regole non si applicano mai su dati a metà.
// Nei log solo il codice di risposta, mai indirizzi con id o dati.

const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const ATTESA_MS = 1500;
const GIORNO = 24 * 60 * 60 * 1000;

function server(env) {
  const base = String(env?.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const chiave = String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return URL_SUPABASE.test(base) && chiave ? { base, headers: { apikey: chiave, authorization: `Bearer ${chiave}` } } : null;
}

// Una lettura: la lista di righe, oppure null per qualunque problema (errore, tempo scaduto, risposta non lista).
async function leggi(s, percorso, f) {
  let timer;
  try {
    const r = await Promise.race([
      f(`${s.base}/rest/v1/${percorso}`, { headers: s.headers }),
      new Promise((_, no) => { timer = setTimeout(() => no(new Error("tempo scaduto")), ATTESA_MS); }),
    ]);
    if (!r.ok) {
      console.error("dati chiamata: risposta", r.status);
      return null;
    }
    const righe = await r.json();
    return Array.isArray(righe) ? righe : null;
  } catch (e) {
    console.error("dati chiamata: errore", e && e.name);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const data = (x) => { const d = new Date(x); return Number.isFinite(d.getTime()) ? d : null; };

// Stanza aperta adesso di una persona: { id, apre, chiude } oppure null.
export async function stanzaDi(env, chi, adesso, f = fetch) {
  const s = server(env);
  if (!s || !UUID.test(chi || "")) return null;
  const ora = encodeURIComponent(adesso.toISOString());
  const righe = await leggi(s, `membri_stanza?utente_id=eq.${chi}&select=stanze!inner(id,apre_il,chiude_il)`
    + `&stanze.apre_il=lte.${ora}&stanze.chiude_il=gt.${ora}&limit=1`, f);
  const st = righe && righe[0] && righe[0].stanze;
  if (!st || !UUID.test(st.id || "")) return null;
  const apre = data(st.apre_il), chiude = data(st.chiude_il);
  return apre && chiude ? { id: st.id, apre, chiude } : null;
}

// Tutto quello che serve a puoChiamare(), letto in parallelo.
export async function datiPerChiamare(env, { stanza, chi, verso }, f = fetch) {
  const s = server(env);
  if (!s || !UUID.test(chi || "") || !UUID.test(verso || "") || !UUID.test(stanza?.id || "")) return { ok: false, motivo: "riprova" };
  // Dal giorno prima dell'apertura: copre la settimana e il conto «5 al giorno» di oggi.
  const da = encodeURIComponent(new Date(stanza.apre.getTime() - GIORNO).toISOString());
  const coppia = `${chi},${verso}`;
  const [membri, chiamate, blocchi, profili, permessi] = await Promise.all([
    leggi(s, `membri_stanza?stanza_id=eq.${stanza.id}&select=utente_id`, f),
    leggi(s, `chiamate?select=chi,con,inizio,durata&inizio=gte.${da}&or=(chi.in.(${coppia}),con.in.(${coppia}))`, f),
    leggi(s, `blocchi?select=chi,bloccato&or=(and(chi.eq.${chi},bloccato.eq.${verso}),and(chi.eq.${verso},bloccato.eq.${chi}))`, f),
    leggi(s, `profili?id=eq.${verso}&select=fascia_da,fascia_a,solo_con_permesso&limit=1`, f),
    leggi(s, `permessi_chiamata?utente_id=eq.${verso}&permesso_a=eq.${chi}&select=permesso_a`, f),
  ]);
  if (!membri || !chiamate || !blocchi || !profili || !permessi) return { ok: false, motivo: "riprova" };
  const p = profili[0] || {};
  const fascia = ORA.test(p.fascia_da || "") && ORA.test(p.fascia_a || "") ? { da: p.fascia_da, a: p.fascia_a } : null;
  return {
    ok: true,
    membri: membri.map((m) => m.utente_id),
    chiamate: chiamate.map(({ chi, con, inizio, durata }) => ({ chi, con, inizio, durata })),
    blocchi: blocchi.map(({ chi, bloccato }) => ({ chi, bloccato })),
    fascia,
    soloConPermesso: p.solo_con_permesso === true,
    permessi: new Set(permessi.map((x) => x.permesso_a)),
  };
}

// --- Passo 3b-2b-2c-2b-2: carte della conversazione (spec v1.2) ------------------------------------------------------
// Le carte (tabella di configurazione) e le carte già viste dalla coppia: solo server. La coppia è sempre a < b,
// come nel vincolo del database. Nessun testo di conversazione, nessun audio: solo id di carta.
const coppiaValida = ({ stanza, a, b }) => UUID.test(stanza || "") && UUID.test(a || "") && UUID.test(b || "") && a < b;
const filtroCoppia = ({ stanza, a, b }) => `stanza_id=eq.${stanza}&a=eq.${a}&b=eq.${b}`;

// Carte attive della versione in uso, [{ id, testo }] in ordine di id; null se il database non risponde.
export async function carteAttiveDb(env, f = fetch) {
  const s = server(env);
  if (!s) return null;
  const righe = await leggi(s, "carte?select=id,versione,testo,attiva&versione=eq.v1&attiva=eq.true&order=id", f);
  if (!righe) return null;
  return righe
    .filter((c) => c.versione === "v1" && c.attiva === true && Number.isInteger(c.id) && c.id > 0 && typeof c.testo === "string")
    .map(({ id, testo }) => ({ id, testo }))
    .sort((x, y) => x.id - y.id);
}

// Id delle carte già viste dalla coppia nella stanza; null se il database non risponde o i dati sono sbagliati.
export async function carteVisteDb(env, coppia, f = fetch) {
  const s = server(env);
  if (!s || !coppiaValida(coppia || {})) return null;
  const righe = await leggi(s, `carte_viste?select=carta_id&${filtroCoppia(coppia)}`, f);
  return righe ? righe.map((r) => r.carta_id).filter((id) => Number.isInteger(id)) : null;
}

// Una scrittura: true se Supabase risponde 2xx entro il tempo, false per qualunque problema.
async function scrivi(s, metodo, percorso, corpo, f) {
  let timer;
  try {
    const r = await Promise.race([
      f(`${s.base}/rest/v1/${percorso}`, {
        method: metodo,
        headers: { ...s.headers, "content-type": "application/json", prefer: "return=minimal,resolution=ignore-duplicates" },
        ...(corpo ? { body: JSON.stringify(corpo) } : {}),
      }),
      new Promise((_, no) => { timer = setTimeout(() => no(new Error("tempo scaduto")), ATTESA_MS); }),
    ]);
    if (!r.ok) console.error("dati chiamata: scrittura", r.status);
    return r.ok;
  } catch (e) {
    console.error("dati chiamata: errore", e && e.name);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Segna la carta vista dalla coppia. ricomincia: il mazzo è finito, prima si azzerano le viste di QUESTA coppia
// (cancellazione sempre filtrata per stanza e coppia, mai senza filtro).
export async function segnaCartaVista(env, { stanza, a, b, carta, ricomincia }, f = fetch) {
  const s = server(env);
  const coppia = { stanza, a, b };
  if (!s || !coppiaValida(coppia) || !Number.isInteger(carta) || carta <= 0) return false;
  if (ricomincia === true && !(await scrivi(s, "DELETE", `carte_viste?${filtroCoppia(coppia)}`, null, f))) return false;
  return scrivi(s, "POST", "carte_viste", { stanza_id: stanza, a, b, carta_id: carta }, f);
}

// --- Passo 3c-4b-1: dopo la chiamata (spec v1.3 § 3) -----------------------------------------------------------------
// Funzioni del server (migrazione 20261113220000_richiameresti.sql), solo con la chiave del server. Risultato:
// il dato, null se non c'è, undefined se il database non risponde (l'app riprova).
async function funzione(s, nome, corpo, f) {
  let timer;
  try {
    const r = await Promise.race([
      f(`${s.base}/rest/v1/rpc/${nome}`, { method: "POST", headers: { ...s.headers, "content-type": "application/json" }, body: JSON.stringify(corpo) }),
      new Promise((_, no) => { timer = setTimeout(() => no(new Error("tempo scaduto")), ATTESA_MS); }),
    ]);
    if (!r.ok) {
      console.error("dati chiamata: funzione", r.status);
      return undefined;
    }
    return await r.json();
  } catch (e) {
    console.error("dati chiamata: errore", e && e.name);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// La chiamata che conta ancora senza «La richiameresti?» (al massimo una), già segnata come proposta dal server.
export async function riproponiDb(env, per, f = fetch) {
  const s = server(env);
  if (!s || !UUID.test(per || "")) return undefined;
  const righe = await funzione(s, "richiameresti_da_riproporre", { p_utente: per }, f);
  if (!Array.isArray(righe)) return undefined;
  const r = righe[0];
  return r ? { chi: r.chi, con: r.con, inizio: r.inizio } : null;
}

// L'ultima chiamata finita (con durata ed esito) della persona: solo le colonne del registro che servono.
export async function ultimaChiamataDb(env, per, f = fetch) {
  const s = server(env);
  if (!s || !UUID.test(per || "")) return undefined;
  const righe = await leggi(s, `chiamate?select=chi,con,inizio,durata,esito&or=(chi.eq.${per},con.eq.${per})`
    + "&durata=not.is.null&order=inizio.desc&limit=1", f);
  if (!righe) return undefined;
  const r = righe[0];
  return r ? { chi: r.chi, con: r.con, inizio: r.inizio, durata: r.durata, esito: r.esito } : null;
}

// Salva sì / no / salta: true salvata, false niente da salvare (risposta già data, chiamata che non conta, stanza chiusa).
export async function salvaRichiamerestiDb(env, { per, chi, inizio, risposta }, f = fetch) {
  const s = server(env);
  if (!s || !UUID.test(per || "") || !UUID.test(chi || "") || !["si", "no", "salta"].includes(risposta) || typeof inizio !== "string") return undefined;
  const r = await funzione(s, "salva_richiameresti", { p_utente: per, p_chi: chi, p_inizio: inizio, p_risposta: risposta }, f);
  return typeof r === "boolean" ? r : undefined;
}
