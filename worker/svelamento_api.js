// Caparra dello svelamento (issue #65, spec v1 del CPO; D48 A, D12 A, D18 A). Passo 4b, linea «sviluppatore».
//
//   GET  /app/api/svelamento  → { ok, saldo, caparra, beta, testi, porte: [...] }               (svelamento_di)
//   POST /app/api/svelamento  { azione: "caparra", porta }
//                             → { ok: true, esito, stato } | { ok: false, motivo, testo?, mancano? }
//   POST /app/api/svelamento  { azione: "scelta", porta, scelta: "video" | "foto" }                (passo 3a)
//                             → { ok: true, esito: "salvata", stato } | { ok: false, motivo, testo? }
//   POST /app/api/svelamento  { azione: "pronto", porta }                                          (passo 5a)
//                             → { ok: true, esito: "pronto" | "entrambi_pronti", stato } | { ok: false, motivo, testo? }
//   POST /app/api/svelamento  { azione: "fasce", porta, fasce: [ISO, …] } (1-3 inizi da 30 minuti)  (passo 5a)
//                             → { ok: true, esito: "salvate" | "fissata", stato } | { ok: false, motivo, testo? }
//   La scelta e le fasce dell'altra persona non escono mai: solo «mia_scelta», «mie_fasce» e la fascia fissata.
//
// Chi blocca la caparra lo dice SOLO il token di Supabase: una persona scritta nel corpo non conta. Le regole
// (10 crediti, una caparra per persona e porta, mai sotto zero, chiusura per scadenza, blocco o sospensione con le
// caparre restituite a entrambi) le applica il database (migrazioni 20261116220000 e 20261116230000); qui solo
// accesso, forma della richiesta e testi. Una porta chiusa da un blocco o da una sospensione dà solo «Questa porta si
// è chiusa.», mai il motivo; una porta di altri risponde come una che non esiste. In beta i crediti sono di prova:
// nessun pagamento (Stripe in Fase 4). Nei log solo codici e nomi di errore. Spento finché ACCESSO_APP non vale «si».
import { SVELAMENTO, TESTI_SVELAMENTO } from "../api/svelamento.js";
import { risposta, chiEDavvero, leggiCorpo } from "./supporto_api.js";

export const PERCORSO_SVELAMENTO = "/app/api/svelamento";
const CORPO_MASSIMO = 1024;
const ATTESA_SUPABASE_MS = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_SUPABASE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const CAMPI_PORTA = ["porta", "con", "nome", "eta", "aperta_il", "scade_il", "mia_caparra", "sua_caparra"];
const SCELTE = ["video", "foto"];
const BLOCCATA = ["bloccata", "gia_bloccata"];
const FASCIA_MS = SVELAMENTO.fasciaMinuti * 60000;
const istante = (x) => (typeof x === "string" && x.length <= 40 && Number.isFinite(Date.parse(x)) ? new Date(Date.parse(x)).toISOString() : null);
const riprova = () => risposta(503, { ok: false, motivo: "riprova" });

function entro(ms, promessa) {
  let timer;
  return Promise.race([promessa, new Promise((_, no) => { timer = setTimeout(() => no(new Error("tempo scaduto")), ms); })])
    .finally(() => clearTimeout(timer));
}

function server(env) {
  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const chiave = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return URL_SUPABASE.test(base) && chiave ? { base, chiave } : null;
}

async function rpc(s, nome, argomenti, f) {
  try {
    const r = await entro(ATTESA_SUPABASE_MS, f(`${s.base}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: { apikey: s.chiave, authorization: `Bearer ${s.chiave}`, "content-type": "application/json" },
      body: JSON.stringify(argomenti),
    }));
    if (!r.ok) {
      console.error(`svelamento: ${nome} risposta ${r.status}`);
      return undefined;
    }
    return await r.json();
  } catch (e) {
    console.error(`svelamento: ${nome} errore`, e && e.name);
    return undefined;
  }
}

// Solo i campi previsti escono verso il telefono, anche se un giorno la funzione del database ne restituisse altri.
function porta(p) {
  const pulita = {};
  for (const campo of CAMPI_PORTA) pulita[campo] = p[campo] ?? null;
  pulita.mia_scelta = SCELTE.includes(p.mia_scelta) ? p.mia_scelta : "video";
  // Passo 5a: solo le proprie fasce (al massimo 3 orari validi) e la fascia fissata; «pronto» vale solo se è vero.
  pulita.mie_fasce = Array.isArray(p.mie_fasce) ? p.mie_fasce.map(istante).filter(Boolean).slice(0, SVELAMENTO.maxFasce) : [];
  pulita.fascia_fissata = istante(p.fascia_fissata);
  pulita.mio_pronto = p.mio_pronto === true;
  pulita.suo_pronto = p.suo_pronto === true;
  pulita.pronto_scade_il = pulita.mio_pronto ? istante(p.pronto_scade_il) : null;
  pulita.pronta = pulita.suo_pronto ? TESTI_SVELAMENTO.prontaAltro.replace("<nome>", String(p.nome || "")) : null;
  pulita.aspetta = p.mia_caparra === true && p.sua_caparra !== true
    ? TESTI_SVELAMENTO.aspettaCaparra.replace("<nome>", String(p.nome || ""))
    : null;
  return pulita;
}

async function stato(s, id, f) {
  const d = await rpc(s, "svelamento_di", { p_utente: id }, f);
  if (!d || typeof d !== "object" || !Number.isFinite(d.saldo) || !Array.isArray(d.porte)) return null;
  return {
    saldo: d.saldo,
    caparra: SVELAMENTO.caparra,
    beta: true,
    testi: {
      blocca: TESTI_SVELAMENTO.blocca, spiegazione: TESTI_SVELAMENTO.spiegazioneCaparra, beta: TESTI_SVELAMENTO.beta,
      scelta: { video: TESTI_SVELAMENTO.sceltaVideo, foto: TESTI_SVELAMENTO.sceltaFoto },
      quando: { ora: TESTI_SVELAMENTO.prontoOra, orario: TESTI_SVELAMENTO.scegliOrario, maxFasce: SVELAMENTO.maxFasce, fasciaMinuti: SVELAMENTO.fasciaMinuti },
    },
    porte: d.porte.filter((p) => p && typeof p === "object").map(porta),
  };
}

export async function svelamentoApi(request, env, f = fetch) {
  if (new URL(request.url).pathname !== PERCORSO_SVELAMENTO) return risposta(404, { ok: false, motivo: "non_trovato" });
  if (String(env.ACCESSO_APP || "").trim() !== "si") return risposta(404, { ok: false, motivo: "spento" });
  if (request.method !== "GET" && request.method !== "POST") return risposta(405, { ok: false, motivo: "metodo" }, { allow: "GET, POST" });
  if (await troppeRichieste(request, env)) return risposta(429, { ok: false, motivo: "troppe" });
  const s = server(env);
  if (!s) return riprova();
  const chi = await chiEDavvero(request, env, f);
  if (chi.errore) return chi.errore;

  if (request.method === "GET") {
    const st = await stato(s, chi.id, f);
    return st ? risposta(200, { ok: true, ...st }) : riprova();
  }

  const corpo = await leggiCorpo(request, CORPO_MASSIMO);
  if (corpo.errore) return corpo.errore;
  const { azione, porta: idPorta, scelta, fasce } = corpo.dati;
  if (!UUID.test(String(idPorta || ""))) return risposta(400, { ok: false, motivo: "dati" });
  if (azione === "scelta") return sceltaSvelamento(s, chi.id, idPorta, scelta, f);
  if (azione === "pronto") return quando(s, chi.id, idPorta, "pronto_svelamento", {}, ["pronto", "entrambi_pronti"], f);
  if (azione === "fasce") {
    const pulite = formaFasce(fasce);
    if (!pulite) return risposta(400, { ok: false, motivo: "dati" });
    return quando(s, chi.id, idPorta, "fasce_svelamento", { p_fasce: pulite }, ["salvate", "fissata"], f);
  }
  if (azione !== "caparra") return risposta(400, { ok: false, motivo: "dati" });

  const esito = await rpc(s, "caparra_svelamento", { p_porta: idPorta, p_persona: chi.id }, f);
  if (BLOCCATA.includes(esito)) return risposta(200, { ok: true, esito, stato: await stato(s, chi.id, f) });
  if (esito === "non_nella_porta") return risposta(404, { ok: false, motivo: "non_trovata" });
  if (esito === "porta_scaduta") return risposta(200, { ok: false, motivo: esito, testo: TESTI_SVELAMENTO.scaduta });
  if (esito === "porta_chiusa") return risposta(200, { ok: false, motivo: esito, testo: TESTI_SVELAMENTO.portaChiusa });
  if (esito === "crediti_insufficienti") {
    const st = await stato(s, chi.id, f);
    const mancano = st ? Math.max(1, SVELAMENTO.caparra - st.saldo) : SVELAMENTO.caparra;
    return risposta(200, {
      ok: false, motivo: esito, mancano,
      testo: `${mancano === 1 ? "Ti manca" : "Ti mancano"} ${mancano} ${mancano === 1 ? "credito" : "crediti"}`,
      ricarica: TESTI_SVELAMENTO.ricarica, beta: TESTI_SVELAMENTO.beta,
    });
  }
  return riprova();
}

// Passo 3a: «Videochiamata di 10 secondi» o «Preferisco le foto», solo per la persona del token. Le regole (porta
// aperta, non ancora iniziata, chiusura per scadenza, blocco o sospensione) le applica scelta_svelamento() nel database.
async function sceltaSvelamento(s, id, idPorta, scelta, f) {
  if (!SCELTE.includes(scelta)) return risposta(400, { ok: false, motivo: "dati" });
  const esito = await rpc(s, "scelta_svelamento", { p_porta: idPorta, p_persona: id, p_scelta: scelta }, f);
  if (esito === "salvata") return risposta(200, { ok: true, esito, stato: await stato(s, id, f) });
  if (esito === "gia_iniziato") return risposta(200, { ok: false, motivo: esito });
  if (esito === "non_nella_porta") return risposta(404, { ok: false, motivo: "non_trovata" });
  if (esito === "porta_scaduta") return risposta(200, { ok: false, motivo: esito, testo: TESTI_SVELAMENTO.scaduta });
  if (esito === "porta_chiusa") return risposta(200, { ok: false, motivo: esito, testo: TESTI_SVELAMENTO.portaChiusa });
  return riprova();
}

// Passo 5a: da 1 a 3 orari leggibili, allineati a :00 o :30; ordinati e senza doppioni. Che siano futuri e dentro le
// 48 ore lo controlla il database (fasce_svelamento), che conosce l'apertura della porta.
function formaFasce(fasce) {
  if (!Array.isArray(fasce) || fasce.length < 1 || fasce.length > SVELAMENTO.maxFasce) return null;
  const inizi = [];
  for (const f of fasce) {
    const x = istante(f);
    if (!x || Date.parse(x) % FASCIA_MS !== 0) return null;
    if (!inizi.includes(x)) inizi.push(x);
  }
  return inizi.sort();
}

// Passo 5a: «Sono pronto ora» e «Scegli un orario», solo per la persona del token. Le regole (caparre, porta aperta,
// non iniziata, 5 minuti, prima fascia comune) le applicano pronto_svelamento() e fasce_svelamento() nel database.
async function quando(s, id, idPorta, nome, extra, buoni, f) {
  const esito = await rpc(s, nome, { p_porta: idPorta, p_persona: id, ...extra }, f);
  if (buoni.includes(esito)) return risposta(200, { ok: true, esito, stato: await stato(s, id, f) });
  if (["gia_iniziato", "manca_caparra", "fasce_non_valide"].includes(esito)) return risposta(200, { ok: false, motivo: esito });
  if (esito === "non_nella_porta") return risposta(404, { ok: false, motivo: "non_trovata" });
  if (esito === "porta_scaduta") return risposta(200, { ok: false, motivo: esito, testo: TESTI_SVELAMENTO.scaduta });
  if (esito === "porta_chiusa") return risposta(200, { ok: false, motivo: esito, testo: TESTI_SVELAMENTO.portaChiusa });
  return riprova();
}

// Limite di frequenza: stesso binding gratuito delle altre richieste (LIMITE_PROVINCIA), chiave a parte. L'IP serve
// solo a contare in memoria, mai salvato.
async function troppeRichieste(request, env) {
  if (!env.LIMITE_PROVINCIA) return false;
  try {
    const { success } = await env.LIMITE_PROVINCIA.limit({ key: "svelamento:" + (request.headers.get("cf-connecting-ip") || "sconosciuto") });
    return !success;
  } catch {
    return false;
  }
}
