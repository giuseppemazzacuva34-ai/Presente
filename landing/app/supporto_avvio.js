// Pagina di chi risponde a «Scrivici» (issue #10, spec v1 del CPO, parte A) · linea «sviluppatore-c», passo 5b.
// Si entra con lo stesso accesso dell'app (/app/). Chi può leggere lo decide il database (ruolo «supporto»): qui la
// pagina mostra solo ciò che il Worker restituisce. Ogni testo entra con textContent, mai come HTML. La risposta
// salvata compare all'utente in «I miei messaggi».
import { creaAccesso } from "/app/moduli/accesso.js";
import { creaSupportoOperatore, vociSupporto, testoErroreOperatore, MASSIMO_RISPOSTA } from "/app/moduli/supporto_operatore.js";

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
  return h("form", { class: "corpo", onsubmit: async (e) => {
    e.preventDefault();
    errore.textContent = "";
    invia.disabled = true;
    const esito = await p.rispondi(v.id, campo.value);
    invia.disabled = false;
    if (!esito.ok) { errore.textContent = testoErroreOperatore(esito.motivo); return; }
    await mostraCoda(p);
    avvisa("Risposta salvata: la persona la vede in «I miei messaggi».");
  } },
  h("label", { for: `risposta-${i}`, testo: `Risposta a ${v.email || "questa persona"}` }), campo, conto, errore, invia);
}

async function mostraCoda(p) {
  avvisa("");
  const r = await p.coda();
  if (!r.ok) {
    mostra(h("h1", { testo: TITOLO }), h("p", { testo: testoErroreOperatore(r.motivo) }),
      r.motivo === "accesso" ? h("p", {}, h("a", { href: "/app/", testo: "Vai all'app" })) : null);
    return;
  }
  const voci = vociSupporto(r.messaggi, new Date());
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
