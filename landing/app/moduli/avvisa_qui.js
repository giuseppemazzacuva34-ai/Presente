// «Avvisa <nome> che sei qui» (issue #6, spec v1 del CPO del 3/11, punto 6 «Check-in»). Linea «sviluppatore-b».
// Chi ha detto «Sono qui» e aspetta, dopo 15 minuti, può avvisare l'altra persona, una volta sola. Le regole le decide
// il database (avvisa_sono_qui): qui si leggono dallo stato dell'incontro l'azione «avvisa_qui», «avviso_qui_da»
// (da quando si potrà), «avvisato_mio» e «avvisato_altro» (solo sì/no, mai chi), e si manda
// POST /app/api/incontro { azione: "avvisa_qui", porta } col token; poi si rilegge lo stato.
// Solo il nome del pulsante viene dalla spec; le altre frasi sono provvisorie, da rivedere con «contenuti».
// Niente salvataggi locali, niente log. Non tocca la pagina: riceve h, fetch e token dall'esterno (node --test).

const PERCORSO = "/app/api/incontro";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const TESTI_AVVISO = Object.freeze({
  // Dalla spec (v1, punto 6).
  bottone: "Avvisa <nome> che sei qui",
  // Provvisori.
  presto: "Dalle <ora> potrai avvisare <nome> che sei qui.",
  avvisato: "Hai avvisato <nome> che sei qui.",
  arrivato: "<nome> ti ha avvisato: è già lì e ti aspetta.",
  attimo: "Un attimo…",
  altraPersona: "L'altra persona",
  errori: Object.freeze({
    troppo_presto: "Aspetta ancora qualche minuto: potrai avvisare dopo 15 minuti di attesa.",
    gia_avvisato: "Hai già mandato l'avviso: si manda una volta sola.",
    gia_arrivato: "L'altra persona è già arrivata.",
    non_ancora_qui: "Prima tocca «Sono qui».",
    troppo_tardi: "Il tempo per il check-in è finito.",
    non_confermato: "L'incontro non è ancora confermato.",
    incontro_chiuso: "Questo incontro non è più disponibile.",
    generico: "Non è andata. Riprova tra poco.",
  }),
});

const ORARIO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const confermato = (i) => !!i && typeof i === "object" && i.stato === "confermato" && !i.esito;
const nomeDi = (nome) => (typeof nome === "string" && nome.trim() ? nome.trim() : TESTI_AVVISO.altraPersona);
const iniziale = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// Cosa mostrare: «avvisa» (il pulsante, col suo testo) e una nota (da quando, avviso partito o arrivato) oppure null.
export function rigaAvviso(i, nome = null, adesso = new Date()) {
  const chi = nomeDi(nome);
  const vuota = { avvisa: false, bottone: TESTI_AVVISO.bottone.replace("<nome>", chi), nota: null };
  if (!confermato(i)) return vuota;
  const azioni = Array.isArray(i.azioni) ? i.azioni : [];
  if (i.avvisato_mio === true) return { ...vuota, nota: TESTI_AVVISO.avvisato.replace("<nome>", chi) };
  if (i.avvisato_altro === true && i.checkin_mio !== true) return { ...vuota, nota: iniziale(TESTI_AVVISO.arrivato.replace("<nome>", chi)) };
  if (azioni.includes("avvisa_qui")) return { ...vuota, avvisa: true };
  const da = typeof i.avviso_qui_da === "string" ? new Date(i.avviso_qui_da) : null;
  if (i.checkin_mio === true && i.checkin_altro !== true && da && Number.isFinite(da.getTime()) && da > new Date(adesso)) {
    return { ...vuota, nota: TESTI_AVVISO.presto.replace("<ora>", ORARIO.format(da)).replace("<nome>", chi) };
  }
  return vuota;
}

const fraseErrore = (m) => (typeof m === "string" && m !== "generico" && Object.hasOwn(TESTI_AVVISO.errori, m)
  ? TESTI_AVVISO.errori[m] : TESTI_AVVISO.errori.generico);

export function creaClientAvviso({ token, fetch: f = globalThis.fetch }) {
  const leggiToken = () => Promise.resolve().then(token).catch(() => null);
  return {
    async avvisa(porta) {
      if (typeof porta !== "string" || !UUID.test(porta)) return { ok: false, testo: TESTI_AVVISO.errori.generico };
      const t = await leggiToken();
      if (!t) return { ok: false, testo: TESTI_AVVISO.errori.generico };
      let r;
      try {
        const risposta = await f(PERCORSO, { method: "POST",
          headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ azione: "avvisa_qui", porta }) });
        r = await risposta.json();
      } catch {
        return { ok: false, testo: TESTI_AVVISO.errori.generico };
      }
      if (r && r.ok === true && r.esito === "avvisato") return { ok: true, esito: "avvisato" };
      return { ok: false, testo: fraseErrore(r && r.motivo) };
    },
  };
}

// Il foglio dentro «Il vostro incontro»: esito ed errore solo in memoria; dopo un invio riuscito si rilegge lo stato.
export function creaFoglioAvviso({ client, ricarica = () => {}, aggiorna = () => {} }) {
  let porta = null;
  let invio = false;
  let errore = "";
  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare il foglio */ } };
  const rileggi = () => Promise.resolve().then(ricarica).catch(() => null);
  function sincronizza(p) {
    if (!p || p === porta) return;
    const prima = porta;
    porta = p;
    if (prima !== null) { invio = false; errore = ""; }
  }
  return {
    sincronizza,
    async manda(p) {
      if (invio) return false;
      sincronizza(p);
      invio = true; errore = ""; avvisa();
      const r = await Promise.resolve().then(() => client.avvisa(p)).catch(() => ({ ok: false, testo: TESTI_AVVISO.errori.generico }));
      invio = false;
      if (porta !== p) return false;
      if (r && r.ok) {
        avvisa();
        await rileggi();
        return true;
      }
      errore = (r && r.testo) || TESTI_AVVISO.errori.generico;
      avvisa();
      return false;
    },
    modello: () => ({ porta, invio, errore }),
  };
}

// La vista (h come in flusso.js). i è lo stato dell'incontro, nome quello dell'altra persona (solo testo).
export function vistaFoglioAvviso(h, fa, porta, i, nome = null, adesso = new Date()) {
  if (!fa || !confermato(i)) return null;
  fa.sincronizza(porta);
  const m = fa.modello();
  const riga = rigaAvviso(i, nome, adesso);
  const parti = [];
  if (riga.nota) parti.push(h("p", { classe: "nota", role: "status" }, riga.nota));
  if (riga.avvisa) {
    parti.push(h("button", { classe: "bottone", type: "button", disabled: m.invio, "aria-busy": m.invio ? "true" : null,
      onclick: () => fa.manda(porta) }, m.invio ? TESTI_AVVISO.attimo : riga.bottone));
  }
  if (m.errore) parti.push(h("p", { classe: "errore", role: "alert" }, m.errore));
  return parti.length ? h("div", { classe: "avvisa-qui" }, parti) : null;
}
