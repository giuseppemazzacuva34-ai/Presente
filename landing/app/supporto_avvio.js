// Pagina di chi risponde a «Scrivici» (issue #10, spec v1 del CPO, parte A) · linea «sviluppatore-c», passo 5b.
// Si entra con lo stesso accesso dell'app (/app/). Chi può leggere lo decide il database (ruolo «supporto»): qui la
// pagina mostra solo ciò che il Worker restituisce. Ogni testo entra con textContent, mai come HTML. La risposta
// salvata compare all'utente in «I miei messaggi».
import { creaAccesso } from "/app/moduli/accesso.js";
import { creaSupportoOperatore, vociSupporto, unisciBozze, testoErroreOperatore, MASSIMO_RISPOSTA, copiaTesto } from "/app/moduli/supporto_operatore.js";

const radice = document.getElementById("supporto");
const stato = document.getElementById("stato");
const TITOLO = "Messaggi «Scrivici»";

function h(tag, attributi = {}, ...figli) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attributi)) {
    if (k === "testo") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const f of figli.flat()) if (f) el.append(f);
  return el;
}
function avvisa(testo) {
  stato.textContent = testo;
  stato.hidden = !testo;
}
function mostra(...figli) {
  radice.replaceChildren(...figli);
  const titolo = radice.querySelector("h1");
  if (titolo) { titolo.setAttribute("tabindex", "-1"); titolo.focus(); }
}

async function prepara() {
  try {
    const config = await (await fetch("/app/config.json", { cache: "no-store" })).json();
    if (!config.pronta || config.accesso !== true) return null;
    let memoria = null;
    try { memoria = window.localStorage; } catch { memoria = null; }
    const accesso = creaAccesso({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey, fetch: window.fetch.bind(window), memoria });
    return creaSupportoOperatore({ token: () => accesso.token(), fetch: window.fetch.bind(window) });
  } catch {
    return null;
  }
}

function moduloRisposta(p, v, i) {
  const campo = h("textarea", { id: `risposta-${i}`, name: "risposta", rows: "5", maxlength: String(MASSIMO_RISPOSTA), required: true });
  const conto = h("p", { class: "nota", id: `conto-${i}`, testo: `0/${MASSIMO_RISPOSTA}` });
  campo.setAttribute("aria-describedby", conto.id);
  campo.addEventListener("input", () => { conto.textContent = `${[...campo.value].length}/${MASSIMO_RISPOSTA}`; });
  const errore = h("p", { class: "errore", role: "alert" });
  const invia = h("button", { type: "submit", class: "bottone", testo: "Invia la risposta" });
  const scrivi = (testo) => { campo.value = testo; campo.dispatchEvent(new Event("input")); };
  const modulo = h("form", { class: "corpo", onsubmit: async (e) => {
    e.preventDefault();
    errore.textContent = "";
    invia.disabled = true;
    const esito = await p.rispondi(v.id, campo.value);
    invia.disabled = false;
    if (!esito.ok) { errore.textContent = testoErroreOperatore(esito.motivo); return; }
    mostraDaCopiare(p, v.email, campo.value);
  } },
  h("label", { for: `risposta-${i}`, testo: `Risposta a ${v.email || "questa persona"}` }), campo, conto, errore, invia);
  return h("div", {}, v.bozza ? riquadroBozza(p, v, i, { scrivi, campo, modulo, errore }) : null, modulo);
}

// Parte B (D122 B): la bozza dell'agente. Nessuna risposta parte senza un tocco qui. «Da gestire da Giuseppe» è una
// nota interna: niente «Invia così» né «Modifica e invia», solo «Scarta e scrivo io».
function riquadroBozza(p, v, i, { scrivi, campo, modulo, errore }) {
  const { bozza } = v;
  const riquadro = h("section", { class: "bozza", "aria-labelledby": `bozza-${i}` },
    h("h3", { id: `bozza-${i}`, testo: bozza.daGestire ? "Nota dell'agente (non inviare)" : "Bozza dell'agente" }),
    h("p", { class: "nota", testo: `Fonte: ${bozza.fonte}` }),
    bozza.istruzioni ? h("p", { testo: "Attenzione: testo con istruzioni all'agente. Controlla bene la bozza." }) : null,
    bozza.ferma ? h("p", { testo: "Bozza in attesa da più di 36 ore: la promessa è 48 ore." }) : null,
    h("p", { class: "racconto", testo: bozza.testo }));
  const azioni = h("div", { class: "azioni" },
    bozza.daGestire ? null : h("button", { type: "button", class: "bottone", testo: "Invia così", onclick: () => {
      scrivi(bozza.testo);
      modulo.requestSubmit();
    } }),
    bozza.daGestire ? null : h("button", { type: "button", class: "bottone-secondario", testo: "Modifica e invia", onclick: () => {
      scrivi(bozza.testo);
      campo.focus();
    } }),
    h("button", { type: "button", class: "bottone-secondario", testo: "Scarta e scrivo io", onclick: async () => {
      errore.textContent = "";
      const esito = await p.scarta(v.id);
      if (!esito.ok && esito.motivo !== "gia_tolta") { errore.textContent = testoErroreOperatore(esito.motivo); return; }
      riquadro.remove();
      scrivi("");
      campo.focus();
    } }));
  riquadro.append(azioni);
  return riquadro;
}

// D140 A: dopo il salvataggio la risposta va copiata in un'email dalla casella di Presente all'indirizzo mostrato.
function mostraDaCopiare(p, email, risposta) {
  const esito = h("p", { class: "nota", role: "status" });
  const copia = (testo, fatto) => async () => {
    const r = await copiaTesto(navigator.clipboard, testo);
    esito.textContent = r.ok ? fatto : testoErroreOperatore(r.motivo);
  };
  mostra(
    h("h1", { testo: "Risposta salvata" }),
    h("p", { testo: "La persona la vede in «I miei messaggi». Ora mandala anche per email dalla casella di Presente a:" }),
    h("p", { class: "email-risposta", testo: email || "indirizzo non disponibile" }),
    h("p", { class: "racconto", testo: risposta }),
    h("div", { class: "azioni" },
      email ? h("button", { type: "button", class: "bottone-secondario", onclick: copia(email, "Indirizzo copiato."), testo: "Copia indirizzo" }) : null,
      h("button", { type: "button", class: "bottone", onclick: copia(risposta, "Risposta copiata."), testo: "Copia risposta" }),
      h("button", { type: "button", class: "bottone-secondario", onclick: () => mostraCoda(p), testo: "Torna ai messaggi" })),
    esito,
  );
}

async function mostraCoda(p) {
  avvisa("");
  const r = await p.coda();
  if (!r.ok) {
    mostra(h("h1", { testo: TITOLO }), h("p", { testo: testoErroreOperatore(r.motivo) }),
      r.motivo === "accesso" ? h("p", {}, h("a", { href: "/app/", testo: "Vai all'app" })) : null);
    return;
  }
  // Le bozze sono un aiuto: se non arrivano, la coda si mostra lo stesso e si risponde a mano.
  const b = await p.bozze();
  const voci = unisciBozze(vociSupporto(r.messaggi, new Date()), b.ok ? b.bozze : [], new Date());
  const aperti = voci.filter((v) => !v.risposto).length;
  mostra(
    h("h1", { testo: TITOLO }),
    h("p", { class: "sottotitolo", testo: aperti ? `${aperti} senza risposta, prima quelli con parole di pericolo e i più vecchi.` : "Nessun messaggio senza risposta." }),
    h("ul", { class: "coda" }, voci.map((v, i) => h("li", { class: v.rossa ? "voce-coda voce-rossa" : "voce-coda" },
      h("h2", { testo: `${v.categoria} · ${v.stato}` }),
      h("p", { class: "nota", testo: [v.email, v.quando, v.resta].filter(Boolean).join(" · ") }),
      v.avviso ? h("p", { testo: v.avviso }) : null,
      h("p", { class: "racconto", testo: v.testo }),
      v.risposto ? null : moduloRisposta(p, v, i)))),
    h("div", { class: "azioni" }, h("button", { type: "button", class: "bottone-secondario", onclick: () => mostraCoda(p), testo: "Aggiorna" })),
  );
}

prepara().then((p) => {
  if (!p) { mostra(h("h1", { testo: TITOLO }), h("p", { testo: testoErroreOperatore("spento") })); return; }
  return mostraCoda(p);
});
