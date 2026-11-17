// Schermata della porta nella web app (issue #65, spec v1 del CPO, passi 1-2; D48 A, D12 A, D18 A). Passo 4c, linea del
// CTO. Dopo «Vai allo svelamento»: nome, età, conto alla rovescia delle 48 ore e caparra («Blocca 10 crediti»).
// Le regole (10 crediti, una caparra per persona e porta, mai sotto zero, porte chiuse o scadute) le decide il server
// (/app/api/svelamento, worker/svelamento_api.js): qui si mostrano le sue risposte.
// Il corpo non dice mai chi blocca: lo dice solo il token. Una porta chiusa da un blocco o da una sospensione dà solo
// «Questa porta si è chiusa.», mai il motivo. In beta i crediti sono di prova: «Ricarica» mostra solo il testo della
// beta, nessun pagamento (Stripe in Fase 4). Niente salvataggi locali.
// Il modulo non tocca la pagina: riceve fetch, token e h dall'esterno, così si prova con node --test.
// I testi sono gli stessi di api/svelamento.js (TESTI_SVELAMENTO): il test lo controlla.

const PERCORSO = "/app/api/svelamento";
const ATTESA_MS = 8000;
const CAPARRA = 10;
const MINUTO = 60 * 1000;
const ORA = 60 * MINUTO;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const TESTI = Object.freeze({
  aperta: "Una porta si è aperta. Hai 48 ore per lo svelamento.",
  blocca: "Blocca 10 crediti",
  spiegazioneCaparra: "I tuoi 10 crediti restano bloccati. Se uno dei due dice no o non risponde, tornano a entrambi. Li perdi solo se dai buca a un appuntamento confermato.",
  aspettaCaparra: "Aspettiamo che anche <nome> blocchi la caparra.",
  ricarica: "Ricarica",
  beta: "In beta i crediti sono di prova",
  portaChiusa: "Questa porta si è chiusa.",
  scaduta: "Il tempo per lo svelamento è finito. I tuoi crediti sono di nuovo disponibili.",
  // Provvisorio, da rivedere con «contenuti»: il passo 3 della spec (video o foto, quando) arriva con il passo 5.
  entrambe: "Avete bloccato entrambi i crediti. Ora scegliete insieme come e quando fare lo svelamento.", // testo di Contenuti, 17/11
  torna: "Torna alla stanza",
});

const nome = (n) => (typeof n === "string" && n.trim() ? n.trim() : "");
const plurale = (n, uno, molti) => `${n} ${n === 1 ? uno : molti}`;

// «Mancano 34 ore e 30 minuti per lo svelamento.» sull'orologio di chi guarda; null a porta scaduta.
export function contoPorta(scadeIl, adesso = new Date()) {
  const manca = new Date(scadeIl).getTime() - adesso.getTime();
  if (!Number.isFinite(manca) || manca <= 0) return null;
  const ore = Math.floor(manca / ORA);
  const minuti = Math.floor((manca % ORA) / MINUTO);
  if (ore > 0) return `${ore === 1 ? "Manca" : "Mancano"} ${plurale(ore, "ora", "ore")} e ${plurale(minuti, "minuto", "minuti")} per lo svelamento.`;
  const m = Math.max(1, minuti);
  return `${m === 1 ? "Manca" : "Mancano"} ${plurale(m, "minuto", "minuti")} per lo svelamento.`;
}

// Cosa mostra la schermata di una porta (spec, passi 1-2). null = stato non ancora letto.
export function schermataPorta(stato, idPorta, adesso = new Date()) {
  if (!stato || !Array.isArray(stato.porte)) return null;
  const p = UUID.test(String(idPorta || "")) ? stato.porte.find((x) => x && x.porta === idPorta) : null;
  if (!p) return { tipo: "chiusa", testo: TESTI.portaChiusa };
  const conto = contoPorta(p.scade_il, adesso);
  if (!conto) return { tipo: "scaduta", testo: TESTI.scaduta };
  const n = nome(p.nome) || "questa persona";
  const saldo = Number.isFinite(stato.saldo) ? Math.max(0, stato.saldo) : 0;
  let caparra;
  if (p.mia_caparra === true && p.sua_caparra === true) caparra = { tipo: "entrambe", testo: TESTI.entrambe };
  else if (p.mia_caparra === true) {
    caparra = { tipo: "aspetta", testo: typeof p.aspetta === "string" && p.aspetta ? p.aspetta : TESTI.aspettaCaparra.replace("<nome>", n) };
  } else if (saldo >= CAPARRA) caparra = { tipo: "blocca", bottone: TESTI.blocca, spiegazione: TESTI.spiegazioneCaparra };
  else {
    const mancano = CAPARRA - saldo;
    caparra = { tipo: "ricarica", testo: `${mancano === 1 ? "Ti manca" : "Ti mancano"} ${plurale(mancano, "credito", "crediti")}`,
      bottone: TESTI.ricarica, beta: TESTI.beta, spiegazione: TESTI.spiegazioneCaparra };
  }
  return {
    tipo: "porta", porta: p.porta, titolo: TESTI.aperta,
    chi: Number.isInteger(p.eta) ? `${n}, ${p.eta}` : n,
    conto, saldo: `I tuoi crediti: ${saldo}`, caparra,
  };
}

const ERRORI = Object.freeze({
  rete: "Sei senza connessione. Riprova tra poco.",
  accesso: "Accedi di nuovo per continuare.",
  troppe: "Troppi tentativi. Aspetta un minuto.",
  non_trovata: TESTI.portaChiusa,
});
export const testoErroreSvelamento = (motivo) => (Object.hasOwn(ERRORI, motivo) ? ERRORI[motivo] : "Non è andata. Riprova tra poco.");
const errore = (motivo) => ({ ok: false, motivo, testo: testoErroreSvelamento(motivo) });

export function creaSvelamento({ token, fetch: f = globalThis.fetch, attesa = ATTESA_MS }) {
  async function chiedi(corpo = null) {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return errore("accesso");
    const ferma = new AbortController();
    const timer = setTimeout(() => ferma.abort(), attesa);
    try {
      let r;
      try {
        const headers = { authorization: `Bearer ${t}` };
        if (corpo) headers["content-type"] = "application/json";
        r = await f(PERCORSO, { method: corpo ? "POST" : "GET", signal: ferma.signal, headers, body: corpo ? JSON.stringify(corpo) : undefined });
      } catch {
        return errore("rete");
      }
      if (r.status === 401) return errore("accesso");
      if (r.status === 429) return errore("troppe");
      if (r.status === 404) return errore("non_trovata");
      let dati;
      try { dati = await r.json(); } catch { return errore("riprova"); }
      if (!dati || typeof dati !== "object" || (r.status !== 200 && dati.ok !== false)) return errore("riprova");
      if (dati.ok === false) {
        // Il testo per l'utente lo manda il server per i rifiuti delle regole (crediti, scaduta, chiusa).
        return typeof dati.testo === "string" && dati.testo ? { ok: false, motivo: String(dati.motivo || ""), testo: dati.testo }
          : errore(String(dati.motivo || "riprova"));
      }
      return { ok: true, dati };
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async leggi() {
      const r = await chiedi();
      if (!r.ok) return r;
      const { ok, ...stato } = r.dati;
      return { ok: true, stato };
    },
    async blocca(porta) {
      if (!UUID.test(String(porta || ""))) return errore("non_trovata");
      const r = await chiedi({ azione: "caparra", porta });
      return r.ok ? { ok: true, esito: r.dati.esito, stato: r.dati.stato ?? null } : r;
    },
  };
}

// Il controllo della schermata: una porta aperta alla volta, una richiesta alla volta.
export function creaPortaSvelamento({ svelamento, aggiorna = () => {}, adesso = () => new Date() }) {
  let porta = null;
  let stato = null;
  let carica = false;
  let inCorso = false;
  let errore = null;
  let ricarica = false;
  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare la schermata */ } };

  async function leggi() {
    const id = porta;
    carica = true;
    errore = null;
    avvisa();
    const r = await svelamento.leggi().catch(() => ({ ok: false, motivo: "rete" }));
    if (porta !== id) return;
    carica = false;
    if (r && r.ok) stato = r.stato;
    else errore = (r && r.testo) || testoErroreSvelamento(r && r.motivo);
    avvisa();
  }

  return {
    async apri(id) {
      porta = String(id || "");
      stato = null;
      ricarica = false;
      inCorso = false;
      await leggi();
    },
    chiudi() {
      porta = null;
      stato = null;
      errore = null;
      ricarica = false;
      carica = false;
      avvisa();
    },
    riprova: () => leggi(),
    mostraRicarica() {
      ricarica = !ricarica;
      avvisa();
    },
    async blocca() {
      if (inCorso || !porta) return;
      inCorso = true;
      errore = null;
      avvisa();
      const id = porta;
      const r = await svelamento.blocca(id).catch(() => ({ ok: false, motivo: "rete" }));
      inCorso = false;
      if (porta !== id) return;
      if (r && r.ok) {
        if (r.stato) stato = r.stato;
        else await leggi();
        avvisa();
        return;
      }
      const motivo = r && r.motivo;
      if (["crediti_insufficienti", "porta_chiusa", "porta_scaduta", "non_trovata"].includes(motivo)) {
        // Si rilegge: la schermata mostra «Ricarica» o la porta chiusa come la vede il server.
        await leggi();
        if (motivo === "crediti_insufficienti") ricarica = false;
        avvisa();
        return;
      }
      errore = (r && r.testo) || testoErroreSvelamento(motivo);
      avvisa();
    },
    modello: () => ({
      aperta: porta !== null,
      carica,
      inCorso,
      errore,
      ricarica,
      schermata: porta !== null ? schermataPorta(stato, porta, adesso()) : null,
    }),
  };
}

// La vista (h come in flusso.js). null se nessuna porta è aperta.
export function vistaPorta(h, ps, { torna = () => ps.chiudi() } = {}) {
  const m = ps.modello();
  if (!m.aperta) return null;
  const s = m.schermata;
  const parti = [];
  if (m.carica && !s) parti.push(h("p", { classe: "nota", role: "status" }, "Un attimo…"));
  if (m.errore) {
    parti.push(h("p", { classe: "errore", role: "alert" }, m.errore),
      h("button", { classe: "link", type: "button", onclick: () => ps.riprova() }, "Riprova"));
  }
  if (s && (s.tipo === "chiusa" || s.tipo === "scaduta")) parti.push(h("p", { classe: "sottotitolo" }, s.testo));
  if (s && s.tipo === "porta") {
    const c = s.caparra;
    parti.push(
      h("p", { classe: "porta-chi" }, h("strong", {}, s.chi)),
      h("p", { classe: "nota", role: "timer" }, s.conto),
      h("p", { classe: "nota" }, s.saldo));
    if (c.tipo === "blocca") {
      parti.push(h("p", { id: "caparra-spiegazione" }, c.spiegazione),
        h("button", { classe: "bottone", type: "button", "aria-describedby": "caparra-spiegazione", disabled: m.inCorso,
          onclick: () => ps.blocca() }, m.inCorso ? "Un attimo…" : c.bottone));
    } else if (c.tipo === "ricarica") {
      parti.push(h("p", { id: "caparra-spiegazione" }, c.spiegazione),
        h("p", { classe: "errore", role: "status" }, c.testo),
        h("button", { classe: "bottone-secondario", type: "button", "aria-expanded": m.ricarica ? "true" : "false",
          "aria-controls": "ricarica-beta", onclick: () => ps.mostraRicarica() }, c.bottone),
        m.ricarica ? h("p", { classe: "nota", id: "ricarica-beta", role: "status" }, c.beta) : null);
    } else {
      parti.push(h("p", { role: "status" }, c.testo));
    }
  }
  return h("section", { classe: "schermata porta-svelamento", "aria-labelledby": "porta-titolo" },
    h("h1", { id: "porta-titolo" }, s && s.tipo === "porta" ? s.titolo : "Svelamento"),
    parti,
    h("div", { classe: "azioni" }, h("button", { classe: "bottone-secondario", type: "button", onclick: torna }, TESTI.torna)));
}
