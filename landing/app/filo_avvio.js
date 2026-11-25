// Pannello del Filo della stanza (issue #360, spec v1 + v1.1 del CPO, D151 A) · linea «sviluppatore-c», passo 13b.
// Si entra con lo stesso accesso dell'app (/app/). Chi è Filo e quali stanze segue lo decide il database: qui la pagina
// mostra solo ciò che il Worker restituisce (nomi di battesimo, regole, dalle 21:00 di domenica solo il numero delle
// porte). Il vocale si registra nel telefono, si riascolta (lettore che non parte da solo), si rifà e si carica col
// suo testo. Ogni testo entra con textContent, mai come HTML. L'audio registrato resta solo in memoria finché non si
// carica: dopo «Rifai» o «Carica» il link locale si libera.
import { creaAccesso } from "/app/moduli/accesso.js";
import { registra } from "/app/moduli/registratore.js";
import { creaPannelloFilo, vociPannelloFilo, controllaVocale, testoErrorePannelloFilo } from "/app/moduli/filo_pannello.js";

const radice = document.getElementById("filo");
const stato = document.getElementById("stato");
const TITOLO = "Le tue stanze";
const NOMI_TIPO = { lunedi: "Vocale del lunedì", domenica: "Vocale della domenica" };
const ERRORI_MICROFONO = {
  negato: "Per registrare serve il permesso del microfono.",
  silenzio: "Non si sente niente: controlla il microfono e riprova.",
  non_supportato: "Questo browser non registra l'audio: prova con un altro.",
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
const tempo = (s) => {
  const n = Math.max(0, Math.round(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};

async function prepara() {
  try {
    const config = await (await fetch("/app/config.json", { cache: "no-store" })).json();
    if (!config.pronta || config.accesso !== true) return null;
    let memoria = null;
    try { memoria = window.localStorage; } catch { memoria = null; }
    const accesso = creaAccesso({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey, fetch: window.fetch.bind(window), memoria });
    return creaPannelloFilo({ token: () => accesso.token(), fetch: window.fetch.bind(window) });
  } catch {
    return null;
  }
}

// Registra → (Ferma) → riascolta, Rifai → testo del vocale → Carica.
function riquadroVocale(p, v, i) {
  const { tipo, massimo } = v.finestra;
  const idTesto = `testo-${i}`, idConta = `conta-${i}`;
  let registrato = null, inCorso = null;
  const tempoEl = h("p", { class: "nota", testo: `Da 10 secondi a ${tempo(massimo)}.` });
  const zonaAscolto = h("div", { class: "vocale-filo" });
  const errore = h("p", { class: "errore", role: "alert" });
  const testo = h("textarea", { id: idTesto, name: "testo", rows: "5", maxlength: "900", required: true, "aria-describedby": idConta });
  const conta = h("p", { id: idConta, class: "nota", testo: "0 / 900" });
  testo.addEventListener("input", () => { conta.textContent = `${[...testo.value].length} / 900`; });

  const libera = () => {
    if (registrato) URL.revokeObjectURL(registrato.url);
    registrato = null;
    zonaAscolto.replaceChildren();
    rifai.hidden = true;
    carica.disabled = true;
  };
  const registraBtn = h("button", { type: "button", class: "bottone", testo: "Registra", onclick: async () => {
    errore.textContent = "";
    if (inCorso) { inCorso.ferma(); return; }
    libera();
    registraBtn.textContent = "Ferma";
    inCorso = await registra(massimo, (s) => { tempoEl.textContent = `${tempo(s)} / ${tempo(massimo)}`; });
    const esito = await inCorso.finita;
    inCorso = null;
    registraBtn.textContent = "Registra";
    if (esito.errore) {
      errore.textContent = ERRORI_MICROFONO[esito.errore] || testoErrorePannelloFilo(esito.errore === "breve" ? "breve" : "riprova");
      return;
    }
    registrato = esito;
    const breve = controllaVocale({ tipo, secondi: esito.secondi, testo: "x" });
    if (breve) errore.textContent = testoErrorePannelloFilo(breve);
    zonaAscolto.replaceChildren(
      h("audio", { controls: true, preload: "none", src: esito.url, "aria-label": `Riascolta: ${NOMI_TIPO[tipo]}` }),
      h("p", { class: "nota", testo: `Durata ${tempo(esito.secondi)}` }),
    );
    rifai.hidden = false;
    carica.disabled = Boolean(breve);
  } });
  const rifai = h("button", { type: "button", class: "bottone-secondario", testo: "Rifai", hidden: true, onclick: () => {
    errore.textContent = "";
    libera();
    tempoEl.textContent = `Da 10 secondi a ${tempo(massimo)}.`;
    registraBtn.focus();
  } });
  const carica = h("button", { type: "submit", class: "bottone", testo: "Carica", disabled: true });

  const modulo = h("form", { class: "corpo", onsubmit: async (e) => {
    e.preventDefault();
    if (!registrato) return;
    errore.textContent = "";
    carica.disabled = true;
    const esito = await p.carica({ stanza: v.id, tipo, secondi: registrato.secondi, testo: testo.value, audio: registrato.blob });
    if (!esito.ok) { carica.disabled = false; errore.textContent = testoErrorePannelloFilo(esito.motivo); return; }
    libera();
    testo.value = "";
    conta.textContent = "0 / 900";
    tempoEl.textContent = `Da 10 secondi a ${tempo(massimo)}.`;
    avvisa(`${NOMI_TIPO[tipo]} caricato: lo sentirà chi è nella stanza.`);
  } },
  h("h3", { testo: NOMI_TIPO[tipo] }),
  h("p", { class: "nota", testo: v.finestra.nota }),
  h("div", { class: "azioni" }, registraBtn, rifai),
  tempoEl, zonaAscolto,
  h("label", { for: idTesto, testo: "Testo del vocale" }),
  h("p", { class: "nota", testo: "Quello che dici, per chi non può ascoltare." }),
  testo, conta, errore,
  h("div", { class: "azioni" }, carica));
  return modulo;
}

async function mostraStanze(p, pulisci = true) {
  if (pulisci) avvisa("");
  const r = await p.stanze();
  if (!r.ok) {
    mostra(h("h1", { testo: TITOLO }), h("p", { testo: testoErrorePannelloFilo(r.motivo) }),
      r.motivo === "accesso" ? h("p", {}, h("a", { href: "/app/", testo: "Vai all'app" })) : null);
    return;
  }
  const voci = vociPannelloFilo(r, new Date());
  mostra(
    h("h1", { testo: TITOLO }),
    h("p", { class: "sottotitolo", testo: voci.length ? "Il Filo della stanza: due vocali a settimana, il lunedì e la domenica."
      : "Per ora non segui nessuna stanza." }),
    h("ul", { class: "coda" }, voci.map((v, i) => h("li", { class: "voce-coda" },
      h("h2", { testo: v.titolo }),
      h("p", { class: "nota", testo: [v.periodo, v.persone].filter(Boolean).join(" · ") }),
      v.porte ? h("p", { class: "numero-porte", testo: v.porte }) : null,
      h("h3", { testo: "Vi presento" }),
      v.nomi.length ? h("ul", { class: "nomi-filo" }, v.nomi.map((n) => h("li", { testo: n }))) : h("p", { class: "nota", testo: "Ancora nessuno." }),
      r.regole ? h("p", { class: "nota", testo: r.regole }) : null,
      v.finestra.tipo ? riquadroVocale(p, v, i) : h("p", { class: "nota", testo: v.finestra.nota })))),
    h("div", { class: "azioni" }, h("button", { type: "button", class: "bottone-secondario", onclick: () => mostraStanze(p), testo: "Aggiorna" })),
  );
}

prepara().then((p) => {
  if (!p) { mostra(h("h1", { testo: TITOLO }), h("p", { testo: testoErrorePannelloFilo("spento") })); return; }
  return mostraStanze(p);
});
