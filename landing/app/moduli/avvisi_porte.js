// Avvisi delle porte nella home (issue #65, spec v1 del CPO, passo 4 «Quando»; D48 A). Linea del CTO.
// Le notifiche push arrivano con D24: finché non ci sono, gli avvisi si vedono con l'app aperta e visibile.
// - «<nome> ti aspetta per lo svelamento» (testo del server), «Potete entrare adesso.»;
// - 10 minuti prima della fascia fissata («inizia tra N minuti») e per la mezz'ora fissata («inizia ora»);
// - ogni porta aperta resta raggiungibile con «Vai allo svelamento» fino alla scadenza delle 48 ore (martedì 21:00),
//   anche dopo lunedì 9:00, quando la sera delle chiavi non si vede più.
// Legge lo stato con creaSvelamento().leggi() (GET /app/api/svelamento): una lettura al minuto solo con porte aperte e
// app visibile, nessuna in secondo piano, si ferma con app spenta o accesso scaduto. Niente salvataggi locali, niente
// setInterval. Le regole restano al server; al telefono non arrivano mai le fasce dell'altra persona.
// Pagina, orologio e timer si passano da fuori, così si prova con node --test.
import { etichettaFascia, TESTI as TESTI_PORTA } from "./svelamento.js";

export const LETTURA_MS = 60000;
const MINUTO = 60000;
const PRIMA_MS = 10 * MINUTO;
const FASCIA_MS = 30 * MINUTO;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Provvisori, da rivedere con «contenuti» (la base è lo stesso testo della sera delle chiavi, chiavi.js).
export const TESTI_AVVISI = Object.freeze({
  aperta: "Una porta si è aperta: <nome>.",
  traPoco: "Lo svelamento con <nome> inizia tra <minuti>.",
  ora: "Lo svelamento con <nome> inizia ora.",
  entrambiPronti: TESTI_PORTA.entrambiPronti,
  bottone: "Vai allo svelamento",
  etichetta: "Vai allo svelamento con <nome>",
});

const tempo = (x) => (typeof x === "string" ? Date.parse(x) : NaN);
const nomeDi = (n) => (typeof n === "string" && n.trim() ? n.trim() : "una persona della stanza");
const aperte = (stato, ora) => (stato && Array.isArray(stato.porte) ? stato.porte : [])
  .filter((p) => p && UUID.test(String(p.porta || "")) && tempo(p.scade_il) > ora);

// Cosa dire per ogni porta ancora aperta, sull'orologio di chi guarda.
export function avvisiPorte(stato, adesso = new Date()) {
  const ora = adesso.getTime();
  return aperte(stato, ora).map((p) => {
    const nome = nomeDi(p.nome);
    const mioVivo = p.mio_pronto === true && tempo(p.pronto_scade_il) > ora;
    const suo = p.suo_pronto === true;
    const inizio = tempo(p.fascia_fissata);
    let testo = TESTI_AVVISI.aperta.replace("<nome>", nome);
    let urgente = true;
    if (suo && mioVivo) testo = TESTI_AVVISI.entrambiPronti;
    else if (suo && typeof p.pronta === "string" && p.pronta.trim()) testo = p.pronta.trim();
    else if (Number.isFinite(inizio) && ora >= inizio && ora < inizio + FASCIA_MS) testo = TESTI_AVVISI.ora.replace("<nome>", nome);
    else if (Number.isFinite(inizio) && ora < inizio && inizio - ora <= PRIMA_MS) {
      const m = Math.max(1, Math.ceil((inizio - ora) / MINUTO));
      testo = TESTI_AVVISI.traPoco.replace("<nome>", nome).replace("<minuti>", `${m} ${m === 1 ? "minuto" : "minuti"}`);
    } else urgente = false;
    const fissata = !urgente && Number.isFinite(inizio) && inizio > ora && etichettaFascia(p.fascia_fissata)
      ? `${TESTI_PORTA.fasciaFissata}: ${etichettaFascia(p.fascia_fissata)}` : null;
    return { porta: p.porta, testo, urgente, fissata, bottone: TESTI_AVVISI.bottone, etichetta: TESTI_AVVISI.etichetta.replace("<nome>", nome) };
  });
}

// Quanto aspettare prima della prossima lettura; null = fermarsi (si rilegge quando l'app torna visibile).
export function prossimaLettura(r, adesso = new Date()) {
  if (!r || typeof r !== "object" || r.ok !== true) {
    if (r && (r.motivo === "spento" || r.motivo === "accesso")) return null;
    return LETTURA_MS;
  }
  return aperte(r.stato, adesso.getTime()).length ? LETTURA_MS : null;
}

export function creaAvvisiPorte({ svelamento, aggiorna = () => {}, pagina = null, adesso = () => new Date(),
  setTimeout: dopo = globalThis.setTimeout, clearTimeout: annulla = globalThis.clearTimeout }) {
  let attiva = false;
  let inLettura = false;
  let timer = null;
  let giro = 0;
  let stato = null;
  let avvisi = [];
  let firma = "[]";
  const visibile = () => !pagina || pagina.visibilityState === "visible";
  const cancella = () => { if (timer !== null) { annulla(timer); timer = null; } };

  function ricalcola() {
    avvisi = avvisiPorte(stato, adesso());
    const nuova = JSON.stringify(avvisi);
    if (nuova === firma) return;
    firma = nuova;
    try { aggiorna(); } catch { /* la vista non deve fermare gli avvisi */ }
  }

  async function leggi() {
    if (!attiva || inLettura || !visibile()) return;
    cancella();
    inLettura = true;
    const questo = giro;
    let r = null;
    try { r = await svelamento.leggi(); } catch { r = null; }
    inLettura = false;
    if (questo !== giro || !attiva) return;
    if (r && r.ok === true) stato = r.stato;
    else if (r && (r.motivo === "spento" || r.motivo === "accesso")) stato = null;
    ricalcola();
    const ms = prossimaLettura(r, adesso());
    if (ms === null || !visibile()) return;
    cancella();
    timer = dopo(leggi, ms);
  }

  function cambioVisibilita() {
    if (visibile()) leggi();
    else cancella();
  }

  return {
    avvia() {
      if (attiva) return;
      attiva = true;
      pagina?.addEventListener("visibilitychange", cambioVisibilita);
      leggi();
    },
    // Dopo un'azione nella schermata della porta: rileggere ora.
    subito() { leggi(); },
    ferma() {
      attiva = false;
      giro++;
      inLettura = false;
      cancella();
      pagina?.removeEventListener("visibilitychange", cambioVisibilita);
    },
    modello: () => ({ avvisi }),
  };
}

// Gli avvisi in cima a «La tua stanza». Con «soloUrgenti» (la sera delle chiavi mostra già le porte) restano solo
// «pronta», «tra N minuti» e «ora». Solo gli avvisi urgenti si annunciano al lettore di schermo.
export function vistaAvvisiPorte(h, ap, { apri, soloUrgenti = false } = {}) {
  const lista = ap.modello().avvisi.filter((a) => !soloUrgenti || a.urgente);
  if (!lista.length || typeof apri !== "function") return null;
  return h("div", { classe: "chiavi-sera avvisi-porte" },
    lista.map((a) => h("div", { classe: "porta-aperta" },
      h("p", a.urgente ? { role: "status" } : {}, h("strong", {}, a.testo)),
      a.fissata ? h("p", { classe: "nota" }, a.fissata) : null,
      h("button", { classe: "bottone", type: "button", "aria-label": a.etichetta, onclick: () => apri(a.porta) }, a.bottone))));
}
