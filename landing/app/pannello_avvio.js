// Pagina del pannello di chi decide (issue #7, «Cosa vede chi decide»; D51 A) · linea «sviluppatore-b», passo 13c.
// Si entra con lo stesso accesso dell'app (/app/). Chi decide lo controlla il Worker (tabella moderatori): qui la
// pagina mostra solo ciò che il Worker restituisce. Ogni testo entra con textContent, mai come HTML.
import { creaAccesso } from "/app/moduli/accesso.js";
import { creaPannello, vociCoda, schedaLeggibile, AZIONI_PANNELLO, REGOLE_PANNELLO, vociRicorsi, ESITI_RICORSO_PANNELLO }
  from "/app/moduli/pannello.js";

const radice = document.getElementById("pannello");
const stato = document.getElementById("stato");
const MESSAGGI = {
  accesso: "Entra prima nell'app con il tuo account, poi torna su questa pagina.",
  non_moderatore: "Questo account non può vedere le segnalazioni.",
  rete: "Connessione assente. Riprova tra poco.",
  riprova: "Qualcosa non ha funzionato. Riprova tra poco.",
  rifiutata: "Decisione non salvata: la segnalazione è già decisa o non c'è più una persona da sanzionare.",
  regola: "Scegli la regola violata.",
  testo: "Scrivi il motivo della decisione (massimo 2000 caratteri).",
  spento: "Il pannello non è ancora attivo.",
  rifiutata_ricorso: "Decisione non salvata: il ricorso è già deciso, oppure la sanzione l'hai data tu (decide un'altra persona).",
  seconda_volta_contatti: "Decisione non salvata: è la seconda volta in 6 mesi che chiede contatti prima della porta. Scegli «Sospensione 7 giorni».",
};

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
function elenco(titolo, righe, vuoto) {
  return [h("h2", { testo: titolo }), righe.length ? h("ul", {}, righe.map((r) => h("li", { testo: r }))) : h("p", { class: "nota", testo: vuoto })];
}

async function preparaPannello() {
  try {
    const config = await (await fetch("/app/config.json", { cache: "no-store" })).json();
    if (!config.pronta || config.accesso !== true) return null;
    let memoria = null;
    try { memoria = window.localStorage; } catch { memoria = null; }
    const accesso = creaAccesso({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey, fetch: window.fetch.bind(window), memoria });
    return creaPannello({ token: () => accesso.token(), fetch: window.fetch.bind(window) });
  } catch {
    return null;
  }
}

async function mostraCoda(p) {
  avvisa("");
  const r = await p.coda();
  if (!r.ok) {
    mostra(h("h1", { testo: "Pannello delle segnalazioni" }), h("p", { testo: MESSAGGI[r.motivo] || MESSAGGI.riprova }),
      r.motivo === "accesso" ? h("p", {}, h("a", { href: "/app/", testo: "Vai all'app" })) : null);
    return;
  }
  const voci = vociCoda(r.coda, new Date());
  mostra(
    h("h1", { testo: "Segnalazioni aperte" }),
    h("p", { class: "sottotitolo", testo: voci.length ? `${voci.length} da decidere, prima le più urgenti.` : "Nessuna segnalazione da decidere." }),
    h("ul", { class: "coda" }, voci.map((v) => h("li", { class: v.rossa ? "voce-coda voce-rossa" : "voce-coda" },
      h("button", { type: "button", class: "bottone-secondario", onclick: () => mostraScheda(p, v.id) },
        h("strong", { testo: v.motivo }),
        h("span", { testo: ` · ${v.priorita} · ${v.resta}${v.rossa ? " · urgente" : ""}` })),
      h("p", { class: "nota", testo: [v.chi, ...v.note].join(" · ") })))),
    h("div", { class: "azioni" },
      h("button", { type: "button", class: "bottone-secondario", onclick: () => mostraCoda(p), testo: "Aggiorna" }),
      h("button", { type: "button", class: "bottone-secondario", onclick: () => mostraRicorsi(p), testo: "Ricorsi in attesa" })),
  );
}

// Ricorsi in attesa (spec «Ricorso», passo 13f): accolto annulla subito la sanzione, respinto la lascia.
// Chi ha dato la sanzione vede il ricorso ma non il modulo: decide un'altra persona.
async function mostraRicorsi(p) {
  avvisa("");
  const r = await p.ricorsi();
  if (!r.ok) { avvisa(MESSAGGI[r.motivo] || MESSAGGI.riprova); return; }
  const voci = vociRicorsi(r.ricorsi, new Date());
  mostra(
    h("h1", { testo: "Ricorsi in attesa" }),
    h("p", { class: "sottotitolo", testo: voci.length ? `${voci.length} da decidere, prima quelli con la risposta più vicina.` : "Nessun ricorso da decidere." }),
    h("ul", { class: "coda" }, voci.map((v, i) => h("li", { class: v.rossa ? "voce-coda voce-rossa" : "voce-coda" },
      h("h2", { testo: v.titolo }),
      h("p", { class: "nota", testo: `Inviato il ${v.inviato} · ${v.resta}${v.rossa ? " · urgente" : ""}` }),
      h("p", { testo: `Motivo della sanzione: ${v.motivoSanzione || "non indicato"}` }),
      h("p", { class: "racconto", testo: `Perché la contesta: ${v.perche}` }),
      v.puoiDecidere ? moduloRicorso(p, v, i) : h("p", { class: "nota", testo: "La sanzione l'hai data tu: questo ricorso lo decide un'altra persona." })))),
    h("div", { class: "azioni" },
      h("button", { type: "button", class: "bottone-secondario", onclick: () => mostraCoda(p), testo: "Torna alle segnalazioni" }),
      h("button", { type: "button", class: "bottone-secondario", onclick: () => mostraRicorsi(p), testo: "Aggiorna" })),
  );
}

function moduloRicorso(p, v, i) {
  const esito = h("select", { id: `esito-${i}`, name: "esito" }, ESITI_RICORSO_PANNELLO.map(([e, t]) => h("option", { value: e, testo: t })));
  const motivo = h("textarea", { id: `motivo-ricorso-${i}`, name: "motivo", rows: "3", maxlength: "2000", required: true });
  const errore = h("p", { class: "errore", role: "alert" });
  const invia = h("button", { type: "submit", class: "bottone", testo: "Conferma la decisione sul ricorso" });
  return h("form", { class: "corpo", onsubmit: async (e) => {
    e.preventDefault();
    invia.disabled = true;
    const fatto = await p.decidiRicorso({ id: v.id, esito: esito.value, testo: motivo.value });
    invia.disabled = false;
    if (!fatto.ok) {
      errore.textContent = fatto.motivo === "rifiutata" ? MESSAGGI.rifiutata_ricorso : MESSAGGI[fatto.motivo] || MESSAGGI.riprova;
      return;
    }
    await mostraRicorsi(p);
    avvisa("Decisione sul ricorso salvata e scritta nel registro.");
  } },
  h("label", { for: `esito-${i}`, testo: "Decisione" }), esito,
  h("label", { for: `motivo-ricorso-${i}`, testo: "Motivo (obbligatorio, resta nel registro)" }), motivo,
  errore, invia);
}

async function mostraScheda(p, id) {
  avvisa("");
  const r = await p.scheda(id);
  const s = r.ok ? schedaLeggibile(r.scheda) : null;
  if (!s) { avvisa(MESSAGGI[r.motivo] || MESSAGGI.riprova); return; }
  const azioni = s.sanzionabile ? AZIONI_PANNELLO : AZIONI_PANNELLO.filter(([a]) => a === "archivia" || a === "togli_cautelare");
  const scelta = h("select", { id: "azione", name: "azione" }, azioni.map(([v, t]) => h("option", { value: v, testo: t })));
  const regola = h("select", { id: "regola", name: "regola" }, h("option", { value: "", testo: "Scegli la regola…" }),
    REGOLE_PANNELLO.map((t) => h("option", { value: t, testo: t })));
  const motivo = h("textarea", { id: "motivo", name: "motivo", rows: "4", maxlength: "2000", required: true });
  const errore = h("p", { class: "errore", role: "alert" });
  const invia = h("button", { type: "submit", class: "bottone", testo: "Conferma la decisione" });
  const modulo = h("form", { class: "corpo", onsubmit: async (e) => {
    e.preventDefault();
    invia.disabled = true;
    const esito = await p.decidi({ id: s.id, azione: scelta.value, regola: regola.value, testo: motivo.value });
    invia.disabled = false;
    if (!esito.ok) { errore.textContent = MESSAGGI[esito.motivo] || MESSAGGI.riprova; return; }
    await mostraCoda(p);
    avvisa("Decisione salvata e scritta nel registro.");
  } },
  h("label", { for: "azione", testo: "Decisione" }), scelta,
  h("label", { for: "regola", testo: "Regola violata (non serve per «Archivia» e «Togli sospensione cautelare»)" }), regola,
  h("label", { for: "motivo", testo: "Motivo (obbligatorio, resta nel registro)" }), motivo,
  errore,
  h("div", { class: "azioni" },
    h("button", { type: "button", class: "bottone-secondario", onclick: () => mostraCoda(p), testo: "Torna all'elenco" }), invia));
  mostra(
    h("h1", { testo: s.titolo }),
    h("p", { class: "sottotitolo", testo: `${s.chi} · ${s.quando}` }),
    h("h2", { testo: "Racconto" }), h("p", { class: "racconto", testo: s.testo || "Nessun racconto." }),
    ...elenco("Chiamate tra i due", s.chiamate, "Nessuna chiamata negli ultimi 6 mesi."),
    ...elenco("Porte e svelamento", s.porte, "Nessuna porta tra i due."),
    ...elenco("Storico della persona segnalata (6 mesi)", s.storico, "Nessuna segnalazione o sanzione precedente."),
    h("h2", { testo: "Decidi" }), modulo,
  );
}

preparaPannello().then((p) => {
  if (!p) { mostra(h("h1", { testo: "Pannello delle segnalazioni" }), h("p", { testo: MESSAGGI.spento })); return; }
  return mostraCoda(p);
});
