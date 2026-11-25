// Schermata 35 «Domenica sera» del design v4 (issue #349, LEGGIMI punto 35, prototipo #n25). Linea C.
// Domenica dalle 20:00 alle 20:59 (ora di Roma, la stessa ora in cui parte il conto delle chiavi), con la stanza
// aperta: al posto della home la porta socchiusa con la luce calda di un tavolo che aspetta, «La stanza si chiude.
// Le porte si aprono alle 21.», il conto alla rovescia e «Rivedi la tua stanza». Il pulsante la toglie per quella
// domenica (solo in memoria): si torna alla stanza e si possono ancora dare o riprendere le chiavi fino alle 20:59.
// Dalle 21 la schermata sparisce da sola e arrivano il Filo (36) e la sera delle porte, invariati.
// Solo orologio e testi: nessuna rete, nessun dato personale, niente salvataggi nel telefono.

export const TESTI_DOMENICA_SERA = Object.freeze({
  etichetta: "Domenica sera",
  titolo: "La stanza si chiude.",
  evidenza: "Le porte si aprono alle 21.",
  bottone: "Rivedi la tua stanza",
});

const IMMAGINE = "/app/img/porta-calda.jpg";
const DALLE = 20; // ora di Roma in cui compare
const formato = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Rome", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function aRoma(istante) {
  const p = Object.fromEntries(formato.formatToParts(istante).map((x) => [x.type, x.value]));
  return { domenica: p.weekday === "Sun", giorno: `${p.year}-${p.month}-${p.day}`, ora: Number(p.hour), min: Number(p.minute), s: Number(p.second) };
}

const due = (n) => String(n).padStart(2, "0");

function testoAria(minuti) {
  if (minuti < 1) return "Manca meno di un minuto alle 21";
  return minuti === 1 ? "Manca 1 minuto alle 21" : `Mancano ${minuti} minuti alle 21`;
}

export function creaDomenicaSera() {
  const viste = new Set(); // domeniche (data di Roma) in cui si è già toccato «Rivedi la tua stanza»
  // Per ogni giorno: la prima volta che l'app l'ha guardato era già nell'ora delle 20? Se l'app era aperta prima, la
  // schermata non interrompe (chi sta scrivendo la frase di una chiave non perde nulla): la vedrà alla prossima apertura.
  const primoSguardo = new Map();

  function conto(adesso) {
    if (!(adesso instanceof Date) || !Number.isFinite(adesso.getTime())) return null;
    const r = aRoma(adesso);
    if (!r.domenica || r.ora !== DALLE) return { r, fuori: true }; // dentro l'ora delle 20 non c'è cambio d'ora
    const ms = (60 * 60 - (r.min * 60 + r.s)) * 1000 - adesso.getMilliseconds();
    const minuti = Math.max(0, Math.floor(ms / 60000));
    return { r, minuti, fuori: false };
  }

  return {
    modello(adesso, { inStanza = false } = {}) {
      const c = conto(adesso);
      if (!c) return null;
      if (!primoSguardo.has(c.r.giorno)) primoSguardo.set(c.r.giorno, !c.fuori);
      if (inStanza !== true || c.fuori || !primoSguardo.get(c.r.giorno) || viste.has(c.r.giorno)) return null;
      return {
        conto: `${due(Math.floor(c.minuti / 60))}:${due(c.minuti % 60)}`,
        ariaConto: testoAria(c.minuti),
        segmenti: ["on", "on", "on", "on", "on", "on", "oggi"],
      };
    },
    rivedi(adesso = new Date()) {
      const c = conto(adesso);
      if (c && !c.fuori) viste.add(c.r.giorno);
    },
    // Ogni giro della sentinella: aggiorna il conto sul posto. true = sono le 21, la pagina va ridisegnata.
    aggiornaSulPosto(radice, adesso = new Date()) {
      const el = radice && radice.querySelector("#conto-domenica-sera");
      if (!el) return false;
      const m = this.modello(adesso, { inStanza: true });
      if (!m) return true;
      if (el.textContent !== m.conto) el.textContent = m.conto;
      el.setAttribute("aria-label", m.ariaConto);
      return false;
    },
  };
}

// h = costruttore di nodi della web app (i testi entrano sempre come testo). La scena è decorativa.
export function vistaDomenicaSera(h, m, { rivedi } = {}) {
  if (!m) return null;
  return h("section", { classe: "schermata domenica-sera", "aria-labelledby": "domenica-sera-titolo" },
    h("div", { classe: "domenica-sera-scena", "aria-hidden": "true" },
      h("img", { classe: "domenica-sera-foto", src: IMMAGINE, alt: "" }),
      h("div", { classe: "domenica-sera-luce" })),
    h("div", { classe: "domenica-sera-testa" },
      h("div", { classe: "settimana", "aria-hidden": "true" }, m.segmenti.map((s) => h("i", { classe: s }))),
      h("p", { classe: "passo" }, TESTI_DOMENICA_SERA.etichetta),
      h("h1", { id: "domenica-sera-titolo" }, TESTI_DOMENICA_SERA.titolo, h("br"), h("em", {}, TESTI_DOMENICA_SERA.evidenza))),
    h("div", { classe: "domenica-sera-piede" },
      h("p", { classe: "timer domenica-sera-conto", id: "conto-domenica-sera", "aria-label": m.ariaConto }, m.conto),
      h("button", { classe: "bottone", type: "button", onclick: () => { if (rivedi) rivedi(); } }, TESTI_DOMENICA_SERA.bottone)));
}
