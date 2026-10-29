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
  if (env.RISPOSTE_META !== "si" || !env.META_PAGE_TOKEN || !env.META_PAGE_ID) return testoSemplice("ok (spento)", 200);
  let dati;
  try {
    dati = JSON.parse(new TextDecoder().decode(corpo));
  } catch {
    return testoSemplice("ok", 200);
  }
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
