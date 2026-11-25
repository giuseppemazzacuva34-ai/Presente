// API finte della prova (/app/prova.html, D141 A): saldo, regali, Filo e stanza viva con persone e numeri inventati.
// Richiesta del coordinatore del 25/11 (punto 7): la prova deve mostrare anche saldo, profilo (23), crediti (13),
// regali (26-28), Filo (18, 36) e stanza viva (19). Niente rete: risponde solo in memoria, ricaricando si riparte.
// Le forme delle risposte sono quelle dei Worker veri (coin_api, regali, filo_api, appuntamenti_api): le controllano i
// moduli dell'app stessi (test/prova_api.test.mjs).
import { PERSONE_PROVA } from "./prova.js";
import { creaCoinServer, creaSaldo, collegaSaldo } from "./saldo_coin.js";
import { aggiornaTestata } from "./testata.js";
import { creaRegali } from "./regali.js";
import { creaRegaliStanza } from "./regali_stanza.js";
import { creaStoricoRegali } from "./storico_regali.js";
import { creaFiloDomenica } from "./filo_domenica.js";
import { creaFiloLunedi } from "./filo_lunedi.js";
import { creaFiloRiascolto } from "./filo_riascolto.js";
import { creaStanzaViva } from "./appuntamenti_stanza.js";

// Saldo inventato: abbastanza per una stanza e qualche regalo.
export const SALDO_PROVA = 120;
const PREZZI = Object.freeze({ rosa: 5, spumante: 10, fiori: 20 });

const json = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });

export function creaApiProva() {
  const mondo = { saldo: SALDO_PROVA, filoVisto: false };
  const p = (i) => PERSONE_PROVA[i % PERSONE_PROVA.length];

  // Schermata 28: un regalo da due persone finte di questa stanza, nessuna stanza passata.
  const storico = () => ({ ok: true, titolo: "Hai ricevuto 3 regali", totale: { rosa: 2, spumante: 1, fiori: 0 },
    attuale: { citta: "Milano", persone: [{ nome: p(1).nome, dettaglio: "2 rose", quando: "ieri" },
      { nome: p(3).nome, dettaglio: "1 spumante", quando: "oggi" }] },
    passate: null });

  // Schermata 19: stati veri di presenza (online, in chiamata con…, non in linea · da …).
  const NON_IN_LINEA = ["non in linea · da poco", "non in linea · da 3 h", "non in linea · da ieri"];
  const presenza = () => ({ ok: true, persone: PERSONE_PROVA.map((x, i) => (i % 4 === 0 ? { id: x.id, stato: "online", testo: "online" }
    : i % 4 === 1 ? { id: x.id, stato: "in_chiamata", testo: "in chiamata", con: p(i + 1).id }
      : { id: x.id, stato: "non_in_linea", testo: NON_IN_LINEA[i % NON_IN_LINEA.length] })) });

  async function rispondi(percorso, metodo, corpo) {
    const url = new URL(percorso, "https://prova.invalid");
    const via = url.pathname;
    if (via === "/app/api/coin" && metodo === "GET") return json(200, { ok: true, saldo: mondo.saldo, primaStanzaUsata: false, pagamenti: false });
    if (via === "/app/api/regali/storico" && metodo === "GET") return json(200, storico());
    if (via === "/app/api/regali" && metodo === "GET") {
      return json(200, url.searchParams.has("da") ? { ok: true, testo: null } : { ok: true, saldo: mondo.saldo, avvisi: [] });
    }
    if (via === "/app/api/regali" && metodo === "POST") {
      if (corpo.azione === "visti") return json(200, { ok: true });
      const costo = PREZZI[corpo.regalo];
      if (corpo.azione !== "manda" || !costo || !PERSONE_PROVA.some((x) => x.id === corpo.a)) return json(400, { ok: false, motivo: "richiesta" });
      if (mondo.saldo < costo) return json(200, { ok: false, motivo: "saldo", testo: "Non hai abbastanza crediti." });
      mondo.saldo -= costo;
      return json(200, { ok: true, saldo: mondo.saldo });
    }
    if (via === "/app/api/filo/benvenuto") {
      if (metodo === "POST") { mondo.filoVisto = true; return json(200, { ok: true }); }
      return json(200, { ok: true, benvenuto: mondo.filoVisto ? null : { visto: false, stanza: "prova", filo: "Il Filo" } });
    }
    if (via === "/app/api/filo/porte" && metodo === "GET") return json(200, { ok: true, porte: { numero: 3 } });
    // Nessun vocale del Filo nella prova: la scheda del vocale non compare.
    if (via === "/app/api/filo/ascolta" || via === "/app/api/filo/riascolto") return json(404, { ok: false, motivo: "nessuno" });
    if (via === "/app/api/stanza/presenza") return json(200, metodo === "POST" ? { ok: true } : presenza());
    if (via === "/app/api/stanza/appuntamenti") {
      if (metodo === "GET") return json(200, url.searchParams.has("con") ? { ok: true, ore: [] } : { ok: true, appuntamenti: [] });
      return json(200, { ok: false, motivo: "prova", testo: "Nella prova gli appuntamenti non si fissano." });
    }
    return json(404, { ok: false, motivo: "non_trovato" });
  }

  return {
    async fetch(percorso, { method = "GET", body } = {}) {
      let corpo = {};
      try { corpo = body ? JSON.parse(body) : {}; } catch { corpo = {}; }
      return rispondi(String(percorso), method.toUpperCase(), corpo);
    },
  };
}

// I moduli veri dell'app collegati alle API finte, da aggiungere alle opzioni della prova; il saldo finto va nella
// testata (in alto a sinistra) come nell'app vera. pagina = document; contenitore = .pagina.app.
export function moduliProva({ pagina, contenitore, aggiorna = {} } = {}) {
  const api = creaApiProva();
  const token = () => "prova";
  const finto = api.fetch;
  const fai = (nome) => () => { if (typeof aggiorna[nome] === "function") aggiorna[nome](); };
  if (pagina) {
    collegaSaldo({ saldo: creaSaldo({ coin: creaCoinServer({ token, fetch: finto }), testata: (dati) => aggiornaTestata(pagina, dati) }),
      pagina });
  }
  return {
    coinProfilo: creaCoinServer({ token, fetch: finto }),
    storicoRegali: creaStoricoRegali({ token, fetch: finto }),
    regali: contenitore ? creaRegaliStanza({ regali: creaRegali({ token, fetch: finto }), contenitore, aggiorna: fai("regali") }) : null,
    filoDomenica: creaFiloDomenica({ token, fetch: finto, aggiorna: fai("chiavi") }),
    filoLunedi: creaFiloLunedi({ token, fetch: finto, aggiorna: fai("filo") }),
    filoRiascolto: creaFiloRiascolto({ token, fetch: finto, aggiorna: fai("filo") }),
    stanzaViva: creaStanzaViva({ token, fetch: finto }),
  };
}
