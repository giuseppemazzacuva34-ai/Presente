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
