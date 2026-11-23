// «I tuoi regali» (schermata 28 del design v4, issue #349; regole dei regali #331). Linea «sviluppatore-b», passo 3.
// Legge GET /app/api/regali/storico (worker/storico_regali_api.js): chi chiede lo dice solo il token; arrivano già le
// frasi della schermata, mai id di persone, delle stanze passate solo numeri. Struttura come nel prototipo
// (#storico-regali): etichetta, titolo con il numero in corsivo, tre conteggi con icona, «Questa stanza», «Stanze
// passate», un solo pulsante «Torna al profilo». Niente salvataggi locali, niente log. Il modulo non tocca la pagina.

const PERCORSO = "/app/api/regali/storico";
const TIPI = [["rosa", "Rose"], ["spumante", "Spumante"], ["fiori", "Fiori"]];

export const TESTI_STORICO = Object.freeze({
  etichetta: "Il tuo profilo · regali ricevuti",
  questaStanza: "Questa stanza",
  stanzePassate: "Stanze passate",
  torna: "Torna al profilo",
  link: "I tuoi regali",
  carica: "Un attimo…",
});

const intero = (n) => Number.isInteger(n) && n >= 0;
const frase = (s) => typeof s === "string";
function valida(c) {
  if (!c || typeof c !== "object" || !frase(c.titolo) || !c.totale || !TIPI.every(([t]) => intero(c.totale[t]))) return false;
  const a = c.attuale;
  if (a !== null && (typeof a !== "object" || !frase(a.citta) || !Array.isArray(a.persone)
    || !a.persone.every((p) => p && frase(p.nome) && frase(p.dettaglio) && frase(p.quando)))) return false;
  const p = c.passate;
  return p === null || (typeof p === "object" && intero(p.stanze) && frase(p.persone) && frase(p.dettaglio));
}

export function creaStoricoRegali({ token, fetch: f = globalThis.fetch }) {
  return {
    // { ok: true, vista } oppure { ok: false, motivo: "accesso" | "rete" | "lettura" }.
    async leggi() {
      const t = await Promise.resolve().then(token).catch(() => null);
      if (!t) return { ok: false, motivo: "accesso" };
      let r;
      try {
        r = await f(PERCORSO, { method: "GET", headers: { authorization: `Bearer ${t}` } });
      } catch {
        return { ok: false, motivo: "rete" };
      }
      if (r.status === 401) return { ok: false, motivo: "accesso" };
      if (!r.ok) return { ok: false, motivo: "lettura" };
      let c;
      try { c = await r.json(); } catch { return { ok: false, motivo: "lettura" }; }
      if (!c || c.ok !== true || !valida(c)) return { ok: false, motivo: "lettura" };
      return { ok: true, vista: { titolo: c.titolo, totale: c.totale, attuale: c.attuale, passate: c.passate } };
    },
  };
}

function titolo(h, t) {
  const m = /^(Hai ricevuto) (.+)$/.exec(t);
  return m ? h("h2", {}, m[1], h("br", {}), h("em", {}, m[2])) : h("h2", {}, t);
}

const riga = (h, nome, dettaglio, destra) =>
  h("div", { classe: "persona" }, h("div", {}, h("b", {}, nome), h("small", {}, dettaglio)), h("span", { classe: "nota" }, destra));

export function vistaStoricoRegali(h, v, { torna }) {
  const ricevuti = TIPI.reduce((s, [t]) => s + v.totale[t], 0) > 0;
  return h("div", { classe: "storico-regali" },
    h("div", { classe: "corpo" },
      h("div", { classe: "passo" }, TESTI_STORICO.etichetta),
      titolo(h, v.titolo),
      ricevuti ? h("div", { classe: "conteggi" }, TIPI.map(([t, nome]) =>
        h("div", {}, h("span", { classe: `regalo-icona regalo-${t}`, "aria-hidden": "true" }), h("b", {}, String(v.totale[t])), h("span", {}, nome)))) : null,
      v.attuale ? [
        h("div", { classe: "lista-t" }, h("span", {}, TESTI_STORICO.questaStanza), h("span", {}, v.attuale.citta)),
        v.attuale.persone.map((p) => riga(h, p.nome, p.dettaglio, p.quando)),
      ] : null,
      v.passate ? [
        h("div", { classe: "lista-t" }, h("span", {}, TESTI_STORICO.stanzePassate), h("span", {}, String(v.passate.stanze))),
        riga(h, v.passate.persone, v.passate.dettaglio, ""),
      ] : null),
    h("div", { classe: "azioni" }, h("button", { classe: "bottone-secondario", type: "button", onclick: torna }, TESTI_STORICO.torna)));
}

// Passo 4: la schermata aperta dal profilo. Tiene solo lo stato della schermata (aperta, in lettura, vista o errore);
// il flusso la disegna a tutta pagina e la richiude con «Torna al profilo». Gli errori usano i messaggi del flusso.
export function creaSchermoRegali({ storico, disegna, errore }) {
  const st = { aperto: false, carica: false, vista: null, errore: "", giro: 0 };
  const chiudi = () => { Object.assign(st, { aperto: false, carica: false, vista: null, errore: "" }); st.giro++; disegna(); };
  return {
    aperto: () => st.aperto,
    async apri() {
      const giro = ++st.giro;
      Object.assign(st, { aperto: true, carica: true, vista: null, errore: "" });
      disegna();
      const r = await Promise.resolve().then(() => storico.leggi()).catch(() => ({ ok: false, motivo: "rete" }));
      if (giro !== st.giro || !st.aperto) return;
      st.carica = false;
      if (r && r.ok) st.vista = r.vista; else st.errore = errore((r && r.motivo) || "rete");
      disegna();
    },
    schermo(h) {
      const contenuto = st.vista ? vistaStoricoRegali(h, st.vista, { torna: chiudi })
        : h("div", { classe: "storico-regali" },
          h("div", { classe: "corpo" },
            h("div", { classe: "passo" }, TESTI_STORICO.etichetta),
            st.carica ? h("p", { classe: "nota", role: "status" }, TESTI_STORICO.carica) : h("p", { classe: "errore", role: "alert" }, st.errore)),
          h("div", { classe: "azioni" }, h("button", { classe: "bottone-secondario", type: "button", onclick: chiudi }, TESTI_STORICO.torna)));
      return h("section", { classe: "schermata", "aria-label": TESTI_STORICO.link }, contenuto);
    },
  };
}
