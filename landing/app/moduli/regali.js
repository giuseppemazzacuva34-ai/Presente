// Foglio dei regali e avviso del regalo ricevuto nella web app (issue #331, spec v1 del CPO, parte C; D145 A;
// design v4, schermate 26 «La chiamata · I regali» e 27 «Regalo ricevuto»). Passo 7 della linea «sviluppatore-c».
//
// Chi lo usa (scheda di una persona della stanza, schermata della chiamata della linea A):
//   apriFoglioRegali(contenitore, { a, nome, saldo, inChiamata, regali: creaRegali({ token }), alRegalo, alChiudi })
//   mostraAvvisoRegalo(contenitore, { regalo, testo })   // sopra il timer per 3 secondi, la chiamata non si ferma
//
// Il telefono non decide niente: saldo, permessi (stanza, blocchi, segnalazioni, limiti) e importi li ricontrolla il
// server (worker/regali_api.js → manda_regalo). Qui solo testi, scelta e una richiesta con chiave unica, così due
// tocchi rapidi fanno partire un solo regalo. Nessun messaggio scritto con il regalo, nessun salvataggio locale.
// Il catalogo è lo stesso di api/coin.js (la pagina non può importarlo): lo controlla test/regali_foglio.test.mjs.

export const DURATA_AVVISO_MS = 3000;
const PERCORSO = "/app/api/regali";

const CATALOGO = Object.freeze([
  Object.freeze({ id: "rosa", breve: "Rosa", nome: "Rosa", coin: 5, conArticolo: "una rosa", mandato: "mandata", regala: "Regala la rosa" }),
  Object.freeze({ id: "spumante", breve: "Spumante", nome: "Bicchiere di spumante", coin: 10, conArticolo: "un bicchiere di spumante", mandato: "mandato", regala: "Regala lo spumante" }),
  Object.freeze({ id: "fiori", breve: "Fiori", nome: "Mazzo di fiori", coin: 20, conArticolo: "un mazzo di fiori", mandato: "mandato", regala: "Regala i fiori" }),
]);

export const TESTI_FOGLIO = Object.freeze({
  chiudi: "Chiudi",
  manda: "Manda",
  annulla: "Annulla",
  // Testi già usati nell'app per gli errori: per i due limiti giornalieri la spec non dà una frase (chiesta al CPO).
  generico: "Non è andata. Riprova tra poco.",
  rete: "Sei senza connessione. Riprova tra poco.",
});

const coin = (n) => (n === 1 ? "1 credito" : `${n} crediti`); // decisioni_giuseppe_23_11_crediti
const REGALI_ALLA_PERSONA_AL_GIORNO = 3; // come COIN.regaliAllaPersonaAlGiorno in api/coin.js (lo controlla il test)
const chi = (nome) => (typeof nome === "string" && nome.trim() ? nome.trim() : "questa persona");
const mancano = (n) => (n === 1 ? "Ti manca 1 credito" : `Ti mancano ${n} crediti`);
const saldoValido = (n) => Number.isInteger(n) && n >= 0;
const regaloDa = (id) => CATALOGO.find((r) => r.id === id) ?? null;

// Testi dei due limiti giornalieri (CPO, 22/11), uguali a testoLimite di api/coin.js; qui con il nome della stanza.
export function testoLimite(motivo, nome) {
  if (motivo === "limite_persona") return `Oggi hai già mandato ${REGALI_ALLA_PERSONA_AL_GIORNO} regali a ${chi(nome)}. Domani puoi mandargliene altri.`;
  if (motivo === "limite_giorno") return "Per oggi hai mandato tutti i regali. Domani puoi mandarne altri.";
  return null;
}

// Cosa mostra il foglio. fase: "scelta" | "conferma" | "invio" | "fatto" | "limite" | "errore".
export function statoFoglio({ nome, saldo = null, scelto = null, inChiamata = false, fase = "scelta", errore = null } = {}) {
  const n = chi(nome);
  const s = saldoValido(saldo) ? saldo : null;
  const r = regaloDa(scelto) ?? CATALOGO[0];
  const base = {
    titolo: `Fai un regalo a ${n}`,
    saldo: s === null ? null : `Hai ${coin(s)}`,
    regali: CATALOGO.map((x) => ({
      id: x.id, nome: x.breve, coin: x.coin, prezzo: coin(x.coin), etichetta: `${x.nome} · ${coin(x.coin)}`, scelto: x.id === r.id,
    })),
    nota: inChiamata ? `${n} lo vede subito, durante la chiamata.` : null,
    domanda: null,
    messaggio: null,
    errore: null,
  };
  if (fase === "conferma" || fase === "invio") {
    return { ...base, domanda: `Mandi ${r.conArticolo} a ${n}? Costa ${coin(r.coin)}.`, primario: { testo: TESTI_FOGLIO.manda, attivo: fase === "conferma" }, secondario: TESTI_FOGLIO.annulla };
  }
  if (fase === "fatto") {
    return { ...base, messaggio: `${r.nome} ${r.mandato} a ${n}.`, primario: { testo: TESTI_FOGLIO.chiudi, attivo: true }, secondario: null };
  }
  if (fase === "limite") {
    return { ...base, messaggio: errore || TESTI_FOGLIO.generico, primario: { testo: TESTI_FOGLIO.chiudi, attivo: true }, secondario: null };
  }
  if (fase === "errore") {
    return { ...base, errore: errore || TESTI_FOGLIO.generico, primario: { testo: TESTI_FOGLIO.chiudi, attivo: true }, secondario: null };
  }
  if (s === null) return { ...base, primario: { testo: r.regala, attivo: false }, secondario: TESTI_FOGLIO.chiudi };
  if (s < r.coin) return { ...base, primario: { testo: mancano(r.coin - s), attivo: false }, secondario: TESTI_FOGLIO.chiudi };
  return { ...base, primario: { testo: r.regala, attivo: true }, secondario: TESTI_FOGLIO.chiudi };
}

// Richieste al Worker con il token di chi usa l'app. Mai un saldo o un esito inventato.
export function creaRegali({ token, fetch: f = globalThis.fetch } = {}) {
  async function chiedi({ percorso = PERCORSO, ...init }) {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return { ok: false, motivo: "accesso", testo: TESTI_FOGLIO.generico };
    let r;
    try {
      r = await f(percorso, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${t}` } });
    } catch {
      return { ok: false, motivo: "rete", testo: TESTI_FOGLIO.rete };
    }
    if (r.status === 401) return { ok: false, motivo: "accesso", testo: TESTI_FOGLIO.generico };
    let corpo = null;
    try { corpo = await r.json(); } catch { /* sotto */ }
    if (!r.ok || !corpo || typeof corpo !== "object") return { ok: false, motivo: "riprova", testo: TESTI_FOGLIO.generico };
    return corpo;
  }
  const json = (dati) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(dati) });
  return {
    async manda({ a, regalo, chiave }) {
      const c = await chiedi(json({ azione: "manda", a, regalo, chiave }));
      if (c.ok === true) return { ok: true, saldo: saldoValido(c.saldo) ? c.saldo : null };
      const motivo = typeof c.motivo === "string" ? c.motivo : "riprova";
      return { ok: false, motivo, testo: typeof c.testo === "string" && c.testo ? c.testo : TESTI_FOGLIO.generico };
    },
    async avvisi() {
      const c = await chiedi({ method: "GET" });
      if (c.ok !== true) return { ok: false, motivo: c.motivo || "riprova" };
      return { ok: true, saldo: saldoValido(c.saldo) ? c.saldo : null, avvisi: Array.isArray(c.avvisi) ? c.avvisi : [] };
    },
    // Scheda di chi riceve: «Ti ha mandato: 1 rosa, …» (testo del server) o null se non ci sono regali.
    async ricevutiDa(da) {
      if (typeof da !== "string" || !da) return { ok: false, motivo: "riprova" };
      const c = await chiedi({ method: "GET", percorso: `${PERCORSO}?da=${encodeURIComponent(da)}` });
      if (c.ok !== true) return { ok: false, motivo: c.motivo || "riprova" };
      return { ok: true, testo: typeof c.testo === "string" && c.testo.trim() ? c.testo.trim() : null };
    },
    async visti(ids) {
      const c = await chiedi(json({ azione: "visti", ids }));
      return c.ok === true ? { ok: true } : { ok: false, motivo: c.motivo || "riprova" };
    },
  };
}

function el(doc, tag, classe, testo) {
  const e = doc.createElement(tag);
  if (classe) e.className = classe;
  if (testo != null) e.textContent = testo;
  return e;
}

// Il foglio dal basso (schermata 26). Tutto con pulsanti veri: si usa da tastiera, Esc chiude.
export function apriFoglioRegali(contenitore, { a, nome, saldo = null, inChiamata = false, regali, chiave, alRegalo, alChiudi } = {}) {
  const doc = contenitore.ownerDocument;
  const nuovaChiave = typeof chiave === "function" ? chiave : () => globalThis.crypto.randomUUID();
  const st = { saldo: saldoValido(saldo) ? saldo : null, scelto: CATALOGO[0].id, fase: "scelta", errore: null, chiave: null };
  if (st.saldo !== null) st.scelto = (CATALOGO.find((r) => r.coin <= st.saldo) ?? CATALOGO[0]).id;

  const foglio = el(doc, "section", "foglio-regali");
  foglio.setAttribute("role", "dialog");
  foglio.setAttribute("aria-modal", "true");
  foglio.setAttribute("aria-labelledby", "foglio-regali-titolo");
  let aperto = true;

  function chiudi() {
    if (!aperto) return;
    aperto = false;
    foglio.remove();
    if (typeof alChiudi === "function") alChiudi();
  }

  async function invia() {
    if (st.fase !== "conferma") return; // secondo tocco: già in corso
    st.fase = "invio";
    st.chiave ||= nuovaChiave(); // stessa chiave se si riprova: il server ne conta uno solo
    disegna();
    const r = await regali.manda({ a, regalo: st.scelto, chiave: st.chiave });
    if (!aperto) return;
    if (r.ok) {
      st.fase = "fatto";
      if (r.saldo !== null) st.saldo = r.saldo;
      if (typeof alRegalo === "function") alRegalo(r.saldo);
    } else if (testoLimite(r.motivo, nome)) {
      st.fase = "limite"; // limite del giorno: messaggio con role="status", nessun Coin scalato, il foglio resta aperto
      st.errore = testoLimite(r.motivo, nome);
    } else {
      st.fase = "errore";
      st.errore = r.testo;
    }
    disegna();
  }

  function disegna() {
    const s = statoFoglio({ nome, saldo: st.saldo, scelto: st.scelto, inChiamata, fase: st.fase, errore: st.errore });
    const testa = el(doc, "div", "foglio-regali-testa");
    const titolo = el(doc, "h2", "foglio-regali-titolo", s.titolo);
    titolo.setAttribute("id", "foglio-regali-titolo");
    testa.append(titolo);
    if (s.saldo) testa.append(el(doc, "p", "foglio-regali-saldo", s.saldo));
    const griglia = el(doc, "div", "foglio-regali-scelte");
    const scelte = s.regali.map((r) => {
      const b = el(doc, "button", "regalo-scelta");
      b.setAttribute("type", "button");
      b.setAttribute("aria-label", r.etichetta);
      b.setAttribute("aria-pressed", r.scelto ? "true" : "false");
      b.append(el(doc, "span", `regalo-icona regalo-${r.id}`), el(doc, "span", "regalo-nome", r.nome), el(doc, "span", "regalo-prezzo", r.prezzo));
      b.disabled = st.fase !== "scelta";
      b.addEventListener("click", () => { st.scelto = r.id; disegna(); });
      return b;
    });
    griglia.append(...scelte);
    const parti = [testa, griglia];
    if (s.nota) parti.push(el(doc, "p", "foglio-regali-nota", s.nota));
    const testoMessaggio = s.domanda || s.messaggio || s.errore;
    if (testoMessaggio) {
      const m = el(doc, "p", "foglio-regali-messaggio", testoMessaggio);
      m.setAttribute("role", s.errore ? "alert" : "status");
      parti.push(m);
    }
    const azioni = el(doc, "div", "azioni");
    if (s.secondario) {
      const sec = el(doc, "button", "bottone-secondario", s.secondario);
      sec.setAttribute("type", "button");
      sec.addEventListener("click", () => {
        if (st.fase === "conferma") { st.fase = "scelta"; disegna(); } else if (st.fase === "scelta") chiudi();
      });
      sec.disabled = st.fase === "invio";
      azioni.append(sec);
    }
    const pri = el(doc, "button", "bottone", s.primario.testo);
    pri.setAttribute("type", "button");
    pri.disabled = !s.primario.attivo;
    pri.addEventListener("click", () => {
      if (st.fase === "scelta") { st.fase = "conferma"; disegna(); } else if (st.fase === "conferma") invia();
      else if (st.fase === "fatto" || st.fase === "limite" || st.fase === "errore") chiudi(); // durante l'invio un secondo tocco non fa nulla
    });
    azioni.append(pri);
    parti.push(azioni);
    foglio.replaceChildren(...parti);
    return { scelte, pri };
  }

  foglio.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && st.fase !== "invio") { e.preventDefault(); chiudi(); }
  });
  const { scelte } = disegna();
  contenitore.append(foglio);
  scelte.find((b) => b.getAttribute("aria-pressed") === "true")?.focus();
  return { chiudi };
}

// Avviso del regalo ricevuto (schermata 27 del design v4, D149): l'icona grande al centro sopra la chiamata e la frase
// del server su due righe, il regalo in corsivo («Marta ti ha mandato» / «una rosa.»). Letto intero dal lettore di
// schermo (role="status"), non blocca i pulsanti della chiamata, sparisce da solo.
export function mostraAvvisoRegalo(contenitore, avviso = {}, { setTimeout: dopo = globalThis.setTimeout } = {}) {
  const r = regaloDa(avviso.regalo);
  if (!r || typeof avviso.testo !== "string" || !avviso.testo.trim()) return null;
  const doc = contenitore.ownerDocument;
  const testo = avviso.testo.trim();
  const box = el(doc, "div", `avviso-regalo avviso-regalo-${r.id}`);
  box.setAttribute("role", "status");
  const icona = el(doc, "span", `regalo-icona regalo-${r.id}`);
  icona.setAttribute("aria-hidden", "true");
  const frase = el(doc, "p", "avviso-regalo-frase");
  const diviso = / ti ha mandato /.exec(testo);
  if (diviso) {
    const dove = diviso.index + " ti ha mandato".length;
    frase.append(el(doc, "span", null, `${testo.slice(0, dove)} `), el(doc, "br", null), el(doc, "em", null, testo.slice(dove + 1)));
  } else frase.textContent = testo;
  box.append(icona, frase);
  contenitore.append(box);
  dopo(() => box.remove(), DURATA_AVVISO_MS);
  return box;
}
