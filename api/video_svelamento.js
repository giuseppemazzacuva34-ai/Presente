// Svelamento dopo la porta (issue #65, passo 7c; D48 A, spec v1 del CPO): le richieste video dei 10 secondi.
// Il Worker (worker/svelamento_api.js) chiama queste funzioni SOLO dopo che il database ha detto «iniziato_video» per
// la persona del token (entra_svelamento). Qui si mettono insieme Cloudflare Realtime (api/realtime.js) e il Durable
// Object `Svelamento` della porta (api/svelamento_do.js):
//   pubblica  offerta del telefono (una voce + un video) → sessione nuova, risposta di Cloudflare, sessione nel DO
//   ricevi    → offerta di Cloudflare con voce e video dell'altra persona (tracce segnate «in arrivo» nel DO)
//   conferma  risposta del telefono → rinegoziazione; con le conferme di tutti e due partono i 10 secondi
//   vista     → fase, inizio, nitidoDal, fine (per chi aspetta l'altra persona)
// Al telefono non arriva mai un id di sessione: solo descrizioni SDP e la «vista». Se il DO rifiuta dopo che Realtime
// ha già aperto qualcosa, si chiude subito. Nessuna registrazione, niente SDP nei log: solo nomi di errore.
// Le dipendenze arrivano da fuori (d), così si prova tutto con node --test senza rete.

import { soloSvelamento, svelamentoSessione, midDi } from "./realtime.js";

const no = (motivo) => ({ ok: false, motivo });
const esito = (r) => (r && r.ok ? null : no(String((r && r.motivo) || "riprova")));
export const offertaSvelamento = (o) => !!o && typeof o === "object" && o.type === "offer" && soloSvelamento(o.sdp);
export const rispostaSvelamento = (o) => !!o && typeof o === "object" && o.type === "answer" && svelamentoSessione(o.sdp);

async function chiudi(d, sessione, mids) {
  try { await d.chiudiSessione(sessione, mids); } catch { /* Realtime chiude comunque le sessioni senza traffico */ }
}

export async function pubblicaVideo({ per, offerta }, d) {
  if (!offertaSvelamento(offerta)) return no("svelamento");
  const mids = [midDi(offerta.sdp, "audio"), midDi(offerta.sdp, "video")];
  if (!mids[0] || !mids[1] || mids[0] === mids[1]) return no("svelamento");
  const s = await d.nuovaSessione();
  if (!s || !s.ok) return esito(s);
  let pubblicata = false;
  try {
    const p = await d.pubblicaSvelamento(s.sessione, offerta);
    if (!p || !p.ok) return esito(p);
    pubblicata = true;
    const r = await d.svelamento.pubblica({ da: per, sessione: s.sessione, mids });
    if (!r || !r.ok) {
      await chiudi(d, s.sessione, mids);
      return esito(r);
    }
    return { ok: true, descrizione: p.descrizione, vista: r.vista };
  } catch (e) {
    console.error("svelamento video: pubblica", e && e.name);
    if (pubblicata) await chiudi(d, s.sessione, mids);
    return no("riprova");
  }
}

export async function riceviVideo({ per }, d) {
  const s = await d.svelamento.sessioni(per);
  if (!s || !s.ok) return esito(s);
  let mids = null;
  try {
    const v = await d.riceviSvelamento(s.mia, s.altra);
    if (!v || !v.ok) return esito(v);
    mids = v.mids;
    const r = await d.svelamento.inArrivo({ da: per, mids });
    if (!r || !r.ok) {
      await chiudi(d, s.mia, mids);
      return esito(r);
    }
    return { ok: true, descrizione: v.descrizione, vista: r.vista };
  } catch (e) {
    console.error("svelamento video: ricevi", e && e.name);
    if (mids) await chiudi(d, s.mia, mids);
    return no("riprova");
  }
}

export async function confermaVideo({ per, risposta }, d) {
  if (!rispostaSvelamento(risposta)) return no("svelamento");
  const s = await d.svelamento.sessioni(per);
  if (!s || !s.ok) return esito(s);
  const c = await d.confermaSvelamento(s.mia, risposta);
  if (!c || !c.ok) return esito(c);
  const r = await d.svelamento.ricevuto({ da: per });
  return esito(r) || { ok: true, vista: r.vista };
}

export async function vistaVideo({ per }, d) {
  const r = await d.svelamento.vista(per);
  return esito(r) || { ok: true, vista: r.vista };
}
