// «Il profilo» (schermata 23 del design v4, issue #349; prototipo #n16). Linea «sviluppatore-b», passo 1: dati e vista.
// Si apre dal cerchio in alto a destra della testata. Qui si modificano voce, risposte, foto e preferenze; in fondo
// «Elimina il mio account», che sta solo qui. Il modulo non tocca la pagina e non chiama la rete: il flusso gli passa
// i dati che ha già (nome, età, città visibile, voce) e quelli del server (saldo e numero dei regali). Se un numero
// manca, non si mostra: mai numeri inventati. In beta i crediti sono un contatore interno: «Ricarica» si accende solo
// per aprire la schermata 13 (passo 3, dove «Paga» resta spento, come dalla 21). Niente salvataggi locali, niente log.

export const TESTI_PROFILO = Object.freeze({
  voce: "La tua voce",
  unita: "crediti",
  unitaUno: "credito",
  ricarica: "Ricarica",
  risposte: "Le tre risposte a voce",
  regali: "Regali ricevuti",
  foto: "Le tue foto (nascoste)",
  preferenze: "Chi cerchi · Notifiche · Privacy",
  elimina: "Elimina il mio account",
  tornaStanza: "Torna alla stanza",
  tornaHome: "Torna alla home",
  pausa: "Pausa",
});
const T = TESTI_PROFILO;

const intero = (n) => Number.isInteger(n) && n >= 0;
const frase = (s) => (typeof s === "string" && s.trim() ? s.trim() : null);

export function statoProfilo({ nome = "", eta = null, citta = "", voce = null, saldo = null, regali = null, inStanza = false } = {}) {
  const n = frase(nome) || "";
  const url = voce && frase(voce.url);
  const secondi = voce && Number.isFinite(voce.secondi) && voce.secondi > 0 ? Math.round(voce.secondi) : null;
  return {
    titolo: intero(eta) ? `${n}, ${eta}` : n,
    citta: frase(citta),
    voce: url ? { url, testo: secondi ? `${T.voce} · ${secondi} s` : T.voce } : null,
    saldo: intero(saldo) ? { numero: String(saldo), unita: saldo === 1 ? T.unitaUno : T.unita, ricarica: T.ricarica, attivo: false } : null,
    regali: intero(regali) ? `${T.regali} · ${regali}` : T.regali,
    torna: inStanza ? T.tornaStanza : T.tornaHome,
  };
}

// Pulsante della voce: suona dall'<audio> senza i comandi del browser (come «Riascolta» nella schermata 08).
function pulsanteVoce(h, voce) {
  const audio = h("audio", { src: voce.url, preload: "metadata" });
  const etichetta = `▶ ${voce.testo}`;
  const b = h("button", { classe: "bottone-secondario", type: "button", "aria-pressed": "false",
    onclick: () => { if (audio.paused) { audio.currentTime = 0; audio.play().catch(() => {}); } else audio.pause(); } }, etichetta);
  if (typeof audio.addEventListener === "function") {
    audio.addEventListener("play", () => { b.textContent = T.pausa; b.setAttribute("aria-pressed", "true"); });
    const fermo = () => { b.textContent = etichetta; b.setAttribute("aria-pressed", "false"); };
    audio.addEventListener("pause", fermo);
    audio.addEventListener("ended", fermo);
  }
  return [audio, b];
}

const riga = (h, testo, azione) => (typeof azione === "function"
  ? h("button", { classe: "voce-profilo", type: "button", onclick: azione }, testo, h("span", { classe: "freccia", "aria-hidden": "true" }, "›"))
  : null);

// s = statoProfilo(...). Azioni: risposte, regali, foto, preferenze, elimina, torna, ricarica (apre la schermata 13);
// onda = l'onda grande del flusso.
export function vistaProfilo(h, s, { risposte, regali, foto, preferenze, elimina, torna, ricarica = null, onda = null, errore = null } = {}) {
  return h("section", { classe: "schermata profilo", "aria-labelledby": "profilo-titolo" },
    h("div", { classe: "corpo" },
      h("h2", { id: "profilo-titolo" }, s.titolo, s.citta ? [h("br"), h("em", {}, s.citta)] : null),
      s.voce ? h("div", { classe: "rec" }, onda, pulsanteVoce(h, s.voce)) : null,
      s.saldo ? h("div", { classe: "pacco" },
        h("div", { classe: "q" }, s.saldo.numero, h("small", {}, s.saldo.unita)),
        typeof ricarica === "function"
          ? h("button", { classe: "bottone", type: "button", disabled: false, onclick: ricarica }, s.saldo.ricarica)
          : h("button", { classe: "bottone", type: "button", disabled: !s.saldo.attivo }, s.saldo.ricarica)) : null,
      riga(h, T.risposte, risposte),
      riga(h, s.regali, regali),
      riga(h, T.foto, foto),
      riga(h, T.preferenze, preferenze),
      typeof errore === "string" && errore ? h("p", { classe: "errore", role: "alert" }, errore) : null,
      typeof elimina === "function" ? h("button", { classe: "link rosso", type: "button", onclick: elimina }, T.elimina) : null),
    h("div", { classe: "azioni" }, h("button", { classe: "bottone", type: "button", onclick: torna }, s.torna)));
}

// Passo 2: la schermata aperta dal cerchio. Tiene solo lo stato (aperta o no) e i due numeri letti dal server
// all'apertura: saldo (coin.saldo() di saldo_coin.js) e regali ricevuti (somma di storico.leggi() di storico_regali.js).
// Se una lettura non va, quel numero resta vuoto. Una lettura arrivata dopo la chiusura non cambia niente.
const somma = (t) => (t && ["rosa", "spumante", "fiori"].every((k) => intero(t[k])) ? t.rosa + t.spumante + t.fiori : null);
export function creaSchermoProfilo({ coin = null, storico = null, disegna = () => {} } = {}) {
  const st = { aperto: false, saldo: null, regali: null, primaStanzaUsata: null, giro: 0 };
  const leggi = async (fonte, metodo) => {
    if (!fonte) return null;
    try { return await fonte[metodo](); } catch { return null; }
  };
  return {
    aperto: () => st.aperto,
    dati: () => ({ saldo: st.saldo, regali: st.regali }),
    primaStanzaUsata: () => st.primaStanzaUsata, // true/false dal server; null se non si sa

    async apri() {
      const giro = ++st.giro;
      Object.assign(st, { aperto: true, saldo: null, regali: null, primaStanzaUsata: null });
      disegna();
      const [c, r] = await Promise.all([leggi(coin, "saldo"), leggi(storico, "leggi")]);
      if (giro !== st.giro || !st.aperto) return;
      st.saldo = c && c.ok === true && intero(c.saldo) ? c.saldo : null;
      st.primaStanzaUsata = st.saldo !== null && typeof c.primaStanzaUsata === "boolean" ? c.primaStanzaUsata : null;
      st.regali = r && r.ok === true && r.vista ? somma(r.vista.totale) : null;
      disegna();
    },
    chiudi() {
      st.giro++;
      Object.assign(st, { aperto: false, saldo: null, regali: null, primaStanzaUsata: null });
      disegna();
    },
  };
}

// Il cerchio della testata (#apri-profilo, base comune di testata.js): l'iniziale e il clic che apre il profilo.
// Compare solo con un nome e un'azione (cioè nella home a profilo completo); altrimenti resta nascosto.
export function collegaCerchio(doc, { nome = "", apri = null } = {}) {
  const b = doc && doc.getElementById("apri-profilo");
  if (!b) return;
  const i = typeof nome === "string" && nome.trim() ? [...nome.trim()][0].toLocaleUpperCase("it") : null;
  const attivo = i !== null && typeof apri === "function";
  b.hidden = !attivo;
  b.onclick = attivo ? apri : null;
  if (attivo) b.textContent = i;
}
