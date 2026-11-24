// Pannello dell'amministratore per il Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A) · linea
// «sviluppatore-c», passo 12d. Si entra con lo stesso accesso dell'app (/app/). Chi può usarlo lo decide il database
// (tabella moderatori): qui la pagina mostra solo ciò che il Worker restituisce. Ogni testo entra con textContent,
// mai come HTML. Il vocale non si scarica e non parte da solo (preload «none», nessuna partenza automatica).
import { creaAccesso } from "/app/moduli/accesso.js";
import { creaFiloAmministratore, vociStanzeFilo, testoErroreFilo, durataVocale } from "/app/moduli/filo_amministratore.js";

const radice = document.getElementById("filo-amministratore");
const stato = document.getElementById("stato");
const TITOLO = "Il Filo delle stanze";
const NOMI_TIPO = { lunedi: "del lunedì", domenica: "della domenica" };

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
    return creaFiloAmministratore({ token: () => accesso.token(), fetch: window.fetch.bind(window) });
  } catch {
    return null;
  }
}

function moduloAssegna(p, v, i) {
  const campo = h("input", { id: `email-${i}`, name: "email", type: "email", autocomplete: "off", required: true, maxlength: "254" });
  const errore = h("p", { class: "errore", role: "alert" });
  const invia = h("button", { type: "submit", class: "bottone", testo: v.conFilo ? "Cambia il Filo" : "Assegna il Filo" });
  return h("form", { class: "corpo", onsubmit: async (e) => {
    e.preventDefault();
    errore.textContent = "";
    invia.disabled = true;
    const esito = await p.assegna(v.stanza, campo.value);
    invia.disabled = false;
    if (!esito.ok) { errore.textContent = testoErroreFilo(esito.motivo); return; }
    avvisa("Filo assegnato.");
    mostraStanze(p, false);
  } },
  h("label", { for: `email-${i}`, testo: "Email dell'account del Filo" }), campo, errore, invia);
}

function bottoneTogliFilo(p, v) {
  const errore = h("p", { class: "errore", role: "alert" });
  const bottone = h("button", { type: "button", class: "bottone-secondario", testo: "Togli il Filo", onclick: async () => {
    if (!window.confirm(`Togliere il Filo da «${v.titolo}»? La stanza resta aperta, senza Filo.`)) return;
    errore.textContent = "";
    bottone.disabled = true;
    const esito = await p.togliFilo(v.stanza);
    bottone.disabled = false;
    if (!esito.ok) { errore.textContent = testoErroreFilo(esito.motivo); return; }
    avvisa(esito.tolto ? "Filo tolto." : "La stanza era già senza Filo.");
    mostraStanze(p, false);
  } });
  return h("div", {}, bottone, errore);
}

// «Ascolta»: chiede un link firmato di 5 minuti, mostra lettore, durata e testo; «Togli il vocale» con conferma.
function riquadroVocale(p, v, tipo, i) {
  const zona = h("div", { class: "vocale-filo" });
  const errore = h("p", { class: "errore", role: "alert" });
  const ascolta = h("button", { type: "button", class: "bottone-secondario", testo: `Ascolta il vocale ${NOMI_TIPO[tipo]}`, onclick: async () => {
    errore.textContent = "";
    ascolta.disabled = true;
    const r = await p.ascolta(v.stanza, tipo);
    ascolta.disabled = false;
    if (!r.ok) { errore.textContent = testoErroreFilo(r.motivo); return; }
    if (!r.vocale) { zona.replaceChildren(h("p", { class: "nota", testo: "Il vocale non c'è più." })); return; }
    const idTesto = `testo-${tipo}-${i}`;
    const lettore = h("audio", { controls: true, preload: "none", src: r.vocale.url, "aria-label": `Vocale ${NOMI_TIPO[tipo]} di ${v.titolo}` });
    const togli = h("button", { type: "button", class: "bottone-secondario", testo: "Togli il vocale", onclick: async () => {
      if (!window.confirm(`Togliere il vocale ${NOMI_TIPO[tipo]} di «${v.titolo}»? Il file si cancella e non torna.`)) return;
      errore.textContent = "";
      togli.disabled = true;
      const esito = await p.togliVocale(v.stanza, tipo, r.vocale.file);
      togli.disabled = false;
      if (!esito.ok) { errore.textContent = testoErroreFilo(esito.motivo); return; }
      avvisa(esito.tolto ? "Vocale tolto." : "Il vocale era già cambiato o tolto: ricarico l'elenco.");
      mostraStanze(p, false);
    } });
    zona.replaceChildren(
      lettore,
      h("p", { class: "nota", testo: `Durata ${durataVocale(r.vocale.durata) || "non nota"}` }),
      h("h4", { id: idTesto, testo: "Testo del vocale" }),
      h("p", { class: "racconto", "aria-labelledby": idTesto, testo: r.vocale.testo || "(senza testo)" }),
      h("div", { class: "azioni" }, togli),
    );
  } });
  return h("div", {}, ascolta, zona, errore);
}

async function mostraStanze(p, pulisci = true) {
  if (pulisci) avvisa("");
  const r = await p.stanze();
  if (!r.ok) {
    mostra(h("h1", { testo: TITOLO }), h("p", { testo: testoErroreFilo(r.motivo) }),
      r.motivo === "accesso" ? h("p", {}, h("a", { href: "/app/", testo: "Vai all'app" })) : null);
    return;
  }
  const voci = vociStanzeFilo(r.stanze, new Date());
  const avvisi = voci.filter((v) => v.rossa).length;
  mostra(
    h("h1", { testo: TITOLO }),
    h("p", { class: "sottotitolo", testo: !voci.length ? "Nessuna stanza aperta o in arrivo."
      : avvisi ? `${avvisi} ${avvisi === 1 ? "stanza" : "stanze"} senza vocale del lunedì, in cima.` : `${voci.length} ${voci.length === 1 ? "stanza" : "stanze"}, nessun avviso.` }),
    h("ul", { class: "coda" }, voci.map((v, i) => h("li", { class: v.rossa ? "voce-coda voce-rossa" : "voce-coda" },
      h("h2", { testo: v.titolo }),
      h("p", { class: "nota", testo: [v.periodo, v.membri].filter(Boolean).join(" · ") }),
      v.avviso ? h("p", { testo: v.avviso }) : null,
      h("p", { testo: v.filo }),
      h("p", { class: "nota", testo: v.vocali }),
      v.lunedi ? riquadroVocale(p, v, "lunedi", i) : null,
      v.domenica ? riquadroVocale(p, v, "domenica", i) : null,
      moduloAssegna(p, v, i),
      v.conFilo ? bottoneTogliFilo(p, v) : null))),
    h("div", { class: "azioni" }, h("button", { type: "button", class: "bottone-secondario", onclick: () => mostraStanze(p), testo: "Aggiorna" })),
  );
}

prepara().then((p) => {
  if (!p) { mostra(h("h1", { testo: TITOLO }), h("p", { testo: testoErroreFilo("spento") })); return; }
  return mostraStanze(p);
});
