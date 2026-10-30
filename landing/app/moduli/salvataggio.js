// Salvataggio dell'iscrizione su Supabase, passo per passo (issue #2, specifica v1: «il profilo incompleto si salva
// passo per passo: chi esce riprende da dove era»). Si usano le API HTTP di Supabase con fetch (nessuna libreria).
//
// Funziona SOLO con l'accesso acceso (ACCESSO_APP = «si»): senza token non parte nessuna chiamata.
// Ogni chiamata porta il token dell'utente, quindi valgono le regole per riga del database: ognuno legge e scrive
// solo i propri dati (migrazione 20261029140000_profilo.sql) e nelle cartelle private solo i nomi fissi
// presentazione, risposta-1…3, foto-1…3 (migrazione 20261030230000_limiti_file_elimina.sql).
// La data del consenso a «cerco» non si manda: la scrive il server (requisito 3 del CISO).
//
// Questo modulo non tocca la pagina: riceve fetch e token dall'esterno, così si prova con node --test.

import { VERSIONE } from "./domande.js";

// Versione dell'informativa privacy dell'app accettata con il consenso a «cerco». Va aggiornata insieme al testo
// dell'informativa (T08): il database la salva accanto al consenso.
export const VERSIONE_INFORMATIVA_APP = "app-1.0";

// Nomi fissi dei file: gli unici che il database accetta.
export const FILE_VOCE = "presentazione";
export const fileRisposta = (i) => `risposta-${i + 1}`; // i = 0, 1, 2 (ordine di scelta delle domande)
export const fileFoto = (i) => `foto-${i + 1}`; // i = 0, 1, 2

// Paese per chi vive all'estero e non ha ancora indicato quale (codice ISO riservato «ZZ» = sconosciuto).
export const PAESE_ESTERO = "ZZ";

export function creaSalvataggio({ supabaseUrl, supabaseAnonKey, token, utenteId, fetch: f = globalThis.fetch }) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl || "") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl || "")) {
    throw new Error("Indirizzo Supabase non valido");
  }
  const base = supabaseUrl.replace(/\/+$/, "");

  async function chiama(percorso, { metodo = "GET", corpo, tipo = "application/json", extra = {} } = {}) {
    const t = await token();
    const id = utenteId();
    if (!t || !/^[0-9a-f-]{36}$/.test(id || "")) return { ok: false, motivo: "accesso" };
    let r;
    try {
      r = await f(base + percorso, {
        method: metodo,
        headers: { apikey: supabaseAnonKey, authorization: `Bearer ${t}`, ...(corpo !== undefined ? { "content-type": tipo } : {}), ...extra },
        body: corpo === undefined ? undefined : (tipo === "application/json" ? JSON.stringify(corpo) : corpo),
      });
    } catch {
      return { ok: false, motivo: "rete" };
    }
    if (r.status === 401) return { ok: false, motivo: "accesso" };
    if (!r.ok) return { ok: false, motivo: "salvataggio" };
    return { ok: true, risposta: r };
  }
  async function json(r) {
    try { return await r.risposta.json(); } catch { return null; }
  }
  const io = () => encodeURIComponent(utenteId() || "");

  // Inserisce o aggiorna la riga della persona (upsert sulla chiave primaria).
  async function upsert(tabella, chiave, campi) {
    const r = await chiama(`/rest/v1/${tabella}?on_conflict=${chiave}`, {
      metodo: "POST", corpo: { [chiave]: utenteId(), ...campi },
      extra: { prefer: "resolution=merge-duplicates,return=minimal" },
    });
    return r.ok ? { ok: true } : r;
  }

  return {
    // Passi 3–5 e punto in cui riprendere. campi: { data_nascita, regole_accettate_il, nome, citta, paese, mi_presento_come, mi_descrivo, domande_voce, passo }
    salvaProfilo(campi) {
      return upsert("profili", "id", pulisci(campi, ["data_nascita", "regole_accettate_il", "nome", "citta", "paese", "mi_presento_come", "mi_descrivo", "domande_voce", "passo"]));
    },

    // Passo 6. La data del consenso la mette il server; qui si manda solo la versione dell'informativa.
    salvaFiltri(campi) {
      const c = pulisci(campi, ["cerco", "eta_min", "eta_max", "raggio", "cosa_cerco", "figli", "fumo"]);
      if (c.cerco) c.consenso_versione_informativa = VERSIONE_INFORMATIVA_APP;
      return upsert("filtri", "utente_id", c);
    },

    // Passo 9. Una sola riga «della prossima settimana»: se c'è si aggiorna, altrimenti si crea
    // (il database decide da quale lunedì vale; la riga già in vigore non si tocca).
    async salvaQuestionario(risposte, importanza) {
      const filtro = `utente_id=eq.${io()}&in_vigore_dal=gt.${encodeURIComponent(new Date().toISOString())}`;
      const c = await chiama(`/rest/v1/questionario?select=in_vigore_dal&${filtro}`);
      if (!c.ok) return c;
      const righe = (await json(c)) || [];
      const corpo = { risposte, importanza, versione: VERSIONE };
      const r = righe.length
        ? await chiama(`/rest/v1/questionario?${filtro}`, { metodo: "PATCH", corpo, extra: { prefer: "return=minimal" } })
        : await chiama("/rest/v1/questionario", { metodo: "POST", corpo: { utente_id: utenteId(), ...corpo }, extra: { prefer: "return=minimal" } });
      return r.ok ? { ok: true } : r;
    },

    // Passi 7, 8 e 10: carica (o sostituisce) un file con uno dei nomi fissi.
    async caricaFile(cartella, nome, blob) {
      if (!["voci", "foto"].includes(cartella) || !/^(presentazione|risposta-[1-3]|foto-[1-3])$/.test(nome)) return { ok: false, motivo: "salvataggio" };
      const tipo = String(blob?.type || "").split(";")[0] || (cartella === "foto" ? "image/jpeg" : "audio/webm");
      const r = await chiama(`/storage/v1/object/${cartella}/${io()}/${nome}`, {
        metodo: "POST", corpo: blob, tipo, extra: { "x-upsert": "true", "cache-control": "no-store" },
      });
      return r.ok ? { ok: true } : r;
    },

    // Scarica un proprio file (per riascoltare o rivedere dopo il rientro). null = non c'è o non si legge.
    async scaricaFile(cartella, nome) {
      const r = await chiama(`/storage/v1/object/authenticated/${cartella}/${io()}/${nome}`);
      if (!r.ok) return null;
      try { return await r.risposta.blob(); } catch { return null; }
    },

    // Al rientro: tutto ciò che la persona ha già salvato, per ripartire dal passo lasciato.
    async leggi() {
      const [p, fi, q, v, ft] = await Promise.all([
        chiama(`/rest/v1/profili?select=*&id=eq.${io()}`),
        chiama(`/rest/v1/filtri?select=*&utente_id=eq.${io()}`),
        chiama(`/rest/v1/questionario?select=risposte,importanza,in_vigore_dal&utente_id=eq.${io()}&order=in_vigore_dal.desc&limit=1`),
        chiama("/storage/v1/object/list/voci", { metodo: "POST", corpo: { prefix: utenteId(), limit: 10, offset: 0 } }),
        chiama("/storage/v1/object/list/foto", { metodo: "POST", corpo: { prefix: utenteId(), limit: 10, offset: 0 } }),
      ]);
      const primo = [p, fi, q, v, ft].find((x) => !x.ok);
      if (primo) return primo;
      const nomi = async (r) => ((await json(r)) || []).map((x) => String(x?.name || "")).filter(Boolean);
      return {
        ok: true,
        profilo: ((await json(p)) || [])[0] || null,
        filtri: ((await json(fi)) || [])[0] || null,
        questionario: ((await json(q)) || [])[0] || null,
        voci: await nomi(v),
        foto: await nomi(ft),
      };
    },
  };
}

// Tiene solo i campi ammessi e toglie quelli non definiti (così un aggiornamento parziale non svuota il resto).
function pulisci(campi, ammessi) {
  const fuori = {};
  for (const k of ammessi) if (campi && campi[k] !== undefined) fuori[k] = campi[k];
  return fuori;
}

// Dallo stato dell'app ai campi del database (e ritorno). Funzioni pure, provate in test/salvataggio.test.mjs.
export function profiloDaStato(s) {
  const citta = s.estero ? null : (s.citta === "altra" ? s.cittaAltra.trim() : s.citta) || null;
  return {
    nome: s.nome.trim() || null,
    citta,
    paese: s.estero ? PAESE_ESTERO : "IT",
    mi_presento_come: s.miPresento || null,
    mi_descrivo: s.miPresento === "mi_descrivo" ? s.miDescrivo.trim().slice(0, 40) || null : null,
  };
}

export function filtriDaStato(s) {
  return {
    cerco: s.consensoCerco && s.cerco ? s.cerco : null,
    eta_min: s.etaMin, eta_max: s.etaMax, raggio: s.raggio || null,
    cosa_cerco: s.cosaCerco || null, figli: s.figli || null, fumo: s.fumo || null,
  };
}

// Applica allo stato dell'app ciò che è stato letto da Supabase. Restituisce il passo da cui ripartire.
export function statoDaSalvato(s, salvato, citta = []) {
  const p = salvato.profilo;
  if (p) {
    if (p.data_nascita) {
      s.dataNascita = p.data_nascita;
      [s.anno, s.mese, s.giorno] = p.data_nascita.split("-").map((x) => String(Number(x)));
    }
    s.regole = Boolean(p.regole_accettate_il);
    s.nome = p.nome || "";
    if (p.paese && p.paese !== "IT") { s.estero = true; s.citta = "estero"; }
    else if (p.citta) {
      if (citta.includes(p.citta)) s.citta = p.citta;
      else { s.citta = "altra"; s.cittaAltra = p.citta; }
    }
    s.miPresento = p.mi_presento_come || "";
    s.miDescrivo = p.mi_descrivo || "";
    if (Array.isArray(p.domande_voce)) s.domandeVoce = p.domande_voce.filter((i) => Number.isInteger(i)).slice(0, 3);
  }
  const fi = salvato.filtri;
  if (fi) {
    s.cerco = fi.cerco || ""; s.consensoCerco = Boolean(fi.cerco);
    if (fi.eta_min) s.etaMin = fi.eta_min;
    if (fi.eta_max) s.etaMax = fi.eta_max;
    s.raggio = fi.raggio || s.raggio; s.cosaCerco = fi.cosa_cerco || ""; s.figli = fi.figli || ""; s.fumo = fi.fumo || "";
  }
  const q = salvato.questionario;
  if (q) {
    s.questionario.risposte = { ...(q.risposte || {}) };
    s.questionario.importanza = { ...(q.importanza || {}) };
  }
  const passo = p && Number.isInteger(p.passo) ? Math.min(10, Math.max(2, p.passo)) : 2;
  return passo;
}
