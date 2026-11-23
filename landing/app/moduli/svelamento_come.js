// Design v4 (#349, approvato da Giuseppe il 22/11), schermata 40 «Lo svelamento · Come» (#n28 nel prototipo).
// Linea «sviluppatore-c», d'accordo con il CTO (plancia 22/11). Due schede grandi (videochiamata con il cerchio dei
// 10 secondi, foto con la pila sfocata) e l'orario in un selettore unico «Adesso / Scegli un orario».
// Solo vista: le regole restano in svelamento.js e sul server (ps.scegli, ps.pronto, ps.mostraOrari,
// ps.impostaFascia, ps.inviaFasce). La scelta e le fasce dell'altra persona non arrivano mai qui.
// Gli orari restano 3 menu veri (tastiera e lettore di schermo), disegnati come le pillole del prototipo.
// Testi senza genere (D141): al posto di «Sono pronta» il pulsante resta «Ci sono adesso» del server.

export const TESTI_COME = Object.freeze({
  titolo: "Come vi volete",
  titoloEvidenza: "vedere?",
  video: "Videochiamata",
  videoNota: "Dieci secondi, poi si chiude da sola.",
  videoCerchio: "10 s",
  foto: "Le foto",
  fotoNota: "Le vostre tre foto, insieme.",
  quando: "Quando",
  adesso: "Adesso",
  orario: "Orario",
  nessunOrario: "Nessuno",
  salvaOrari: "Salva gli orari",
  orariSpiegazione: "Segna fino a 3 mezz'ore. L'app fissa la prima che avete in comune.",
});

const GIORNO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "short", day: "numeric" });
const ORA = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// «lun 16, 21:30» (ora italiana): entra nelle pillole strette; "" se l'orario non è leggibile.
export function orarioBreve(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${GIORNO.format(d)}, ${ORA.format(d)}`;
}

function scheda(h, ps, m, valore, attuale, immagine, titolo, nota) {
  const scelta = valore === attuale;
  return h("button", { classe: scelta ? "opz on" : "opz", type: "button", "aria-pressed": scelta ? "true" : "false",
    disabled: m.inCorso, onclick: () => ps.scegli(valore) },
  immagine, h("b", {}, titolo), h("span", {}, nota));
}

function vistaQuandoV4(h, ps, m, q) {
  const stato = [q.entrambi, q.mioPronto, q.pronta, q.fissata, q.nessuna].filter(Boolean)
    .map((t) => h("p", { role: "status" }, t));
  const orari = m.orari === true;
  const bozza = Array.isArray(m.bozza) ? m.bozza : [];
  const fila = orari ? [
    h("p", { classe: "nota", id: "orari-spiegazione" }, TESTI_COME.orariSpiegazione),
    h("div", { classe: "orari" }, [0, 1, 2].map((i) => h("div", { classe: "orario" },
      h("label", { classe: "nascosto", for: `fascia-${i + 1}` }, `${TESTI_COME.orario} ${i + 1}`),
      h("select", { id: `fascia-${i + 1}`, "aria-describedby": "orari-spiegazione", disabled: m.inCorso,
        onchange: (e) => ps.impostaFascia(i, e.target.value) },
      h("option", { value: "", selected: !bozza[i] }, TESTI_COME.nessunOrario),
      q.opzioni.map((o) => h("option", { value: o.valore, selected: o.valore === bozza[i] }, orarioBreve(o.valore) || o.testo)))))),
  ] : null;
  return [
    h("p", { classe: "passo", id: "quando-titolo" }, TESTI_COME.quando),
    stato,
    h("div", { classe: "segmenti", role: "group", "aria-labelledby": "quando-titolo" },
      h("button", { type: "button", "aria-pressed": orari ? "false" : "true", disabled: m.inCorso,
        onclick: () => { if (orari) ps.mostraOrari(); } }, TESTI_COME.adesso),
      h("button", { type: "button", "aria-pressed": orari ? "true" : "false", disabled: m.inCorso,
        onclick: () => { if (!orari) ps.mostraOrari(); } }, q.orario)),
    fila,
    orari
      ? h("button", { classe: "bottone", type: "button", disabled: m.inCorso, onclick: () => ps.inviaFasce() },
        m.inCorso ? "Un attimo…" : TESTI_COME.salvaOrari)
      : h("button", { classe: "bottone", type: "button", disabled: m.inCorso, onclick: () => ps.pronto() }, q.ora),
  ];
}

// La vista (h come in flusso.js). null se non c'è ancora niente da scegliere (prima della propria caparra).
export function vistaCome(h, ps, m, s) {
  if (!s || s.tipo !== "porta" || (!s.scelta && !s.quando)) return null;
  const parti = [h("h2", { id: "come-titolo" }, `${TESTI_COME.titolo} `, h("em", {}, TESTI_COME.titoloEvidenza))];
  if (s.scelta) {
    const a = s.scelta.attuale;
    parti.push(h("div", { classe: "scelta2", role: "group", "aria-labelledby": "come-titolo" },
      scheda(h, ps, m, "video", a, h("div", { classe: "anello", "aria-hidden": "true" }, h("span", {}, TESTI_COME.videoCerchio)),
        TESTI_COME.video, TESTI_COME.videoNota),
      scheda(h, ps, m, "foto", a, h("div", { classe: "pila", "aria-hidden": "true" }, h("i", {}), h("i", {}), h("i", {})),
        TESTI_COME.foto, TESTI_COME.fotoNota)));
  }
  if (s.quando) parti.push(vistaQuandoV4(h, ps, m, s.quando));
  return h("div", { classe: "come-svelamento" }, parti);
}
