// «I tuoi appunti» sulla scheda della persona (issue #5 spec v1.1, passo 3; D51 A). Linea «sviluppatore-c», passo 9.
// Le note di ogni chiamata (data, durata, testo), modificabili e cancellabili. Le legge solo chi le ha scritte:
// passano da diario.js, direttamente su Supabase col proprio token (regole per riga); il Worker non le vede mai.
// Una sola lettura per tutta la stanza. Niente salvataggi locali, niente log. Il modulo non tocca la pagina: la vista
// (flusso.js) chiama vistaAppunti(h, …) e si prova con node --test.

const ERRORE = "Non è andata. Riprova tra poco.";

export function creaAppuntiStanza({ diario, aggiorna = () => {} }) {
  let chiave = null;
  let letto = null;
  let perPersona = {};
  let finestra = null; // { tipo: "modifica" | "cancella", persona, chiamataIl, testo }
  let errore = null;
  let inCorso = false;

  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare gli appunti */ } };
  const nota = (persona, chiamataIl) => (perPersona[persona] || []).find((a) => a.chiamataIl === chiamataIl) || null;

  async function leggi(ids) {
    const r = await diario.appuntiDi(ids).catch(() => null);
    perPersona = r && r.ok && r.perPersona && typeof r.perPersona === "object" ? r.perPersona : {};
    avvisa();
  }

  return {
    // Per la home, che si ridisegna spesso: una lettura sola per le stesse persone.
    prepara(ids) {
      const k = [...(Array.isArray(ids) ? ids : [])].map(String).sort().join(",");
      if (k !== chiave) { chiave = k; letto = leggi(ids); }
      return letto;
    },
    // Dopo una nota nuova del diario (fine chiamata): la prossima prepara() rilegge anche per le stesse persone.
    rileggi() { chiave = null; },
    di: (persona) => (perPersona[persona] || []).map((a) => ({ ...a })),
    modello: () => ({ finestra: finestra ? { ...finestra } : null, errore, inCorso }),
    apriModifica(persona, chiamataIl) {
      const n = nota(persona, chiamataIl);
      if (!n) return;
      finestra = { tipo: "modifica", persona, chiamataIl, testo: n.testo };
      errore = null;
      avvisa();
    },
    apriCancella(persona, chiamataIl) {
      if (!nota(persona, chiamataIl)) return;
      finestra = { tipo: "cancella", persona, chiamataIl };
      errore = null;
      avvisa();
    },
    scrivi(testo) {
      if (finestra && finestra.tipo === "modifica") finestra.testo = typeof testo === "string" ? testo : "";
    },
    chiudi() {
      finestra = null;
      errore = null;
      avvisa();
    },
    async conferma() {
      if (!finestra || inCorso) return;
      const f = finestra;
      inCorso = true;
      errore = null;
      avvisa();
      try {
        const r = f.tipo === "modifica" ? await diario.modifica(f.chiamataIl, f.testo) : await diario.cancella(f.chiamataIl);
        if (!r || !r.ok) { errore = ERRORE; return; }
        const elenco = perPersona[f.persona] || [];
        if (f.tipo === "modifica") {
          const n = elenco.find((a) => a.chiamataIl === f.chiamataIl);
          if (n) n.testo = f.testo.trim();
        } else {
          perPersona[f.persona] = elenco.filter((a) => a.chiamataIl !== f.chiamataIl);
        }
        finestra = null;
      } catch {
        errore = ERRORE;
      } finally {
        inCorso = false;
        avvisa();
      }
    },
  };
}

// Sotto la scheda della persona: niente se non ci sono note (nessun testo nuovo per il vuoto).
export function vistaAppunti(h, as, persona, nome) {
  const elenco = as.di(persona);
  if (!elenco.length) return null;
  const m = as.modello();
  const n = typeof nome === "string" && nome.trim() ? nome.trim() : "questa persona";
  const titolo = `appunti-titolo-${persona}`;
  return h("div", { classe: "appunti-scheda", role: "group", "aria-labelledby": titolo },
    h("p", { id: titolo }, h("strong", {}, "I tuoi appunti"), " ", h("span", { classe: "nota" }, "Lo leggi solo tu.")),
    h("ul", { classe: "appunti" }, elenco.map((a) => {
      const f = m.finestra && m.finestra.persona === persona && m.finestra.chiamataIl === a.chiamataIl ? m.finestra : null;
      const intestazione = h("p", { classe: "nota" }, `${a.data} · ${a.durata}`);
      if (f && f.tipo === "modifica") {
        const id = `appunto-${persona}-${a.chiamataIl}`.replace(/[^a-zA-Z0-9-]/g, "-");
        return h("li", { classe: "appunto" }, intestazione,
          h("label", { for: id, classe: "nota" }, `Il tuo appunto su ${n}`),
          h("textarea", { id, classe: "racconto-segnala", maxlength: "1000", rows: "4", disabled: m.inCorso,
            oninput: (e) => as.scrivi(e.target.value) }, f.testo || ""),
          m.errore ? h("p", { classe: "errore", role: "alert" }, m.errore) : null,
          h("button", { classe: "bottone", type: "button", disabled: m.inCorso, onclick: () => as.conferma() }, m.inCorso ? "Un attimo…" : "Salva"),
          h("button", { classe: "link", type: "button", disabled: m.inCorso, onclick: () => as.chiudi() }, "Annulla"));
      }
      if (f && f.tipo === "cancella") {
        return h("li", { classe: "appunto" }, intestazione, h("p", {}, a.testo),
          h("div", { role: "alertdialog", "aria-label": "Cancellare questa nota?" },
            h("p", {}, h("strong", {}, "Cancellare questa nota?")),
            m.errore ? h("p", { classe: "errore", role: "alert" }, m.errore) : null,
            h("button", { classe: "bottone-secondario", type: "button", disabled: m.inCorso, onclick: () => as.conferma() }, m.inCorso ? "Un attimo…" : "Cancella"),
            h("button", { classe: "link", type: "button", disabled: m.inCorso, onclick: () => as.chiudi() }, "Annulla")));
      }
      return h("li", { classe: "appunto" }, intestazione, h("p", {}, a.testo),
        h("button", { classe: "link", type: "button", "aria-label": `Modifica l'appunto del ${a.data} su ${n}`, onclick: () => as.apriModifica(persona, a.chiamataIl) }, "Modifica"),
        h("button", { classe: "link", type: "button", "aria-label": `Cancella l'appunto del ${a.data} su ${n}`, onclick: () => as.apriCancella(persona, a.chiamataIl) }, "Cancella"));
    })));
}
