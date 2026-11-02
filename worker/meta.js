// Webhook di Meta per i commenti «BUIO» (decisione di Giuseppe del 29/10: risposta entro 10 minuti).
// Indirizzo: https://presenteincontri.app/meta/webhook (passi su Meta in docs/meta-webhook.md).
//
// Cosa fa: quando qualcuno scrive BUIO sotto un post o un'inserzione di Instagram o della Pagina Facebook,
// Meta chiama questo indirizzo; il Worker manda il link della lista d'attesa in privato (private reply)
// e risponde in pubblico al commento. Se il messaggio privato non parte, la risposta pubblica contiene il link.
//
// Cosa NON fa: non salva nulla (niente database, niente log con testi, nomi o id delle persone).
// Gli id del commento servono solo per rispondere, nella memoria della richiesta, e poi spariscono.
//
// Sicurezza: ogni chiamata POST deve avere la firma X-Hub-Signature-256 (HMAC-SHA256 del corpo con il segreto
// dell'app Meta); senza firma giusta non si fa nulla. I segreti (META_APP_SECRET, META_VERIFY_TOKEN,
// META_PAGE_TOKEN) stanno solo nei Secret del Worker su Cloudflare, mai nel repository.
// Interruttore: RISPOSTE_META in wrangler.jsonc. Con "no" il webhook si può verificare ma non risponde a nessuno.
//
// IMPORT DIRETTO DEI CONTATTI DEL MODULO META, SENZA AI (D85 = A, compito T43; docs/meta-contatti.md).
// Quando qualcuno compila il modulo dentro Facebook o Instagram, Meta chiama questo stesso indirizzo (campo «leadgen»
// della Pagina) con il solo numero del contatto. Il Worker chiede a Meta email e risposte di quel contatto e lo salva in D1
// con le stesse regole dell'import dal CSV (worker/contatti_meta.js): solo email nuove, solo maggiorenni, niente contatti
// di prova. Nessun servizio in mezzo: Meta → Cloudflare → D1. Nei log e in /conteggio solo numeri.
// Interruttore: IMPORT_META in wrangler.jsonc ("no" = Meta può avvisare ma non si legge e non si salva nulla).

import { contatto, trovaColonne } from "./contatti_meta.js";
import { contaEsito } from "./iscrizione.js";

export const PERCORSO_META = "/meta/webhook";

const TESTI_PREDEFINITI = {
  privato: "Ciao! Ecco il tuo posto nel buio: entra nella lista d'attesa di Presente qui 👉 {link}",
  pubblico: "Ti abbiamo scritto in privato 🖤",
  pubblicoConLink: "Eccoti il link per la lista d'attesa: {link} 🖤",
};
const LINK = { instagram: "https://presenteincontri.app/da/instagram", facebook: "https://presenteincontri.app/da/facebook" };
const MAX_COMMENTI_PER_CHIAMATA = 25;

function testo(env, chiave, link) {
  const nomi = { privato: "META_TESTO_PRIVATO", pubblico: "META_TESTO_PUBBLICO", pubblicoConLink: "META_TESTO_PUBBLICO_LINK" };
  const modello = (env[nomi[chiave]] || TESTI_PREDEFINITI[chiave]).slice(0, 900);
  return modello.replace("{link}", link);
}

// «BUIO» come parola, in qualunque punto, maiuscole o minuscole, con o senza punteggiatura ed emoji.
export function contieneBuio(testoCommento) {
  if (typeof testoCommento !== "string") return false;
  const parole = testoCommento.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().split(/[^A-Z0-9]+/);
  return parole.includes("BUIO");
}

function testoSemplice(corpo, stato) {
  return new Response(corpo, { status: stato, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

function uguali(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function firmaValida(corpoGrezzo, intestazione, segreto) {
  if (!intestazione || !segreto || !intestazione.startsWith("sha256=")) return false;
  const chiave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", chiave, corpoGrezzo));
  const esadecimale = Array.from(firma, (b) => b.toString(16).padStart(2, "0")).join("");
  return uguali(esadecimale, intestazione.slice(7).toLowerCase());
}

// Verifica dell'indirizzo da parte di Meta (GET con hub.mode, hub.verify_token, hub.challenge).
function verificaIscrizione(url, env) {
  const p = url.searchParams;
  const sfida = p.get("hub.challenge") || "";
  if (!env.META_VERIFY_TOKEN) return testoSemplice("non configurato", 503);
  if (p.get("hub.mode") !== "subscribe" || !uguali(p.get("hub.verify_token") || "", env.META_VERIFY_TOKEN)) {
    return testoSemplice("vietato", 403);
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sfida)) return testoSemplice("sfida non valida", 400);
  return testoSemplice(sfida, 200);
}

// Estrae dal corpo di Meta solo i commenti nuovi con BUIO, scritti da altri (mai da noi: niente risposte a catena).
export function commentiBuio(dati, env) {
  const nostri = new Set([env.META_PAGE_ID, env.META_IG_ID].filter(Boolean).map(String));
  const trovati = [];
  if (!dati || !Array.isArray(dati.entry)) return trovati;
  for (const voce of dati.entry) {
    for (const cambio of Array.isArray(voce.changes) ? voce.changes : []) {
      const v = cambio && cambio.value;
      if (!v) continue;
      if (dati.object === "instagram" && cambio.field === "comments") {
        const autore = v.from && String(v.from.id);
        if (v.id && contieneBuio(v.text) && !nostri.has(autore)) trovati.push({ rete: "instagram", id: String(v.id) });
      } else if (dati.object === "page" && cambio.field === "feed" && v.item === "comment" && v.verb === "add") {
        const autore = v.from && String(v.from.id);
        if (v.comment_id && contieneBuio(v.message) && !nostri.has(autore)) trovati.push({ rete: "facebook", id: String(v.comment_id) });
      }
    }
  }
  return trovati.slice(0, MAX_COMMENTI_PER_CHIAMATA);
}

// Estrae dal corpo di Meta i numeri dei contatti nuovi del modulo della NOSTRA Pagina (campo «leadgen»).
export function contattiModulo(dati, env) {
  const trovati = [];
  if (!dati || dati.object !== "page" || !Array.isArray(dati.entry)) return trovati;
  for (const voce of dati.entry) {
    for (const cambio of Array.isArray(voce.changes) ? voce.changes : []) {
      const v = cambio && cambio.value;
      if (!v || cambio.field !== "leadgen") continue;
      const id = String(v.leadgen_id || "");
      if (!/^[0-9]{1,30}$/.test(id)) continue;
      if (env.META_PAGE_ID && String(v.page_id || voce.id) !== String(env.META_PAGE_ID)) continue;
      if (!trovati.includes(id)) trovati.push(id);
    }
  }
  return trovati.slice(0, MAX_COMMENTI_PER_CHIAMATA);
}

// Il contatto come lo dà Meta → { nome campo: primo valore } più created_time; i campi che non servono non si guardano.
export function righeDaContatto(dati) {
  const riga = { created_time: String(dati && dati.created_time || "") };
  for (const campo of Array.isArray(dati && dati.field_data) ? dati.field_data : []) {
    if (!campo || typeof campo.name !== "string") continue;
    const valore = Array.isArray(campo.values) ? campo.values[0] : "";
    riga[campo.name.slice(0, 120)] = String(valore ?? "").slice(0, 300);
  }
  return riga;
}

const INSERISCI_META = "INSERT INTO iscrizioni (email, zona, invito, consenso_il, versione_informativa, sorgente, presento) VALUES (?, ?, NULL, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING";

// Legge un contatto da Meta e lo salva. Restituisce l'esito: meta_nuova, meta_gia_in_lista, meta_scartata, meta_errore.
export async function importaContatto(id, env, f = fetch) {
  const versione = env.META_GRAPH_VERSIONE || "v24.0";
  let dati;
  try {
    const risposta = await f(`https://graph.facebook.com/${versione}/${encodeURIComponent(id)}?fields=created_time,field_data`, {
      headers: { authorization: `Bearer ${env.META_PAGE_TOKEN}` },
    });
    if (!risposta.ok) return "meta_errore";
    dati = await risposta.json();
  } catch {
    return "meta_errore";
  }
  const riga = righeDaContatto(dati);
  const colonne = trovaColonne(Object.keys(riga));
  if (!colonne.email) return "meta_scartata";
  const esito = contatto(riga, colonne, { maggiorenneNelModulo: env.META_MAGGIORENNE_NEL_MODULO === "si" });
  if (esito.scarto) return "meta_scartata";
  const i = esito.iscrizione;
  try {
    const r = await env.DB.prepare(INSERISCI_META)
      .bind(i.email, i.zona, i.consenso_il, i.versione_informativa, i.sorgente, i.presento || null).run();
    return r && r.meta && r.meta.changes > 0 ? "meta_nuova" : "meta_gia_in_lista";
  } catch (errore) {
    console.error("meta: contatto non salvato", errore && errore.name);
    return "meta_errore";
  }
}

async function grafo(f, env, percorso, corpo) {
  const versione = env.META_GRAPH_VERSIONE || "v24.0";
  const risposta = await f(`https://graph.facebook.com/${versione}/${percorso}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.META_PAGE_TOKEN}` },
    body: JSON.stringify(corpo),
  });
  return risposta.ok;
}

export async function rispondi(commento, env, f = fetch) {
  const link = LINK[commento.rete];
  const id = encodeURIComponent(commento.id);
  let privato = false;
  try {
    privato = await grafo(f, env, `${encodeURIComponent(env.META_PAGE_ID)}/messages`, {
      recipient: { comment_id: commento.id },
      message: { text: testo(env, "privato", link) },
    });
  } catch {
    privato = false;
  }
  const messaggio = testo(env, privato ? "pubblico" : "pubblicoConLink", link);
  const percorsoPubblico = commento.rete === "instagram" ? `${id}/replies` : `${id}/comments`;
  let pubblico = false;
  try {
    pubblico = await grafo(f, env, percorsoPubblico, { message: messaggio });
  } catch {
    pubblico = false;
  }
  return { privato, pubblico };
}

async function gestisciNotifica(request, env, ctx, f) {
  if (!env.META_APP_SECRET) return testoSemplice("non configurato", 503);
  const corpo = await request.arrayBuffer();
  if (corpo.byteLength > 256 * 1024) return testoSemplice("troppo grande", 413);
  if (!(await firmaValida(corpo, request.headers.get("x-hub-signature-256"), env.META_APP_SECRET))) {
    return testoSemplice("firma non valida", 401);
  }
  let dati;
  try {
    dati = JSON.parse(new TextDecoder().decode(corpo));
  } catch {
    return testoSemplice("ok", 200);
  }
  const importAcceso = env.IMPORT_META === "si" && env.META_PAGE_TOKEN && env.DB;
  const contatti = importAcceso ? contattiModulo(dati, env) : [];
  if (contatti.length) {
    const lavoro = (async () => {
      const totali = {};
      for (const id of contatti) {
        const esito = await importaContatto(id, env, f);
        totali[esito] = (totali[esito] || 0) + 1;
        await contaEsito(env, esito);
      }
      // Nel log solo numeri: mai email, id o risposte.
      console.log(`meta: contatti del modulo ${contatti.length}, ${Object.entries(totali).map(([k, n]) => `${k} ${n}`).join(", ")}`);
    })();
    if (ctx && ctx.waitUntil) ctx.waitUntil(lavoro);
    else await lavoro;
  }
  if (env.RISPOSTE_META !== "si" || !env.META_PAGE_TOKEN || !env.META_PAGE_ID) return testoSemplice(contatti.length ? "ok" : "ok (spento)", 200);
  const commenti = commentiBuio(dati, env);
  if (commenti.length) {
    // Si risponde subito 200 a Meta (altrimenti ripete la chiamata e si risponderebbe due volte) e si lavora in sottofondo.
    const lavoro = (async () => {
      let riusciti = 0;
      for (const c of commenti) {
        const esito = await rispondi(c, env, f);
        if (esito.privato || esito.pubblico) riusciti++;
      }
      // Nel log solo numeri: mai testi, nomi o id.
      console.log(`meta: commenti BUIO ${commenti.length}, risposte riuscite ${riusciti}`);
    })();
    if (ctx && ctx.waitUntil) ctx.waitUntil(lavoro);
    else await lavoro;
  }
  return testoSemplice("ok", 200);
}

export async function metaWebhook(request, env, ctx, f = fetch) {
  const url = new URL(request.url);
  if (request.method === "GET") return verificaIscrizione(url, env);
  if (request.method === "POST") return gestisciNotifica(request, env, ctx, f);
  return testoSemplice("metodo non ammesso", 405);
}
