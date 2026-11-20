// Pannello di chi decide (issue #7, spec v1.1 definitiva, «Cosa vede chi decide»; D51 A: in beta decide Giuseppe).
// Passo 13c della linea «sviluppatore-b». Parla SOLO con /app/api/pannello/* (worker/pannello_api.js) col token di chi
// decide: il Worker controlla che sia nella tabella moderatori. Qui solo testi e forma dei dati, niente pagina
// (così si prova con node --test). Niente salvataggi locali, niente log: nomi e racconti restano sullo schermo.

import { MOTIVI_MODULO } from "./segnala.js";
import { REGOLE_COMMUNITY, ID_REGOLE, testoRegola, regolaProposta } from "./regole_community.js";

const PERCORSO = "/app/api/pannello";
const ATTESA_MS = 10000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const ETICHETTE_MOTIVI = Object.freeze({
  ...Object.fromEntries(MOTIVI_MODULO),
  sono_in_difficolta: "Sono in difficoltà",
  non_al_sicuro: "Non mi sono sentita/o al sicuro (valutazione)",
});

// Stesso ordine delle azioni del Worker (spec: «Azioni»).
export const AZIONI_PANNELLO = Object.freeze([
  ["archivia", "Archivia (nessuna violazione)"],
  ["avviso", "Avviso"],
  ["sospensione_7", "Sospensione 7 giorni"],
  ["sospensione_30", "Sospensione 30 giorni"],
  ["esclusione", "Esclusione definitiva"],
  ["togli_cautelare", "Togli sospensione cautelare"],
].map(Object.freeze));
const SENZA_REGOLA = new Set(["archivia", "togli_cautelare"]);

// Regola violata: la vede anche chi riceve la sanzione («Regola violata: …»). Spec #7 v1.2: le 10 Regole della
// community ufficiali ([id, titolo]), niente «Altre regole»; al Worker si manda l'id. Motivo libero: 100 caratteri.
export const REGOLE_PANNELLO = REGOLE_COMMUNITY;
export const MASSIMO_MOTIVO_DECISIONE = 100;

const LIVELLI = Object.freeze({ avviso: "Avviso", sospensione_7: "Sospensione 7 giorni", sospensione_30: "Sospensione 30 giorni", esclusione: "Esclusione definitiva" });
const ESITI_CHIAMATA = Object.freeze({ tempo_scaduto: "finita allo scadere dei 15 minuti", chiusa: "chiusa", chiudi_e_segnala: "chiusa con «Chiudi e segnala»", caduta: "caduta" });
const ESITI_PORTA = Object.freeze({ doppio_si: "doppio sì", chiusa: "chiusa", scaduta: "scaduta", chiudi_e_segnala: "chiusa con «Chiudi e segnala»", blocco: "chiusa per un blocco", sospensione: "chiusa per una sospensione" });

const QUANDO = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
function quando(iso) {
  const d = new Date(iso || "");
  return Number.isNaN(d.getTime()) ? "" : QUANDO.format(d);
}
const nome = (n) => (typeof n === "string" && n.trim() ? n.trim() : "");

export function tempoCheResta(scadeIl, adesso = new Date()) {
  const t = new Date(scadeIl || "").getTime();
  if (Number.isNaN(t)) return "";
  const minuti = Math.round(Math.abs(t - adesso.getTime()) / 60000);
  const g = Math.floor(minuti / 1440), h = Math.floor((minuti % 1440) / 60), m = minuti % 60;
  const durata = g ? `${g} g${h ? ` ${h} h` : ""}` : h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
  return t >= adesso.getTime() ? `Restano ${durata}` : `Scaduta da ${durata}`;
}

function chiSegnala(da, contro) {
  const a = nome(da), b = nome(contro);
  if (!b) return `${a || "Senza nome"} · nessuna persona collegata`;
  return `${a || "Senza nome"} segnala ${b}`;
}

// Elenco della coda: { id, motivo, priorita, chi, resta, rossa, note[] }. Righe non valide si scartano.
export function vociCoda(righe, adesso = new Date()) {
  if (!Array.isArray(righe)) return [];
  return righe.filter((r) => r && UUID.test(r.id || "")).map((r) => {
    const scaduta = new Date(r.scade_il || "").getTime() < adesso.getTime();
    const note = [r.aperta ? "Aperta" : "Nuova"];
    if (r.in_sospensione) note.push("Sospensione in corso");
    if (Number(r.archiviate_di_chi_segnala) > 0) note.push(`Chi segnala ha ${Number(r.archiviate_di_chi_segnala)} segnalazioni archiviate`);
    return {
      id: r.id,
      motivo: ETICHETTE_MOTIVI[r.motivo] || "Motivo sconosciuto",
      priorita: `Priorità ${r.ore === 1 ? "1 ora" : `${Number(r.ore) || "?"} ore`}`,
      chi: chiSegnala(r.nome_da, r.nome_contro),
      resta: tempoCheResta(r.scade_il, adesso),
      // Spec «Responsabile non raggiungibile»: dopo la scadenza resta in cima e rossa; da 1 ora e non aperta, subito rossa.
      rossa: scaduta || (r.ore === 1 && !r.aperta),
      note,
    };
  });
}

function durata(secondi) {
  const s = Number(secondi);
  if (!Number.isFinite(s)) return "durata sconosciuta";
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

// La scheda aperta in frasi. Si leggono solo i campi previsti: qualunque altro campo viene ignorato.
export function schedaLeggibile(scheda) {
  const s = scheda && scheda.segnalazione;
  if (!s || typeof s !== "object") return null;
  const da = nome(s.nome_da) || "chi segnala", contro = nome(s.nome_contro) || "la persona segnalata";
  const chiamate = (Array.isArray(scheda.chiamate) ? scheda.chiamate : []).map((c) =>
    `${quando(c.inizio)} · chiamava ${c.chiamava === "da" ? da : contro} · ${durata(c.durata)} · ${ESITI_CHIAMATA[c.esito] || "in corso"}`);
  const porte = (Array.isArray(scheda.porte) ? scheda.porte : []).map((p) => {
    const parti = [`Porta aperta il ${quando(p.aperta_il)}`];
    if (p.svelamento_iniziato_il) parti.push(`svelamento il ${quando(p.svelamento_iniziato_il)}`);
    parti.push(ESITI_PORTA[p.esito] || "in corso");
    return parti.join(" · ");
  });
  const st = scheda.storico || {};
  const storico = [
    ...(Array.isArray(st.segnalazioni) ? st.segnalazioni : []).map((x) =>
      `Segnalazione «${ETICHETTE_MOTIVI[x.motivo] || "?"}» del ${quando(x.creata_il)} · ${x.esito === "archiviata" ? "archiviata" : x.esito === "provvedimenti" ? "con provvedimenti" : "aperta"}`),
    ...(Array.isArray(st.sanzioni) ? st.sanzioni : []).map((z) =>
      `Sanzione «${LIVELLI[z.livello] || "?"}» (${testoRegola(z.regola) || "regola non indicata"}) del ${quando(z.decisa_il)}`),
  ];
  return {
    id: s.id,
    titolo: ETICHETTE_MOTIVI[s.motivo] || "Motivo sconosciuto",
    chi: chiSegnala(s.nome_da, s.contro ? (nome(s.nome_contro) || "persona senza nome") : null),
    quando: quando(s.creata_il),
    testo: typeof s.testo === "string" ? s.testo : "",
    chiamate,
    porte,
    storico,
    sanzionabile: typeof s.contro === "string" && s.contro.length > 0,
    regolaProposta: regolaProposta(s.motivo),
    // Spec #7 v1.2, punto 2: il database la manda solo con una porta tra i due e un motivo che riguarda la frase.
    fraseChiave: nome(s.frase_chiave),
  };
}

// Ricorsi (spec «Ricorso», passo 13f): stessi esiti del Worker (worker/pannello_api.js, ESITI_RICORSO).
export const ESITI_RICORSO_PANNELLO = Object.freeze([
  ["accolto", "Accolto: la sanzione si annulla subito"],
  ["respinto", "Respinto: la sanzione resta"],
].map(Object.freeze));

// Elenco dei ricorsi in attesa: { id, titolo, motivoSanzione, perche, inviato, resta, rossa, puoiDecidere }.
// «puoiDecidere» è falso per chi ha dato la sanzione: lo rifiuta comunque il database.
export function vociRicorsi(righe, adesso = new Date()) {
  if (!Array.isArray(righe)) return [];
  return righe.filter((r) => r && UUID.test(r.id || "")).map((r) => ({
    id: r.id,
    titolo: `${nome(r.nome) || "Senza nome"} contesta «${LIVELLI[r.livello] || "?"}» (${testoRegola(r.regola) || "regola non indicata"})`,
    motivoSanzione: typeof r.motivo_sanzione === "string" ? r.motivo_sanzione : "",
    perche: typeof r.testo === "string" && r.testo.trim() ? r.testo : "Nessun motivo scritto.",
    inviato: quando(r.inviato_il),
    resta: tempoCheResta(r.risposta_entro, adesso),
    rossa: new Date(r.risposta_entro || "").getTime() < adesso.getTime(),
    puoiDecidere: r.decisa_da_te !== true,
  }));
}

export function creaPannello({ token, fetch: f = globalThis.fetch }) {
  async function chiama(percorso, corpo) {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return { ok: false, motivo: "accesso" };
    const controllo = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controllo ? setTimeout(() => controllo.abort(), ATTESA_MS) : null;
    let r;
    try {
      r = await f(PERCORSO + percorso, {
        method: corpo === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${t}`, ...(corpo === undefined ? {} : { "content-type": "application/json" }) },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: controllo ? controllo.signal : undefined,
      });
    } catch {
      return { ok: false, motivo: "rete" };
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (r.status === 401) return { ok: false, motivo: "accesso" };
    if (r.status === 403) return { ok: false, motivo: "non_moderatore" };
    let dati = null;
    try { dati = await r.json(); } catch { dati = null; }
    if (!r.ok || !dati) return { ok: false, motivo: "riprova" };
    return dati;
  }
  return {
    async coda() {
      const d = await chiama("/coda");
      return d.ok ? { ok: true, coda: Array.isArray(d.coda) ? d.coda : [] } : d;
    },
    async scheda(id) {
      if (!UUID.test(id || "")) return { ok: false, motivo: "id" };
      const d = await chiama("/scheda", { id });
      return d.ok ? { ok: true, scheda: d.scheda } : d;
    },
    async decidi({ id, azione, regola, testo }) {
      if (!UUID.test(id || "")) return { ok: false, motivo: "id" };
      if (!AZIONI_PANNELLO.some(([a]) => a === azione)) return { ok: false, motivo: "azione" };
      const t = typeof testo === "string" ? testo.trim() : "";
      const r = typeof regola === "string" ? regola.trim() : "";
      if (r ? !ID_REGOLE.includes(r) : !SENZA_REGOLA.has(azione)) return { ok: false, motivo: "regola" };
      if (!t || t.length > MASSIMO_MOTIVO_DECISIONE) return { ok: false, motivo: "testo" };
      const d = await chiama("/decidi", { id, azione, regola: r, testo: t });
      return d.ok ? { ok: true } : { ok: false, motivo: d.motivo || "riprova" };
    },
    async ricorsi() {
      const d = await chiama("/ricorsi");
      return d.ok ? { ok: true, ricorsi: Array.isArray(d.ricorsi) ? d.ricorsi : [] } : d;
    },
    async decidiRicorso({ id, esito, testo }) {
      if (!UUID.test(id || "")) return { ok: false, motivo: "id" };
      if (!ESITI_RICORSO_PANNELLO.some(([e]) => e === esito)) return { ok: false, motivo: "esito" };
      const t = typeof testo === "string" ? testo.trim() : "";
      if (!t || t.length > 2000) return { ok: false, motivo: "testo" };
      const d = await chiama("/ricorso", { id, esito, testo: t });
      return d.ok ? { ok: true } : { ok: false, motivo: d.motivo || "riprova" };
    },
  };
}
